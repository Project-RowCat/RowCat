import { createRowCatClient, type RowCatClient } from "@rowcat/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type AuthCookieSource,
	createAuthenticatedFetch,
} from "./auth-fetch.ts";

/**
 * **This file is the P0 of this slice.**
 *
 * What it verifies is one thing: when the RowCat client is built **once** and the process goes
 * through guest → Alice → guest → Bob, does each request carry the credential **of that moment**? A
 * cookie captured at construction stays stuck on the first step, and requests Bob sends then carry
 * Alice's cookie. That is not a defect; it is a cross-account incident.
 *
 * No simulator or SecureStore is needed, because the cookie source is an argument (see the
 * `auth-fetch.ts` header), and that is the value of the design.
 */

/** Current cookie. When a test changes this, the next request carries that value. */
let cookie: string | null = null;
const readCookie: AuthCookieSource = async () => cookie;

interface Seen {
	url: string;
	headers: Headers;
	init: RequestInit;
}

let seen: Seen[] = [];

/**
 * Responses are **the minimum the contract allows**. Returning arbitrary JSON would trip the SDK's
 * response validation first, and the header assertions we want would never be reached.
 */
const VIEWER = {
	id: "member-1",
	nickname: "Alice",
	status: "approved",
	role: "user",
	verified: false,
	adult: false,
	showAdult: false,
	ageStatus: "standard",
	membershipGate: null,
};

const bodyFor = (url: string): unknown => {
	if (url.includes("/me/sync/records"))
		return { ok: true, cursor: 0, conflicts: [] };
	if (url.endsWith("/me")) return null;
	return VIEWER;
};

/** Records requests actually sent. The body is not inspected — only the headers are checked here. */
const recordingFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input);
	seen.push({ url, headers: new Headers(init?.headers), init: init ?? {} });
	return Promise.resolve(
		new Response(JSON.stringify(bodyFor(url)), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	);
}) as typeof globalThis.fetch;

const last = (): Seen => {
	const entry = seen.at(-1);
	if (!entry) throw new Error("no request went out");
	return entry;
};

beforeEach(() => {
	cookie = null;
	seen = [];
});

describe("reads the current cookie on every request", () => {
	it("Alice → guest → Bob split on **the same client**", async () => {
		/**
		 * The client is built **once** here. The three requests below are all sent by this instance; only
		 * the cookie source changes between them.
		 */
		const client: RowCatClient = createRowCatClient({
			baseUrl: "https://api.test/v2",
			fetch: createAuthenticatedFetch(readCookie, recordingFetch),
		});

		cookie = "better-auth.session_token=alice";
		await client.me.get();
		expect(last().headers.get("Cookie")).toBe(
			"better-auth.session_token=alice",
		);

		// Sign out — the header **must not remain.** If it stayed, sign-out would never reach the server.
		cookie = null;
		await client.me.get();
		expect(last().headers.has("Cookie")).toBe(false);

		cookie = "better-auth.session_token=bob";
		await client.me.get();
		expect(last().headers.get("Cookie")).toBe("better-auth.session_token=bob");
	});

	it("an empty string counts as absent too", async () => {
		const authenticated = createAuthenticatedFetch(
			async () => "",
			recordingFetch,
		);
		await authenticated("https://api.test/v2/me");
		expect(last().headers.has("Cookie")).toBe(false);
	});

	/**
	 * **A request started late does not use an old cookie.** If the value were captured when the
	 * request is created, this assertion would fail: the value at client construction (guest) or at
	 * the first request (Alice) would linger, and a request started after Bob is activated would still
	 * go out as Alice.
	 */
	it("if it switches to Bob while a request started as Alice is in flight, the next request is Bob", async () => {
		let releaseAlice: (() => void) | undefined;
		let aliceStarted: (() => void) | undefined;
		/** Signal that the first request has actually gone out. Sleeping with a timer would make the failure depend on execution speed. */
		const started = new Promise<void>((resolve) => {
			aliceStarted = resolve;
		});

		const slowFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			seen.push({
				url: String(input),
				headers: new Headers(init?.headers),
				init: init ?? {},
			});
			// Hold only the first request — the account changes in the meantime.
			if (seen.length === 1) {
				aliceStarted?.();
				return new Promise<Response>((resolve) => {
					releaseAlice = () => resolve(new Response("null", { status: 200 }));
				});
			}
			return Promise.resolve(new Response("null", { status: 200 }));
		}) as typeof globalThis.fetch;

		const authenticated = createAuthenticatedFetch(readCookie, slowFetch);

		cookie = "session=alice";
		const inFlight = authenticated("https://api.test/v2/me");
		await started;
		expect(seen[0]?.headers.get("Cookie")).toBe("session=alice");

		// The account changes while Alice's request is still running.
		cookie = "session=bob";
		await authenticated("https://api.test/v2/me");
		expect(seen[1]?.headers.get("Cookie")).toBe("session=bob");

		releaseAlice?.();
		await inFlight;
		expect(seen).toHaveLength(2);
	});

	/**
	 * An **unreadable** credential is not the same as a missing one. Swallowing the error and sending
	 * without a cookie makes the server honestly answer guest, and the screen that receives that
	 * answer draws the user as signed out.
	 */
	it("when reading the cookie fails it throws without sending the request", async () => {
		const authenticated = createAuthenticatedFetch(
			() => Promise.reject(new Error("couldn't open the Keychain")),
			recordingFetch,
		);

		await expect(authenticated("https://api.test/v2/me")).rejects.toThrow();
		expect(seen).toHaveLength(0);
	});
});

