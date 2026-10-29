import { describe, expect, it } from "vitest";
import {
	ROOM_SETTINGS_IA,
	roomSettingsGroups,
	roomSettingsRowAvailable,
} from "./room-settings-ia.ts";

describe("room settings rows a build can honour", () => {
	it("with packs available, the IA is unchanged", () => {
		expect(roomSettingsGroups({ narration: true })).toEqual(ROOM_SETTINGS_IA);
	});

	it("without packs, only the narration row leaves, and order holds", () => {
		const groups = roomSettingsGroups({ narration: false });
		expect(groups.map((group) => group.id)).toEqual(
			ROOM_SETTINGS_IA.map((group) => group.id),
		);
		expect(groups.flatMap((group) => group.rows)).toEqual(
			ROOM_SETTINGS_IA.flatMap((group) => group.rows).filter(
				(row) => row !== "narration",
			),
		);
	});

	it("every other row stands either way", () => {
		for (const row of ROOM_SETTINGS_IA.flatMap((group) => group.rows)) {
			if (row === "narration") continue;
			expect(roomSettingsRowAvailable(row, { narration: false })).toBe(true);
		}
		expect(roomSettingsRowAvailable("narration", { narration: false })).toBe(
			false,
		);
	});
});
