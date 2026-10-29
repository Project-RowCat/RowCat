import type { AuthoringStore, StoryPublicationSource } from "@rowcat/authoring";
import {
	createDraftStartSceneRecord,
	createStoryDraftRecord,
} from "@rowcat/authoring";
import type { StoryPublishRequest } from "@rowcat/contracts";
import {
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
} from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it, vi } from "vitest";
import { type PublishDraftResult, publishDraft } from "./publish-draft.ts";

/**
 * Publish-order tests. What breaks here is the order of irreversible steps. Failures in this layer
 * show no error on screen. Writing the draft after an account switch adds data to another user's
 * device. Navigating before the write shows the user a work address that is not theirs. So the
 * order is pinned by hand, with no render, Dexie, or server involved.
 */

const NOW = "2026-01-01T00:00:00.000Z";
/**
 * The publish path never reads the revision. This value only fills the slot needed to build the
 * record.
 */
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

/** Minimal draft that passes validation. A title and a scenario are enough. */
function source(overrides: Partial<StoryPublicationSource> = {}) {
	return {
		draft: createStoryDraftRecord(
			{ title: "The Night Library", prompt: "A library where the books talk." },
			{ id: "draft-1", now: NOW, rev: REV },
		),
		lore: [],
		startScenes: [],
		sceneImages: [],
		...overrides,
	} satisfies StoryPublicationSource;
}

/**
 * Store stub. This layer does not care how the store is implemented, only what is called and when.
 */
function stubStore(
	publicationSource: StoryPublicationSource | null = source(),
) {
	const markPublished = vi.fn(async () => null);
	const store = {
		loadPublicationSource: vi.fn(async () => publicationSource),
		markPublished,
	} as unknown as AuthoringStore;
	return { store, markPublished };
}

const published = (id = "story-9", created = true): PublishDraftResult => ({
	created,
	story: { id },
});

interface Harness {
	store: AuthoringStore;
	markPublished: ReturnType<typeof vi.fn>;
	publish: ReturnType<typeof vi.fn>;
	navigate: ReturnType<typeof vi.fn>;
	lock: { current: boolean };
	owns: { current: boolean };
	run: () => ReturnType<typeof publishDraft>;
}

/**
 * Simulates the active scope with one mutable variable. The real check
 * (`LocalDataScopeProvider.ownsStore`) compares the store instance and member id. This helper
 * enforces only one contract: once the predicate turns false, publishing must stop.
 */
function harness(
	options: {
		publicationSource?: StoryPublicationSource | null;
		publish?: (request: StoryPublishRequest) => Promise<PublishDraftResult>;
		uploadStagedCover?: (storyId: string) => Promise<void>;
	} = {},
): Harness {
	const { store, markPublished } = stubStore(
		options.publicationSource === undefined
			? source()
			: options.publicationSource,
	);
	const owns = { current: true };
	const lock = { current: false };
	const publish = vi.fn(options.publish ?? (async () => published()));
	const navigate = vi.fn(async () => undefined);

	return {
		store,
		markPublished,
		publish,
		navigate,
		lock,
		owns,
		run: () =>
			publishDraft({
				draftId: "draft-1",
				lock,
				ensureStore: async () => store,
				stillOwnsStore: () => owns.current,
				publish,
				navigate,
				uploadStagedCover: options.uploadStagedCover,
			}),
	};
}

describe("the normal path", () => {
	it("finishes in order: assemble → publish → record on the draft → navigate", async () => {
		const h = harness();

		const outcome = await h.run();

		expect(outcome).toEqual({
			status: "published",
			storyId: "story-9",
			created: true,
		});
		expect(h.publish).toHaveBeenCalledTimes(1);
		expect(h.markPublished).toHaveBeenCalledWith("draft-1", "story-9");
		expect(h.navigate).toHaveBeenCalledWith("story-9");
	});

	it("what goes to the server is only the authored content and the draft origin", async () => {
		const h = harness();
		await h.run();

		const request = h.publish.mock.calls[0]?.[0] as StoryPublishRequest;
		expect(request.originDraftId).toBe("draft-1");
		// The work id and rating snapshot are set by the server. If the request carried them, a client
		// could forge them.
		expect(request.play).not.toHaveProperty("storyId");
		expect(request.metadata.visibility).toBe("private");
	});

	it("a recovery (created=false) also counts as success and links to the same story", async () => {
		/**
		 * Retry after a lost response. Showing an error here would make the user press again, even though
		 * the work was already published.
		 */
		const h = harness({ publish: async () => published("story-9", false) });

		const outcome = await h.run();

		expect(outcome).toMatchObject({ status: "published", created: false });
		expect(h.markPublished).toHaveBeenCalledWith("draft-1", "story-9");
		expect(h.navigate).toHaveBeenCalledWith("story-9");
	});
});

