import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of the creation slice's boundaries: what types cannot catch.
 *
 * Every rule below is the kind that compiles when broken and only shows up on a device. Here the
 * symptom is usually another account's manuscript being published or the user's writing vanishing,
 * and both look like ordinary diffs in review.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, files);
		else if (/\.tsx?$/.test(entry.name)) files.push(full);
	}
	return files;
}

/** Scan after stripping comments: this repository's comments name the forbidden terms while explaining the boundary. */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("create-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const create = product.filter((file) =>
	file.path.startsWith("features/create/"),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("the files to check actually exist", () => {
	/** If the filter above selects nothing, the checks below pass silently. */
	it("the creation folder has files", () => {
		expect(create.length).toBeGreaterThan(10);
	});

	it("the routes and screens are in place", () => {
		for (const path of [
			"app/create/index.tsx",
			"app/create/[draftId].tsx",
			"features/create/create-screen.tsx",
			"features/create/draft-editor-screen.tsx",
			"features/create/publish-draft.ts",
			"features/create/use-draft-autosave.ts",
		])
			expect(() => fileAt(path)).not.toThrow();
	});
});

describe("a route is just a route", () => {
	/**
	 * Putting queries, SQLite or publish order in `src/app/` makes that file both route and
	 * implementation, leaving no place to reuse or test the screen.
	 */
	it("route files only delegate to screens", () => {
		for (const path of ["app/create/index.tsx", "app/create/[draftId].tsx"]) {
			const text = fileAt(path);
			expect(text, path).not.toMatch(/@tanstack\/react-query/);
			expect(text, path).not.toMatch(/@rowcat\/query/);
			expect(text, path).not.toMatch(/useAuthoringScope|useLocalDrafts/);
			expect(text, path).not.toMatch(/\bcreateDraft\b|\bpublishDraft\b/);
		}
	});

	/**
	 * The address is the source of truth for draft identity. A pure function parses it
	 * (`readDraftIdParam`) and the route does not slice it itself: this app's tests do not render, so
	 * that rule would become unverifiable.
	 */
	it("draft id parsing goes through a pure function", () => {
		expect(fileAt("app/create/[draftId].tsx")).toContain("readDraftIdParam");
	});
});

describe("local-first data doesn't go into the query cache", () => {
	/**
	 * Two sources of truth inevitably diverge, and if the editor draws the wrong one the user reads it
	 * as their writing vanishing.
	 */
	it("doesn't create query keys holding drafts", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(/queryKey:\s*\[/);
			expect(file.text, file.path).not.toMatch(/\bqueryOptions\s*\(/);
			expect(file.text, file.path).not.toMatch(/setQueryData/);
		}
	});

	/** Fetch and invalidation policy for server resources (works, analytics) belongs to the shared package. */
	it("server cells use the shared query policy as is", () => {
		const works = fileAt("features/create/published-work-panel.tsx");
		expect(works).toContain("creatorWorksInfiniteQueryOptions");
		expect(works).toContain("storyLifecycleMutationOptions");
		const analytics = fileAt("features/create/creator-analytics-panel.tsx");
		expect(analytics).toContain("creatorAnalyticsInfiniteQueryOptions");
		expect(analytics).toContain("creatorAnalyticsSummary");
	});

	/**
	 * The `Comments` tab is the same resource under the same rules as the web. A second fetch policy or
	 * status ordering would one day draw failure as an empty list in only one app.
	 */
	it("the comments cell uses the shared query and decisions as is", () => {
		const panel = fileAt("features/create/creator-comments-panel.tsx");
		expect(panel).toContain("creatorCommentsInfiniteQueryOptions");
		expect(panel).toContain("creatorCommentInboxItems");
		expect(panel).toContain("useReportAction");
		const state = fileAt("features/create/creator-comments-state.ts");
		expect(state).toContain("creatorCommentsPanelView");
		expect(state).toContain("creatorCommentDestination");
		expect(state).toContain("creatorCommentUnreachableReason");
		/** The app does not rewrite the state ordering; one domain function decides. */
		expect(state).not.toMatch(/state:\s*"(offline|reauth|loading|empty)"/);
	});

	/**
	 * The inbox is not a new messaging system: read/reply/assign/delete vocabulary would make two
	 * mailboxes manage the same fact, and open the first path for a creator to delete others'
	 * comments.
	 */
	it("the comments cell has no read state, reply or delete", () => {
		const panel = fileAt("features/create/creator-comments-panel.tsx");
		expect(panel).not.toMatch(/\bmarkRead|unread|readAt\b/i);
		expect(panel).not.toMatch(/deleteComment|replyTo|createReply|assign/);
		expect(panel).not.toMatch(/setQueryData|invalidateQueries/);
	});

	/**
	 * Totals are not built from accumulated rows: that value grows with every `Show more` press and the
	 * user reads it as views or works having increased.
	 */
	it("doesn't count totals from accumulated rows", () => {
		for (const path of [
			"features/create/published-work-panel.tsx",
			"features/create/creator-analytics-panel.tsx",
		]) {
			const text = fileAt(path);
			expect(text, path).not.toMatch(/rows\.length\s*\.toLocaleString/);
			expect(text, path).not.toMatch(/works\.length\s*\.toLocaleString/);
			expect(text, path).not.toMatch(/reduce\(/);
		}
	});
});

describe("doesn't lay server resources onto the device", () => {
	/**
	 * The server is the source of truth for publications and analytics. No copy goes in SQLite,
	 * SecureStore or AsyncStorage, or it would survive an account switch on the device.
	 */
	it("the creation folder doesn't open device storage directly", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(/expo-sqlite/);
			expect(file.text, file.path).not.toMatch(/expo-secure-store/);
			expect(file.text, file.path).not.toMatch(/AsyncStorage/);
			expect(file.text, file.path).not.toMatch(
				/\bexecuteSql\b|\bdb\.transaction\b/,
			);
		}
	});
});

