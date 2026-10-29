import {
	STORY_PUBLISH_ERROR_CODE,
	type StoryPlaybackDto,
	type StoryPublishRequestInput,
} from "@rowcat/contracts";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { media, story_media, story_runtime } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Managed image bindings: does a logical name cross publication into playback, and does the server
 * really adjudicate the reference.
 *
 * Four facts cannot be checked with mocks, so this runs through the real Hono app and Postgres:
 *
 * ```text
 * ownership/kind  do the three predicate conditions really reject (one missing `kind` is silent)
 * atomicity       do artifact and bindings move in the same statement (transaction boundary)
 * role isolation  does a runtime publication touch scene-image dependencies (role in the predicate)
 * preservation    does an absent `runtime` leave bindings alone (rollout of old clients)
 * ```
 *
 * Preservation is the costliest of them: reading that absence as "turned off" would let one update
 * publication silently erase already-published images.
 */

const EMAIL_PREFIX = "runtime-asset-test-";

const signUp = () => createTestMember(EMAIL_PREFIX, { name: "runtime image" });

/**
 * A runtime that calls two logical names, though the source need not name them.
 *
 * The compiler does not collect logical references statically (unlike remote addresses), so the
 * published bindings are a list independent of source; one test below binds a name the source never
 * mentions.
 */
const ASSET_SOURCE = `import { Image, Screen, asset } from "@rowcat/runtime";

export default function App() {
	return (
		<Screen>
			<Image source={asset("characters/sena/smile")} alt="Sena" />
			<Image source={asset("backgrounds/library")} alt="library" />
		</Screen>
	);
}
`;

/**
 * Plants one media row directly.
 *
 * Skips the upload route because it requires a libvips decode; what is under test is the
 * reference's ownership and kind decision, which reads only the row's `owner` and `kind` (the
 * scene-image test made the same call).
 */
async function seedMedia(
	ownerId: string,
	kind: "runtime_image" | "scene_image" | "avatar" = "runtime_image",
	/**
	 * Lifecycle status. Defaults to what uploads create today; `pending` pre-stages a state a later
	 * safety check will create, to see publication refuse it.
	 */
	status: "ready" | "pending" = "ready",
): Promise<string> {
	const id = newId();
	await db.insert(media).values({
		id,
		owner: ownerId,
		kind,
		mime: "image/webp",
		width: 512,
		height: 512,
		byte_size: 1024,
		storage_key: `media/${kind}/${ownerId}/${id}.webp`,
		status,
	});
	return id;
}

/**
 * One audio media row: no dimensions, has a duration.
 *
 * That asymmetry is the helper's point. It is not the image helper widened by one argument because
 * the two kinds fill opposite columns, and one function would make an audio row with `width: 0`
 * expressible.
 */
async function seedAudioMedia(
	ownerId: string,
	kind: "runtime_audio" | "runtime_image" = "runtime_audio",
	status: "ready" | "pending" = "ready",
): Promise<string> {
	const id = newId();
	await db.insert(media).values({
		id,
		owner: ownerId,
		kind,
		mime: "audio/mpeg",
		duration_ms: 42_000,
		byte_size: 65_536,
		storage_key: `media/${kind}/${ownerId}/${id}.mp3`,
		status,
	});
	return id;
}

const runtimeSource = (
	assets: { path: string; assetId: string; kind?: "image" | "audio" }[],
	content = ASSET_SOURCE,
) => ({
	mode: "source" as const,
	project: {
		apiVersion: RUNTIME_API_VERSION,
		entry: "src/main.tsx",
		files: [{ path: "src/main.tsx", content }],
		assets,
	},
});

