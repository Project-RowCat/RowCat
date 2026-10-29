import {
	ROOM_SETTINGS_DESTRUCTIVE_ROWS,
	ROOM_SETTINGS_IA,
	ROOM_SETTINGS_NAVIGATIONAL_ROWS,
	type RoomSettingsGroupId,
	type RoomSettingsRowId,
} from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import { DELETE_ROOM_CONFIRM } from "../room/actions.ts";
import {
	ROOM_SETTINGS_BLOCKED_WARNING,
	ROOM_SETTINGS_GROUP_TITLE,
	ROOM_SETTINGS_ROW_SUMMARY,
	ROOM_SETTINGS_ROW_TITLE,
	ROOM_SETTINGS_TRIGGER_LABEL,
	ROOM_SETTINGS_VIEW_PARENT,
	ROOM_SETTINGS_VIEW_TITLE,
} from "./view.ts";

/**
 * Information structure and copy of room settings, checked without rendering. This app's tests do
 * not render React (`vitest.config.ts`), so what home draws and in what order is verifiable only if
 * the list is data, and that list is `@rowcat/chat`'s `ROOM_SETTINGS_IA`, read by the web too. Two
 * things are locked: the shared table still has the web's structure, and this app's copy tables
 * cover it completely.
 */

const groupIds = ROOM_SETTINGS_IA.map((group) => group.id);
const rowIds = ROOM_SETTINGS_IA.flatMap((group) => group.rows);

describe("groups and rows", () => {
	/** Same three, same order as the web settings home; the axis is character: how it is made, what this conversation is, what is done to the conversation itself. */
	it("the groups stand in generation · conversation · management order", () => {
		expect(groupIds).toEqual([
			"generation",
			"conversation",
			"management",
		] satisfies RoomSettingsGroupId[]);
		expect(groupIds.map((id) => ROOM_SETTINGS_GROUP_TITLE[id])).toEqual([
			"Generation",
			"Conversations",
			"Manage",
		]);
	});

	it("the row columns stand in the same order as the web", () => {
		expect(rowIds).toEqual([
			"generation",
			"persona",
			"narration",
			"intensity",
			"characters",
			"memory",
			"userNote",
			"info",
			"rename",
			"delete",
		] satisfies RoomSettingsRowId[]);
	});

	it("each group has only its own rows", () => {
		expect(ROOM_SETTINGS_IA).toEqual([
			{ id: "generation", rows: ["generation"] },
			{
				id: "conversation",
				rows: [
					"persona",
					"narration",
					"intensity",
					"characters",
					"memory",
					"userNote",
					"info",
				],
			},
			{ id: "management", rows: ["rename", "delete"] },
		]);
	});

	/** The irreversible row is one and last, gathering the place a finger could slip. */
	it("the only destructive row is delete, and it's last", () => {
		expect([...ROOM_SETTINGS_DESTRUCTIVE_ROWS]).toEqual(["delete"]);
		expect(rowIds.at(-1)).toBe("delete");
	});

	/** Delete has no arrow: it opens a confirmation, not a pane, and an arrow would promise "go in and pick more". */
	it("only delete has no navigation arrow", () => {
		for (const row of rowIds)
			expect(ROOM_SETTINGS_NAVIGATIONAL_ROWS.has(row), row).toBe(
				row !== "delete",
			);
	});
});

describe("copy", () => {
	/** Types catch omissions but not whether a value is actually there. */
	it("every row has a name", () => {
		for (const row of rowIds)
			expect(ROOM_SETTINGS_ROW_TITLE[row].length, row).toBeGreaterThan(0);
	});

	/** The `Generation settings` summary is not fixed copy: it is built from stored values (`room-generation-summary.ts`), and a placeholder here would be drawn once before values arrive and read as the user's setting. */
	it("the generation row's summary isn't in the table", () => {
		expect(ROOM_SETTINGS_ROW_SUMMARY.generation).toBeNull();
	});

	/** Persona is the same: its summary is the name of the currently effective role, from the room record (`personaRowSummary`); fixed copy would be drawn once and read as the user's setting. */
	it("the persona row's summary isn't in the table either", () => {
		expect(ROOM_SETTINGS_ROW_SUMMARY.persona).toBeNull();
	});

	/** Rows whose title is already the action get no description. */
	it("management rows have no description", () => {
		expect(ROOM_SETTINGS_ROW_SUMMARY.rename).toBeNull();
		expect(ROOM_SETTINGS_ROW_SUMMARY.delete).toBeNull();
	});

	/** The pane title is the window name, the first word a screen reader reads on open. */
	it("the nine surfaces have the same titles as the web", () => {
		expect(ROOM_SETTINGS_VIEW_TITLE).toEqual({
			home: "Conversation settings",
			generation: "Generation settings",
			info: "Conversation info",
			persona: "Persona",
			personaForm: "Edit persona",
			narration: "Narration",
			intensity: "Intensity",
			characters: "Characters",
			userNote: "User note",
		});
	});

	/** One pane deeper, so back has more than one destination: cancelling persona creation returns to the picker, not home. A wrong table fails silently (the window stays open and only the arrow goes elsewhere). */
	it("each surface has a fixed back destination", () => {
		expect(ROOM_SETTINGS_VIEW_PARENT).toEqual({
			home: null,
			generation: "home",
			info: "home",
			persona: "home",
			personaForm: "persona",
			narration: "home",
			intensity: "home",
			characters: "home",
			userNote: "home",
		});
	});

	/** The header trigger is named like the home title: what opens and what is opened share a word. */
	it("the header trigger says conversation settings", () => {
		expect(ROOM_SETTINGS_TRIGGER_LABEL).toBe(ROOM_SETTINGS_VIEW_TITLE.home);
	});

	/** The home warning states one fact only; adding reasons would put the same guidance in two places (the detail screen has per-reason sentences) and one would go stale. */
	it("the blocked warning doesn't state the reason", () => {
		for (const absent of ["Link", "API", "under 14", "list"])
			expect(ROOM_SETTINGS_BLOCKED_WARNING, absent).not.toContain(absent);
	});

	/** Do not put what does not exist into the vocabulary: pin, archive, export, share and folder all need new product semantics (stored fields, sync rules), and common chat apps having them is no reason to build them. */
	it("operations the product lacks aren't in the list", () => {
		const labels = rowIds.map((row) => ROOM_SETTINGS_ROW_TITLE[row]).join(" ");
		for (const absent of [
			"pin",
			"archive",
			"export",
			"share",
			"folder",
			"duplicate",
		])
			expect(labels, absent).not.toContain(absent);
	});
});

describe("delete confirmation", () => {
	/** The copy says what disappears; "are you sure you want to delete?" gives no information and gets pressed unread. */
	it("states what disappears with it and that it can't be undone", () => {
		expect(DELETE_ROOM_CONFIRM.message).toContain("memories");
		expect(DELETE_ROOM_CONFIRM.message).toContain("other devices");
		expect(DELETE_ROOM_CONFIRM.message).toContain("can't be undone");
	});

	/** Implies no archive or trash; this product has no such procedure. */
	it("no word implying recovery", () => {
		for (const absent of ["archive", "trash", "recovery", "30 days"])
			expect(DELETE_ROOM_CONFIRM.message, absent).not.toContain(absent);
	});
});