describe("doesn't break the incoming request", () => {
	const client = () =>
		createRowCatClient({
			baseUrl: "https://api.test/v2",
			fetch: createAuthenticatedFetch(readCookie, recordingFetch),
		});

	it("the Accept and Content-Type the SDK set pass through as is", async () => {
		cookie = "session=alice";
		await client().me.updateNickname({ nickname: "New name" });

		const { headers, init } = last();
		expect(headers.get("Accept")).toBe("application/json");
		expect(headers.get("Content-Type")).toBe("application/json");
		expect(headers.get("Cookie")).toBe("session=alice");
		expect(init.method).toBe("PATCH");
		expect(init.body).toBe(JSON.stringify({ nickname: "New name" }));
	});

	/**
	 * The idempotency key for sync push. If this header is dropped, one retry becomes a second
	 * application, and the symptom appears in the **data**, not in the transport layer.
	 */
	it("doesn't remove per-request headers like Idempotency-Key", async () => {
		cookie = "session=alice";
		await client().sync.push({ items: [], idempotencyKey: "key-1234" });

		expect(last().headers.get("Idempotency-Key")).toBe("key-1234");
		expect(last().headers.get("Cookie")).toBe("session=alice");
	});

	it("the streaming Accept passes through as is", async () => {
		cookie = "session=alice";
		const streamingFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			seen.push({
				url: String(input),
				headers: new Headers(init?.headers),
				init: init ?? {},
			});
			/** A stream that closes at once — no frames at all. Only the headers are checked here. */
			const empty = new ReadableStream<Uint8Array>({
				start: (controller) => controller.close(),
			});
			return Promise.resolve(new Response(empty, { status: 200 }));
		}) as typeof globalThis.fetch;

		const streaming = createRowCatClient({
			baseUrl: "https://api.test/v2",
			fetch: createAuthenticatedFetch(readCookie, streamingFetch),
		});
		// It is a generator, so one pull is needed to send the request. No frames arrive, so it ends at
		// once.
		await streaming.sync.wakeStream().next();

		expect(last().headers.get("Accept")).toContain("text/event-stream");
		expect(last().headers.get("Cookie")).toBe("session=alice");
	});

	it("the cancel signal passes through as is", async () => {
		const controller = new AbortController();
		const authenticated = createAuthenticatedFetch(readCookie, recordingFetch);

		await authenticated("https://api.test/v2/me", {
			signal: controller.signal,
			method: "GET",
		});

		expect(last().init.signal).toBe(controller.signal);
		expect(last().init.method).toBe("GET");
	});

	/**
	 * Do not turn on the native cookie jar — the `include` the SDK sends is overridden here. Leaving
	 * it on gives the credential two sources, and the second one is not cleared by sign-out.
	 */
	it("doesn't use the OS cookie store", async () => {
		cookie = "session=alice";
		await client().me.get();
		expect(last().init.credentials).toBe("omit");
	});
});