function publishRequest(
	overrides: Partial<StoryPublishRequestInput> = {},
): StoryPublishRequestInput {
	return {
		originDraftId: newId(),
		metadata: { title: "A runtime with pictures", visibility: "private" },
		play: { scenario: "A runtime story." },
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

const playback = (cookie: string, storyId: string): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/stories/${storyId}/playback`, {
			headers: { Origin: WEB_ORIGIN, Cookie: cookie },
		}),
	);

const readRuntime = async (storyId: string) => {
	const [row] = await db
		.select()
		.from(story_runtime)
		.where(eq(story_runtime.story_id, storyId));
	return row ?? null;
};

/** Media this story is recorded as depending on, narrowed by role. */
const readReferences = async (
	storyId: string,
	role: string,
): Promise<string[]> => {
	const rows = await db
		.select({ id: story_media.media_id })
		.from(story_media)
		.where(and(eq(story_media.story_id, storyId), eq(story_media.role, role)));
	return rows.map((row) => row.id).sort();
};

interface PublishBody {
	created: boolean;
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

/** Publishes runtime and bindings together and returns the story id. */
async function publishWith(
	cookie: string,
	assets: { path: string; assetId: string; kind?: "image" | "audio" }[],
	overrides: Partial<StoryPublishRequestInput> = {},
): Promise<string> {
	const response = await publish(cookie, {
		...publishRequest(overrides),
		runtime: runtimeSource(assets),
	});
	if (response.status !== 201)
		throw new Error(
			`runtime publish failed: ${response.status} ${await response.text()}`,
		);
	return ((await response.json()) as PublishBody).story.id;
}

describe.skipIf(!databaseReady)("publishing managed images", () => {
	test("bindings commit together with the snapshot and the dependency relations", async () => {
		const owner = await signUp();
		const smile = await seedMedia(owner.memberId);
		const library = await seedMedia(owner.memberId);
		const storyId = await publishWith(owner.cookie, [
			{ path: "characters/sena/smile", assetId: smile },
			{ path: "backgrounds/library", assetId: library },
		]);

		const row = await readRuntime(storyId);
		/** What is stored is an identity, not an address: there is no `url` key. */
		expect(row?.managed_assets).toEqual([
			{ path: "backgrounds/library", assetId: library, kind: "image" },
			{ path: "characters/sena/smile", assetId: smile, kind: "image" },
		]);
		expect(await readReferences(storyId, "runtime_asset")).toEqual(
			[smile, library].sort(),
		);
	});

	test("binding the same picture to two names still gives one dependency row", async () => {
		const owner = await signUp();
		const shared = await seedMedia(owner.memberId);
		const storyId = await publishWith(owner.cookie, [
			{ path: "characters/sena/smile", assetId: shared },
			{ path: "characters/sena/happy", assetId: shared },
		]);

		const row = await readRuntime(storyId);
		expect(row?.managed_assets).toHaveLength(2);
		/** This table answers one question, "does the story stand without it", not how many times it is used. */
		expect(await readReferences(storyId, "runtime_asset")).toEqual([shared]);
	});

	/**
	 * Bindings are carried even when the source never calls the name: the compiler does not collect
	 * logical references. Unlike remote addresses, the threat model allows it: a logical name points
	 * at our own store and is not an outbound channel, so a dynamically assembled name that is in the
	 * table must open.
	 */
	test("names not in the source can be bound too — the list belongs to authoring", async () => {
		const owner = await signUp();
		const asset = await seedMedia(owner.memberId);
		const storyId = await publishWith(owner.cookie, [
			{ path: "characters/sena/angry", assetId: asset },
		]);
		expect(
			await readRuntime(storyId).then((row) => row?.managed_assets),
		).toEqual([
			{ path: "characters/sena/angry", assetId: asset, kind: "image" },
		]);
	});
});

describe.skipIf(!databaseReady)("validating managed images", () => {
	test("a publish pointing at someone else's media is blocked", async () => {
		const owner = await signUp();
		const stranger = await signUp();
		const foreign = await seedMedia(stranger.memberId);

		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: runtimeSource([
				{ path: "characters/sena/smile", assetId: foreign },
			]),
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
		);
	});

	/**
	 * `kind` is in the predicate because of this case. Ownership alone would let someone publish their
	 * own avatar or scene-image id as a runtime asset, which would render, but is a photo they never
	 * agreed to put there.
	 */
	test.each([
		"avatar",
		"scene_image",
	] as const)("even your own %s media can't become a runtime asset", async (kind) => {
		const owner = await signUp();
		const wrongKind = await seedMedia(owner.memberId, kind);

		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: runtimeSource([
				{ path: "characters/sena/smile", assetId: wrongKind },
			]),
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
		);
	});

	test("missing media and someone else's media get the same refusal — existence doesn't leak", async () => {
		const owner = await signUp();
		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: runtimeSource([
				{ path: "characters/sena/smile", assetId: newId() },
			]),
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
		);
	});

	test("a publish binding the same name twice is blocked — not folded quietly", async () => {
		const owner = await signUp();
		const first = await seedMedia(owner.memberId);
		const second = await seedMedia(owner.memberId);

		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: runtimeSource([
				{ path: "characters/sena/smile", assetId: first },
				{ path: "characters/sena/smile", assetId: second },
			]),
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
		);
	});

	/**
	 * The logical-name grammar is decided by the language contract (`classifyRuntimeAssetValue`): an
	 * address, a parent path or whitespace cannot be a logical asset. This list shows the server keeps
	 * no regex copy.
	 *
	 * The empty string is absent on purpose: the contract schema (`z.string().min(1)`) rejects it
	 * earlier, so it never reaches this predicate and would blur which layer answers.
	 */
	test.each([
		"https://cdn.example.com/a.png",
		"../escape",
		"has space",
	])("blocked when the name is %j", async (path) => {
		const owner = await signUp();
		const asset = await seedMedia(owner.memberId);
		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: runtimeSource([{ path, assetId: asset }]),
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as ErrorBody).code).toBe(
			STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
		);
	});

	/** An empty name is rejected by the contract; either layer, the point is that it is not published. */
	test("an empty name is blocked by the contract", async () => {
		const owner = await signUp();
		const asset = await seedMedia(owner.memberId);
		const response = await publish(owner.cookie, {
			...publishRequest(),
			runtime: runtimeSource([{ path: "", assetId: asset }]),
		});
		expect(response.status).toBe(400);
	});

	/** A rejected publication creates no story row: validation comes before commit. */
	test("a refused publish doesn't touch already published bindings", async () => {
		const owner = await signUp();
		const good = await seedMedia(owner.memberId);
		const draftId = newId();
		const storyId = await publishWith(
			owner.cookie,
			[{ path: "characters/sena/smile", assetId: good }],
			{ originDraftId: draftId },
		);

		const stranger = await signUp();
		const foreign = await seedMedia(stranger.memberId);
		const rejected = await update(owner.cookie, storyId, {
			...publishRequest({ originDraftId: draftId }),
			runtime: runtimeSource([{ path: "ui/heart", assetId: foreign }]),
		});
		expect(rejected.status).toBe(400);

		const row = await readRuntime(storyId);
		expect(row?.managed_assets).toEqual([
			{ path: "characters/sena/smile", assetId: good, kind: "image" },
		]);
		expect(await readReferences(storyId, "runtime_asset")).toEqual([good]);
	});
});

describe.skipIf(!databaseReady)(
	"republishing — references settle to the final state",
	() => {
		test("a swapped picture replaces the old reference", async () => {
			const owner = await signUp();
			const before = await seedMedia(owner.memberId);
			const after = await seedMedia(owner.memberId);
			const draftId = newId();
			const storyId = await publishWith(
				owner.cookie,
				[{ path: "characters/sena/smile", assetId: before }],
				{ originDraftId: draftId },
			);

			const response = await update(owner.cookie, storyId, {
				...publishRequest({ originDraftId: draftId }),
				runtime: runtimeSource([
					{ path: "characters/sena/smile", assetId: after },
				]),
			});
			expect(response.status).toBe(200);

			const row = await readRuntime(storyId);
			expect(row?.managed_assets).toEqual([
				{ path: "characters/sena/smile", assetId: after, kind: "image" },
			]);
			/** Reconciles to the final state rather than adding; a leftover old reference would be retained by account deletion. */
			expect(await readReferences(storyId, "runtime_asset")).toEqual([after]);
		});

		test("republishing with an empty list removes every reference", async () => {
			const owner = await signUp();
			const asset = await seedMedia(owner.memberId);
			const draftId = newId();
			const storyId = await publishWith(
				owner.cookie,
				[{ path: "characters/sena/smile", assetId: asset }],
				{ originDraftId: draftId },
			);

			const response = await update(owner.cookie, storyId, {
				...publishRequest({ originDraftId: draftId }),
				runtime: runtimeSource([]),
			});
			expect(response.status).toBe(200);
			expect(
				await readRuntime(storyId).then((row) => row?.managed_assets),
			).toEqual([]);
			expect(await readReferences(storyId, "runtime_asset")).toEqual([]);
		});

		/**
		 * The costliest case in this file. During rollout, clients that do not know this axis send update
		 * publications, and reading that absence as "turned off" would silently erase the published
		 * images.
		 */
		test("an update without `runtime` preserves the bindings", async () => {
			const owner = await signUp();
			const asset = await seedMedia(owner.memberId);
			const draftId = newId();
			const storyId = await publishWith(
				owner.cookie,
				[{ path: "characters/sena/smile", assetId: asset }],
				{ originDraftId: draftId },
			);

			const response = await update(
				owner.cookie,
				storyId,
				publishRequest({ originDraftId: draftId }),
			);
			expect(response.status).toBe(200);

			expect(
				await readRuntime(storyId).then((row) => row?.managed_assets),
			).toEqual([
				{ path: "characters/sena/smile", assetId: asset, kind: "image" },
			]);
			expect(await readReferences(storyId, "runtime_asset")).toEqual([asset]);
		});

		test("turning the runtime off removes the artifact and the references together", async () => {
			const owner = await signUp();
			const asset = await seedMedia(owner.memberId);
			const draftId = newId();
			const storyId = await publishWith(
				owner.cookie,
				[{ path: "characters/sena/smile", assetId: asset }],
				{ originDraftId: draftId },
			);

			const response = await update(owner.cookie, storyId, {
				...publishRequest({ originDraftId: draftId }),
				runtime: { mode: "disabled" },
			});
			expect(response.status).toBe(200);
			expect(await readRuntime(storyId)).toBeNull();
			expect(await readReferences(storyId, "runtime_asset")).toEqual([]);
		});
	},
);

/**
 * Roles are pinned in the predicate. Without this, a runtime publication would strip the same
 * story's scene-image dependencies, a loss only visible to buyers when the creator leaves.
 */
describe.skipIf(!databaseReady)("roles don't step on each other", () => {
	test("a runtime publish doesn't delete scene image references", async () => {
		const owner = await signUp();
		const scene = await seedMedia(owner.memberId, "scene_image");
		const runtimeAsset = await seedMedia(owner.memberId);
		const draftId = newId();

		const created = await publish(owner.cookie, {
			...publishRequest({ originDraftId: draftId }),
			play: {
				scenario: "A runtime story.",
				sceneImages: [{ trigger: "night", assetId: scene }],
			},
			runtime: runtimeSource([
				{ path: "characters/sena/smile", assetId: runtimeAsset },
			]),
		});
		expect(created.status).toBe(201);
		const storyId = ((await created.json()) as PublishBody).story.id;

		expect(await readReferences(storyId, "scene_image")).toEqual([scene]);
		expect(await readReferences(storyId, "runtime_asset")).toEqual([
			runtimeAsset,
		]);

		/** Swap only the runtime; scene images stay in the request unchanged. */
		const replacement = await seedMedia(owner.memberId);
		const updated = await update(owner.cookie, storyId, {
			...publishRequest({ originDraftId: draftId }),
			play: {
				scenario: "A runtime story.",
				sceneImages: [{ trigger: "night", assetId: scene }],
			},
			runtime: runtimeSource([
				{ path: "characters/sena/smile", assetId: replacement },
			]),
		});
		expect(updated.status).toBe(200);

		expect(await readReferences(storyId, "scene_image")).toEqual([scene]);
		expect(await readReferences(storyId, "runtime_asset")).toEqual([
			replacement,
		]);
	});

	test("scene image references remain even with the runtime off", async () => {
		const owner = await signUp();
		const scene = await seedMedia(owner.memberId, "scene_image");
		const runtimeAsset = await seedMedia(owner.memberId);
		const draftId = newId();

		const created = await publish(owner.cookie, {
			...publishRequest({ originDraftId: draftId }),
			play: {
				scenario: "A runtime story.",
				sceneImages: [{ trigger: "night", assetId: scene }],
			},
			runtime: runtimeSource([
				{ path: "characters/sena/smile", assetId: runtimeAsset },
			]),
		});
		const storyId = ((await created.json()) as PublishBody).story.id;

		await update(owner.cookie, storyId, {
			...publishRequest({ originDraftId: draftId }),
			play: {
				scenario: "A runtime story.",
				sceneImages: [{ trigger: "night", assetId: scene }],
			},
			runtime: { mode: "disabled" },
		});

		expect(await readReferences(storyId, "scene_image")).toEqual([scene]);
		expect(await readReferences(storyId, "runtime_asset")).toEqual([]);
	});
});

describe.skipIf(!databaseReady)(
	"playback — bindings come with the artifact",
	() => {
		test("an eligible person receives the artifact and bindings in one response", async () => {
			const owner = await signUp();
			const asset = await seedMedia(owner.memberId);
			const storyId = await publishWith(owner.cookie, [
				{ path: "characters/sena/smile", assetId: asset },
			]);

			const response = await playback(owner.cookie, storyId);
			expect(response.status).toBe(200);
			const body = (await response.json()) as StoryPlaybackDto;
			expect(body.kind).toBe("runtime");
			if (body.kind !== "runtime") return;
			expect(body.managedAssets).toEqual([
				{ path: "characters/sena/smile", assetId: asset, kind: "image" },
			]);
			/** An identity, not an address: no `url` anywhere in the response. */
			expect(JSON.stringify(body.managedAssets)).not.toContain("http");
		});

		test("an ineligible person doesn't receive the bindings either — there is one door", async () => {
			const owner = await signUp();
			const stranger = await signUp();
			const asset = await seedMedia(owner.memberId);
			const storyId = await publishWith(owner.cookie, [
				{ path: "characters/sena/smile", assetId: asset },
			]);

			const response = await playback(stranger.cookie, storyId);
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("characters/sena/smile");
		});

		/**
		 * Audio bindings reach the playback response with their kind.
		 *
		 * Without it, publication succeeds and only playback goes silent: the resolver splits on kind
		 * (`bindRuntimeAssetResolver`), so a binding without `kind` does not resolve for `<Audio>`.
		 */
		test("sound bindings come with kind: audio", async () => {
			const owner = await signUp();
			const track = await seedAudioMedia(owner.memberId);
			const storyId = await publishWith(owner.cookie, [
				{ path: "audio/bgm/main", assetId: track, kind: "audio" },
			]);

			const body = (await (
				await playback(owner.cookie, storyId)
			).json()) as StoryPlaybackDto;
			if (body.kind !== "runtime") throw new Error("not a runtime response");
			expect(body.managedAssets).toEqual([
				{ path: "audio/bgm/main", assetId: track, kind: "audio" },
			]);
		});

		test("a runtime with no bindings is an empty array — not absent", async () => {
			const owner = await signUp();
			const storyId = await publishWith(owner.cookie, []);
			const body = (await (
				await playback(owner.cookie, storyId)
			).json()) as StoryPlaybackDto;
			if (body.kind !== "runtime") throw new Error("not a runtime response");
			expect(body.managedAssets).toEqual([]);
		});
	},
);

/* Managed audio: the kind is the authorization. */

describe.skipIf(!databaseReady)("publishing managed sounds", () => {
	test("sound bindings commit with their kind and the dependency stands", async () => {
		const owner = await signUp();
		const track = await seedAudioMedia(owner.memberId);
		const storyId = await publishWith(owner.cookie, [
			{ path: "audio/bgm/main", assetId: track, kind: "audio" },
		]);

		expect(
			await readRuntime(storyId).then((row) => row?.managed_assets),
		).toEqual([{ path: "audio/bgm/main", assetId: track, kind: "audio" }]);
		/**
		 * The role is the same as for images: this table's question does not include the medium, and
		 * splitting would force lifecycle code to walk both roles, so a buyer's sound would vanish the
		 * day one is missed.
		 */
		expect(await readReferences(storyId, "runtime_asset")).toEqual([track]);
	});

	test("pictures and sounds mixed in one publish settle in path order", async () => {
		const owner = await signUp();
		const smile = await seedMedia(owner.memberId);
		const track = await seedAudioMedia(owner.memberId);
		const storyId = await publishWith(owner.cookie, [
			{ path: "characters/sena/smile", assetId: smile },
			{ path: "audio/bgm/main", assetId: track, kind: "audio" },
		]);

		expect(
			await readRuntime(storyId).then((row) => row?.managed_assets),
		).toEqual([
			{ path: "audio/bgm/main", assetId: track, kind: "audio" },
			{ path: "characters/sena/smile", assetId: smile, kind: "image" },
		]);
		expect(await readReferences(storyId, "runtime_asset")).toEqual(
			[smile, track].sort(),
		);
	});
});

describe.skipIf(!databaseReady)(
	"validating managed sounds — a kind mismatch is blocked",
	() => {
		/**
		 * The two most important lines in this file. The client's `kind` is input to validation, not the
		 * conclusion: the server uses it to pick which predicate to ask, and the DB answers whether that
		 * media really is that kind.
		 */
		test("a publish putting picture media in a sound slot is blocked", async () => {
			const owner = await signUp();
			const image = await seedMedia(owner.memberId);
			const response = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource([
					{ path: "audio/bgm/main", assetId: image, kind: "audio" },
				]),
			});
			expect(response.status).toBe(400);
		});

		test("a publish putting sound media in a picture slot is blocked", async () => {
			const owner = await signUp();
			const track = await seedAudioMedia(owner.memberId);
			const response = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource([
					{ path: "characters/sena/smile", assetId: track, kind: "image" },
				]),
			});
			expect(response.status).toBe(400);
		});

		/** An omitted kind means image, so audio media cannot enter through that path either. */
		test("sound media with the kind omitted is blocked too — absence means image", async () => {
			const owner = await signUp();
			const track = await seedAudioMedia(owner.memberId);
			const response = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource([{ path: "audio/bgm/main", assetId: track }]),
			});
			expect(response.status).toBe(400);
		});

		test("a publish pointing at someone else's sound is blocked", async () => {
			const owner = await signUp();
			const stranger = await signUp();
			const foreign = await seedAudioMedia(stranger.memberId);
			const response = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource([
					{ path: "audio/bgm/main", assetId: foreign, kind: "audio" },
				]),
			});
			expect(response.status).toBe(400);
		});
	},
);

describe.skipIf(!databaseReady)(
	"old client compatibility — unchanged even with sounds",
	() => {
		/**
		 * During rollout, clients that do not know this axis send update publications; reading that
		 * absence as "turned off" would silently erase the published audio too.
		 */
		test("an update without `runtime` preserves sound bindings too", async () => {
			const owner = await signUp();
			const track = await seedAudioMedia(owner.memberId);
			const draftId = newId();
			const storyId = await publishWith(
				owner.cookie,
				[{ path: "audio/bgm/main", assetId: track, kind: "audio" }],
				{ originDraftId: draftId },
			);

			const response = await update(
				owner.cookie,
				storyId,
				publishRequest({ originDraftId: draftId }),
			);
			expect(response.status).toBe(200);
			expect(
				await readRuntime(storyId).then((row) => row?.managed_assets),
			).toEqual([{ path: "audio/bgm/main", assetId: track, kind: "audio" }]);
			expect(await readReferences(storyId, "runtime_asset")).toEqual([track]);
		});

		/**
		 * An old row without a `kind` key folds to `image` at read time; the stored row is not rewritten,
		 * so there is no path that edits a publication without republishing.
		 */
		test("an old snapshot (no kind) is read as image", async () => {
			const owner = await signUp();
			const asset = await seedMedia(owner.memberId);
			const storyId = await publishWith(owner.cookie, [
				{ path: "characters/sena/smile", assetId: asset },
			]);

			/** Reverts to the row shape from before this version. */
			await db
				.update(story_runtime)
				.set({
					managed_assets: [{ path: "characters/sena/smile", assetId: asset }],
				})
				.where(eq(story_runtime.story_id, storyId));

			const body = (await (
				await playback(owner.cookie, storyId)
			).json()) as StoryPlaybackDto;
			if (body.kind !== "runtime") throw new Error("not a runtime response");
			expect(body.managedAssets).toEqual([
				{ path: "characters/sena/smile", assetId: asset, kind: "image" },
			]);
		});
	},
);

/* Media that is not yet public: publication only freezes what playback can open. */

describe.skipIf(!databaseReady)(
	"media that isn't `ready` is not published",
	() => {
		/**
		 * `pending` is not a value the upload path creates today. It is staged here because the state is
		 * in the vocabulary and the read predicate already filters it; if publication ignored it, the day
		 * a safety check lands this order becomes expressible:
		 *
		 * ```text
		 * publish with a pending asset   ->  succeeds
		 * playback opens that media      ->  GET /v2/media/:id serves only ready -> 404
		 * result                         ->  the work stays silent (or imageless) until republished
		 * ```
		 */
		test("a `pending` runtime sound is blocked", async () => {
			const owner = await signUp();
			const track = await seedAudioMedia(
				owner.memberId,
				"runtime_audio",
				"pending",
			);
			const response = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource([
					{ path: "audio/bgm/main", assetId: track, kind: "audio" },
				]),
			});
			expect(response.status).toBe(400);
			expect(((await response.json()) as ErrorBody).code).toBe(
				STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
			);
		});

		test("a `pending` runtime image is blocked", async () => {
			const owner = await signUp();
			const asset = await seedMedia(owner.memberId, "runtime_image", "pending");
			const response = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource([
					{ path: "characters/sena/smile", assetId: asset },
				]),
			});
			expect(response.status).toBe(400);
			expect(((await response.json()) as ErrorBody).code).toBe(
				STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid,
			);
		});

		/**
		 * Rejection does not state the status. `pending`, someone else's and missing must be one
		 * sentence, or this path becomes a probe for the lifecycle of other people's media.
		 */
		test("media that can't go public yet and missing media get the same refusal", async () => {
			const owner = await signUp();
			const pending = await seedMedia(
				owner.memberId,
				"runtime_image",
				"pending",
			);

			const [rejectedPending, rejectedMissing] = await Promise.all([
				publish(owner.cookie, {
					...publishRequest(),
					runtime: runtimeSource([
						{ path: "characters/sena/smile", assetId: pending },
					]),
				}),
				publish(owner.cookie, {
					...publishRequest(),
					runtime: runtimeSource([
						{ path: "characters/sena/smile", assetId: newId() },
					]),
				}),
			]);

			const [pendingBody, missingBody] = (await Promise.all([
				rejectedPending.json(),
				rejectedMissing.json(),
			])) as [
				ErrorBody & { message?: string },
				ErrorBody & { message?: string },
			];
			expect(rejectedPending.status).toBe(rejectedMissing.status);
			expect(pendingBody.code).toBe(missingBody.code);
			expect(pendingBody.message).toBe(missingBody.message);
			/** The internal lifecycle vocabulary does not leak into the response. */
			expect(JSON.stringify(pendingBody)).not.toContain("pending");
		});

		/**
		 * Atomicity: a rejected republish does not move the already-published snapshot at all. This pins
		 * that validation precedes commit; without it the creator suffers a deletion they never made, a
		 * work with the new sound unattached and the old one gone.
		 */
		test("republishing with `pending` leaves already published bindings as they are", async () => {
			const owner = await signUp();
			const live = await seedAudioMedia(owner.memberId);
			const draftId = newId();
			const storyId = await publishWith(
				owner.cookie,
				[{ path: "audio/bgm/main", assetId: live, kind: "audio" }],
				{ originDraftId: draftId },
			);

			const notReady = await seedAudioMedia(
				owner.memberId,
				"runtime_audio",
				"pending",
			);
			const rejected = await update(owner.cookie, storyId, {
				...publishRequest({ originDraftId: draftId }),
				runtime: runtimeSource([
					{ path: "audio/bgm/main", assetId: notReady, kind: "audio" },
				]),
			});
			expect(rejected.status).toBe(400);

			expect(
				await readRuntime(storyId).then((row) => row?.managed_assets),
			).toEqual([{ path: "audio/bgm/main", assetId: live, kind: "audio" }]);
			expect(await readReferences(storyId, "runtime_asset")).toEqual([live]);
		});

		/** One `pending` item blocks the whole publication rather than being dropped. */
		test("one `pending` item in a mixed list blocks the whole publish", async () => {
			const owner = await signUp();
			const goodImage = await seedMedia(owner.memberId);
			const pendingTrack = await seedAudioMedia(
				owner.memberId,
				"runtime_audio",
				"pending",
			);
			const response = await publish(owner.cookie, {
				...publishRequest(),
				runtime: runtimeSource([
					{ path: "characters/sena/smile", assetId: goodImage },
					{ path: "audio/bgm/main", assetId: pendingTrack, kind: "audio" },
				]),
			});
			expect(response.status).toBe(400);
		});
	},
);
