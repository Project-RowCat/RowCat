import { describe, expect, it } from "vitest";
import { RUNTIME_PREVIEW } from "#/features/runtime-preview/runtime-preview-copy.ts";
import {
	RUNTIME_COMMAND_IDS,
	type RuntimeCommandContext,
	type RuntimeCommandId,
	runtimeCommands,
	searchRuntimeCommands,
} from "./registry.ts";

/**
 * Checks the command palette's decisions as values. The layer must answer two things: which
 * operations exist right now, and which of them cannot run and why. If either answer stops tracking
 * the real state, the symptom is silent: a row that is listed but does nothing when pressed, or an
 * operation that is possible but never shown.
 */

const base: RuntimeCommandContext = {
	preview: { run: true, restart: false, stop: false },
	previewEligible: true,
	explorerVisible: true,
	previewVisible: true,
	panel: null,
	entryExists: true,
};

const idsOf = (context: Partial<RuntimeCommandContext> = {}): string[] =>
	runtimeCommands({ ...base, ...context }).map((command) => command.id);

describe("the list follows the current state", () => {
	/**
	 * Run and restart are never offered together. The preview header reads the same table and enables
	 * only one of them. If both appeared, the palette would say something the screen does not, and one
	 * of them would do nothing when pressed.
	 */
	it("run and restart exclude each other", () => {
		expect(
			idsOf({ preview: { run: true, restart: false, stop: false } }),
		).toContain("preview-run");
		expect(
			idsOf({ preview: { run: true, restart: false, stop: false } }),
		).not.toContain("preview-restart");

		const running = idsOf({
			preview: { run: false, restart: true, stop: true },
		});
		expect(running).toContain("preview-restart");
		expect(running).toContain("preview-stop");
		expect(running).not.toContain("preview-run");
	});

	/**
	 * When nothing is running, stop is not an operation at all, so it does not appear, not even
	 * disabled.
	 */
	it("stop is absent when stopped", () => {
		expect(idsOf()).not.toContain("preview-stop");
	});

	/**
	 * The two reset commands always appear. For a stopped preview, reset means the next run starts
	 * from scratch, and clearing saved state needs no compile.
	 */
	it("the two resets don't ask about eligibility or state", () => {
		const blocked = idsOf({
			previewEligible: false,
			preview: { run: false, restart: false, stop: false },
		});
		expect(blocked).toContain("preview-reset-playthrough");
		expect(blocked).toContain("preview-reset-persistent");
	});

	/**
	 * A command that opens an already-open panel changes nothing, so it does not appear in the list.
	 */
	it("an open pane is absent and close stands instead", () => {
		const closed = idsOf({ panel: null });
		expect(closed).toContain("panel-problems");
		expect(closed).not.toContain("panel-close");

		const open = idsOf({ panel: "problems" });
		expect(open).not.toContain("panel-problems");
		expect(open).toContain("panel-console");
		expect(open).toContain("panel-close");
	});

	/**
	 * A command that opens a missing entry file is not listed, because pressing it would do nothing.
	 */
	it("that command doesn't stand without an entry file", () => {
		expect(idsOf({ entryExists: false })).not.toContain("open-entry");
	});

	/**
	 * A panel's visibility flips the verb. With one fixed word (`explorer`), a reader could not tell what
	 * pressing the row would do.
	 */
	it("open/close action names state the current state", () => {
		const shown = runtimeCommands({ ...base, explorerVisible: true });
		const hidden = runtimeCommands({ ...base, explorerVisible: false });
		const label = (list: typeof shown, id: RuntimeCommandId) =>
			list.find((command) => command.id === id)?.label;
		expect(label(shown, "toggle-explorer")).not.toBe(
			label(hidden, "toggle-explorer"),
		);
	});

	/** Every id in the vocabulary must appear in at least one state, so there are no dead values. */
	it("every command id has a state that shows it", () => {
		const seen = new Set<string>();
		for (const preview of [
			{ run: true, restart: false, stop: false },
			{ run: false, restart: true, stop: true },
		])
			for (const panel of [null, "problems"] as const)
				for (const id of idsOf({ preview, panel })) seen.add(id);
		expect([...seen].sort()).toEqual([...RUNTIME_COMMAND_IDS].sort());
	});
});

describe("blocked actions stay with a reason", () => {
	/**
	 * When ineligible, run stays visible but disabled instead of disappearing. If it vanished, the
	 * user would learn only that it does not exist, and lose the chance to see why.
	 */
	it("run gets a reason when a blocking error exists", () => {
		const command = runtimeCommands({ ...base, previewEligible: false }).find(
			(entry) => entry.id === "preview-run",
		);
		expect(command?.disabledReason).toBe(RUNTIME_PREVIEW.notEligible);
	});

	it("no reason when eligible", () => {
		for (const command of runtimeCommands(base))
			expect(command.disabledReason, command.id).toBeNull();
	});
});

describe("search", () => {
	/**
	 * An empty query returns everything. If the list were empty on open, only people who already knew
	 * the names could use it.
	 */
	it("an empty query is the whole list in order", () => {
		const commands = runtimeCommands(base);
		expect(searchRuntimeCommands(commands, "")).toEqual(commands);
		expect(searchRuntimeCommands(commands, "   ")).toEqual(commands);
	});

	/**
	 * Names that start with the query come first. Ties keep the original order rather than sorting by
	 * name length, because the list order already encodes how often each action is used on this
	 * screen.
	 */
	it("prefix matches rank above contains, with ties in original order", () => {
		const list = [
			{
				id: "panel-console",
				label: "one containing run",
				shortcut: null,
				disabledReason: null,
			},
			{
				id: "preview-run",
				label: "run A",
				shortcut: null,
				disabledReason: null,
			},
			{
				id: "preview-stop",
				label: "run B",
				shortcut: null,
				disabledReason: null,
			},
		] as const;
		expect(
			searchRuntimeCommands([...list], "run").map((entry) => entry.label),
		).toEqual(["run A", "run B", "one containing run"]);
	});

	it("a non-matching query is an empty list", () => {
		expect(searchRuntimeCommands(runtimeCommands(base), "zzzz")).toEqual([]);
	});

	/** Case is folded on both the query and the target. */
	it("folds case", () => {
		const commands = runtimeCommands({ ...base, panel: null });
		expect(searchRuntimeCommands(commands, "problems").length).toBeGreaterThan(
			0,
		);
		expect(searchRuntimeCommands(commands, "PROBLEMS").length).toBeGreaterThan(
			0,
		);
	});
});
