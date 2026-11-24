import { describe, expect, it } from "vitest";
import {
	ROOM_SETTINGS_IA,
	roomSettingsGroups,
	roomSettingsRowAvailable,
} from "./room-settings-ia.ts";

const ALL = { narration: true, attachments: true };

describe("room settings rows a build can honour", () => {
	it("with everything available, the IA is unchanged", () => {
		expect(roomSettingsGroups(ALL)).toEqual(ROOM_SETTINGS_IA);
	});

	it("without packs, only the narration row leaves, and order holds", () => {
		const groups = roomSettingsGroups({ ...ALL, narration: false });
		expect(groups.map((group) => group.id)).toEqual(
			ROOM_SETTINGS_IA.map((group) => group.id),
		);
		expect(groups.flatMap((group) => group.rows)).toEqual(
			ROOM_SETTINGS_IA.flatMap((group) => group.rows).filter(
				(row) => row !== "narration",
			),
		);
	});

	it("without an attachment screen, only the attachments row leaves", () => {
		const groups = roomSettingsGroups({ ...ALL, attachments: false });
		expect(groups.flatMap((group) => group.rows)).toEqual(
			ROOM_SETTINGS_IA.flatMap((group) => group.rows).filter(
				(row) => row !== "attachments",
			),
		);
	});

	it("every other row stands either way", () => {
		const none = { narration: false, attachments: false };
		for (const row of ROOM_SETTINGS_IA.flatMap((group) => group.rows)) {
			if (row === "narration" || row === "attachments") continue;
			expect(roomSettingsRowAvailable(row, none)).toBe(true);
		}
		expect(roomSettingsRowAvailable("narration", none)).toBe(false);
		expect(roomSettingsRowAvailable("attachments", none)).toBe(false);
	});

	it("attachments sit between the cast and memory, the order the prompt reads them", () => {
		const rows = ROOM_SETTINGS_IA.flatMap((group) => group.rows);
		expect(rows.indexOf("attachments")).toBe(rows.indexOf("characters") + 1);
		expect(rows.indexOf("memory")).toBe(rows.indexOf("attachments") + 1);
	});
});
