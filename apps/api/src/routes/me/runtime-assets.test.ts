import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { media } from "../../db/schema.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `POST /v2/me/runtime-assets`: the image row invariant. Mirror of the audio test
 * (`runtime-audio.test.ts`). Since `media.width`/`height` became nullable the schema no longer
 * blocks an image row without dimensions; only the service keeps that invariant, so this checks by
 * value what the trusted write path leaves behind.
 *
 * ```text
 * address is the kind   bytes arriving at this route are stored as runtime_image
 * medium asymmetry      an image row has dimensions and no duration (an audio row is the opposite)
 * ```
 *
 * Normalization rules themselves belong to `lib/media/image.test.ts`.
 */

const EMAIL_PREFIX = "me-runtime-assets-test-";

const signUp = () =>
	createTestMember(EMAIL_PREFIX, { name: "Runtime picture" });

/** A deterministic image; non-square so the dimensions visibly flow through. */
const png = (width = 300, height = 200) => {
	const bytes = Buffer.alloc(width * height * 3);
	for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 11) % 256;
	return sharp(bytes, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
};

const upload = (cookie: string, body: Buffer, type = "image/png") =>
	app.request("/v2/me/runtime-assets", {
		method: "POST",
		headers: { Origin: WEB_ORIGIN, Cookie: cookie, "Content-Type": type },
		body: new Uint8Array(body),
	});

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("upload", () => {
	test("a PNG becomes one runtime image — with dimensions and no duration", async () => {
		const owner = await signUp();
		const response = await upload(owner.cookie, await png());
		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			asset: Record<string, unknown>;
		};
		/** Counts the whole key set; the absence of storage key, owner and status is the boundary. */
		expect(Object.keys(body.asset).sort()).toEqual([
			"height",
			"mediaId",
			"mime",
			"url",
			"width",
		]);

		const [row] = await db
			.select()
			.from(media)
			.where(eq(media.id, body.asset.mediaId as string));
		expect(row?.kind).toBe("runtime_image");
		// Image row invariant: dimensions present, duration absent. `createMedia`'s kind discriminator
		// keeps the pairing.
		expect(row?.width).toBeGreaterThan(0);
		expect(row?.height).toBeGreaterThan(0);
		expect(row?.duration_ms).toBeNull();
		expect(row?.mime).toBe("image/webp");
		expect(row?.status).toBe("ready");
	});

	test("sound bytes can't come in through this address", async () => {
		const owner = await signUp();
		/** Bytes starting with an MP3 frame header, not an image signature. */
		const notAnImage = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]);
		expect((await upload(owner.cookie, notAnImage)).status).toBe(400);
	});

	test("a guest gets 401 — before the body is read", async () => {
		const response = await app.request("/v2/me/runtime-assets", {
			method: "POST",
			headers: { Origin: WEB_ORIGIN, "Content-Type": "image/png" },
			body: new Uint8Array(await png()),
		});
		expect(response.status).toBe(401);
	});
});
