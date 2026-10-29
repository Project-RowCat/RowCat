import {
	STORY_PUBLISH_ERROR_CODE,
	StoryChatSeedDto,
	type StoryPublishRequestInput,
} from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { media } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Scene images cross publication into the playback snapshot unchanged, and a publication that
 * points at someone else's asset is refused.
 *
 * Both questions live here because they are two sides of one predicate: carrying the reference and
 * checking it belongs to this creator are two lines of the same transaction, and carrying it
 * without the check is exactly this feature's vulnerability.
 *
 * Runs through the real Hono app and Postgres. Calling the service directly would leave out the
 * route reading the owner from the session and the media row's `kind` pinned in the predicate.
 */

const EMAIL_PREFIX = "scene-image-test-";

const signUp = () => createTestMember(EMAIL_PREFIX, { name: "scene image" });

/**
 * Plants one media row directly.
 *
 * Skips the upload route because it requires a libvips decode; what is under test is the
 * reference's ownership decision, which reads only the row's `owner` and `kind`. Normalization
 * itself is covered by `lib/media/image.test.ts`.
 */
async function seedMedia(
	ownerId: string,
	kind: "scene_image" | "avatar" = "scene_image",
): Promise<string> {
	const id = newId();
	await db.insert(media).values({
		id,
		owner: ownerId,
		kind,
		mime: "image/webp",
		width: 800,
		height: 600,
		byte_size: 1024,
		storage_key: `media/${kind}/${ownerId}/${id}.webp`,
		status: "ready",
	});
	return id;
}

function publishRequest(
	sceneImages: { trigger: string; assetId: string }[],
	overrides: Partial<StoryPublishRequestInput> = {},
): StoryPublishRequestInput {
	return {
		originDraftId: newId(),
		metadata: { title: "The Library at Night", visibility: "private" },
		play: { scenario: "A library where the books talk to you.", sceneImages },
		...overrides,
	};
}

const publish = (cookie: string, body: unknown): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/stories", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	);

const play = (cookie: string, storyId: string): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/play`, {
			headers: { Origin: WEB_ORIGIN, Cookie: cookie },
		}),
	);

interface PublishBody {
	story: { id: string };
}
interface ErrorBody {
	code: string;
}

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)(
	"scene images — publishing and playback",
	() => {
		test("published scene images come in the playback snapshot as is", async () => {
			const account = await signUp();
			const assetId = await seedMedia(account.memberId);

			const created = await publish(
				account.cookie,
				publishRequest([{ trigger: "dark-hallway", assetId }]),
			);
			expect(created.status).toBe(201);
			const { story } = (await created.json()) as PublishBody;

			const response = await play(account.cookie, story.id);
			expect(response.status).toBe(200);
			const seed = StoryChatSeedDto.parse(await response.json());
			expect(seed.sceneImages).toEqual([{ trigger: "dark-hallway", assetId }]);
		});

		test("a publish without scene images has an empty array in its snapshot — old clients still publish as is", async () => {
			const account = await signUp();
			const created = await publish(account.cookie, {
				originDraftId: newId(),
				metadata: { title: "A quiet room", visibility: "private" },
				/** A request that does not mention `sceneImages`; the contract default fills it. */
				play: { scenario: "Nothing happened." },
			});
			expect(created.status).toBe(201);
			const { story } = (await created.json()) as PublishBody;

			const response = await play(account.cookie, story.id);
			const seed = StoryChatSeedDto.parse(await response.json());
			expect(seed.sceneImages).toEqual([]);
		});

		test("an empty trigger is blocked by the contract — no picture without a reference is stored", async () => {
			const account = await signUp();
			const assetId = await seedMedia(account.memberId);
			const response = await publish(
				account.cookie,
				publishRequest([{ trigger: "   ", assetId }]),
			);
			expect(response.status).toBe(400);
		});

		test("an empty reference is blocked by the contract", async () => {
			const account = await signUp();
			const response = await publish(
				account.cookie,
				publishRequest([{ trigger: "night", assetId: "" }]),
			);
			expect(response.status).toBe(400);
		});

		test("a publish pointing at a missing asset is blocked — it doesn't quietly drop it and publish", async () => {
			const account = await signUp();
			const response = await publish(
				account.cookie,
				publishRequest([{ trigger: "night", assetId: newId() }]),
			);
			expect(response.status).toBe(400);
			expect(((await response.json()) as ErrorBody).code).toBe(
				STORY_PUBLISH_ERROR_CODE.sceneImageInvalid,
			);
		});

		test("a publish pointing at someone else's asset is blocked with **the same code** as a missing asset", async () => {
			const owner = await signUp();
			const stranger = await signUp();
			const assetId = await seedMedia(stranger.memberId);

			const response = await publish(
				owner.cookie,
				publishRequest([{ trigger: "night", assetId }]),
			);
			expect(response.status).toBe(400);
			/** Existence is hidden: distinguishing someone else's asset from a missing one would make the response a probe. */
			expect(((await response.json()) as ErrorBody).code).toBe(
				STORY_PUBLISH_ERROR_CODE.sceneImageInvalid,
			);
		});

		test("media of another kind is not a scene image — even my own avatar is blocked", async () => {
			const account = await signUp();
			const avatarId = await seedMedia(account.memberId, "avatar");

			const response = await publish(
				account.cookie,
				publishRequest([{ trigger: "night", assetId: avatarId }]),
			);
			expect(response.status).toBe(400);
			expect(((await response.json()) as ErrorBody).code).toBe(
				STORY_PUBLISH_ERROR_CODE.sceneImageInvalid,
			);
		});

		test("a blocked publish creates no story", async () => {
			const account = await signUp();
			const request = publishRequest([{ trigger: "night", assetId: newId() }]);
			expect((await publish(account.cookie, request)).status).toBe(400);

			/** Same draft again, now with a real asset; a row left by the first attempt would show up here. */
			const assetId = await seedMedia(account.memberId);
			const retry = await publish(account.cookie, {
				...request,
				play: { ...request.play, sceneImages: [{ trigger: "night", assetId }] },
			});
			expect(retry.status).toBe(201);
			const body = (await retry.json()) as { created: boolean };
			expect(body.created).toBe(true);
		});

		test("deleting the story leaves its media rows — other published versions may point at them", async () => {
			const account = await signUp();
			const assetId = await seedMedia(account.memberId);
			const created = await publish(
				account.cookie,
				publishRequest([{ trigger: "night", assetId }]),
			);
			const { story } = (await created.json()) as PublishBody;
			expect(story.id).toBeTruthy();

			const [row] = await db.select().from(media).where(eq(media.id, assetId));
			expect(row?.owner).toBe(account.memberId);
		});
	},
);
