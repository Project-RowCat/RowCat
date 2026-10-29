import {
	applyPlatformSafetyPolicy,
	conversationSafetyPolicy,
	resolvePlatformAllAges,
} from "@rowcat/chat/guards";
import {
	CHAT_ERROR_CODE,
	CHAT_STREAM_CONTENT_TYPE,
	type ChatStreamEvent,
	ManagedChatGenerationRequest,
	StoryChatGenerationRequest,
} from "@rowcat/contracts";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { ApiError, invalidInput } from "../lib/errors.ts";
import { canViewAdult, requireActiveViewer } from "../lib/gates.ts";
import { checkRateLimit } from "../lib/rate-limit/index.ts";
import { getViewer } from "../middleware/viewer.ts";
import { requireManagedGenerationAccess } from "../services/generation/access.ts";
import {
	MANAGED_GENERATION_WALL_CLOCK_MS,
	startChatGeneration,
} from "../services/generation/chat.ts";
import { listGenerationModels } from "../services/generation/models.ts";
import { startProtectedStoryGeneration } from "../services/generation/story.ts";
import { requireFeatureEnabled } from "../services/ops.ts";
import {
	parseChatSeed,
	requirePlayableStory,
} from "./stories/playback-gate.ts";

/**
 * Conversation generation as a transient compute service. It creates no rooms, stores no messages
 * and keeps no history; the server has no conversation table by decision, since the device owns the
 * conversation and the server only calls the model on its behalf.
 *
 * So the prompt rides in the request body, passes through this process to the provider and is gone
 * with the response: never stored, never logged (services/generation/chat.ts).
 *
 * One frame is one NDJSON line; the reason for NDJSON over SSE is in `@rowcat/contracts`.
 */
export const chat = new Hono<AppEnv>()
	/**
	 * The selectable generation targets. No authentication: the list holds only public model names
	 * (managed upstream slugs never leave, see `services/generation/models.ts`) and is the same for
	 * everyone, and a gate would tie the settings screen's server render to a session for no gain.
	 *
	 * This is not a settings API (`GET /settings` stays forbidden): it answers what can be chosen, a
	 * fact of the server-owned generation domain, while the user's choice stays on the device. It also
	 * does not validate credentials; being listed does not mean the user's key works, and the provider
	 * answers that at request time.
	 */
	.get("/models", (c) => {
		// Short cache: a long-lived intermediary would keep a withdrawn model selectable for a while.
		c.header("Cache-Control", "public, max-age=300");
		return c.json({ models: listGenerationModels() });
	})
	.post("/generate", async (c) => {
		// Approved members only: guest access ends at the gallery, and an open door here makes our key an
		// anonymous free API. Decided on the RowCat member (Viewer), not the Better Auth account id; the
		// same function already blocks suspended and banned accounts.
		const viewer = requireActiveViewer(await getViewer(c));
		/**
		 * The managed-generation breaker (`ops` slice), placed right after the gate and before body
		 * parsing so that when off, no upstream request goes out and no prompt is assembled. BYO
		 * generation is not stopped by this line: it goes browser to provider without passing our server,
		 * the same fact as moderation deliberately having no `chat.generate` capability.
		 */
		await requireFeatureEnabled("chat");

		// Allowlist comes before the rate limit (`services/generation/access.ts`) so a refused member
		// does not consume their own window, and nothing goes upstream.
		requireManagedGenerationAccess(viewer);

		/**
		 * Rate limit, before the upstream call. Managed generation runs on the operator's key and is
		 * unmetered, so this line plus the wall-clock cap (`MANAGED_GENERATION_WALL_CLOCK_MS`) is the
		 * server-side spend defence. Like the breaker, it cannot stop BYO generation.
		 */
		await checkRateLimit("managedGeneration", viewer.id);
		await checkRateLimit("managedGenerationDaily", viewer.id);

		// A managed request, not a provider-neutral one: the contract's enum narrows the model to the
		// public managed identity, so upstream slugs and BYO provider names are not expressible here. The
		// service maps back to the real upstream route with its own allowlist
		// (`services/generation/managed-models.ts`).
		const parsed = ManagedChatGenerationRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		/**
		 * The final authority for safety policy is here. The body's `system` is client-assembled context;
		 * our web sends guards built by the same rules (@rowcat/chat), but that holds only on paths
		 * running our code. Any HTTP client with a session cookie can call this endpoint and drop the
		 * guards or send "ignore the rules above", and it is our platform model that runs. So the server
		 * decides two things:
		 * 1. Rating: adult mode is downgraded to all-ages without member entitlement, using the same
		 *    gate as gallery and detail (`canViewAdult`); a second definition would diverge and show up
		 *    as adult content exposure.
		 * 2. Guards: the absolute, rating, (minor) and house-rule guards plus the tail guard wrap both
		 *    ends of the prompt, and only here. Clients no longer send them (the request body is visible
		 *    in devtools), and a body from an older client that already carries them is not wrapped again
		 *    (`applyPlatformSafetyPolicy`).
		 *
		 * Rooms and history still do not exist on the server; this is only this request's policy
		 * decision.
		 */
		const allAges = resolvePlatformAllAges({
			requestedMode: parsed.data.context.requestedMode,
			adultAllowed: canViewAdult(viewer),
		});
		const request = {
			...parsed.data,
			system: applyPlatformSafetyPolicy(parsed.data.system, {
				...conversationSafetyPolicy(parsed.data.context),
				allAges,
			}),
		};

		// A client disconnect cuts upstream too; otherwise stopping would still let the model generate to
		// the end on tokens we pay for (route exit and tab close are the same signal). The wall-clock cap
		// keeps a never-ending stream from burning upstream tokens indefinitely.
		const signal = AbortSignal.any([
			c.req.raw.signal,
			AbortSignal.timeout(MANAGED_GENERATION_WALL_CLOCK_MS),
		]);

		// Awaiting here is the point: missing provider config (503), unknown model (400) and upstream
		// failure (502) surface before any 200 is sent, so they go out in the shared error envelope
		// (`ApiErrorBody`) and the SDK receives a `RowCatApiError`. Opening the stream first would put
		// them inside a 200, indistinguishable from a generation that produced nothing.
		const events = await startChatGeneration(request, signal);

		return streamChatEvents(c, events, signal);
	})
	/**
	 * Generation for prompt-protected stories, assembled by the server. The protected creative prompt
	 * never reaches the device (`/play` sends it blanked), so the device cannot build the system
	 * prompt: it sends only what it holds (history, memories, summary, role, note, intensity, added
	 * characters, narration pack) and the server reads the currently published seed and builds the
	 * prompt with the same assembler (`services/generation/story.ts`). The contract having no `system`
	 * slot is that boundary.
	 *
	 * Gate order matches plain generation (member, breaker, allowlist, rate limit, parse), plus one
	 * more: playback entitlement, through the same door as `/play` (`requirePlayableStory`). Losing
	 * the right to open the story stops that room, and re-deciding on every generation is the intended
	 * rule.
	 *
	 * A non-protected story is a 400. Leaving this route open would silently move ordinary
	 * conversations here to follow republishing, breaking "a room is a copy as of acquisition" for no
	 * reason.
	 */
	.post("/stories/:storyId/generate", async (c) => {
		const viewer = requireActiveViewer(await getViewer(c));
		await requireFeatureEnabled("chat");
		requireManagedGenerationAccess(viewer);
		await checkRateLimit("managedGeneration", viewer.id);
		await checkRateLimit("managedGenerationDaily", viewer.id);

		const parsed = StoryChatGenerationRequest.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) throw invalidInput(parsed.error);

		// Reads the currently published version on every request: republishing reaches open rooms
		// immediately, and hiding, going private or deletion stops the room from the next turn.
		const { storyId, payload } = await requirePlayableStory(
			c,
			c.req.param("storyId"),
		);
		const seed = parseChatSeed(storyId, payload);
		if (!seed.promptProtected)
			throw new ApiError(
				400,
				CHAT_ERROR_CODE.storyNotProtected,
				"This story isn't assembled on the server.",
			);

		// The story's rating comes first: an all-ages story stays all-ages even for an adult member (same
		// axis as `resolveAllAges`), with the request and member entitlement layered on top.
		const allAges =
			!seed.adult ||
			resolvePlatformAllAges({
				requestedMode: parsed.data.requestedMode,
				adultAllowed: canViewAdult(viewer),
			});

		const signal = AbortSignal.any([
			c.req.raw.signal,
			AbortSignal.timeout(MANAGED_GENERATION_WALL_CLOCK_MS),
		]);
		const events = await startProtectedStoryGeneration({
			seed,
			request: parsed.data,
			allAges,
			signal,
		});
		return streamChatEvents(c, events, signal);
	});

