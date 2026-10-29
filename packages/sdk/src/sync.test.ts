import { SYNC_ERROR_CODE, SYNC_WAKE_CONTENT_TYPE } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import type { ApiRequest, RowCatTransport } from "./client.ts";
import { RowCatApiError } from "./errors.ts";
import { createSyncApi } from "./sync.ts";

/**
 * Contract boundary of the sync transport. Three things are checked.
 *
 * The idempotency key goes out as a header. In the body it would be mixed into the request hash the
 * server computes, nullifying idempotency entirely. Keyring possession checks separate 'wrong' from
 * 'could not verify'. A response that deviates from the contract is not passed through.
 *
 * The last point matters especially here. If the server accidentally leaks `auth_key`, the schema
 * drops it. That is the last line of defense.
 */

function transportOf(
	reply: (request: ApiRequest) => unknown,
	voidReply: (request: ApiRequest) => void = () => undefined,
): { transport: RowCatTransport; sent: ApiRequest[] } {
	const sent: ApiRequest[] = [];
	return {
		sent,
		transport: {
			requestJson: async (request) => {
				sent.push(request);
				return reply(request);
			},
			requestVoid: async (request) => {
				sent.push(request);
				voidReply(request);
			},
			requestStream: () => Promise.reject(new Error("does not write")),
		},
	};
}

const apiOf = (
	reply: (request: ApiRequest) => unknown,
	voidReply?: (request: ApiRequest) => void,
) => {
	const { transport, sent } = transportOf(reply, voidReply);
	return { api: createSyncApi(transport), sent };
};

const PUSH_ITEM = {
	id: "record-0001",
	type: "chat.room",
	baseVersion: 0,
	ciphertext: '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAA"}',
	envelope: 1,
	deleted: false,
};

describe("keyring", () => {
	it("the read goes to `/me/sync/keyring` and null is normal", async () => {
		const { api, sent } = apiOf(() => ({ keyring: null }));
		expect(await api.getKeyring()).toEqual({ keyring: null });
		expect(sent[0]).toMatchObject({ method: "GET", path: "/me/sync/keyring" });
	});

	it("**the schema drops `authKey` from the response**", async () => {
		/**
		 * Even if the server leaks it, it disappears here. That the contract has no such field is part of
		 * the defense, and this test pins it.
		 */
		const { api } = apiOf(() => ({
			keyring: "{}",
			authKey: "must-not-leak",
			auth_key: "this-too",
		}));
		const result = await api.getKeyring();
		expect(result).toEqual({ keyring: "{}" });
		expect(JSON.stringify(result)).not.toContain("must-not-leak");
	});

	it("a response that breaks the contract does not pass", async () => {
		const { api } = apiOf(() => ({ keyring: 42 }));
		await expect(api.getKeyring()).rejects.toThrow();
	});

	it("registering is POST, replacing is PUT", async () => {
		const { api, sent } = apiOf(() => ({ keyring: "{}" }));
		await api.setupKeyring({ keyring: "{}", authKey: "AAAA" });
		await api.rewrapKeyring({ keyring: "{}", proof: "BBBB" });
		expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
			"POST /me/sync/keyring",
			"PUT /me/sync/keyring",
		]);
	});
});

describe("proof of possession", () => {
	it("204 is true", async () => {
		const { api, sent } = apiOf(() => undefined);
		expect(await api.verifyKeyring({ keyring: "{}", proof: "AAAA" })).toBe(
			true,
		);
		expect(sent[0]).toMatchObject({
			method: "POST",
			path: "/me/sync/keyring/verify",
		});
	});

	it("**only a confirmed mismatch** folds to false", async () => {
		const { api } = apiOf(
			() => undefined,
			() => {
				throw new RowCatApiError({
					status: 403,
					code: SYNC_ERROR_CODE.keyringProofInvalid,
					message: "proof mismatch",
				});
			},
		);
		expect(await api.verifyKeyring({ keyring: "{}", proof: "AAAA" })).toBe(
			false,
		);
	});

	it.each([
		["network failure", 0, "offline"],
		["server error", 500, "http_error"],
		["no keyring", 404, SYNC_ERROR_CODE.keyringMissing],
		["sign-in required", 401, "login_required"],
	])("%s **throws**; it does not fold to false", async (_label, status, code) => {
		/**
		 * Folding this into `false` would make the caller (auto-unlock) drop trust while offline. A user
		 * who failed once on a plane would have to find the recovery code again.
		 */
		const { api } = apiOf(
			() => undefined,
			() => {
				throw new RowCatApiError({ status, code, message: "failure" });
			},
		);
		await expect(
			api.verifyKeyring({ keyring: "{}", proof: "AAAA" }),
		).rejects.toThrow();
	});
});

