import {
	ABSOLUTE_GUARD,
	ALL_AGES_TAIL,
	HOUSE_RULES,
} from "@rowcat/chat/guards";
import { CHAT_ERROR_CODE, type StoryChatSeedInput } from "@rowcat/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { story } from "../db/schema.ts";
import { newId } from "../lib/id.ts";
import { allowManagedGeneration, createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * Prompt-protected stories: the manuscript never leaves the server. Checks that the seed a device
 * receives has no manuscript (`/play`), that the prompt the server assembles from it reaches
 * upstream (`/chat/stories/:id/generate`), and that this route passes through the same playback
 * entitlement gate. Without the last, someone not entitled to open the story would get responses
 * assembled from its manuscript, leaking a private story's text.
 */

const EMAIL_PREFIX = "chat-story-test-";

const databaseReady = await connectTestDatabase();

afterEach(() => {
	vi.restoreAllMocks();
});

afterAll(async () => {
	if (databaseReady) {
		await deleteTestUsers(EMAIL_PREFIX);
		await db
			.delete(story)
			.where(and(isNull(story.owner), eq(story.title, STORY_TITLE)));
	}
	await closeDb();
});

const STORY_TITLE = "protected-story server assembly test";

const unlisted = () =>
	createTestMember(EMAIL_PREFIX, { name: "Protected story" });
// A member on the managed-generation allowlist; this file tests the gates behind that one
// (`test/auth.ts`).
const signUp = async () => {
	const created = await unlisted();
	await allowManagedGeneration(created.memberId);
	return created;
};

const payload = (
	storyId: string,
	overrides: Partial<StoryChatSeedInput> = {},
): StoryChatSeedInput => ({
	version: 1,
	storyId,
	title: STORY_TITLE,
	adult: false,
	promptProtected: true,
	scenario: "SCENARIO_MARKER A harbor city in the rain.",
	playGuide: "PLAYGUIDE_MARKER Keep it short.",
	firstScene: "*The door opens.*",
	lore: [
		{
			keys: ["lighthouse"],
			content: "LORE_MARKER The lighthouse keepers are twins.",
		},
	],
	...overrides,
});

async function seedStory(
	ownerId: string,
	overrides: Partial<StoryChatSeedInput> = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: STORY_TITLE,
		visibility: "public",
		adult: false,
		prompt_protected: overrides.promptProtected ?? true,
		play_payload: payload(id, overrides),
	});
	return id;
}

// The device's share: no seed and no `system`.
const assembly = (overrides: Record<string, unknown> = {}) => ({
	messages: [{ role: "user", speaker: "Ray", content: "Hi" }],
	model: "claude-sonnet-5",
	...overrides,
});

const generate = (
	cookie: string | null,
	storyId: string,
	body: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/chat/stories/${storyId}/generate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const sse = (frames: string[]): Response =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							...frames.map((frame) => `data: ${frame}\n\n`),
							"data: [DONE]\n\n",
						].join(""),
					),
				);
				controller.close();
			},
		}),
		{ status: 200, headers: { "content-type": "text/event-stream" } },
	);

const TEXT_REPLY = sse([
	'{"choices":[{"delta":{"content":"Yes"},"finish_reason":"stop"}]}',
]);

// Collects upstream request bodies in order and serves the given responses one by one.
function provider(responses: (() => Response)[]): {
	bodies: () => { messages: { role: string; content: string }[] }[];
} {
	const bodies: { messages: { role: string; content: string }[] }[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		const next = responses[bodies.length - 1] ?? (() => TEXT_REPLY.clone());
		return next();
	});
	return { bodies: () => bodies };
}

const eventsOf = async (response: Response) =>
	(await response.text())
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Record<string, unknown>);

const systemOf = (body: { messages: { role: string; content: string }[] }) =>
	body.messages.find((message) => message.role === "system")?.content ?? "";

describe.skipIf(!databaseReady)("the seed sent down to the device", () => {
	test("a protected story's /play has no creative prompt", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId);
		const response = await app.request(`/v2/stories/${id}/play`, {
			headers: { Cookie: owner.cookie },
		});
		expect(response.status).toBe(200);
		const text = await response.text();
		for (const marker of ["SCENARIO_MARKER", "PLAYGUIDE_MARKER", "LORE_MARKER"])
			expect(text).not.toContain(marker);
		// The opening the screen draws is kept.
		expect(text).toContain("*The door opens.*");
	});

	test("a story that isn't protected goes down as is", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId, { promptProtected: false });
		const response = await app.request(`/v2/stories/${id}/play`, {
			headers: { Cookie: owner.cookie },
		});
		expect(await response.text()).toContain("SCENARIO_MARKER");
	});
});

