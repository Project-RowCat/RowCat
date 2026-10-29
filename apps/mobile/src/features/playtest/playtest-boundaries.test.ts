import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static boundary scan for the playtest slice, covering what the type system cannot catch.
 *
 * Failures here are silent. A room created and hidden from the list looks fine on screen, but the
 * record still goes out with the next push, so a test conversation reaches the server and other
 * devices with no error.
 *
 * The behavioural counterpart is `playtest-persistence.test.ts`, which runs against real SQLite.
 * Both are needed: this scan blocks paths not yet called, and the persistence test shows what the
 * current code actually writes.
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

/** Comments are stripped before scanning, because this repo's comments name the forbidden words while explaining the boundary. */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = sources(SRC)
	.map((path) => ({
		path: path.slice(SRC.length),
		text: stripComments(readFileSync(path, "utf8")),
	}))
	.filter((file) => !file.path.endsWith("playtest-boundaries.test.ts"));

const product = all.filter(
	(file) => !file.path.startsWith("test/") && !/\.test\.tsx?$/.test(file.path),
);

const playtest = product.filter((file) =>
	file.path.startsWith("features/playtest/"),
);

/**
 * Only the editor entry points read the store (flushing pending saves and reading the draft once).
 * The rest of the playtest code gets no such exception.
 */
const conversation = playtest.filter(
	(file) =>
		!file.path.endsWith("start-draft-playtest.ts") &&
		!file.path.endsWith("use-start-playtest.tsx"),
);

const fileAt = (path: string) => {
	const found = product.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("the files to check actually exist", () => {
	/** If the filter selects nothing, the checks below pass silently. */
	it("the playback folder has files", () => {
		expect(playtest.length).toBeGreaterThan(5);
	});

	it("the routes and screens are in place", () => {
		for (const path of [
			"app/create/[draftId]/test.tsx",
			"features/playtest/playtest-screen.tsx",
			"features/playtest/playtest-session.ts",
			"features/playtest/start-draft-playtest.ts",
			"features/playtest/playtest-conversation.ts",
			"features/playtest/use-playtest.ts",
			"features/playtest/use-playtest-bootstrap.ts",
		])
			expect(() => fileAt(path)).not.toThrow();
	});

	/**
	 * The route only delegates: parsing goes through the same pure function as the editor, while
	 * queries, store access and generation order do not live here.
	 */
	it("the route only delegates to the screen", () => {
		const route = fileAt("app/create/[draftId]/test.tsx");
		expect(route).toContain("readDraftIdParam");
		expect(route).toContain("PlaytestScreen");
		expect(route).not.toMatch(/@tanstack\/react-query/);
		expect(route).not.toMatch(/useAuthoringScope|loadPublicationSource/);
	});
});

describe("doesn't create a room", () => {
	/**
	 * The P0 of this slice. Once a `ChatStore` is in hand, the fastest implementation creates a room
	 * and hides it in the screen. Such a record carries dirty flags, revisions and tombstones and goes
	 * out with the next push: hiding is the screen's job, and sync does not look at the screen.
	 */
	it("doesn't open the conversation store", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/\buseChatScope\b/);
			expect(file.text, file.path).not.toMatch(/\bChatStore\b/);
			expect(file.text, file.path).not.toMatch(/\bcreateRoom\b/);
			expect(file.text, file.path).not.toMatch(/\bdeleteRoom\b/);
			expect(file.text, file.path).not.toMatch(/\brenameRoom\b/);
			expect(file.text, file.path).not.toMatch(/\bappendMessage\b/);
			expect(file.text, file.path).not.toMatch(/\bcreateChatConversation\b/);
		}
	});

	/** There is no vocabulary for hidden or temporary rooms at all. */
	it("no vocabulary for hidden or temporary rooms", () => {
		for (const file of playtest)
			for (const absent of ["hiddenRoom", "temporaryRoom", "playtestRoom"])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("nothing lives on the device", () => {
	it("doesn't open device storage directly", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/expo-sqlite/);
			expect(file.text, file.path).not.toMatch(/expo-secure-store/);
			expect(file.text, file.path).not.toMatch(/AsyncStorage/);
		}
	});

	/**
	 * Temporary conversations do not enter the query cache either. That cache holds server state; this
	 * conversation is a local original, and caching it would keep it across account switches.
	 */
	it("doesn't create query keys holding playback state", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/queryKey:\s*\[/);
			expect(file.text, file.path).not.toMatch(/setQueryData/);
		}
	});
});

