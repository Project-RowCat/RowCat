import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { media, media_blob } from "../../db/schema.ts";
import { createByteGate } from "../../lib/media/delivery-gate.ts";
import { buildM4a, buildMp3 } from "../../test/audio-fixture.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";
import { __setMediaDeliveryGateForTest } from "../media.ts";

/**
 * `POST /v2/me/runtime-audio` and the `GET /v2/media/:id` that serves its bytes. Four things are
 * checked:
 *
 * 1. The address is the kind: bytes arriving here are validated and stored as audio whatever the
 *    request claims. The stored row's `kind` is checked by value.
 * 2. Projection boundary: the whole response key set is counted. `not.toHaveProperty` would only
 *    block fields known today and let a storage key or owner slip out later.
 * 3. Range responses: headers and bytes are compared together (headers alone let a wrongly cut
 *    slice pass).
 * 4. Schema invariant: an audio row has duration and no dimensions. That asymmetry is the price
 *    of nullable columns, and the service, not the schema, keeps it.
 */

const EMAIL_PREFIX = "me-runtime-audio-test-";

const signUp = () => createTestMember(EMAIL_PREFIX, { name: "Sound test" });

const upload = (cookie: string, body: Buffer, type = "audio/mpeg") =>
	app.request("/v2/me/runtime-audio", {
		method: "POST",
		headers: { Origin: WEB_ORIGIN, Cookie: cookie, "Content-Type": type },
		body: new Uint8Array(body),
	});

const fetchMedia = (mediaId: string, headers: Record<string, string> = {}) =>
	app.request(`/v2/media/${mediaId}`, { headers });

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("upload", () => {
	test("an MP3 becomes one sound media", async () => {
		const owner = await signUp();
		const response = await upload(owner.cookie, buildMp3({ frames: 200 }));
		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			asset: Record<string, unknown>;
		};
		/** Counts the whole key set; the absence of storage key, owner, byte size and status is this response's boundary and must hold when columns are added. */
		expect(Object.keys(body.asset).sort()).toEqual([
			"durationMs",
			"mediaId",
			"mime",
			"url",
		]);
		expect(body.asset.mime).toBe("audio/mpeg");
		expect(body.asset.durationMs).toBeGreaterThan(0);

		const [row] = await db
			.select()
			.from(media)
			.where(eq(media.id, body.asset.mediaId as string));
		expect(row?.kind).toBe("runtime_audio");
		/** Audio row invariant: duration present, no dimensions. */
		expect(row?.width).toBeNull();
		expect(row?.height).toBeNull();
		expect(row?.duration_ms).toBe(body.asset.durationMs);
		/** The storage key's extension derives from the format, so no MP3 is left under `.webp`. */
		expect(row?.storage_key.endsWith(".mp3")).toBe(true);
	});

	test("M4A is accepted too — the container decides the stored format", async () => {
		const owner = await signUp();
		/** The request claims an alias; what is stored is the verdict, not the claim. */
		const response = await upload(owner.cookie, buildM4a(), "audio/x-m4a");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { asset: { mime: string } };
		expect(body.asset.mime).toBe("audio/mp4");
	});

	test("when the request lies about the format, the bytes win", async () => {
		const owner = await signUp();
		const response = await upload(
			owner.cookie,
			buildMp3({ frames: 20 }),
			"audio/mp4",
		);
		expect(response.status).toBe(200);
		expect(
			((await response.json()) as { asset: { mime: string } }).asset.mime,
		).toBe("audio/mpeg");
	});

	test("image bytes can't come in through this address", async () => {
		const owner = await signUp();
		const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
		const response = await upload(owner.cookie, png, "audio/mpeg");
		expect(response.status).toBe(400);
	});

	test("a guest gets 401 — before the body is read", async () => {
		const response = await app.request("/v2/me/runtime-audio", {
			method: "POST",
			headers: { Origin: WEB_ORIGIN, "Content-Type": "audio/mpeg" },
			body: new Uint8Array(buildMp3({ frames: 4 })),
		});
		expect(response.status).toBe(401);
	});

	test("an empty body has its own code", async () => {
		const owner = await signUp();
		const response = await upload(owner.cookie, Buffer.alloc(0));
		expect(response.status).toBe(400);
		expect(((await response.json()) as { code: string }).code).toBe(
			"media_empty",
		);
	});
});