describe.skipIf(!databaseReady)("server-assembled generation", () => {
	test("the server assembles from the published manuscript and the guards and sends it upstream", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId);
		const upstream = provider([() => TEXT_REPLY.clone()]);

		const response = await generate(owner.cookie, id, assembly());
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			WEB_ORIGIN,
		);
		await response.text();

		const system = systemOf(upstream.bodies()[0]);
		expect(system.startsWith(ABSOLUTE_GUARD)).toBe(true);
		expect(system).toContain(HOUSE_RULES);
		expect(system).toContain("SCENARIO_MARKER");
		expect(system).toContain("PLAYGUIDE_MARKER");
		expect(system.endsWith(ALL_AGES_TAIL)).toBe(true);
	});

	test("a republish reaches the very next turn — the room is not a copy", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId);
		await db
			.update(story)
			.set({
				play_payload: payload(id, { scenario: "REPUBLISHED_MARKER" }),
			})
			.where(eq(story.id, id));
		const upstream = provider([() => TEXT_REPLY.clone()]);

		await (await generate(owner.cookie, id, assembly())).text();
		expect(systemOf(upstream.bodies()[0])).toContain("REPUBLISHED_MARKER");
	});

	test("stories that aren't protected don't come through this path", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId, { promptProtected: false });
		provider([]);
		const response = await generate(owner.cookie, id, assembly());
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: CHAT_ERROR_CODE.storyNotProtected,
		});
	});

	test("the request has no slot to carry a prompt", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId);
		provider([]);
		const response = await generate(
			owner.cookie,
			id,
			assembly({ system: "A prompt I wrote myself" }),
		);
		expect(response.status).toBe(400);
	});
});

describe.skipIf(!databaseReady)("the playback entitlement door", () => {
	test("a guest gets 401 and never reaches upstream", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId);
		const upstream = provider([]);
		const response = await generate(null, id, assembly());
		expect(response.status).toBe(401);
		expect(upstream.bodies()).toHaveLength(0);
	});

	// A story the caller cannot see is the same 404 as a missing one and never reaches upstream: this
	// route assembles turns from the manuscript, so the playback gate (`requirePlayableStory`)
	// applies.
	test("someone else's private story is 404 and never reaches upstream", async () => {
		const owner = await signUp();
		const stranger = await signUp();
		const id = await seedStory(owner.memberId);
		await db
			.update(story)
			.set({ visibility: "private" })
			.where(eq(story.id, id));
		const upstream = provider([]);
		const response = await generate(stranger.cookie, id, assembly());
		expect(response.status).toBe(404);
		expect(upstream.bodies()).toHaveLength(0);
	});

	// The allowlist applies here too. Skipping the shared function would let anyone use the operator's
	// key through protected stories alone, and that success looks like a normal response.
	test("a member not on the allowlist gets 403 and never reaches upstream", async () => {
		const owner = await unlisted();
		const id = await seedStory(owner.memberId);
		const upstream = provider([]);
		const response = await generate(owner.cookie, id, assembly());
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: CHAT_ERROR_CODE.managedNotAllowed,
		});
		expect(upstream.bodies()).toHaveLength(0);
	});

	test("an unknown story is 404", async () => {
		const someone = await signUp();
		provider([]);
		const response = await generate(someone.cookie, newId(), assembly());
		expect(response.status).toBe(404);
	});
});

describe.skipIf(!databaseReady)("the server's tool round trip", () => {
	test("the server runs the lore search and it ends in one stream", async () => {
		const owner = await signUp();
		const id = await seedStory(owner.memberId);
		const toolCall = sse([
			JSON.stringify({
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_0",
									function: {
										name: "lore_search",
										arguments: '{"query":"lighthouse"}',
									},
								},
							],
						},
					},
				],
			}),
			'{"choices":[{"finish_reason":"tool_calls"}]}',
		]);
		const upstream = provider([() => toolCall, () => TEXT_REPLY.clone()]);
		const events = await eventsOf(await generate(owner.cookie, id, assembly()));

		const bodies = upstream.bodies();
		expect(bodies).toHaveLength(2);
		// The second round trip carries the lore text as the tool result; the device never saw it.
		expect(JSON.stringify(bodies[1].messages)).toContain("LORE_MARKER");
		// The client never sees the tool call; it is one stream.
		expect(events.some((event) => event.type === "tool_call")).toBe(false);
		// Managed generation is unmetered, so no billing frame even with two round trips.
		expect(events.some((event) => event.type === "billing")).toBe(false);
		expect(events.at(-1)).toMatchObject({ type: "done" });
	});
});