describe("screens don't call sync", () => {
	/**
	 * Store writes already emit a signal that wakes automatic sync. A screen pushing directly would
	 * create a second execution path beside the coordinator, without single-run, backoff or account
	 * isolation.
	 */
	it("the creation folder has no sync calls", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(/\bsyncNow\b/);
			expect(file.text, file.path).not.toMatch(/\brequestSync\b/);
			expect(file.text, file.path).not.toMatch(/client\.sync\./);
			expect(file.text, file.path).not.toMatch(/@rowcat\/sync/);
		}
	});
});

describe("publishing goes through the shared rules", () => {
	/**
	 * The request is not built by hand: normalization (whitespace, duplicates, default opening, scene
	 * images) and validation belong to `@rowcat/authoring` and the web calls the same function.
	 * Per-app copies would yield works that run one way in tests and another once published.
	 */
	it("the assembler builds the publish request", () => {
		expect(fileAt("features/create/publish-draft.ts")).toContain(
			"buildStoryPublication",
		);
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(/metadata:\s*\{/);
			expect(file.text, file.path).not.toMatch(/play:\s*\{/);
		}
	});

	/** The snapshot is one consistent read; four separate reads can mix in edits. */
	it("publishing doesn't read the draft and children separately", () => {
		const text = fileAt("features/create/publish-draft.ts");
		expect(text).toContain("loadPublicationSource");
		expect(text).not.toMatch(
			/\blistLore\b|\blistStartScenes\b|\blistSceneImages\b/,
		);
	});

	/**
	 * Ownership is re-asked before each irreversible step. With fewer than three, an account switch
	 * could create someone else's work or write a link into someone else's draft.
	 */
	it("ownership is checked three times", () => {
		const text = fileAt("features/create/publish-draft.ts");
		expect(text.match(/stillOwnsStore\(store\)/g)).toHaveLength(3);
	});

	/** Cache policy for server writes belongs to the shared mutation; callbacks are not overridden. */
	it("publishing goes through the shared mutation", () => {
		const text = fileAt("features/create/publish-section.tsx");
		expect(text).toContain("publishStoryMutationOptions");
		expect(text).not.toMatch(/client\.stories\.publish/);
	});

	/**
	 * First publish and update publish are not distinguished: the server is idempotent so one request
	 * serves both, and a screen-side decision would be wrong on a retry that lost its response.
	 */
	it("there's no state machine deciding whether it's the first time", () => {
		for (const file of create)
			expect(file.text, file.path).not.toMatch(
				/isFirstPublish|hasPublishedBefore|republish/i,
			);
	});
});

describe("screens don't rewrite lifecycle rules", () => {
	/**
	 * `@rowcat/domain` answers which operations are available. Branching on visibility in the screen
	 * leaves only this app on old rules when the transition table changes, with the silent symptom of
	 * a button that presses and gets a 409.
	 */
	it("the operation list comes from the domain predicate", () => {
		const text = fileAt("features/create/published-work-panel.tsx");
		expect(text).toContain("storyLifecycleActions");
		expect(text).not.toMatch(
			/visibility\s*===\s*["'](public|private|archived)["']/,
		);
	});

	/** Operator hiding is another actor's axis; lifecycle operations do not touch it. */
	it("screens don't change operator hiding", () => {
		for (const file of create)
			expect(file.text, file.path).not.toMatch(/hidden:\s*(true|false)/);
	});

	/** Authored content belongs to the source draft and is not edited on the published row. */
	it("published rows have no authoring edits", () => {
		const text = fileAt("features/create/published-work-panel.tsx");
		for (const forbidden of ["Textarea", "updateDraft", "patchDraft"])
			expect(text, forbidden).not.toContain(forbidden);
	});
});

describe("the cover is the published version's resource", () => {
	/**
	 * Opens without a source draft: the cover belongs to the publication, so tying it to
	 * `editableDraftId` would lock out creators who published from another device or deleted the
	 * draft. The web made the same call, which is why the action sits on the `Published` row.
	 */
	it("cover operations don't hang on the draft's existence", () => {
		const panel = fileAt("features/create/published-work-panel.tsx");
		expect(panel).toContain("<CoverManageDialog");
		/** That button sits outside the `editableDraftId` branch. */
		expect(panel).toMatch(
			/label=\{PUBLISHED_COVER\}[\s\S]{0,400}editableDraftId \? \(/,
		);
	});

	/**
	 * Drafts have no cover. Pre-publication cover storage is absent from this app (writing a temporary
	 * `file://` into a synced draft would create a broken reference, not the feature), and the
	 * vocabulary locks that absence.
	 */
	it("the draft editor doesn't touch the cover", () => {
		for (const path of [
			"features/create/draft-editor-screen.tsx",
			"features/create/basics-section.tsx",
			"features/create/publish-draft.ts",
		])
			for (const forbidden of [
				/setStoryCoverMutationOptions/,
				/removeStoryCoverMutationOptions/,
				/\bcoverUrl\b/,
			])
				expect(fileAt(path), `${path} — ${forbidden}`).not.toMatch(forbidden);
	});

	/** Limits and formats come from the contract; hand-typed numbers would split hint from rejection. */
	it("cover limits aren't written by hand", () => {
		const text = fileAt("features/create/cover-file.ts");
		expect(text).toContain("STORY_COVER_LIMITS");
		expect(text).toContain("STORY_COVER_INPUT_MIME");
		expect(text).toContain("coverByteLimitFor");
		expect(text).not.toMatch(/5\s*\*\s*1024\s*\*\s*1024/);
	});

	/**
	 * A picked image is not yet the work's cover: planting the picker's `file://` URI in the query
	 * cache or work object would make other screens read it as the cover.
	 */
	it("temporary addresses don't leak into the cache", () => {
		const dialog = fileAt("features/create/cover-manage-dialog.tsx");
		expect(dialog).not.toContain("setQueryData");
		expect(dialog).not.toContain("invalidateQueries");
		expect(dialog).toContain("setStoryCoverMutationOptions");
		expect(dialog).toContain("removeStoryCoverMutationOptions");
	});
});

describe("scene images carry only references", () => {
	/**
	 * No bytes, address or local file URI enter the draft: a written `file://` would ride sync and
	 * become a string pointing at nothing on other devices.
	 */
	it("the draft holds no address or file URI", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(/assetId:\s*[^,\n}]*uri/);
			expect(file.text, file.path).not.toMatch(/file:\/\//);
			expect(file.text, file.path).not.toMatch(/base64/i);
		}
	});

	/** One SDK rule builds addresses; a copy would go stale alone when paths change. */
	it("media addresses aren't assembled by hand", () => {
		expect(fileAt("features/create/scene-image-section.tsx")).toContain(
			"client.media.url",
		);
		for (const file of create)
			expect(file.text, file.path).not.toMatch(/\/media\/\$\{/);
	});

	/**
	 * Removing from the draft does not delete the server image: an already-published playback snapshot
	 * may point at that media, and a room built from it may be open on someone else's device now.
	 */
	it("doesn't delete server media", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(
				/deleteMedia|deleteSceneImageAsset/,
			);
			expect(file.text, file.path).not.toMatch(/client\.media\.delete/);
		}
	});

	/** Limits and formats come from the contract; hand-typed numbers would split hint from rejection. */
	it("limits aren't written by hand", () => {
		const text = fileAt("features/create/scene-image-file.ts");
		expect(text).toContain("SCENE_IMAGE_LIMITS");
		expect(text).toContain("MEDIA_INPUT_MIME");
		expect(text).not.toMatch(/3\s*\*\s*1024\s*\*\s*1024/);
	});

	/** Duplicate matching goes through the shared rule; no second lowercase comparison. */
	it("trigger matching goes through the shared function", () => {
		const text = fileAt("features/create/scene-image-section.tsx");
		expect(text).toContain("sceneTriggerKey");
		expect(text).not.toMatch(/trigger\.toLowerCase\(\)/);
	});
});