describe.skipIf(!databaseReady)("delivery — range requests", () => {
	/** Every test in this suite sees the same track. */
	const track = async (): Promise<{ mediaId: string; bytes: Buffer }> => {
		const owner = await signUp();
		const bytes = buildMp3({ frames: 300 });
		const response = await upload(owner.cookie, bytes);
		const body = (await response.json()) as { asset: { mediaId: string } };
		const [row] = await db
			.select({ key: media.storage_key })
			.from(media)
			.where(eq(media.id, body.asset.mediaId));
		const [blob] = await db
			.select({ bytes: media_blob.bytes })
			.from(media_blob)
			.where(eq(media_blob.storage_key, row?.key ?? ""));
		return {
			mediaId: body.asset.mediaId,
			bytes: blob?.bytes ?? Buffer.alloc(0),
		};
	};

	test("without a range, gives the whole as 200", async () => {
		const { mediaId, bytes } = await track();
		const response = await fetchMedia(mediaId);
		expect(response.status).toBe(200);
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(response.headers.get("Content-Length")).toBe(
			String(bytes.byteLength),
		);
		expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
		expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
	});

	test("the first ten bytes", async () => {
		const { mediaId, bytes } = await track();
		const response = await fetchMedia(mediaId, { Range: "bytes=0-9" });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe(
			`bytes 0-9/${bytes.byteLength}`,
		);
		expect(response.headers.get("Content-Length")).toBe("10");
		expect(
			Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(0, 10)),
		).toBe(true);
	});

	test("from the middle to the end", async () => {
		const { mediaId, bytes } = await track();
		const response = await fetchMedia(mediaId, { Range: "bytes=10-" });
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe(
			`bytes 10-${bytes.byteLength - 1}/${bytes.byteLength}`,
		);
		expect(
			Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(10)),
		).toBe(true);
	});

	test("the last ten bytes", async () => {
		const { mediaId, bytes } = await track();
		const response = await fetchMedia(mediaId, { Range: "bytes=-10" });
		expect(response.status).toBe(206);
		const start = bytes.byteLength - 10;
		expect(response.headers.get("Content-Range")).toBe(
			`bytes ${start}-${bytes.byteLength - 1}/${bytes.byteLength}`,
		);
		expect(
			Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(start)),
		).toBe(true);
	});

	/** A 416 must carry `Content-Range: bytes * /TOTAL`. */
	test("a range outside the resource is a 416", async () => {
		const { mediaId, bytes } = await track();
		const response = await fetchMedia(mediaId, {
			Range: `bytes=${bytes.byteLength}-`,
		});
		expect(response.status).toBe(416);
		expect(response.headers.get("Content-Range")).toBe(
			`bytes */${bytes.byteLength}`,
		);
		expect((await response.arrayBuffer()).byteLength).toBe(0);
	});

	/** Multi-range is ignored (a defined policy, not a rejection). */
	test("multiple ranges are answered with the whole", async () => {
		const { mediaId, bytes } = await track();
		const response = await fetchMedia(mediaId, { Range: "bytes=0-9,20-29" });
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
	});

	test("a malformed range is answered with the whole too", async () => {
		const { mediaId } = await track();
		expect((await fetchMedia(mediaId, { Range: "bytes=xyz" })).status).toBe(
			200,
		);
	});

	/**
	 * The ETag identifies the resource, so it does not differ per slice. Conditional requests finish
	 * before range computation; after it, a 304 would carry `Content-Range`.
	 */
	test("the ETag is the same for a slice and the whole, and a conditional request ends with 304", async () => {
		const { mediaId } = await track();
		const whole = await fetchMedia(mediaId);
		const etag = whole.headers.get("ETag");
		expect(etag).toBeTruthy();
		const partial = await fetchMedia(mediaId, { Range: "bytes=0-9" });
		expect(partial.headers.get("ETag")).toBe(etag);

		const cached = await fetchMedia(mediaId, {
			Range: "bytes=0-9",
			"If-None-Match": etag ?? "",
		});
		expect(cached.status).toBe(304);
		expect(cached.headers.get("Content-Range")).toBeNull();
	});

	/** Runtime audio may belong to an unpublished draft, so unlike avatars it is not handed to shared caches. */
	test("a slice's cache policy equals the whole's", async () => {
		const { mediaId } = await track();
		const whole = await fetchMedia(mediaId);
		const partial = await fetchMedia(mediaId, { Range: "bytes=0-9" });
		expect(whole.headers.get("Cache-Control")).toContain("private");
		expect(partial.headers.get("Cache-Control")).toBe(
			whole.headers.get("Cache-Control"),
		);
		expect(partial.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});
});

/**
 * Delivery gate: the cap on bytes the process holds in buffers (`lib/media/delivery-gate.ts`). Pure
 * tests cover the queue rules; here the question is whether the route holds the gate correctly:
 * what the weight is (the slice for a range), when it is returned (after the body is fully sent),
 * and what goes out on overflow (503).
 */