describe("validation", () => {
	it("without a title nothing goes over the network", async () => {
		const h = harness({
			publicationSource: source({
				draft: createStoryDraftRecord(
					{ prompt: "there is content" },
					{ id: "draft-1", now: NOW, rev: REV },
				),
			}),
		});

		const outcome = await h.run();

		expect(outcome.status).toBe("invalid");
		if (outcome.status !== "invalid") return;
		expect(outcome.issues.map((i) => i.field)).toContain("title");
		expect(h.publish).not.toHaveBeenCalled();
		expect(h.markPublished).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
	});

	it("a mismatched default opening is caught before publishing", async () => {
		const draft = createStoryDraftRecord(
			{ title: "Title", prompt: "Content" },
			{ id: "draft-1", now: NOW, rev: REV },
		);
		const h = harness({
			publicationSource: source({
				draft: { ...draft, defaultStartSceneId: "missing-scene" },
				startScenes: [
					createDraftStartSceneRecord(
						{ draftId: "draft-1", position: 0, content: "first scene" },
						{ id: "scene-1", now: NOW, rev: REV },
					),
				],
			}),
		});

		expect((await h.run()).status).toBe("invalid");
		expect(h.publish).not.toHaveBeenCalled();
	});
});

describe("account switch", () => {
	it("if the account changes before sending, no request goes out at all", async () => {
		/**
		 * The request goes out with the browser's current session cookie. Sent after an account switch,
		 * the draft becomes another account's work, and the server cannot detect it.
		 */
		const h = harness();
		h.owns.current = false;

		expect(await h.run()).toEqual({ status: "stale" });
		expect(h.publish).not.toHaveBeenCalled();
		expect(h.markPublished).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
	});

	it("if the account changes during publishing, it neither writes the draft nor navigates", async () => {
		const h = harness({
			publish: async () => {
				h.owns.current = false;
				return published();
			},
		});

		expect(await h.run()).toEqual({ status: "stale" });
		// The work now exists on the server and cannot be undone. The guard only prevents writing into
		// another account's draft.
		expect(h.publish).toHaveBeenCalledTimes(1);
		expect(h.markPublished).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
	});

	it("if the account changes while writing the draft, it does not navigate", async () => {
		const { store, markPublished } = stubStore();
		const owns = { current: true };
		markPublished.mockImplementation(async () => {
			owns.current = false;
			return null;
		});
		const navigate = vi.fn(async () => undefined);

		const outcome = await publishDraft({
			draftId: "draft-1",
			lock: { current: false },
			ensureStore: async () => store,
			stillOwnsStore: () => owns.current,
			publish: async () => published(),
			navigate,
		});

		expect(outcome).toEqual({ status: "stale" });
		/**
		 * Navigating the newly signed-in account to the previous account's work address ends in a 404,
		 * and the user cannot tell why.
		 */
		expect(navigate).not.toHaveBeenCalled();
	});
});

