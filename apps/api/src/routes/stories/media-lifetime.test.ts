import {
	StoryChatSeedDto,
	type StoryPublishRequestInput,
} from "@rowcat/contracts";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { media, media_blob, story, story_media } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { deleteAccountForUser } from "../../services/account/deletion.ts";
import { createRuntimeAudioAsset } from "../../services/runtime-audio.ts";
import { createRuntimeImageAsset } from "../../services/runtime-image.ts";
import { createSceneImageAsset } from "../../services/scene-image.ts";
import { buildMp3 } from "../../test/audio-fixture.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Does a surviving story keep its images, and do images nobody uses still disappear.
 *
 * The defect is silent. Creator account deletion leaves public stories and their playback payloads
 * with only the identity detached, but the scene images that payload points at were taken by the
 * cascade on `media.owner`. To a reader that looks like a chat that opens and produces text with
 * only the image slot returning 404, with no error and no log.
 *
 * So this file does not ask whether the id is still in the JSON (that was always true; the payload
 * is untouched). It asks whether `GET /v2/media/:id` actually returns bytes, the only question
 * equal to what the reader sees.
 *
 * The opposite direction is checked with equal weight: if the fix became "keep every scene image",
 * deletion would sell its promise for one kind name. Unused images must still be deleted, checked
 * in both the row and the bytes.
 *
 * Runs against real Postgres, Hono and image bytes: locks, FKs and transactions are the whole
 * decision, so mocks would leave everything under test outside the test.
 */

const EMAIL_PREFIX = "story-media-lifetime-test-";
let ready = false;

beforeAll(async () => {
	ready = await connectTestDatabase();
});

/** Stories whose identity was detached by deletion have no owner for member cleanup to reach, so clean them up directly at the end. */
const orphaned: string[] = [];

