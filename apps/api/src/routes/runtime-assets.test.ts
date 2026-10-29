import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { closeDb } from "../db/client.ts";
import { REMOTE_IMAGE_BUDGET } from "../lib/remote-image/budget.ts";
import * as remoteImage from "../lib/remote-image/fetch.ts";
import { createSlotGate } from "../lib/remote-image/slots.ts";
import { createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { api } from "../test/http.ts";
import { __setRemoteImageSlotsForTest } from "./runtime-assets.ts";

/**
 * Remote image proxy through the real Hono app (the HTTP boundary).
 *
 * The fetch rules themselves (SSRF, redirects, format, size, deadline) are covered by
 * `lib/remote-image/fetch.test.ts` with a simulated transport. This file checks what surrounds
 * them: who may call, what is a 400 vs a 502, that nothing from upstream reaches the response, and
 * that the success headers are exactly ours.
 *
 * Session branches need a real Postgres and are skipped without one; the sessionless branch (401)
 * always runs.
 */

const EMAIL_PREFIX = "runtime-assets-test-";
const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const path = (url: string) =>
	`/runtime/assets/remote?url=${encodeURIComponent(url)}`;

const fetchSpy = vi.spyOn(remoteImage, "fetchRemoteImage");

beforeEach(() => {
	fetchSpy.mockReset();
});

afterEach(() => {
	fetchSpy.mockReset();
});

describe("without a session", () => {
	/**
	 * Guests get 401, decided before any fetch. After it, our server would send outbound requests
	 * without authentication (an open proxy).
	 */
	test("a guest gets 401 and nothing is fetched", async () => {
		const response = await api(path("https://cdn.example.com/a.png"));
		expect(response.status).toBe(401);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

const hasDb = await connectTestDatabase();

/** Closing the pool is the file's last job; a describe block that closed it would leave later blocks a dead pool. */
afterAll(async () => {
	if (hasDb) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!hasDb)("with a session", () => {
	test.each([
		"http://cdn.example.com/a.png",
		"https://user:pw@cdn.example.com/a.png",
		"https://127.0.0.1/a.png",
		"https://localhost/a.png",
		"characters/sena/smile",
		"data:image/png;base64,AAAA",
		"",
	])("an address outside the rules is a 400 and nothing is fetched: %s", async (url) => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		const response = await api(path(url), { cookie });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "runtime_asset_invalid",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test("failing to fetch is a 502, with no reason details in the response", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		fetchSpy.mockResolvedValue({ ok: false, reason: "private-destination" });
		const response = await api(path("https://internal.example.com/a.png"), {
			cookie,
		});
		expect(response.status).toBe(502);
		expect(response.headers.get("retry-after")).toBe("30");
		const body = await response.json();
		expect(body).toMatchObject({ code: "runtime_asset_unavailable" });
		/** No reason (private network, status, format) may leak; that response would become a probe. */
		expect(JSON.stringify(body)).not.toMatch(
			/private|destination|internal\.example|169\.254|status|timeout/,
		);
	});

	test("on success only the bytes and our chosen headers go out", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		fetchSpy.mockResolvedValue({
			ok: true,
			bytes: PNG,
			contentType: "image/png",
		});
		const url = "https://cdn.example.com/sena.png?v=2";
		const response = await api(path(url), { cookie });
		expect(response.status).toBe(200);
		/** The caller's signal and the meter go along: abort on leave, count what was read. */
		expect(fetchSpy).toHaveBeenCalledWith(
			url,
			expect.objectContaining({
				signal: expect.any(AbortSignal),
				meter: expect.any(Function),
			}),
		);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("content-length")).toBe(String(PNG.length));
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
	});
});

/* Total volume: byte budget, process slots, cancellation. */

const MiB = 1024 * 1024;

/** Simulates a fetch: reports `bytes` to the meter and succeeds. */
const servesBytes =
	(bytes: number) =>
	async (
		_url: string,
		options?: remoteImage.FetchRemoteImageOptions,
	): Promise<remoteImage.RemoteImageResult> => {
		options?.meter?.(bytes);
		return { ok: true, bytes: PNG, contentType: "image/png" };
	};

/** Each reservation is the response cap (10 MiB), so this is how many requests fit one budget at once. */
const RESERVATIONS_PER_WINDOW = Math.floor(
	REMOTE_IMAGE_BUDGET.bytesPerWindow / REMOTE_IMAGE_BUDGET.reservePerRequest,
);

describe.skipIf(!hasDb)("totals", () => {
	afterEach(() => {
		__setRemoteImageSlotsForTest(null);
	});

	/**
	 * Bytes close the gate even under the request-count cap. Before, cap-sized responses could be
	 * received 240 times a minute (2.4 GiB); now a window is 512 MiB.
	 */
	test("when the received bytes use up the window's budget it is a 429 and nothing more is fetched", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		fetchSpy.mockImplementation(
			servesBytes(REMOTE_IMAGE_BUDGET.reservePerRequest),
		);

		for (let i = 0; i < RESERVATIONS_PER_WINDOW; i += 1) {
			const ok = await api(path(`https://cdn.example.com/${i}.png`), {
				cookie,
			});
			expect(ok.status).toBe(200);
		}
		const calls = fetchSpy.mock.calls.length;
		const refused = await api(path("https://cdn.example.com/last.png"), {
			cookie,
		});
		expect(refused.status).toBe(429);
		expect(await refused.json()).toMatchObject({
			code: "runtime_asset_rate_limited",
		});
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		/** Refusal comes before the fetch; no outbound request went out. */
		expect(fetchSpy.mock.calls.length).toBe(calls);
	});

	/** A request that read little returns its reservation; hundreds of small images are normal. */
	test("a small response gives back the rest of the reservation", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		fetchSpy.mockImplementation(servesBytes(64 * 1024));
		for (let i = 0; i < RESERVATIONS_PER_WINDOW + 20; i += 1) {
			const ok = await api(path(`https://cdn.example.com/s${i}.png`), {
				cookie,
			});
			expect(ok.status).toBe(200);
		}
	});

	test("one member's budget doesn't spend another's", async () => {
		const alice = await createTestMember(EMAIL_PREFIX);
		const bob = await createTestMember(EMAIL_PREFIX);
		fetchSpy.mockImplementation(
			servesBytes(REMOTE_IMAGE_BUDGET.reservePerRequest),
		);
		for (let i = 0; i <= RESERVATIONS_PER_WINDOW; i += 1)
			await api(path(`https://cdn.example.com/a${i}.png`), {
				cookie: alice.cookie,
			});
		const bobs = await api(path("https://cdn.example.com/b.png"), {
			cookie: bob.cookie,
		});
		expect(bobs.status).toBe(200);
	});

	/**
	 * Failed fetches are charged for what they read too: a host sending a wrong-format body up to the
	 * cap uses our line without ever succeeding.
	 */
	test("a failed response's bytes are subtracted from the budget too", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		fetchSpy.mockImplementation(async (_url, options) => {
			options?.meter?.(REMOTE_IMAGE_BUDGET.reservePerRequest);
			return { ok: false, reason: "unsupported-type" };
		});
		for (let i = 0; i < RESERVATIONS_PER_WINDOW; i += 1)
			expect(
				(await api(path(`https://cdn.example.com/f${i}.png`), { cookie }))
					.status,
			).toBe(502);
		expect(
			(await api(path("https://cdn.example.com/f.png"), { cookie })).status,
		).toBe(429);
	});

	/**
	 * A `Range` header never yields a partial response: the proxy does not forward it and the response
	 * is always whole, so there is no way to dodge metering by fetching one image in pieces.
	 */
	test("a range request isn't a range here — fetched whole and counted whole", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		fetchSpy.mockImplementation(servesBytes(PNG.length));
		const response = await api(path("https://cdn.example.com/r.png"), {
			cookie,
			headers: { Range: "bytes=0-3" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-range")).toBeNull();
		expect(response.headers.get("content-length")).toBe(String(PNG.length));
		/** Only the meter and signal pass; client headers are not fetch input. */
		const options = fetchSpy.mock.calls.at(-1)?.[1];
		expect(Object.keys(options ?? {}).sort()).toEqual(["meter", "signal"]);
	});

	test("with every process slot taken and the queue full it is a 503, and a finished request gives its slot back", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		const slots = createSlotGate({
			maxInFlight: 1,
			maxQueued: 0,
			maxWaitMs: 50,
		});
		__setRemoteImageSlotsForTest(slots);

		let finish: () => void = () => {};
		fetchSpy.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () =>
						resolve({ ok: true, bytes: PNG, contentType: "image/png" });
				}),
		);
		const holding = api(path("https://cdn.example.com/slow.png"), { cookie });
		/** Wait for auth and reservation to finish; a DB round trip is not guaranteed to fit in 20ms. */
		await vi.waitFor(() => expect(slots.stats().inFlight).toBe(1));

		const crowded = await api(path("https://cdn.example.com/x.png"), {
			cookie,
		});
		expect(crowded.status).toBe(503);
		expect(await crowded.json()).toMatchObject({
			code: "runtime_asset_unavailable",
		});

		finish();
		expect((await holding).status).toBe(200);
		expect(slots.stats()).toEqual({ inFlight: 0, queued: 0 });
	});

	/**
	 * Leaving releases the slot and reservation together. Upstream is cut (signal) and only the bytes
	 * read so far remain; without this, one player moving between screens could fill slots and budget
	 * with never-ending fetches.
	 */
	test("when the requester leaves, the slot goes back and only what was read is charged", async () => {
		const { cookie } = await createTestMember(EMAIL_PREFIX);
		const slots = createSlotGate({
			maxInFlight: 4,
			maxQueued: 0,
			maxWaitMs: 50,
		});
		__setRemoteImageSlotsForTest(slots);

		fetchSpy.mockImplementationOnce(
			(_url, options) =>
				new Promise((resolve) => {
					options?.meter?.(MiB);
					options?.signal?.addEventListener("abort", () =>
						resolve({ ok: false, reason: "cancelled" }),
					);
				}),
		);
		const leaving = new AbortController();
		const pending = api(path("https://cdn.example.com/leave.png"), {
			cookie,
			signal: leaving.signal,
		}).catch(() => null);
		await vi.waitFor(() => expect(slots.stats().inFlight).toBe(1));
		leaving.abort();
		await pending;
		await vi.waitFor(() => expect(slots.stats().inFlight).toBe(0));

		/** The departed request kept only 1 MiB, so all 51 reservations still fit (1 + 510 ≤ 512). */
		fetchSpy.mockImplementation(
			servesBytes(REMOTE_IMAGE_BUDGET.reservePerRequest),
		);
		for (let i = 0; i < RESERVATIONS_PER_WINDOW; i += 1)
			expect(
				(await api(path(`https://cdn.example.com/c${i}.png`), { cookie }))
					.status,
			).toBe(200);
	});
});