describe("failure", () => {
	it("if local storage can't be opened nothing goes to the server", async () => {
		const publish = vi.fn();
		const outcome = await publishDraft({
			draftId: "draft-1",
			lock: { current: false },
			ensureStore: async () => null,
			stillOwnsStore: () => true,
			publish,
			navigate: async () => undefined,
		});

		expect(outcome).toEqual({ status: "failed", reason: "storage" });
		expect(publish).not.toHaveBeenCalled();
	});

	it("does not publish if the draft was deleted meanwhile", async () => {
		const h = harness({ publicationSource: null });
		expect(await h.run()).toEqual({ status: "failed", reason: "storage" });
		expect(h.publish).not.toHaveBeenCalled();
	});

	it("server rejections split by reason", async () => {
		const cases = [
			[STORY_LIFECYCLE_ERROR_CODE.archived, "story_archived"],
			[STORY_PUBLISH_ERROR_CODE.archivedUnavailable, "archived_unavailable"],
			[STORY_PUBLISH_ERROR_CODE.adultNotPermitted, "adult_not_permitted"],
			[STORY_PUBLISH_ERROR_CODE.originMismatch, "origin_mismatch"],
			[STORY_PUBLISH_ERROR_CODE.sceneImageInvalid, "scene_image_invalid"],
			/**
			 * A rejection that asks the user to fix the asset list, not the code. Folding it into a generic
			 * message would only suggest retrying.
			 */
			[STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid, "runtime_asset_invalid"],
			["capability_restricted", "restricted"],
			["account_restricted", "restricted"],
			["something_else", "unknown"],
		] as const;

		for (const [code, reason] of cases) {
			const h = harness({
				publish: async () => {
					throw new RowCatApiError({ status: 403, code, message: "rejected" });
				},
			});
			expect(await h.run()).toEqual({ status: "failed", reason });
			expect(h.markPublished).not.toHaveBeenCalled();
			expect(h.navigate).not.toHaveBeenCalled();
		}
	});

	it("a network failure leaves no trace on the draft", async () => {
		const h = harness({
			publish: async () => {
				throw new Error("the network dropped");
			},
		});

		expect(await h.run()).toEqual({ status: "failed", reason: "unknown" });
		expect(h.markPublished).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
	});
});

describe("double run", () => {
	it("a second call in the same tick does nothing", async () => {
		/**
		 * `setState` takes effect only on the next render, so two clicks in the same tick both see 'not
		 * in progress'. Only a synchronous lock closes that window.
		 */
		const h = harness();

		const [first, second] = await Promise.all([h.run(), h.run()]);

		expect([first.status, second.status].sort()).toEqual(["busy", "published"]);
		expect(h.publish).toHaveBeenCalledTimes(1);
	});

	it("the lock is released afterwards", async () => {
		const h = harness();
		await h.run();
		expect(h.lock.current).toBe(false);

		await h.run();
		expect(h.publish).toHaveBeenCalledTimes(2);
	});
});

describe("the chosen cover", () => {
	/**
	 * Order is the whole point of this test. The cover is keyed on `story_id`, so it cannot be
	 * uploaded before the work exists. If uploaded after navigation, the user sees the work detail
	 * without the cover they just picked.
	 */
	it("uploads after the story exists and before navigating", async () => {
		const order: string[] = [];
		const h = harness({
			uploadStagedCover: async (storyId) => {
				order.push(`cover:${storyId}`);
			},
		});
		h.navigate.mockImplementation(async (storyId: string) => {
			order.push(`navigate:${storyId}`);
			return undefined;
		});

		const outcome = await h.run();

		expect(outcome).toEqual({
			status: "published",
			storyId: "story-9",
			created: true,
		});
		expect(order).toEqual(["cover:story-9", "navigate:story-9"]);
	});

	/**
	 * A cover upload failure does not fail the publish. By then the work exists on the server and the
	 * draft links to it. There is nothing to roll back, and rolling back would be wrong. Returning
	 * `failed` here would show a successful publish as failed. The user would press again and be
	 * unsure where their work is. Publish is idempotent, so no duplicate is created.
	 */
	it("a failed cover upload still counts as a published success and navigates", async () => {
		const h = harness({
			uploadStagedCover: async () => {
				throw new Error("the network dropped");
			},
		});

		const outcome = await h.run();

		expect(outcome).toEqual({
			status: "published",
			storyId: "story-9",
			created: true,
		});
		expect(h.navigate).toHaveBeenCalledWith("story-9");
	});

	/**
	 * A publish without a chosen cover must still finish as a single request. Making the injection
	 * optional guarantees this, and the function must call nothing when it is absent.
	 */
	it("without injection there is no cover step at all", async () => {
		const h = harness();

		const outcome = await h.run();

		expect(outcome.status).toBe("published");
		expect(h.navigate).toHaveBeenCalledWith("story-9");
	});

	/** A rejected publish has no work to attach a cover to, so the cover step is never reached. */
	it("a failed publish uploads no cover", async () => {
		const uploadStagedCover = vi.fn(async () => undefined);
		const h = harness({
			publish: async () => {
				throw new Error("the server rejected it");
			},
			uploadStagedCover,
		});

		const outcome = await h.run();

		expect(outcome).toEqual({ status: "failed", reason: "unknown" });
		expect(uploadStagedCover).not.toHaveBeenCalled();
	});
});