afterAll(async () => {
	if (ready) {
		if (orphaned.length)
			await db.delete(story).where(inArray(story.id, orphaned));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

/* Fixtures */

const signUp = (name = "Media lifetime test") =>
	createTestMember(EMAIL_PREFIX, { name });

/**
 * One scene image through real bytes. Rows are not planted directly because the question is whether
 * the bytes are still readable, which a row never stored cannot answer; the production path
 * (`createSceneImageAsset` → normalization → `MediaBlobStore`) is used.
 */
async function uploadSceneImage(ownerId: string): Promise<string> {
	const png = await sharp({
		create: {
			width: 16,
			height: 16,
			channels: 3,
			background: { r: 180, g: 90, b: 40 },
		},
	})
		.png()
		.toBuffer();
	const asset = await createSceneImageAsset(ownerId, png);
	return asset.mediaId;
}

/**
 * One runtime image through the production path (`createRuntimeImageAsset` → normalization →
 * `MediaBlobStore`). Only `kind` differs from scene images, and that one value is the publication
 * authorization, which is why the two functions are separate.
 */
/**
 * One sound created through the decision boundary. Rows are not INSERTed directly because this file
 * tests the lifecycle; a hand-made row could fill `kind` or `duration_ms` differently from the
 * service, and the test would then speak about the test's row rather than the product's.
 */
async function uploadRuntimeAudio(ownerId: string): Promise<string> {
	const asset = await createRuntimeAudioAsset(
		ownerId,
		buildMp3({ frames: 60 }),
	);
	return asset.mediaId;
}

async function uploadRuntimeImage(ownerId: string): Promise<string> {
	const png = await sharp({
		create: {
			width: 16,
			height: 16,
			channels: 3,
			background: { r: 40, g: 90, b: 180 },
		},
	})
		.png()
		.toBuffer();
	const asset = await createRuntimeImageAsset(ownerId, png);
	return asset.mediaId;
}

function publishRequest(
	sceneImages: { trigger: string; assetId: string }[],
	overrides: Partial<StoryPublishRequestInput> = {},
): StoryPublishRequestInput {
	return {
		originDraftId: newId(),
		metadata: { title: "A story with pictures", visibility: "public" },
		play: { scenario: "A story where scenes get drawn.", sceneImages },
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

const update = (
	cookie: string,
	storyId: string,
	body: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	);

const get = (cookie: string | null, path: string): Promise<Response> =>
	Promise.resolve(
		app.request(path, { headers: cookie ? { Cookie: cookie } : {} }),
	);

/** Publishes and returns the story id. Public stories survive deletion, so they go on the cleanup list. */
async function publishStoryWith(
	cookie: string,
	sceneImages: { trigger: string; assetId: string }[],
	overrides: Partial<StoryPublishRequestInput> = {},
): Promise<string> {
	const response = await publish(
		cookie,
		publishRequest(sceneImages, overrides),
	);
	expect(response.status).toBe(201);
	const body = (await response.json()) as { story: { id: string } };
	orphaned.push(body.story.id);
	return body.story.id;
}

/* Lookups */

const referencesOf = async (storyId: string): Promise<string[]> => {
	const rows = await db
		.select({ mediaId: story_media.media_id })
		.from(story_media)
		.where(
			and(
				eq(story_media.story_id, storyId),
				eq(story_media.role, "scene_image"),
			),
		);
	return rows.map((row) => row.mediaId).sort();
};

const mediaRow = async (mediaId: string) => {
	const [row] = await db
		.select({ id: media.id, owner: media.owner, key: media.storage_key })
		.from(media)
		.where(eq(media.id, mediaId));
	return row ?? null;
};

/** Whether the bytes are still in the store, a different question from whether the row exists. */
const bytesExist = async (storageKey: string): Promise<boolean> => {
	const rows = await db
		.select({ key: media_blob.storage_key })
		.from(media_blob)
		.where(eq(media_blob.storage_key, storageKey));
	return rows.length > 0;
};

/* Publishing reconciles references to the final state */

describe.skipIf(!process.env.DATABASE_URL)(
	"publishing and media references",
	() => {
		test("publishing also records the playback snapshot's pictures as relations", async () => {
			if (!ready) return;
			const creator = await signUp("Creator");
			const a = await uploadSceneImage(creator.memberId);
			const b = await uploadSceneImage(creator.memberId);

			const storyId = await publishStoryWith(creator.cookie, [
				{ trigger: "day", assetId: a },
				{ trigger: "night", assetId: b },
			]);

			expect(await referencesOf(storyId)).toEqual([a, b].sort());
		});

		/**
		 * Reconciling to a final state, not adding. If references only accumulated, B would stay "still in
		 * use" forever and deletion would preserve it even after the creator removed it, an indefinite
		 * retention policy we decided against.
		 */
		test("republishing makes the references match the new snapshot exactly", async () => {
			if (!ready) return;
			const creator = await signUp("Creator");
			const a = await uploadSceneImage(creator.memberId);
			const b = await uploadSceneImage(creator.memberId);
			const c = await uploadSceneImage(creator.memberId);

			const draftId = newId();
			const storyId = await publishStoryWith(
				creator.cookie,
				[
					{ trigger: "day", assetId: a },
					{ trigger: "night", assetId: b },
				],
				{ originDraftId: draftId },
			);
			expect(await referencesOf(storyId)).toEqual([a, b].sort());

			const response = await update(
				creator.cookie,
				storyId,
				publishRequest(
					[
						{ trigger: "day", assetId: a },
						{ trigger: "dawn", assetId: c },
					],
					{ originDraftId: draftId },
				),
			);
			expect(response.status).toBe(200);

			/** A, C, not A, B, C. */
			expect(await referencesOf(storyId)).toEqual([a, c].sort());

			/**
			 * B's row itself stays: a reference disappearing and media being deleted are different matters,
			 * and the latter is not answered here (another published story or a room open on someone else's
			 * device may still use that image).
			 */
			expect(await mediaRow(b)).not.toBeNull();
		});

		test("removing every picture removes every reference too", async () => {
			if (!ready) return;
			const creator = await signUp("Creator");
			const a = await uploadSceneImage(creator.memberId);
			const draftId = newId();
			const storyId = await publishStoryWith(
				creator.cookie,
				[{ trigger: "day", assetId: a }],
				{ originDraftId: draftId },
			);
			expect(await referencesOf(storyId)).toEqual([a]);

			expect(
				(
					await update(
						creator.cookie,
						storyId,
						publishRequest([], { originDraftId: draftId }),
					)
				).status,
			).toBe(200);
			expect(await referencesOf(storyId)).toEqual([]);
		});

		test("deleting the story removes its references too", async () => {
			if (!ready) return;
			const creator = await signUp("Creator");
			const a = await uploadSceneImage(creator.memberId);
			const storyId = await publishStoryWith(
				creator.cookie,
				[{ trigger: "day", assetId: a }],
				{ metadata: { title: "A story to delete", visibility: "private" } },
			);
			expect(await referencesOf(storyId)).toEqual([a]);

			await db.delete(story).where(eq(story.id, storyId));
			expect(await referencesOf(storyId)).toEqual([]);
		});
	},
);

/* Deletion keeps the images of surviving stories intact */

describe.skipIf(!process.env.DATABASE_URL)(
	"creator deletion and scene images",
	() => {
		/**
		 * The defect this file fixed. Checking that the id remains in the payload is not enough (that was
		 * always true); reading the bytes is the only question equal to what the reader sees.
		 *
		 * Public stories stay in the catalogue with only the identity detached (deletion policy 1), so the
		 * preservation decision rests on `story_media`: the question is whether a story still points at
		 * it.
		 */
		test("pictures a surviving public story uses stay readable after the creator deletes their account", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");
			const reader = await signUp("Reader");

			const asset = await uploadSceneImage(creator.memberId);
			const before = await mediaRow(asset);
			expect(before).not.toBeNull();
			const storageKey = before?.key ?? "";
			expect(await bytesExist(storageKey)).toBe(true);

			const storyId = await publishStoryWith(creator.cookie, [
				{ trigger: "night", assetId: asset },
			]);

			const summary = await deleteAccountForUser(creator.authUserId);
			expect(summary.anonymizedStories).toBeGreaterThanOrEqual(1);
			expect(summary.preservedStoryMedia).toBeGreaterThanOrEqual(1);

			/** The story was already preserved; re-check it as a precondition. */
			const [row] = await db
				.select({ owner: story.owner, payload: story.play_payload })
				.from(story)
				.where(eq(story.id, storyId));
			expect(row?.owner).toBeNull();
			expect(JSON.stringify(row?.payload)).toContain(asset);

			/** The row stays with only the identity detached. */
			const after = await mediaRow(asset);
			expect(after).not.toBeNull();
			expect(after?.owner).toBeNull();

			/** The bytes remain. */
			expect(await bytesExist(storageKey)).toBe(true);

			/** Above all, the reader actually reads it; so does a guest (a public id address). */
			expect((await get(null, `/v2/media/${asset}`)).status).toBe(200);
			const image = await get(reader.cookie, `/v2/media/${asset}`);
			expect(image.status).toBe(200);
			expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);

			/** The playback snapshot carries the reference as-is; the response itself is the seed. */
			const playResponse = await get(
				reader.cookie,
				`/v2/stories/${storyId}/play`,
			);
			expect(playResponse.status).toBe(200);
			const seed = StoryChatSeedDto.parse(await playResponse.json());
			expect(seed.sceneImages.map((image) => image.assetId)).toContain(asset);
		});

		/**
		 * The opposite direction must hold with equal weight: if the fix became "keep every scene image",
		 * deletion's promise would be sold for a kind name.
		 */
		test("unused pictures are still deleted", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");

			const used = await uploadSceneImage(creator.memberId);
			const unused = await uploadSceneImage(creator.memberId);
			const usedKey = (await mediaRow(used))?.key ?? "";
			const unusedKey = (await mediaRow(unused))?.key ?? "";

			await publishStoryWith(creator.cookie, [
				{ trigger: "night", assetId: used },
			]);

			await deleteAccountForUser(creator.authUserId);

			/** Used images keep both row and bytes. */
			expect(await mediaRow(used)).not.toBeNull();
			expect(await bytesExist(usedKey)).toBe(true);

			/** Unused images lose both row and bytes. */
			expect(await mediaRow(unused)).toBeNull();
			expect(await bytesExist(unusedKey)).toBe(false);
		});

		/** When a story is deleted its images go too; only surviving stories' references preserve anything. */
		test("pictures of private stories deleted with the account disappear with the story", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");
			const asset = await uploadSceneImage(creator.memberId);
			const key = (await mediaRow(asset))?.key ?? "";
			const storyId = await publishStoryWith(
				creator.cookie,
				[{ trigger: "night", assetId: asset }],
				{ metadata: { title: "A story to be deleted", visibility: "private" } },
			);
			expect(await referencesOf(storyId)).toEqual([asset]);

			const summary = await deleteAccountForUser(creator.authUserId);
			expect(summary.preservedStoryMedia).toBe(0);

			expect(
				await db
					.select({ id: story.id })
					.from(story)
					.where(eq(story.id, storyId)),
			).toHaveLength(0);
			expect(await referencesOf(storyId)).toEqual([]);
			expect(await mediaRow(asset)).toBeNull();
			expect(await bytesExist(key)).toBe(false);
		});

		/**
		 * Two stories using the same image. Checks by value that the schema does not implicitly assume one
		 * story per image: when one disappears, the remaining reference must still protect it. That this
		 * state is hard to produce through the current UI does not license the schema to represent it
		 * wrongly.
		 */
		test("when two stories use the same picture it stays after one disappears", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");
			const reader = await signUp("Reader");

			const shared = await uploadSceneImage(creator.memberId);
			const key = (await mediaRow(shared))?.key ?? "";

			/** The public story that remains and the private one deleted by account deletion point at the same image. */
			const keptId = await publishStoryWith(creator.cookie, [
				{ trigger: "night", assetId: shared },
			]);
			const doomedId = await publishStoryWith(
				creator.cookie,
				[{ trigger: "night", assetId: shared }],
				{ metadata: { title: "A story to be deleted", visibility: "private" } },
			);
			expect(await referencesOf(keptId)).toEqual([shared]);
			expect(await referencesOf(doomedId)).toEqual([shared]);

			await deleteAccountForUser(creator.authUserId);

			/** Only the deleted story's reference disappears; the remaining one keeps the image. */
			expect(await referencesOf(doomedId)).toEqual([]);
			expect(await referencesOf(keptId)).toEqual([shared]);
			expect(await mediaRow(shared)).not.toBeNull();
			expect(await bytesExist(key)).toBe(true);
			expect((await get(reader.cookie, `/v2/media/${shared}`)).status).toBe(
				200,
			);
		});
	},
);