describe("doesn't enter sync", () => {
	/**
	 * No playtest-specific record type or codec. Adding one would make the protocol aware of this
	 * conversation, and sign-out cleanup, bootstrap and merge would all have to handle it.
	 */
	it("no sync vocabulary", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/@rowcat\/sync/);
			expect(file.text, file.path).not.toMatch(/\bsyncNow\b|\brequestSync\b/);
			expect(file.text, file.path).not.toMatch(/client\.sync\./);
			expect(file.text, file.path).not.toMatch(/syncCodecRegistry/);
		}
	});

	/** No `playtest.*` type is registered in the codec registry. */
	it("the codec registry didn't grow", () => {
		expect(fileAt("lib/local-sync/registry.ts")).not.toContain("playtest");
	});
});

describe("only generation and the catalogue go to the server", () => {
	/**
	 * This screen does not publish, create stories, call `/play` or record views. The absence is
	 * locked by vocabulary: if one of those operations appears, the screen is no longer a test that
	 * publishes nothing.
	 */
	it("no publish, playback or view-record vocabulary", () => {
		for (const file of playtest)
			for (const absent of [
				"publishStoryMutationOptions",
				"storyLifecycleMutationOptions",
				"buildStoryPublication",
				"markPublished",
				"recordView",
				"client.stories",
				"client.play",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("doesn't modify the draft", () => {
	/**
	 * A playtest-only start-scene selection that overwrote the draft's default would silently change
	 * the author's own opening on every test run.
	 */
	it("no authoring write operations", () => {
		for (const file of playtest)
			for (const absent of [
				"updateDraft",
				"patchDraft",
				"setDefaultStartScene",
				"createLore",
				"updateLore",
				"createStartScene",
				"updateStartScene",
				"deleteDraft",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});

	/**
	 * Only one read operation. Reading the three separately can mix autosaves in between, producing a
	 * snapshot with a new prompt but an old lore set.
	 */
	it("takes the draft through one consistent read only", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/\bgetDraft\b/);
			expect(file.text, file.path).not.toMatch(
				/\blistLore\b|\blistStartScenes\b|\blistSceneImages\b/,
			);
		}
	});
});

describe("doesn't rewrite normalization", () => {
	/**
	 * The snapshot must pass the same normalization as publication. A second mapper would make a story
	 * run differently in the test than when published, and the difference appears only after
	 * publishing.
	 */
	it("goes through the shared assembler", () => {
		expect(fileAt("features/playtest/playtest-session.ts")).toContain(
			"buildPlaytestSnapshot",
		);
		expect(fileAt("features/playtest/start-draft-playtest.ts")).toContain(
			"buildPlaytestSnapshot",
		);
	});

	/** Seeds are not built by hand. */
	it("doesn't assemble the seed by hand", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/scenario:\s*[^,\n}]/);
			expect(file.text, file.path).not.toMatch(/firstScene:\s*[^,\n}]/);
			expect(file.text, file.path).not.toMatch(/\blore:\s*\[/);
		}
	});
});

describe("there's one generation engine", () => {
	/**
	 * Ordering, failure handling, ownership and billing invalidation live in the same hook the
	 * conversation screen uses. A copy diverges in fixed directions (one side loosens the adult gate,
	 * or misses the managed billing invalidation), and no compile error results.
	 */
	it("uses the same generation hook as the conversation screen", () => {
		expect(fileAt("features/playtest/use-playtest.ts")).toContain(
			"useChatGeneration",
		);
	});

	it("doesn't create a second transport or pure turn", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/runGenerationTurn/);
			expect(file.text, file.path).not.toMatch(/createGenerationTransport/);
			expect(file.text, file.path).not.toMatch(/\bAbortController\b/);
			expect(file.text, file.path).not.toMatch(/buildChatGenerationRequest/);
		}
	});

	/**
	 * All three operations that discard a conversation go through a single statement. Replacing only
	 * the session object gives it a new identity only after React re-renders, but the confirm block of
	 * an aborted stream runs earlier in a microtask; that window is where a late response attaches.
	 */
	it("operations that discard the conversation go through rewriteHistory", () => {
		const hook = fileAt("features/playtest/use-playtest.ts");
		expect(hook).toContain("generation.rewriteHistory");
		/** No shortcut that clears state directly. */
		expect(hook).not.toMatch(/setState\(\s*\{[^}]*messages:\s*\[\]/);
	});

	/** No history cap re-declared; it must be the same window as a real conversation. */
	it("the history cap is the shared constant", () => {
		const adapter = fileAt("features/playtest/playtest-conversation.ts");
		expect(adapter).toContain("CHAT_HISTORY_LIMIT");
		for (const file of playtest)
			expect(file.text, file.path).not.toMatch(/slice\(-\d+\)/);
	});

	/**
	 * The history read goes through a ref, not render state. This placement prevents the quietest
	 * failure in this slice. The pure turn re-reads history right after appending the user's
	 * utterance; only a microtask separates the two, while React's re-render runs in a later task.
	 * Reading state would not see the just-appended utterance, so the model would reply without
	 * knowing what the user said. The bubble is still on screen, so the cause would be invisible.
	 */
	it("receives history and overrides through a synchronous read port", () => {
		/**
		 * The adapter reads state as a function (`read()`). Passing a value would capture the render in
		 * which the adapter was built, so the read right after appending the user's utterance would miss
		 * it.
		 */
		const adapter = fileAt("features/playtest/playtest-conversation.ts");
		expect(adapter).toContain("loadHistory: async () => read().messages");
		expect(adapter).toContain("loadPreference: async () => read().preference");

		/** The hook plugs a ref into that slot, not render state. */
		const hook = fileAt("features/playtest/use-playtest.ts");
		expect(hook).toContain("read: () => stateRef.current");
		expect(hook).not.toMatch(/read:\s*\(\)\s*=>\s*state\b/);
	});

	/**
	 * Ref first, then state. `setState(updater)` does not solve it either: the callback runs at the
	 * next render, so setting the ref inside it leaves the same window.
	 */
	it("every change goes through one function that freezes the ref first", () => {
		const hook = fileAt("features/playtest/use-playtest.ts");
		expect(hook).toMatch(
			/const updated = next\(stateRef\.current\);\s*\n\s*stateRef\.current = updated;\s*\n\s*setState\(updated\);/,
		);
	});
});

