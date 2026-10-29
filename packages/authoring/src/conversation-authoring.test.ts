import { describe, expect, it } from "vitest";
import { resolveConversationAuthoringMode } from "./conversation-authoring.ts";
import { createDraftRuntimeProjectRecord } from "./runtime.ts";

/**
 * Editability of the four conversation-material sections (prompt, lore, opening scene, scene
 * image): four outcomes. The `pending` case is the point of this file. If a section were editable
 * before the project loads, typed text would pass through autosave and mix into old values of a
 * runtime-enabled work.
 */

const project = (enabled: boolean) =>
	createDraftRuntimeProjectRecord(
		{ draftId: "draft-1", enabled, entry: "src/main.tsx" },
		{ now: "2026-01-01T00:00:00.000Z", rev: { t: 1, c: 0, d: "d" } },
	);

describe("conversation material editing mode", () => {
	it("edits without a project", () => {
		expect(
			resolveConversationAuthoringMode({ loading: false, project: null }),
		).toBe("editable");
	});

	it("edits when the project is off", () => {
		expect(
			resolveConversationAuthoringMode({
				loading: false,
				project: project(false),
			}),
		).toBe("editable");
	});

	it("locks when the project is on", () => {
		expect(
			resolveConversationAuthoringMode({
				loading: false,
				project: project(true),
			}),
		).toBe("locked");
	});

	/** Not editable while the state is unknown, whatever the lookup result is. */
	it("waits while unknown", () => {
		expect(
			resolveConversationAuthoringMode({ loading: true, project: null }),
		).toBe("pending");
		expect(
			resolveConversationAuthoringMode({
				loading: true,
				project: project(true),
			}),
		).toBe("pending");
	});

	/**
	 * The decision does not know which section is asked about. All four sections get the same answer
	 * for the same input, and that is the whole guarantee. Passing a section name in would create
	 * separate cases, and one of them could eventually fold `pending` into `editable`.
	 */
	it("takes no section as an argument", () => {
		expect(resolveConversationAuthoringMode.length).toBe(1);
	});
});