/* Runtime images get the same preservation */

/**
 * Preservation is answered by one query even as roles grow. This is the value of
 * `mediaStillReferencedByStories` not filtering by role: with `role = 'scene_image'` in that
 * predicate, runtime images would silently drop out without any code being touched, and the loss
 * would show only on a reader's screen the day the creator leaves.
 */
describe.skipIf(!process.env.DATABASE_URL)(
	"creator deletion and runtime images",
	() => {
		const RUNTIME_SOURCE = `import { Image, Screen, asset } from "@rowcat/runtime";

export default function App() {
	return (
		<Screen>
			<Image source={asset("characters/sena/smile")} alt="Sena" />
		</Screen>
	);
}
`;

		/** Publishes the runtime with its binding; the chat snapshot ships as usual. */
		async function publishRuntimeStory(
			cookie: string,
			assetId: string,
			kind: "image" | "audio" = "image",
		): Promise<string> {
			const response = await publish(cookie, {
				...publishRequest([]),
				runtime: {
					mode: "source",
					project: {
						apiVersion: RUNTIME_API_VERSION,
						entry: "src/main.tsx",
						files: [{ path: "src/main.tsx", content: RUNTIME_SOURCE }],
						assets: [
							kind === "audio"
								? { path: "audio/bgm/main", assetId, kind }
								: { path: "characters/sena/smile", assetId },
						],
					},
				},
			});
			expect(response.status).toBe(201);
			const id = ((await response.json()) as { story: { id: string } }).story
				.id;
			orphaned.push(id);
			return id;
		}

		test("a surviving runtime story's pictures stay readable after the creator deletes their account", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");
			const reader = await signUp("Reader");

			const asset = await uploadRuntimeImage(creator.memberId);
			const key = (await mediaRow(asset))?.key ?? "";
			expect(await bytesExist(key)).toBe(true);

			const storyId = await publishRuntimeStory(creator.cookie, asset);

			const summary = await deleteAccountForUser(creator.authUserId);
			expect(summary.preservedStoryMedia).toBeGreaterThanOrEqual(1);

			/** The row stays with only the identity detached. */
			expect((await mediaRow(asset))?.owner).toBeNull();
			/** The bytes remain. */
			expect(await bytesExist(key)).toBe(true);
			/** Above all, the reader actually reads it. */
			expect((await get(reader.cookie, `/v2/media/${asset}`)).status).toBe(200);

			/** The playback response carries that binding as-is. */
			const playback = await get(
				reader.cookie,
				`/v2/stories/${storyId}/playback`,
			);
			expect(playback.status).toBe(200);
			expect(await playback.text()).toContain(asset);
		});

		/**
		 * Sound is under the same promise; this is where the decision not to split roles pays off.
		 * `story_media` answers "does this story stand without this media", which does not include the
		 * medium, so the preservation query does not ask the kind and carries sound along.
		 */
		test("a surviving runtime story's sounds remain after the creator deletes their account too", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");
			const reader = await signUp("Reader");

			const track = await uploadRuntimeAudio(creator.memberId);
			const key = (await mediaRow(track))?.key ?? "";
			expect(await bytesExist(key)).toBe(true);

			await publishRuntimeStory(creator.cookie, track, "audio");

			await deleteAccountForUser(creator.authUserId);

			expect((await mediaRow(track))?.owner).toBeNull();
			expect(await bytesExist(key)).toBe(true);
			/** Above all, the reader actually hears it. */
			expect((await get(reader.cookie, `/v2/media/${track}`)).status).toBe(200);
		});

		/** Unused sound is deleted exactly like images; the kind is not grounds for preservation. */
		test("unbound runtime sounds are deleted", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");

			const used = await uploadRuntimeImage(creator.memberId);
			const unusedTrack = await uploadRuntimeAudio(creator.memberId);
			const unusedKey = (await mediaRow(unusedTrack))?.key ?? "";

			await publishRuntimeStory(creator.cookie, used);

			await deleteAccountForUser(creator.authUserId);

			expect(await mediaRow(unusedTrack)).toBeNull();
			expect(await bytesExist(unusedKey)).toBe(false);
		});

		/** Opposite direction: an unused runtime image is still deleted. */
		test("unbound runtime images are still deleted", async () => {
			if (!ready) return;
			const creator = await signUp("A departing creator");

			const used = await uploadRuntimeImage(creator.memberId);
			const unused = await uploadRuntimeImage(creator.memberId);
			const usedKey = (await mediaRow(used))?.key ?? "";
			const unusedKey = (await mediaRow(unused))?.key ?? "";

			await publishRuntimeStory(creator.cookie, used);

			await deleteAccountForUser(creator.authUserId);

			expect(await mediaRow(used)).not.toBeNull();
			expect(await bytesExist(usedKey)).toBe(true);
			expect(await mediaRow(unused)).toBeNull();
			expect(await bytesExist(unusedKey)).toBe(false);
		});
	},
);
