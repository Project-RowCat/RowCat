import { describe, expect, it } from "vitest";
import type {
	PreviewGeneration,
	PreviewGenerationRequest,
	PreviewGenerationResult,
} from "./protocol.ts";
import { PREVIEW_GENERATION_FAILURE } from "./runtime-preview-generation-failure.ts";
import {
	createPreviewGenerationRouter,
	type PreviewGenerationRouter,
} from "./runtime-preview-generation-router.ts";

/**
 * Generation races: restart, stop, leave, and late answers. These four are the most expensive part
 * of this slice. A wrong result is quiet: a stale session's answer lands in the new screen with no
 * error, or a paid request nobody reads runs to the end.
 */

const REQUEST: PreviewGenerationRequest = {
	messages: [{ role: "user", content: "hello" }],
	instructions: "You are Sena.",
	maxOutputCharacters: 600,
};

interface Harness {
	router: PreviewGenerationRouter;
	sent: {
		generation: PreviewGeneration;
		requestId: number;
		result: PreviewGenerationResult;
	}[];
	signals: AbortSignal[];
	generation: PreviewGeneration;
	adapter: ((request: PreviewGenerationRequest) => void) | null;
	settle(index: number, result: PreviewGenerationResult): void;
	reject(index: number, error: unknown): void;
	request(requestId: number, generation?: PreviewGeneration): void;
}

function harness(options: { adapter?: boolean } = {}): Harness {
	const sent: Harness["sent"] = [];
	const signals: AbortSignal[] = [];
	const settlers: {
		resolve: (result: PreviewGenerationResult) => void;
		reject: (error: unknown) => void;
	}[] = [];
	const state = { generation: 1 as PreviewGeneration, adapter: null };
	const has = options.adapter !== false;
	const router = createPreviewGenerationRouter({
		adapter: () =>
			has
				? (request, { signal }) => {
						signals.push(signal);
						return new Promise<PreviewGenerationResult>((resolve, reject) => {
							settlers.push({ resolve, reject });
							/** Abort is answered by the adapter as a rejection, the same as the real transport does. */
							signal.addEventListener(
								"abort",
								() =>
									resolve({
										ok: false,
										reason: "cancelled",
										message: "aborted",
									}),
								{ once: true },
							);
							void request;
						});
					}
				: null,
		currentGeneration: () => state.generation,
		send: (generation, requestId, result) =>
			sent.push({ generation, requestId, result }),
	});
	return {
		router,
		sent,
		signals,
		get generation() {
			return state.generation;
		},
		set generation(next: PreviewGeneration) {
			state.generation = next;
		},
		adapter: null,
		settle: (index, result) => settlers[index]?.resolve(result),
		reject: (index, error) => settlers[index]?.reject(error),
		request: (requestId, generation) =>
			router.handle({
				generation: generation ?? state.generation,
				requestId,
				request: REQUEST,
			}),
	};
}

const tick = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