describe.skipIf(!databaseReady)("delivery — slots", () => {
	afterEach(() => __setMediaDeliveryGateForTest(null));

	const track = async () => {
		const owner = await signUp();
		const response = await upload(owner.cookie, buildMp3({ frames: 300 }));
		const body = (await response.json()) as { asset: { mediaId: string } };
		return body.asset.mediaId;
	};

	test("with every slot used and the queue full it is a 503 that states Retry-After", async () => {
		const mediaId = await track();
		const gate = createByteGate({
			capacityBytes: 1024,
			maxQueued: 0,
			maxWaitMs: 50,
		});
		__setMediaDeliveryGateForTest(gate);
		const hold = await gate.acquire(1024);

		const crowded = await fetchMedia(mediaId);
		expect(crowded.status).toBe(503);
		expect(crowded.headers.get("Retry-After")).toBe("2");
		expect(await crowded.json()).toMatchObject({ code: "media_busy" });

		hold();
		expect((await fetchMedia(mediaId)).status).toBe(200);
	});

	/** A 304 reads no bytes, so it needs no slot. */
	test("a conditional request finishes without a slot", async () => {
		const mediaId = await track();
		const etag = (await fetchMedia(mediaId)).headers.get("ETag") ?? "";
		const gate = createByteGate({
			capacityBytes: 1,
			maxQueued: 0,
			maxWaitMs: 50,
		});
		__setMediaDeliveryGateForTest(gate);
		const hold = await gate.acquire(1);
		expect((await fetchMedia(mediaId, { "If-None-Match": etag })).status).toBe(
			304,
		);
		hold();
	});

	test("a range request weighs its slice — not the whole track", async () => {
		const mediaId = await track();
		const gate = createByteGate({
			capacityBytes: 64,
			maxQueued: 0,
			maxWaitMs: 50,
		});
		__setMediaDeliveryGateForTest(gate);
		const hold = await gate.acquire(54);
		/** 10 left: a ten-byte slice fits, the whole track does not. */
		expect((await fetchMedia(mediaId, { Range: "bytes=0-9" })).status).toBe(
			206,
		);
		expect((await fetchMedia(mediaId)).status).toBe(503);
		hold();
	});

	test("the slot returns after the body is fully read", async () => {
		const mediaId = await track();
		const gate = createByteGate({
			capacityBytes: 64 * 1024 * 1024,
			maxQueued: 4,
			maxWaitMs: 1_000,
		});
		__setMediaDeliveryGateForTest(gate);
		const response = await fetchMedia(mediaId);
		expect(response.status).toBe(200);
		expect(gate.stats().inFlight).toBe(1);
		await response.arrayBuffer();
		expect(gate.stats()).toMatchObject({ inFlight: 0, inFlightBytes: 0 });
	});

	/**
	 * A request that leaves without reading the body still returns its slot. If the connection drops
	 * while storage is read, the server adapter takes the body on an already-closed socket and neither
	 * ends nor cancels; only the request's `signal` can return the slot.
	 */
	test("when the request aborts, the slot returns even if the body is unread", async () => {
		const mediaId = await track();
		const gate = createByteGate({
			capacityBytes: 64 * 1024 * 1024,
			maxQueued: 4,
			maxWaitMs: 1_000,
		});
		__setMediaDeliveryGateForTest(gate);
		const controller = new AbortController();
		const response = await app.request(`/v2/media/${mediaId}`, {
			signal: controller.signal,
		});
		expect(response.status).toBe(200);
		expect(gate.stats().inFlight).toBe(1);
		controller.abort();
		expect(gate.stats()).toMatchObject({ inFlight: 0, inFlightBytes: 0 });
	});

	/**
	 * HEAD must not leak a slot. Hono discards a HEAD body without cancelling it, so taking the
	 * slot-holding GET path would fill this cap (a bit over one track) permanently with a single HEAD.
	 */
	test("HEAD takes no slot and answers only headers", async () => {
		const mediaId = await track();
		const whole = await fetchMedia(mediaId);
		const size = (await whole.arrayBuffer()).byteLength;
		const gate = createByteGate({
			capacityBytes: size,
			maxQueued: 0,
			maxWaitMs: 50,
		});
		__setMediaDeliveryGateForTest(gate);

		for (let i = 0; i < 3; i++) {
			const head = await app.request(`/v2/media/${mediaId}`, {
				method: "HEAD",
			});
			expect(head.status).toBe(200);
			expect(head.headers.get("Content-Length")).toBe(String(size));
			expect(head.headers.get("Accept-Ranges")).toBe("bytes");
			expect(head.headers.get("ETag")).toBe(whole.headers.get("ETag"));
		}
		const partial = await app.request(`/v2/media/${mediaId}`, {
			method: "HEAD",
			headers: { Range: "bytes=0-9" },
		});
		expect(partial.status).toBe(206);
		expect(partial.headers.get("Content-Range")).toBe(`bytes 0-9/${size}`);
		expect(partial.headers.get("Content-Length")).toBe("10");

		expect(gate.stats()).toMatchObject({ inFlight: 0, inFlightBytes: 0 });
		const after = await fetchMedia(mediaId);
		expect(after.status).toBe(200);
		expect((await after.arrayBuffer()).byteLength).toBe(size);
	});

	/**
	 * Overlapping ranges cannot inflate a response. Multi-range is ignored, so the response never
	 * exceeds one resource's size regardless of range count (the opposite direction of the known
	 * `bytes=0-,0-,...` amplification).
	 */
	test("even a hundred overlapping ranges give a single-resource response", async () => {
		const mediaId = await track();
		const whole = await fetchMedia(mediaId);
		const size = (await whole.arrayBuffer()).byteLength;
		const response = await fetchMedia(mediaId, {
			Range: `bytes=${Array.from({ length: 100 }, () => "0-").join(",")}`,
		});
		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBe(size);
	});
});