/**
 * Frame stream to NDJSON response, shared by both generation routes. Written twice, one copy would
 * eventually miss "an abort is not an error" or the proxy-buffering header, visible only in that
 * route's conversations.
 */
function streamChatEvents(
	c: Context<AppEnv>,
	events: AsyncGenerator<ChatStreamEvent>,
	signal: AbortSignal,
): Response {
	const encoder = new TextEncoder();
	const frame = (event: ChatStreamEvent): Uint8Array =>
		encoder.encode(`${JSON.stringify(event)}\n`);

	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			// Reads in `pull`, not `start`: the next chunk is drawn only when the consumer is ready, so a
			// slow client does not make us buffer the response in memory.
			try {
				const next = await events.next();
				if (next.done) {
					controller.close();
					return;
				}
				controller.enqueue(frame(next.value));
			} catch (error) {
				// Failure after the stream started: the 200 and headers are out, so the error envelope is
				// unavailable and it is reported as a frame, not as half a JSON for the parser to recover. A
				// user abort is not an error; the client is gone, so close quietly.
				if (signal.aborted) {
					controller.close();
					return;
				}
				console.error(
					`[chat] stream aborted: ${error instanceof Error ? error.name : "unknown"}`,
				);
				controller.enqueue(
					frame({
						type: "error",
						code: CHAT_ERROR_CODE.providerFailed,
						message: "Generation was interrupted.",
					}),
				);
				controller.close();
			}
		},
		// The consumer dropped the stream (disconnect, tab close). Ending the generator explicitly
		// releases the upstream socket, since `readProviderSse`'s finally runs then.
		async cancel() {
			await events.return(undefined).catch(() => {});
		},
	});

	c.header("Content-Type", CHAT_STREAM_CONTENT_TYPE);
	// Conversation content must not land in any intermediary cache.
	c.header("Cache-Control", "private, no-store");
	// A reverse proxy (nginx) buffering the response would defeat streaming entirely.
	c.header("X-Accel-Buffering", "no");
	return c.body(body);
}