describe("doesn't draw what doesn't exist yet", () => {
	/**
	 * A button is a promise, and drawing one while no screen can finish the operation draws a promise
	 * we cannot keep. A disabled button is the same: it reads as "coming soon".
	 *
	 * ```text
	 * draft duplication · co-editing  decisions that change the storage model and sync rules
	 * ```
	 *
	 * `Story test` left this list because that screen now exists (`features/playtest/`), and the group
	 * below locks its presence; locking only absence would let a change deleting that entrance pass
	 * green.
	 *
	 * `Keeping covers before publishing` left for the same reason. It was once the first line here and the basis was
	 * accurate (a separate flow where the device holds bytes and uploads after publishing). Since that
	 * flow exists (`draft-cover-field.tsx`, `lib/local-data/draft-cover-store.ts`), presence and order
	 * are locked instead (see "cover before publishing" below).
	 */
	it("doesn't draw duplicate or coming-soon", () => {
		for (const file of create)
			for (const absent of ["Duplicate", "Coming soon", "Available soon"])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});

	/**
	 * Pre-publication cover is actually wired. Where it lies is what is locked: the value is not
	 * synced (no column for it in the schema), so it must not sit on the authoring store. That mistake
	 * shows no symptom on screen; it surfaces only as the cover existing when the draft opens on
	 * another device, with several MB riding the envelope.
	 */
	it("the cover cell uses its own store, not the draft store", () => {
		const field = fileAt("features/create/draft-cover-field.tsx");
		expect(field).toContain("useDraftCoverScope");
		expect(field).toContain("store.stage(draft.id, picked)");
		/** Not on the authoring store: every value on that port is a synced record. */
		expect(field).not.toContain("useAuthoringScope");
		expect(field).not.toContain("updateDraft");
	});

	/**
	 * Published drafts do not draw this field: the server owns the cover then and the place to edit is
	 * the `Published` cover dialog. With both open, the screen cannot say which wins, and the state shows
	 * up as the cover silently reverting.
	 */
	it("the cell doesn't stand on a published draft", () => {
		expect(fileAt("features/create/draft-cover-field.tsx")).toContain(
			"if (draft.publishedStoryId !== null) return null;",
		);
	});

	/**
	 * The editor has one door out to the work test. The order (flush pending save, store, assemble,
	 * ownership, navigate) belongs to `features/playtest/`; if the editor rewrote those steps, one of
	 * two copies would skip the flush and the screen would test a version missing the sentence just
	 * typed.
	 */
	it("the editor has the test entry through one hook only", () => {
		const editor = fileAt("features/create/draft-editor-screen.tsx");
		expect(editor).toContain("useStartPlaytest");
		expect(editor).toContain("playtest.trigger");
		/** The creation folder does not rewrite that order. */
		for (const file of create) {
			expect(file.text, file.path).not.toContain("buildPlaytestSnapshot");
			expect(file.text, file.path).not.toContain("startDraftPlaytest");
		}
	});

	/**
	 * Not next to the publish section: the action sends nothing to the server, and beside the publish
	 * button that fact blurs and raises the question "must I press test before publishing"; this
	 * product has no such step.
	 */
	it("the test entry isn't in the publish section", () => {
		const publish = fileAt("features/create/publish-section.tsx");
		expect(publish).not.toContain("playtest");
		expect(publish).not.toContain("Story test");
	});

	/** Do not revive the legacy authoring model; that rolls the storage model back to v1. */
	it("no vocabulary from the v1 authoring fields", () => {
		for (const file of create)
			for (const absent of [
				"scenario:",
				"playGuide",
				"suggestedPersona",
				"DraftCharacter",
				"characters:",
				"bodyMode",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("confirmations are declarative dialogs", () => {
	/**
	 * `Alert.alert` is imperative and freezes its sentence when shown. The confirmation copy here
	 * varies with publication state and title, so a sync changing values in between makes the frozen
	 * sentence wrong.
	 */
	it("doesn't use system alerts", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(/\bAlert\.alert\b/);
			expect(file.text, file.path).not.toMatch(
				/from\s+["']react-native["'][^\n]*\bAlert\b/,
			);
		}
	});

	/** Irreversible confirmation is an `AlertDialog`. */
	it("delete and public publish have confirm dialogs", () => {
		expect(fileAt("features/create/draft-list-panel.tsx")).toContain(
			"<AlertDialog",
		);
		expect(fileAt("features/create/publish-section.tsx")).toContain(
			"<AlertDialog",
		);
	});
});

describe("the save model is autosave alone", () => {
	/** No second hand-called write path: it would have no debounce, ownership check or rollback of failed changes. */
	it("there is no save button", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toMatch(/label=\{?"Save"/);
			expect(file.text, file.path).not.toMatch(/onSave\b/);
		}
	});

	/** Queue rules belong to the shared package; the web calls the same function. */
	it("the app doesn't rebuild the queue", () => {
		const text = fileAt("features/create/use-draft-autosave.ts");
		expect(text).toContain("createAutosaveQueue");
		expect(text).toContain("commitQueue");
	});

	/** Publishing reads the snapshot only after the flush. */
	it("publishing waits for the flush", () => {
		const text = fileAt("features/create/publish-draft.ts");
		expect(text).toContain("await flushAutosave()");
	});
});

describe("full-screen editing isn't a second draft state", () => {
	/**
	 * One overlay still owns the value (`draft-overlay.ts`). Both fields taking the same
	 * `value`/`onChange` is the whole of this slice; if that pairing breaks, the sentence just typed
	 * vanishes on closing, since two "screen-ahead values" would accept the autosave rollback at
	 * different times.
	 *
	 * The only state this file may hold is dialog open and caret planting, never the body text.
	 */
	it("no local state holding the body", () => {
		const prompt = fileAt("features/create/prompt-section.tsx");
		expect(prompt).not.toMatch(/useState<string>/);
		expect(prompt).not.toMatch(/useState\(value\)/);
		/** One save path: this file knows neither the store nor autosave. */
		expect(prompt).not.toMatch(/patchDraft|updateDraft|flush\(/);
	});

	/**
	 * No confirm step: `Done` only closes the dialog and autosave keeps running while it is open.
	 * Writing `Save` would imply "lose it unless closed", a promise this editor never made.
	 */
	it("doesn't create save or cancel operations", () => {
		const copy = fileAt("features/create/editor-copy.ts");
		expect(copy).toMatch(/close: "Done"/);
		const prompt = fileAt("features/create/prompt-section.tsx");
		expect(prompt).not.toMatch(/onSave|handleSave/);
	});

	/**
	 * The caret-handoff rule is a pure function. This app's tests do not render, so putting the
	 * clamping in a component leaves only "try it by hand", and that failure reproduces only when the
	 * value shortens off-screen.
	 */
	it("caret folding goes through a pure function", () => {
		const prompt = fileAt("features/create/prompt-section.tsx");
		expect(prompt).toContain("clampTextSelection");
		expect(prompt).not.toMatch(/Math\.min\(|Math\.max\(/);
	});
});

/** The four conversation-material sections that go through the runtime decision; this list is what the checks below cover. */
const MATERIAL_SECTIONS = [
	["Prompt", "features/create/prompt-section.tsx"],
	["Lore", "features/create/lore-section.tsx"],
	["Opening scenes", "features/create/start-scene-section.tsx"],
	["Scene images", "features/create/scene-image-section.tsx"],
] as const;

/**
 * Four sections lock on a runtime-enabled draft, and all go through the same wiring.
 *
 * This app has no runtime authoring screen but the record arrives by sync. Editing the prompt,
 * lore, opening and images of a work turned on in the web here would mix newly typed text into the
 * old value with no symptom, since the field locks soon after. If each section rewrote subscription
 * and decision, one would eventually not pass `loading`, which is silent for the same reason.
 */
describe("turning the runtime on locks the conversation material", () => {
	/** One wiring site calls the pure decision and the sections call that site. */
	it("one place calls the decision", () => {
		const wiring = fileAt("features/create/runtime-lock.tsx");
		expect(wiring).toContain("resolveConversationAuthoringMode");
		for (const [, path] of MATERIAL_SECTIONS)
			expect(fileAt(path)).not.toContain("resolveConversationAuthoringMode");
	});

	it.each(
		MATERIAL_SECTIONS,
	)("the %s section goes through that place", (_name, path) => {
		const text = fileAt(path);
		expect(text).toContain("useConversationAuthoringMode");
		/** Sections open no subscription of their own: that site must carry `loading` too. */
		expect(text).not.toContain("useDraftRuntimeProject");
		/** The screen does not rewrite the decision; reading `enabled` happens inside the pure function. */
		expect(text).not.toMatch(/isRuntimeEnabled|\.enabled\b/);
	});

	/**
	 * A locked section neither folds nor offers `Add`. Given a summary it would stand closed and only
	 * those who open it read the lock notice, yet creators need to know why they cannot edit, not how
	 * many items there are. The promise lives in the wiring: the component drawing the locked branch
	 * passes neither `summary` nor `action`.
	 */
	it("the locked branch has neither summary nor operations", () => {
		const wiring = fileAt("features/create/runtime-lock.tsx");
		expect(wiring).toContain("<EditorSection");
		expect(wiring).not.toContain("summary=");
		expect(wiring).not.toContain("action=");
	});

	/** The three list sections take that branch first; after it, summary and action would draw together. */
	it.each(
		MATERIAL_SECTIONS.filter(([name]) => name !== "Prompt"),
	)("the %s section branches before its operations", (_name, path) => {
		const text = fileAt(path);
		const guard = text.indexOf('if (mode !== "editable")');
		expect(guard).toBeGreaterThan(-1);
		expect(text.indexOf("summary=")).toBeGreaterThan(guard);
		expect(text.indexOf("action=")).toBeGreaterThan(guard);
	});

	/**
	 * A locked section holds no value: a second state would give the value two owners, and a path
	 * where turning it on empties the value leaves nothing to return when turned off.
	 */
	it.each(
		MATERIAL_SECTIONS,
	)("the %s section doesn't write the draft", (_name, path) => {
		expect(fileAt(path)).not.toMatch(/patchDraft|updateDraft/);
	});

	/**
	 * Lock copy says the value is kept. Without that sentence creators read their accumulated
	 * manuscript as deleted, a misunderstanding only turning the runtime off resolves.
	 */
	it.each([
		"PROMPT_RUNTIME_LOCK",
		"LORE_RUNTIME_LOCK",
		"START_SCENE_RUNTIME_LOCK",
		"SCENE_IMAGE_RUNTIME_LOCK",
	])("%s states that it keeps and restores", (name) => {
		const copy = fileAt("features/create/editor-copy.ts");
		const at = copy.indexOf(`${name} = {`);
		expect(at).toBeGreaterThan(-1);
		const lock = copy.slice(at, copy.indexOf("} as const;", at));
		expect(lock).toContain("kept");
		expect(lock).toMatch(/once runtime is off/);
	});
});

/**
 * Where the pre-publication cover lies, and where it does not.
 *
 * This slice brought one native dependency (`expo-file-system`, needs a rebuild). If more places
 * know that module, path rules spread into feature folders and one starts storing absolute paths;
 * that row points at a missing file after reinstall while the file is fine and the screen shows no
 * error.
 */
describe("cover before publishing", () => {
	/** One lib is the file boundary; neither the store nor screens hold that library directly. */
	it("only one place in lib imports expo-file-system", () => {
		const importers = product
			.filter((file) => file.text.includes("expo-file-system"))
			.map((file) => file.path);
		expect(importers).toEqual(["lib/draft-cover-files.ts"]);
	});

	/**
	 * The store receives even that file boundary by injection: it enters the test graph through scope
	 * assembly, whose config has no polyfills (`vitest.config.ts`), so importing directly would kill
	 * dozens of SQLite adapter tests while parsing the native module.
	 */
	it("the store receives the file boundary by injection", () => {
		const store = fileAt("lib/local-data/draft-cover-store.ts");
		expect(store).toContain("files: DraftCoverFiles");
		expect(store).not.toContain("draft-cover-files.ts");
	});

	/**
	 * Screens do not assemble addresses: only a name is stored and the address is built on each read,
	 * and if assembly moved to a feature folder one would eventually freeze an absolute path.
	 */
	it("screens don't assemble addresses", () => {
		for (const file of create) {
			expect(file.text, file.path).not.toContain("draftCoverUri");
			expect(file.text, file.path).not.toContain("Paths.document");
		}
	});

	/**
	 * The last step of publishing, and its failure is not a publish failure. Order (after linking on
	 * the draft, before navigation) and failure direction are run by value in `publish-draft.test.ts`;
	 * this only checks the wiring is plugged in (unplugged, the picked cover never uploads with no
	 * symptom).
	 */
	it("publishing uploads the cover that was set aside", () => {
		const section = fileAt("features/create/publish-section.tsx");
		expect(section).toContain("uploadStagedCover:");
		expect(section).toContain("client.stories.setCover(");
		/** Delete the device copy only on success; on failure it can be re-uploaded from `Manage cover`. */
		expect(section).toContain("await store.clear(draftId);");
	});
});

/**
 * The window picker outlives the placeholder.
 *
 * Two paths enter the `Analytics` loading branch with different character: first opening the tab, and
 * having just changed the window. Covering the screen with one spinner in the latter hides the
 * control just pressed, so the chosen window is invisible and cannot be changed again.
 *
 * This app's tests do not render React, so they look at the shape of the source. The reverting
 * change (folding that branch back to a single spinner) is one line with no error or type failure.
 */
describe("analytics' waiting screen", () => {
	const panel =
		all.find((file) => file.path.endsWith("create/creator-analytics-panel.tsx"))
			?.text ?? "";

	it("the loading branch draws the period picker too", () => {
		expect(panel).not.toBe("");
		const branch = panel.slice(
			panel.indexOf('if (view.state === "loading")'),
			panel.indexOf('if (view.state === "offline"'),
		);
		expect(branch).not.toBe("");
		expect(branch).toContain("windowMenu");
		expect(branch).toContain("<Spinner />");
	});

	/** Keeping the previous window's numbers would stand old values under the new window's label, worse than a placeholder. */
	it("that branch doesn't draw metrics", () => {
		const branch = panel.slice(
			panel.indexOf('if (view.state === "loading")'),
			panel.indexOf('if (view.state === "offline"'),
		);
		expect(branch).not.toContain("summary");
		expect(branch).not.toContain("AnimatedCount");
	});
});