describe("no memory and no automatic maintenance", () => {
	/**
	 * The playtest session has no record for summaries. Running maintenance would make a paid call
	 * whose result is saved nowhere, costing money on every test run.
	 */
	it("no maintenance wiring", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/useMemoryMaintenance/);
			expect(file.text, file.path).not.toMatch(/runMemoryMaintenance/);
			expect(file.text, file.path).not.toMatch(/\bmaintain\b/);
			expect(file.text, file.path).not.toMatch(/listMemories|createMemory/);
		}
	});
});

describe("not a live subscription", () => {
	/**
	 * If the system prompt changes mid-conversation, nobody can explain what is being tested. Exactly
	 * one operation pulls in edits from another device, and it has its own name.
	 */
	it("doesn't subscribe to the draft", () => {
		for (const file of conversation) {
			expect(file.text, file.path).not.toMatch(/useLocalLive\b/);
			expect(file.text, file.path).not.toMatch(/useLocalDraft\b/);
			expect(file.text, file.path).not.toMatch(
				/useDraftLore|useDraftStartScenes/,
			);
		}
	});
});

describe("doesn't rewrite model rules", () => {
	/** The model list and availability check are a shared module; conversation settings call the same function. */
	it("the model list comes from the shared function", () => {
		expect(fileAt("features/playtest/playtest-settings-dialog.tsx")).toContain(
			"buildModelOptions",
		);
	});

	/**
	 * Priority resolution is not reproduced by the screen; it takes the value the resolver answered.
	 *
	 * Blocks writing `preference.responseLength ?? …` and similar in place. The target axis is the
	 * exception: asking which model is active needs the model to look up its reasoning capability, so
	 * it has to be resolved against the model. That question picks between two already-resolved layers
	 * and yields the same result as `EffectiveGeneration`.
	 */
	it("doesn't write precedence by hand", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(
				/preference\.responseLength\s*\?\?\s*/,
			);
			expect(file.text, file.path).not.toMatch(
				/preference\.reasoningEffort\s*\?\?\s*/,
			);
			/** Only the inherited target may appear as a fallback. */
			for (const match of file.text.matchAll(
				/preference\.target\s*\?\?\s*(\w+)/g,
			))
				expect(match[1], file.path).toBe("inheritedTarget");
		}
	});

	/**
	 * Temporary overrides are stored nowhere. A test run must not change the user's default for every
	 * conversation, and there is no room to hold a room override in the first place.
	 */
	it("no preference save operations", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/\bsetGlobal\b/);
			expect(file.text, file.path).not.toMatch(/\bsetRoom\b/);
			expect(file.text, file.path).not.toMatch(/\bclearRoom\b/);
		}
	});
});

