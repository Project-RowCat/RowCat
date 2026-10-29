import type { AuthoringStore, StoryPublicationSource } from "@rowcat/authoring";
import type { StoryPublishRequest } from "@rowcat/contracts";
import {
	CAPABILITY_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
} from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it, vi } from "vitest";
import {
	type PublishDraftInput,
	type PublishDraftResult,
	publishDraft,
} from "./publish-draft.ts";

/**
 * The publish order. This file pins the sequence, not values: each step's failure must not trigger
 * the next, and ownership must be checked right before every irreversible step. Getting one of
 * these wrong publishes a manuscript to another account, and the defect shows no symptom on screen.
 *
 * Same matrix as the web's `publish-draft.test.ts`.
 */

const DRAFT_ID = "draft-1";

/** One HLC revision. These tests do not exercise merging, so the value does not matter. */
const REV = { t: 1, c: 0, d: "device" } as const;

/** Minimal snapshot that goes through the real assembler. A title and a prompt are needed to pass validation. */
function source(): StoryPublicationSource {
	return {
		draft: {
			id: DRAFT_ID,
			schemaVersion: 2,
			title: "Title",
			tagline: "",
			description: "",
			tags: [],
			orientation: null,
			adult: false,
			visibility: "private",
			promptProtected: false,
			prompt: "Body",
			defaultStartSceneId: null,
			publishedStoryId: null,
			fieldRev: {
				meta: REV,
				rating: REV,
				body: REV,
				defaults: REV,
				publication: REV,
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			deletedAt: null,
			dirty: 1,
			serverVersion: 0,
			rev: REV,
		},
		lore: [],
		startScenes: [],
		sceneImages: [],
	};
}

interface Harness {
	input: PublishDraftInput;
	calls: string[];
	store: AuthoringStore;
	markPublished: ReturnType<typeof vi.fn>;
	publish: ReturnType<typeof vi.fn>;
	navigate: ReturnType<typeof vi.fn>;
	flush: ReturnType<typeof vi.fn>;
	/** Ownership is lost from this call on, set by call count. */
	loseOwnershipAfter: (calls: number) => void;
}

function harness(
	over: {
		flush?: () => Promise<boolean>;
		source?: () => Promise<StoryPublicationSource | null>;
		publish?: () => Promise<PublishDraftResult>;
		markPublished?: () => Promise<unknown>;
		navigate?: () => Promise<unknown>;
		ensureStore?: () => Promise<AuthoringStore | null>;
		uploadStagedCover?: (storyId: string) => Promise<boolean>;
	} = {},
): Harness {
	const calls: string[] = [];
	let ownershipChecks = 0;
	let loseAfter = Number.POSITIVE_INFINITY;

	const markPublished = vi.fn(async () => {
		calls.push("markPublished");
		return over.markPublished ? await over.markPublished() : null;
	});
	const loadPublicationSource = vi.fn(async () => {
		calls.push("load");
		return over.source ? await over.source() : source();
	});
	const store = {
		loadPublicationSource,
		markPublished,
	} as unknown as AuthoringStore;

	const flush = vi.fn(async () => {
		calls.push("flush");
		return over.flush ? await over.flush() : true;
	});
	const publish = vi.fn(async (_request: StoryPublishRequest) => {
		calls.push("publish");
		return over.publish
			? await over.publish()
			: { created: true, story: { id: "story-1" } };
	});
	const navigate = vi.fn(async () => {
		calls.push("navigate");
		return over.navigate ? await over.navigate() : undefined;
	});

	return {
		calls,
		store,
		markPublished,
		publish,
		navigate,
		flush,
		loseOwnershipAfter: (n) => {
			loseAfter = n;
		},
		input: {
			draftId: DRAFT_ID,
			lock: { current: false },
			flushAutosave: flush,
			ensureStore: over.ensureStore ?? (async () => store),
			stillOwnsStore: () => {
				ownershipChecks += 1;
				calls.push(`owns:${ownershipChecks}`);
				return ownershipChecks <= loseAfter;
			},
			publish,
			/**
			 * By default the cover step has nothing to upload (`true`). Its presence in the order is caught
			 * by the `calls` checks below; the failure branches have their own tests.
			 */
			uploadStagedCover:
				over.uploadStagedCover ??
				(async () => {
					calls.push("cover");
					return true;
				}),
			navigate,
		},
	};
}

describe("lock", () => {
	/**
	 * Locks before the first `await`, so a second call in the same tick cannot get past it. React
	 * state cannot do this: `setState` lands on the next render.
	 */
	it("a second call in the same tick is busy", async () => {
		const h = harness();
		const [first, second] = await Promise.all([
			publishDraft(h.input),
			publishDraft(h.input),
		]);
		const outcomes = [first.status, second.status];
		expect(outcomes).toContain("published");
		expect(outcomes).toContain("busy");
		expect(h.publish).toHaveBeenCalledTimes(1);
	});

	it("the lock releases after it finishes", async () => {
		const h = harness();
		await publishDraft(h.input);
		expect(h.input.lock.current).toBe(false);
		expect((await publishDraft(h.input)).status).toBe("published");
	});
});

describe("order", () => {
	/**
	 * Flush comes first. Publishing assembles from storage, so a sentence still in the debounce buffer
	 * would be missed.
	 */
	it("autosave flush → snapshot → server → draft → cover → navigation", async () => {
		const h = harness();
		await publishDraft(h.input);
		expect(h.calls).toEqual([
			"flush",
			"load",
			"owns:1",
			"publish",
			"owns:2",
			"markPublished",
			"owns:3",
			/** The cover uploads after the link is written and before navigation; see the `the set-aside cover` block for why. */
			"cover",
			"navigate",
		]);
	});

	/** The snapshot is read once. Four separate reads could mix edits from different moments. */
	it("reads the publish source only once", async () => {
		const h = harness();
		await publishDraft(h.input);
		expect(h.calls.filter((call) => call === "load")).toHaveLength(1);
	});
});

describe("flush failure", () => {
	/** Better not to upload than to upload without the unsaved edits. */
	it("nothing goes to the server", async () => {
		const h = harness({ flush: async () => false });
		expect((await publishDraft(h.input)).status).toBe("unsaved");
		expect(h.publish).not.toHaveBeenCalled();
		expect(h.calls).toEqual(["flush"]);
	});
});

describe("validation", () => {
	/** On validation failure nothing goes over the network; the user sees the place to fix. */
	it("doesn't publish without a title", async () => {
		const h = harness({
			source: async () => {
				const value = source();
				return { ...value, draft: { ...value.draft, title: "  " } };
			},
		});
		const outcome = await publishDraft(h.input);
		expect(outcome.status).toBe("invalid");
		if (outcome.status === "invalid")
			expect(outcome.issues.some((issue) => issue.field === "title")).toBe(
				true,
			);
		expect(h.publish).not.toHaveBeenCalled();
	});

	/** The request goes through the assembler. This value confirms the screen does not hand-build requests. */
	it("the request sent is the assembler's result", async () => {
		const h = harness();
		await publishDraft(h.input);
		const request = h.publish.mock.calls[0]?.[0] as StoryPublishRequest;
		expect(request.originDraftId).toBe(DRAFT_ID);
		expect(request.metadata.title).toBe("Title");
		expect(request.play.scenario).toBe("Body");
		/** The three fields v2 sends empty. The contract stays as it is, and this app does not fill them. */
		expect(request.play.playGuide).toBe("");
		expect(request.play.persona).toBeNull();
		expect(request.play.characters).toEqual([]);
	});
});

describe("ownership", () => {
	/**
	 * The check right before the server write matters most. The request leaves with this device's
	 * session cookie, so after an account switch this manuscript would become another account's work.
	 */
	it("losing it before the server write doesn't publish", async () => {
		const h = harness();
		h.loseOwnershipAfter(0);
		expect((await publishDraft(h.input)).status).toBe("stale");
		expect(h.publish).not.toHaveBeenCalled();
		expect(h.markPublished).not.toHaveBeenCalled();
	});

	/** The server write has already happened. This check prevents writing to another member's draft. */
	it("losing it after server success doesn't write the draft", async () => {
		const h = harness();
		h.loseOwnershipAfter(1);
		expect((await publishDraft(h.input)).status).toBe("stale");
		expect(h.publish).toHaveBeenCalledTimes(1);
		expect(h.markPublished).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
	});

	/** Does not open the previous account's work address for the account now signed in. */
	it("losing it after writing the draft doesn't navigate", async () => {
		const h = harness();
		h.loseOwnershipAfter(2);
		expect((await publishDraft(h.input)).status).toBe("stale");
		expect(h.markPublished).toHaveBeenCalledTimes(1);
		expect(h.navigate).not.toHaveBeenCalled();
	});
});

describe("failure", () => {
	it("failing to open storage sends nothing to the server", async () => {
		const h = harness({ ensureStore: async () => null });
		const outcome = await publishDraft(h.input);
		expect(outcome).toEqual({ status: "failed", reason: "storage" });
		expect(h.publish).not.toHaveBeenCalled();
	});

	/** A deletion from another device arrived mid-edit; nothing is left to send. */
	it("if the draft disappeared nothing goes to the server", async () => {
		const h = harness({ source: async () => null });
		expect((await publishDraft(h.input)).status).toBe("failed");
		expect(h.publish).not.toHaveBeenCalled();
	});

	it("if the server refuses the draft isn't written", async () => {
		const h = harness({
			publish: async () => {
				throw new Error("nope");
			},
		});
		const outcome = await publishDraft(h.input);
		expect(outcome).toEqual({ status: "failed", reason: "unknown" });
		expect(h.markPublished).not.toHaveBeenCalled();
		expect(h.navigate).not.toHaveBeenCalled();
	});

	it("server refusals split by reason", async () => {
		/**
		 * Rejections that pressing again cannot fix each get their own reason. Folded into the generic
		 * one, the screen would offer retry while every press gets the same rejection.
		 */
		const cases = [
			[STORY_PUBLISH_ERROR_CODE.sceneImageInvalid, "scene_image_invalid"],
			[STORY_PUBLISH_ERROR_CODE.runtimeInvalid, "runtime_invalid"],
			[STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid, "runtime_asset_invalid"],
			[CAPABILITY_ERROR_CODE.restricted, "restricted"],
			["account_restricted", "restricted"],
			["something_else", "unknown"],
		] as const;
		for (const [code, reason] of cases) {
			const h = harness({
				publish: async () => {
					throw new RowCatApiError({ status: 403, code, message: "rejection" });
				},
			});
			expect(await publishDraft(h.input)).toEqual({ status: "failed", reason });
			expect(h.markPublished).not.toHaveBeenCalled();
		}
	});

	/**
	 * Local write failed; the work is already on the server. Navigating here would lie: the draft
	 * stays unpublished, so the next publish looks like a first one.
	 */
	it("if the draft can't be written it doesn't navigate", async () => {
		const h = harness({
			markPublished: async () => {
				throw new Error("disk");
			},
		});
		expect(await publishDraft(h.input)).toEqual({
			status: "failed",
			reason: "storage",
		});
		expect(h.navigate).not.toHaveBeenCalled();
	});

	/**
	 * Navigation failure is not a publish failure. Folding it into `failed` would offer retry, though
	 * the user lost only the navigation.
	 */
	it("publishing succeeds even if navigation fails", async () => {
		const h = harness({
			navigate: async () => {
				throw new Error("router");
			},
		});
		expect(await publishDraft(h.input)).toEqual({
			status: "published",
			storyId: "story-1",
			created: true,
			navigated: false,
			coverUploaded: true,
		});
	});
});

describe("idempotency", () => {
	/**
	 * Does not judge whether this is the first publish. The server is idempotent per (member, draft),
	 * so a retry is the same single request. Branching on it would judge wrong after a lost response,
	 * and that is how duplicate works get created.
	 */
	it("republishing goes through the same path", async () => {
		const h = harness({
			publish: async () => ({ created: false, story: { id: "story-1" } }),
		});
		expect(await publishDraft(h.input)).toEqual({
			status: "published",
			storyId: "story-1",
			created: false,
			navigated: true,
			coverUploaded: true,
		});
		expect(h.calls).toEqual([
			"flush",
			"load",
			"owns:1",
			"publish",
			"owns:2",
			"markPublished",
			"owns:3",
			/** The cover uploads after the link is written and before navigation; see the `the set-aside cover` block for why. */
			"cover",
			"navigate",
		]);
	});

	/** The draft id does not change: publishing does not consume the draft. */
	it("the draft id doesn't become the story id", async () => {
		const h = harness();
		await publishDraft(h.input);
		expect(h.markPublished).toHaveBeenCalledWith(DRAFT_ID, "story-1");
	});
});

/**
 * The staged cover. It is the last publish step, and its failure is not a publish failure.
 *
 * The order is the rule, and the direction of failure is why: uploading before the link could leave
 * a cover with no link, and publishing again would upload the same cover a second time. With the
 * order here, the worst case is "work and link exist, cover missing", which the creator fixes under
 * `Manage cover`.
 */
describe("the set-aside cover", () => {
	it("uploads it after writing the link to the draft, before navigating", async () => {
		const h = harness();
		await publishDraft(h.input);
		const marked = h.calls.indexOf("markPublished");
		const cover = h.calls.indexOf("cover");
		const navigated = h.calls.indexOf("navigate");
		expect(marked).toBeGreaterThan(-1);
		expect(cover).toBeGreaterThan(marked);
		expect(navigated).toBeGreaterThan(cover);
	});

	/**
	 * The work already exists on the server. Folding a cover failure into `failed` would offer retry,
	 * and the user lost one cover but would read it as a lost publish.
	 */
	it("publishing succeeds even if it can't upload", async () => {
		const h = harness({ uploadStagedCover: async () => false });
		const outcome = await publishDraft(h.input);
		expect(outcome.status).toBe("published");
		if (outcome.status !== "published") return;
		expect(outcome.coverUploaded).toBe(false);
		expect(outcome.navigated).toBe(true);
	});

	/** Throwing changes nothing: it must not fall through the outer `catch` into `failed`. */
	it("publishing succeeds even if it throws", async () => {
		const h = harness({
			uploadStagedCover: async () => {
				throw new Error("network");
			},
		});
		const outcome = await publishDraft(h.input);
		expect(outcome.status).toBe("published");
		if (outcome.status !== "published") return;
		expect(outcome.coverUploaded).toBe(false);
	});

	/** With nothing to upload it is true: a publish without a cover must not look like a failure. */
	it("true when there's nothing to upload", async () => {
		const outcome = await publishDraft(harness().input);
		expect(outcome.status).toBe("published");
		if (outcome.status !== "published") return;
		expect(outcome.coverUploaded).toBe(true);
	});
});