describe("records", () => {
	it("pull carries the cursor as a query", async () => {
		const { api, sent } = apiOf(() => ({
			records: [],
			cursor: 7,
			hasMore: false,
		}));
		await api.pull({ since: 7, limit: 50 });
		expect(sent[0].path).toBe("/me/sync/records");
		expect(sent[0].search?.get("since")).toBe("7");
		expect(sent[0].search?.get("limit")).toBe("50");
	});

	it("**the idempotency key is a header, not part of the body**", async () => {
		/**
		 * The idempotency key must stay out of the body. In the body it becomes part of the request hash
		 * the server computes, so retries of the same chunk would each produce a different hash and
		 * idempotency would fail.
		 */
		const { api, sent } = apiOf(() => ({ ok: true, cursor: 1, conflicts: [] }));
		await api.push({ items: [PUSH_ITEM], idempotencyKey: "a".repeat(20) });

		expect(sent[0].headers).toEqual({ "Idempotency-Key": "a".repeat(20) });
		expect(sent[0].body).toEqual({ items: [PUSH_ITEM] });
		expect(JSON.stringify(sent[0].body)).not.toContain("a".repeat(20));
	});

	it("a conflict is **a value, not an exception**", async () => {
		const { api } = apiOf(() => ({
			ok: false,
			cursor: 3,
			conflicts: [{ id: "record-0001", serverVersion: 2 }],
		}));
		const response = await api.push({
			items: [PUSH_ITEM],
			idempotencyKey: "a".repeat(20),
		});
		expect(response.ok).toBe(false);
		expect(response.conflicts).toEqual([
			{ id: "record-0001", serverVersion: 2 },
		]);
	});

	it("passes the idempotent retry marker through", async () => {
		const { api } = apiOf(() => ({
			ok: true,
			cursor: 3,
			conflicts: [],
			deduplicated: true,
		}));
		expect(
			(await api.push({ items: [PUSH_ITEM], idempotencyKey: "a".repeat(20) }))
				.deduplicated,
		).toBe(true);
	});

	it("a 200 that breaks the contract does not pass", async () => {
		const { api } = apiOf(() => ({ records: [{ id: "x" }], cursor: 0 }));
		await expect(api.pull({ since: 0 })).rejects.toThrow();
	});

	it("the transport has no slot for plaintext", async () => {
		// This resource sees only already-encrypted strings and server bookkeeping.
		const { api, sent } = apiOf(() => ({ ok: true, cursor: 1, conflicts: [] }));
		await api.push({ items: [PUSH_ITEM], idempotencyKey: "a".repeat(20) });
		const body = sent[0].body as { items: Array<Record<string, unknown>> };
		expect(Object.keys(body.items[0]).sort()).toEqual([
			"baseVersion",
			"ciphertext",
			"deleted",
			"envelope",
			"id",
			"type",
		]);
	});
});

/*
 * Wake stream. Three things are checked here: where it goes, what counts as an event, and that
 * malformed frames are not passed through.
 *
 * The last matters most. If an `undefined` cursor passed through, the lifecycle layer would try to
 * compare it with the local cursor.
 */

const encoder = new TextEncoder();

const streamTransportOf = (
	chunks: string[],
	onRequest?: (request: ApiRequest) => void,
): { transport: RowCatTransport; sent: ApiRequest[] } => {
	const sent: ApiRequest[] = [];
	return {
		sent,
		transport: {
			requestJson: () => Promise.reject(new Error("does not write")),
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: async (request) => {
				sent.push(request);
				onRequest?.(request);
				return new ReadableStream<Uint8Array>({
					start(controller) {
						for (const chunk of chunks)
							controller.enqueue(encoder.encode(chunk));
						controller.close();
					},
				});
			},
		},
	};
};

const wakeApiOf = (chunks: string[]) => {
	const { transport, sent } = streamTransportOf(chunks);
	return { api: createSyncApi(transport), sent };
};

const drain = async (
	stream: AsyncGenerator<{ cursor: number }>,
): Promise<number[]> => {
	const cursors: number[] = [];
	for await (const event of stream) cursors.push(event.cursor);
	return cursors;
};

