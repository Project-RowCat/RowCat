import { MCP_DEVICE_CLIENT_ID } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import {
	type BrowserSignInOptions,
	signInWithBrowser,
} from "./browser-sign-in.ts";

/**
 * The sign-in's endings, each checked by value: a fake server answers the two calls, the clock and
 * the sleep are the test's, and the opener only records what it was given. Most of these endings
 * would otherwise need a person to wait minutes in front of a browser.
 */

const API = "https://api.rowcat.test/v2";
const COMPLETE = "https://rowcat.test/device?user_code=ABCDEFGH";
const DEVICE_CODE = "device-code-that-must-not-be-printed";

const json = (status: number, body: unknown, cookies: string[] = []) => {
	const headers = new Headers({ "Content-Type": "application/json" });
	for (const cookie of cookies) headers.append("set-cookie", cookie);
	return new Response(JSON.stringify(body), { status, headers });
};

const issued = (overrides: Record<string, unknown> = {}) =>
	json(200, {
		device_code: DEVICE_CODE,
		user_code: "ABCDEFGH",
		verification_uri: "https://rowcat.test/device",
		verification_uri_complete: COMPLETE,
		expires_in: 600,
		interval: 5,
		...overrides,
	});

const pending = () => json(400, { error: "authorization_pending" });
const approved = () =>
	json(200, { ok: true }, [
		"better-auth.session_token=signed.value; Path=/; HttpOnly",
	]);

interface Call {
	readonly url: string;
	readonly body: unknown;
	readonly origin: string | null;
}

/** A server that answers issuance with `issue` and each poll with the next of `polls`. */
function harness(
	issue: () => Response | Promise<Response>,
	polls: (() => Response | Promise<Response>)[],
	options: { readonly opens?: boolean } = {},
) {
	const calls: Call[] = [];
	const lines: string[] = [];
	const slept: number[] = [];
	const opened: string[] = [];
	let clock = 0;
	let next = 0;
	const fakeFetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = String(input);
		const headers = new Headers(init?.headers);
		calls.push({
			url,
			body: JSON.parse(String(init?.body ?? "null")),
			origin: headers.get("Origin"),
		});
		if (url.endsWith("/auth/device/code")) return issue();
		const answer = polls[next];
		next += 1;
		if (answer === undefined) throw new Error("no more answers");
		return answer();
	}) as typeof fetch;
	const run = (extra: Partial<BrowserSignInOptions> = {}) =>
		signInWithBrowser({
			baseUrl: API,
			out: (line) => lines.push(line),
			now: () => clock,
			sleep: async (ms) => {
				slept.push(ms);
				clock += ms;
			},
			openBrowser: (address) => {
				opened.push(address);
				return options.opens ?? true;
			},
			fetch: fakeFetch,
			...extra,
		});
	return {
		calls,
		lines,
		slept,
		opened,
		run,
		polls: () => calls.filter((call) => call.url.endsWith("/session")),
	};
}

describe("the way to a session", () => {
	test("approved after a wait: the cookie comes back, and only the address and the code are shown", async () => {
		const h = harness(issued, [pending, pending, approved]);
		const outcome = await h.run();
		expect(outcome).toEqual({
			status: "signed_in",
			cookie: "better-auth.session_token=signed.value",
		});
		expect(h.opened).toEqual([COMPLETE]);
		expect(h.lines).toContain(`  ${COMPLETE}`);
		expect(h.lines).toContain("Code: ABCD-EFGH");
		expect(h.lines.join("\n")).not.toContain(DEVICE_CODE);
		expect(h.slept).toEqual([5000, 5000, 5000]);
	});

	test("the requests carry the client and the code, and the API's own origin", async () => {
		const h = harness(issued, [approved]);
		await h.run();
		expect(h.calls[0]).toEqual({
			url: `${API}/auth/device/code`,
			body: { client_id: MCP_DEVICE_CLIENT_ID },
			origin: "https://api.rowcat.test",
		});
		expect(h.polls()[0]).toEqual({
			url: `${API}/auth/device/session`,
			body: { device_code: DEVICE_CODE, client_id: MCP_DEVICE_CLIENT_ID },
			origin: "https://api.rowcat.test",
		});
	});

	/** Over SSH or with no display the address is still the way: it can be opened on any device. */
	test("when no browser opens here, the address is the instruction", async () => {
		const h = harness(issued, [approved], { opens: false });
		await h.run();
		expect(h.lines).toContain(`  ${COMPLETE}`);
		expect(h.lines.join("\n")).toContain("another device");
	});

	test("slow_down stretches the interval by five seconds for the rest of the attempt", async () => {
		const h = harness(issued, [
			() => json(400, { error: "slow_down" }),
			pending,
			approved,
		]);
		await h.run();
		expect(h.slept).toEqual([5000, 10000, 10000]);
	});
});

describe("the endings that are not a session", () => {
	test("denied in the browser", async () => {
		const h = harness(issued, [
			pending,
			() => json(400, { error: "access_denied" }),
		]);
		expect(await h.run()).toEqual({ status: "denied" });
	});

	test("the server says the request is gone", async () => {
		for (const error of ["expired_token", "invalid_grant"]) {
			const h = harness(issued, [() => json(400, { error })]);
			expect(await h.run()).toEqual({ status: "expired" });
		}
	});

	test("the local clock runs out without asking again", async () => {
		const h = harness(
			() => issued({ expires_in: 12, interval: 5 }),
			[pending, pending, pending],
		);
		expect(await h.run()).toEqual({ status: "expired" });
		expect(h.polls()).toHaveLength(2);
	});

	/** The request was consumed by that answer, so asking again can only say "gone". */
	test("approved but no cookie arrived", async () => {
		const h = harness(issued, [() => json(200, { ok: true })]);
		const outcome = await h.run();
		expect(outcome.status).toBe("failed");
		expect(h.polls()).toHaveLength(1);
	});

	test("a blip is waited out, a run of failures is not", async () => {
		const down = () => Promise.reject(new TypeError("fetch failed"));
		const blip = harness(issued, [down, down, approved]);
		expect((await blip.run()).status).toBe("signed_in");

		const outage = harness(issued, [down, down, down, down, down, approved]);
		const outcome = await outage.run();
		expect(outcome.status).toBe("failed");
		expect(outage.polls()).toHaveLength(5);
	});
});

describe("issuance failures say what to do", () => {
	const startWith = async (issue: () => Response | Promise<Response>) => {
		const outcome = await harness(issue, []).run();
		if (outcome.status !== "failed") throw new Error(outcome.status);
		return outcome.message;
	};

	test("too many requests", async () => {
		expect(await startWith(() => json(429, {}))).toContain("Too many");
	});

	test("a server without this sign-in", async () => {
		expect(await startWith(() => json(404, {}))).toContain(
			"doesn't offer browser sign-in",
		);
	});

	test("no answer at all", async () => {
		expect(
			await startWith(() => Promise.reject(new TypeError("fetch failed"))),
		).toContain("Check the API address");
	});

	/** The opener would run what it is given; only http(s) reaches it. */
	test("an approval address that is not http(s) is refused before anything opens", async () => {
		const h = harness(
			() => issued({ verification_uri_complete: "file:///etc/passwd" }),
			[],
		);
		expect((await h.run()).status).toBe("failed");
		expect(h.opened).toEqual([]);
	});
});