describe("normal path", () => {
	it("the answer returns with the request's generation and number", async () => {
		const h = harness();
		h.request(1);
		h.settle(0, { ok: true, text: "nice to meet you" });
		await tick();
		expect(h.sent).toEqual([
			{
				generation: 1,
				requestId: 1,
				result: { ok: true, text: "nice to meet you" },
			},
		]);
		expect(h.router.pending()).toBe(0);
	});

	/**
	 * With several requests, each answer must reach its own promise. The request number is the
	 * identity.
	 */
	it("answers to several requests do not mix", async () => {
		const h = harness();
		h.request(1);
		h.request(2);
		h.settle(1, { ok: true, text: "second" });
		h.settle(0, { ok: true, text: "first" });
		await tick();
		expect(h.sent).toEqual([
			{ generation: 1, requestId: 2, result: { ok: true, text: "second" } },
			{ generation: 1, requestId: 1, result: { ok: true, text: "first" } },
		]);
	});

	/**
	 * Even if the adapter throws, the worker still gets an answer. Silently dropping it would leave
	 * the VM's promise unsettled forever, and the creator code in that session would stay stuck at
	 * `await`.
	 */
	it("an adapter exception also returns as a named failure", async () => {
		const h = harness();
		h.request(1);
		h.reject(0, new Error("transport blew up"));
		await tick();
		expect(h.sent).toEqual([
			{
				generation: 1,
				requestId: 1,
				result: {
					ok: false,
					reason: "failed",
					message: PREVIEW_GENERATION_FAILURE.failed,
				},
			},
		]);
	});

	/**
	 * The exception's sentence must not reach the worker. The adapter already folds it in its own
	 * catch, but this place must fold too, because an adapter can still end by rejecting instead of
	 * returning a result. If the original sentence passed here, it would carry a named reason and get
	 * past the host's general sanitizer into the VM.
	 */
	it("even when the adapter refuses, its sentence does not reach the worker", async () => {
		const h = harness();
		h.request(1);
		h.reject(
			0,
			new Error(
				"500 https://secret-provider.example key=sk-preview-secret /srv/provider.ts",
			),
		);
		await tick();
		const result = h.sent[0]?.result;
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message: PREVIEW_GENERATION_FAILURE.failed,
		});
		const serialized = JSON.stringify(h.sent);
		for (const secret of [
			"500",
			"secret-provider.example",
			"sk-preview-secret",
			"/srv/",
			"provider.ts",
			"https://",
		])
			expect(serialized).not.toContain(secret);
		/** No promise is left dangling: the request is settled and the pending count drops back. */
		expect(h.router.pending()).toBe(0);
	});

	it("without an adapter it is unavailable on the spot", async () => {
		const h = harness({ adapter: false });
		h.request(1);
		await tick();
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0]?.result).toEqual({
			ok: false,
			reason: "unavailable",
			message: PREVIEW_GENERATION_FAILURE.unavailable,
		});
	});
});

describe("restart: the generation changes", () => {
	/**
	 * §20: restart cancels running generation. The generation number alone would discard the answer,
	 * but without cancelling, an already-sent paid request would run to the end with nobody reading
	 * it.
	 */
	it("the running request is aborted and a late answer does not reach the new generation", async () => {
		const h = harness();
		h.request(1);
		expect(h.router.pending()).toBe(1);

		h.generation = 2;
		h.router.abort();
		expect(h.signals[0]?.aborted).toBe(true);
		expect(h.router.pending()).toBe(0);

		h.settle(0, { ok: true, text: "old session's answer" });
		await tick();
		expect(h.sent).toEqual([]);

		h.request(1);
		h.settle(1, { ok: true, text: "new session's answer" });
		await tick();
		expect(h.sent).toEqual([
			{
				generation: 2,
				requestId: 1,
				result: { ok: true, text: "new session's answer" },
			},
		]);
	});

	/**
	 * A request from a past generation must not call the adapter. Calling it would start a paid
	 * request that nobody reads.
	 */
	it("an old generation's request does not reach the adapter", async () => {
		const h = harness();
		h.generation = 3;
		h.request(1, 2);
		await tick();
		expect(h.signals).toEqual([]);
		expect(h.sent).toEqual([]);
	});
});

describe("stopping and leaving", () => {
	it("stopping aborts the running request", async () => {
		const h = harness();
		h.request(1);
		h.router.abort();
		await tick();
		expect(h.signals[0]?.aborted).toBe(true);
		expect(h.router.pending()).toBe(0);
	});

	/**
	 * Leaving (unmount) raises the generation and aborts. No answer goes out afterwards, so no promise
	 * is left holding a discarded screen.
	 */
	it("no answer goes out after leaving", async () => {
		const h = harness();
		h.request(1);
		h.request(2);
		h.generation = 2;
		h.router.abort();
		h.settle(0, { ok: true, text: "a" });
		h.settle(1, { ok: true, text: "b" });
		await tick();
		expect(h.sent).toEqual([]);
		expect(h.router.pending()).toBe(0);
	});

	it("aborting is idempotent; it does not throw with no running request", () => {
		const h = harness();
		expect(() => {
			h.router.abort();
			h.router.abort();
		}).not.toThrow();
	});
});