describe("wake stream", () => {
	it("goes to `/me/sync/events` and asks for SSE", async () => {
		const { api, sent } = wakeApiOf(['event: sync\ndata: {"cursor":1}\n\n']);
		await drain(api.wakeStream());
		expect(sent[0]).toMatchObject({
			method: "GET",
			path: "/me/sync/events",
			accept: SYNC_WAKE_CONTENT_TYPE,
		});
		// No query and no body. There is nowhere in the request to name the owner.
		expect(sent[0].search).toBeUndefined();
		expect(sent[0].body).toBeUndefined();
	});

	it("reads cursors through the contract and yields them one by one", async () => {
		const { api } = wakeApiOf([
			'event: sync\ndata: {"cursor":1}\n\n',
			'event: sync\ndata: {"cursor":7}\n\n',
		]);
		expect(await drain(api.wakeStream())).toEqual([1, 7]);
	});

	it("heartbeats do not become events", async () => {
		const { api } = wakeApiOf([
			": ping\n\n",
			": ping\n\n",
			'event: sync\ndata: {"cursor":3}\n\n',
			": ping\n\n",
		]);
		expect(await drain(api.wakeStream())).toEqual([3]);
	});

	/**
	 * Unrecognized event names are silently ignored. If a second frame kind appears later, existing
	 * clients stay safe.
	 */
	it("events with other names are ignored", async () => {
		const { api } = wakeApiOf([
			'event: futurething\ndata: {"cursor":99}\n\n',
			'data: {"cursor":4}\n\n',
			'event: sync\ndata: {"cursor":5}\n\n',
		]);
		expect(await drain(api.wakeStream())).toEqual([5]);
	});

	it("a frame with broken JSON does not pass", async () => {
		const { api } = wakeApiOf(["event: sync\ndata: {broken\n\n"]);
		await expect(drain(api.wakeStream())).rejects.toMatchObject({
			code: "invalid_stream_frame",
		});
	});

	it("a frame shaped differently from the contract does not pass", async () => {
		const { api } = wakeApiOf(['event: sync\ndata: {"cursor":-1}\n\n']);
		await expect(drain(api.wakeStream())).rejects.toMatchObject({
			code: "invalid_response",
		});

		const noCursor = wakeApiOf(['event: sync\ndata: {"seq":3}\n\n']);
		await expect(drain(noCursor.api.wakeStream())).rejects.toMatchObject({
			code: "invalid_response",
		});
	});

	/**
	 * Fields outside the contract are cut out. If the server accidentally sends something, it never
	 * reaches client code. In this stream that is the last line of defense.
	 */
	it("fields outside the contract are cut", async () => {
		const { api } = wakeApiOf([
			'event: sync\ndata: {"cursor":2,"roomId":"r-1","ciphertext":"..."}\n\n',
		]);
		const events: unknown[] = [];
		for await (const event of api.wakeStream()) events.push(event);
		expect(events).toEqual([{ cursor: 2 }]);
	});

	/**
	 * A failure before the stream opens is an ordinary API error. The status code must survive so the
	 * caller can tell 401 (stop) from 5xx (back off, then reconnect). That is exactly why fetch is
	 * used instead of native `EventSource`.
	 */
	it("an HTTP failure before the stream arrives as an error with the status", async () => {
		const api = createSyncApi({
			requestJson: () => Promise.reject(new Error("does not write")),
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: () =>
				Promise.reject(
					new RowCatApiError({
						status: 401,
						code: "login_required",
						message: "Sign-in required.",
					}),
				),
		});
		await expect(drain(api.wakeStream())).rejects.toMatchObject({
			status: 401,
			code: "login_required",
		});
	});

	it("passes the abort signal through to the transport", async () => {
		const abort = new AbortController();
		const { api, sent } = wakeApiOf([]);
		await drain(api.wakeStream({ signal: abort.signal }));
		expect(sent[0].signal).toBe(abort.signal);
	});

	/** Leaving through `break` must release the socket. Server-side unsubscription depends on it. */
	it("stopping midway cancels the stream", async () => {
		let cancelled = false;
		const api = createSyncApi({
			requestJson: () => Promise.reject(new Error("does not write")),
			requestVoid: () => Promise.reject(new Error("does not write")),
			requestStream: async () =>
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(
							encoder.encode('event: sync\ndata: {"cursor":1}\n\n'),
						);
					},
					cancel() {
						cancelled = true;
					},
				}),
		});

		for await (const event of api.wakeStream()) {
			expect(event.cursor).toBe(1);
			break;
		}
		expect(cancelled).toBe(true);
	});
});