describe("presentation rules", () => {
	/** A system alert is imperative, so once shown the copy is fixed. */
	it("doesn't use system alerts", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toMatch(/\bAlert\.alert\b/);
			expect(file.text, file.path).not.toMatch(
				/from\s+["']react-native["'][^\n]*\bAlert\b/,
			);
		}
	});

	/**
	 * Dialogs do not stack on a surface. The confirm dialog belongs to one screen, and the settings
	 * dialog closes before it opens. Two layers would make it unpredictable which one Android's back
	 * button closes (the memory panel confirms inline for the same reason).
	 */
	it("no confirm dialog inside the settings dialog", () => {
		const dialog = fileAt("features/playtest/playtest-settings-dialog.tsx");
		expect(dialog).toContain("<Dialog");
		expect(dialog).not.toContain("<AlertDialog");

		const screen = fileAt("features/playtest/playtest-screen.tsx");
		expect(screen).toContain("<AlertDialog");
		/** The settings dialog closes before the confirm opens. */
		expect(screen).toMatch(/setSettingsOpen\(false\);\s*\n\s*setPending\(/);
	});

	/** Pinned to the screen height; the bottom edge's owner (`ComposerArea`) sits in the same tree. */
	it("the composer is inside ComposerArea", () => {
		expect(fileAt("features/playtest/playtest-screen.tsx")).toMatch(
			/<ComposerArea>[\s\S]{0,400}<Composer[\s\S]{0,400}<\/ComposerArea>/,
		);
	});

	/**
	 * The list is one virtualized list. Temporary does not mean short: the creator runs long tests.
	 */
	it("doesn't stack the conversation in a ScrollView", () => {
		for (const file of playtest) {
			expect(file.text, file.path).not.toContain("<ScrollView");
			/**
			 * What is blocked is hand-rendering the conversation.
			 *
			 * `request.messages` is not the conversation: a request is a fixed snapshot (already cut to the
			 * history cap), and the inspector draws it as rows. Blocking both arrays with one pattern would
			 * make the check broader than its intent, and the next person would edit the check rather than
			 * the rule.
			 */
			expect(file.text, file.path).not.toMatch(
				/(?<!request)\.messages\.map\(|(?<![\w.])messages\.map\(/,
			);
		}
		expect(fileAt("features/playtest/playtest-screen.tsx")).toContain(
			"<MessageList",
		);
	});
});

describe("the only row operation is copy", () => {
	/**
	 * The other four require a store transaction or the identity the server knows. They are not drawn
	 * as disabled, since that would be a promise we cannot keep.
	 */
	it("no edit, delete, report or memory vocabulary", () => {
		for (const file of playtest)
			for (const absent of [
				"useMessageActions",
				"editUserMessage",
				"editAssistantMessage",
				"deleteFromMessage",
				"ReportMessageModal",
				"buildAiResponseEvidence",
				"continueGeneration",
			])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});

describe("doesn't send to screens that don't exist", () => {
	/**
	 * This check once blocked `/settings` entirely, correctly, because that screen did not exist. Now
	 * it does, and it is the only next step for a generation blocked by a missing provider connection.
	 * So what is locked changed: not "never go to settings", but "the only destination is failure
	 * recovery, and this screen does not re-derive that decision." Putting navigation everywhere would
	 * make the playtest a second entrance to settings, and encoding the decision here would diverge
	 * from the conversation screen.
	 */
	it("the only path to settings is failure recovery", () => {
		const screen = playtest.find(
			(file) => file.path === "features/playtest/playtest-screen.tsx",
		);
		expect(screen).toBeDefined();
		/** The decision lives in the pure module; the screen only draws its result. */
		expect(screen?.text).toContain("generationRecovery");
		/** The screen does not recount the branches. */
		expect(screen?.text).not.toContain("needsProviderSetup");
		expect(screen?.text).not.toContain("isInsufficientChuru");

		/** Other files do not know settings: neither the condition summary nor the settings dialog points there. */
		for (const file of playtest) {
			if (file.path === "features/playtest/playtest-screen.tsx") continue;
			expect(file.text, `${file.path} — /settings`).not.toContain("/settings");
		}
	});

	/**
	 * The operations tool is still not this app. Queue, enforcement and appeals belong to
	 * `apps/admin`; their vocabulary appearing here crosses the boundary.
	 */
	it("no operator vocabulary", () => {
		for (const file of playtest)
			for (const absent of ["moderationQueue", "executeAction", "/moderation"])
				expect(file.text, `${file.path} — ${absent}`).not.toContain(absent);
	});
});
