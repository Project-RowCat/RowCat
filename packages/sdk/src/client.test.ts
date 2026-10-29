import { describe, expect, it } from "vitest";
import { createRowCatClient } from "./client.ts";

/**
 * Tests for the transport itself (`sendRequest`), the first tests of this seam.
 *
 * No other test in this SDK checked it. Every other SDK test replaces the transport, so they only
 * check what `ApiRequest` a resource builds, not how that request becomes a `fetch` call. As a
 * result, a broken body serialization would pass every SDK test.
 *
 * The most costly silent spot is the binary body. Two fields (`body` and `rawBody`) fold into one
 * fetch `body`. If that fold is wrong, an image goes out as the string "{}" and the failure shows
 * up only as a server 400. So this file checks the folding rules rather than a resource:
 * - which field decides serialization,
 * - whether Content-Type matches it, and is absent when there is no body,
 * - whether credentials and cancellation are always included.
 *
 * Resources are not used because `sendRequest` is not exported; the transport is internal to the
 * client. Responses are mostly `invalid_response` because the fixtures are not contract-valid. This
 * file only inspects the outgoing request, so it swallows that failure.
 */

interface Call {
	url: string;
	init: RequestInit;
}

const BASE_URL = "https://api.test/v2";

/** A fetch stub that records outgoing requests. Response bodies are not this file's concern. */
function clientOf(headers?: HeadersInit) {
	const calls: Call[] = [];
	const client = createRowCatClient({
		baseUrl: BASE_URL,
		headers,
		fetch: async (input, init) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
	});
	return { client, calls };
}

/**
 * Swallows response-validation failures. Building successful responses would require contract-valid
 * fixtures for each resource, and those values have nothing to do with what this file checks. The
 * request has already gone out by then.
 */
const send = (run: Promise<unknown>) => run.catch(() => undefined);

/**
 * Init headers arrive as a `Headers` instance, but the reader must not depend on that. `new
 * Headers(...)` accepts any HeadersInit.
 */
const headerOf = (init: RequestInit, name: string) =>
	new Headers(init.headers).get(name);

const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {
	type: "image/png",
});

describe("sendRequest: body serialization", () => {
	it("a JSON body folds to a string and gets Content-Type", async () => {
		const { client, calls } = clientOf();

		await send(client.me.updateShowAdult({ showAdult: true }));

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`${BASE_URL}/me/show-adult`);
		expect(calls[0]?.init.method).toBe("PATCH");
		expect(calls[0]?.init.body).toBe(JSON.stringify({ showAdult: true }));
		expect(headerOf(calls[0]?.init ?? {}, "Content-Type")).toBe(
			"application/json",
		);
	});

	/**
	 * The most important assertion in this file. It compares identity (`toBe`), not value.
	 *
	 * A value comparison would miss this bug. `JSON.stringify(blob)` does not throw; it produces the
	 * string "{}". That request still goes out and fails only on the server. When the same object
	 * reaches fetch, the bad path cannot happen.
	 */
	it("a binary body rides untouched", async () => {
		const { client, calls } = clientOf();

		await send(client.stories.setCover("story-1", image));

		expect(calls[0]?.url).toBe(`${BASE_URL}/stories/story-1/cover`);
		expect(calls[0]?.init.method).toBe("PUT");
		expect(calls[0]?.init.body).toBe(image);
		// The media type the caller declares becomes the header as-is. The transport does not guess
		// again.
		expect(headerOf(calls[0]?.init ?? {}, "Content-Type")).toBe("image/png");
	});

	/**
	 * Does not attach Content-Type to a request without a body. Otherwise every GET would claim it
	 * carries JSON, and proxies, server logs, and CORS preflight decisions would all rest on that
	 * false claim.
	 */
	it("no body means neither body nor Content-Type", async () => {
		const { client, calls } = clientOf();

		await send(client.stories.get("story-1"));

		expect(calls[0]?.init.method).toBe("GET");
		expect(calls[0]?.init.body).toBeUndefined();
		expect(headerOf(calls[0]?.init ?? {}, "Content-Type")).toBeNull();
	});
});

describe("sendRequest: what always rides", () => {
	/**
	 * The session cookie must be sent in all three shapes. If it is missing, the server cannot resolve
	 * the viewer, and a logged-in user gets the anonymous gallery: their private works and adult
	 * settings disappear. The failure is silent, so all three shapes are checked.
	 */
	it("carries credentials in all three shapes", async () => {
		const { client, calls } = clientOf();

		await send(client.stories.get("story-1"));
		await send(client.me.updateShowAdult({ showAdult: false }));
		await send(client.stories.setCover("story-1", image));

		expect(calls).toHaveLength(3);
		for (const call of calls) expect(call.init.credentials).toBe("include");
	});

	it("passes the abort signal through", async () => {
		const { client, calls } = clientOf();
		const controller = new AbortController();

		await send(client.stories.get("story-1", { signal: controller.signal }));
		await send(
			client.stories.setCover("story-1", image, { signal: controller.signal }),
		);

		expect(calls[0]?.init.signal).toBe(controller.signal);
		expect(calls[1]?.init.signal).toBe(controller.signal);
	});

	/**
	 * Per-request headers override default headers. If this direction flipped, a sync push's
	 * idempotency key would be overwritten by the value fixed at client creation. Different chunks
	 * would then share one key, and the second chunk would fold into a retry, so those records would
	 * never reach the server.
	 */
	it("per-request headers override default headers", async () => {
		const { client, calls } = clientOf({ "Idempotency-Key": "client-default" });

		await send(client.sync.push({ items: [], idempotencyKey: "chunk-1" }));

		expect(headerOf(calls[0]?.init ?? {}, "Idempotency-Key")).toBe("chunk-1");
	});

	/**
	 * Default headers stay on every request. The Cookie supplied by SSR must not disappear from a
	 * request.
	 */
	it("default headers ride every request", async () => {
		const { client, calls } = clientOf({ Cookie: "session=abc" });

		await send(client.stories.get("story-1"));
		await send(client.stories.setCover("story-1", image));

		expect(headerOf(calls[0]?.init ?? {}, "Cookie")).toBe("session=abc");
		expect(headerOf(calls[1]?.init ?? {}, "Cookie")).toBe("session=abc");
	});
});

describe("public base", () => {
	it("addresses are built from `publicBaseUrl` and requests go to `baseUrl`", async () => {
		const calls: string[] = [];
		const client = createRowCatClient({
			baseUrl: "http://api-internal:3001/v2",
			publicBaseUrl: "https://api.example/v2",
			fetch: async (input) => {
				calls.push(String(input));
				return new Response("null", {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});

		/** URLs must be openable by the browser. An internal host must never appear in the HTML. */
		expect(client.media.url("media-1")).toBe(
			"https://api.example/v2/media/media-1",
		);

		await client.me.get();
		/** Requests, by contrast, go to the internal network. The two axes never mix. */
		expect(calls[0]).toBe("http://api-internal:3001/v2/me");
	});

	it("unset, it equals the request base", () => {
		const client = createRowCatClient({ baseUrl: "https://api.example/v2/" });
		expect(client.media.url("media-1")).toBe(
			"https://api.example/v2/media/media-1",
		);
	});
});
