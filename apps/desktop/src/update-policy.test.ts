import { describe, expect, it } from "vitest";
import {
	releaseDateOf,
	selfUpdateSupported,
	UPDATE_CHECK_INTERVAL_MS,
	updateCheckDue,
	updateFeedFrom,
	windowsInstallerName,
} from "./update-policy.ts";

describe("releaseDateOf", () => {
	it("reads the installer version back as the release date", () => {
		expect(releaseDateOf("2026.10.31")).toBe("2026-10-31");
		expect(releaseDateOf("2026.1.5")).toBe("2026-01-05");
	});

	it("is not a release for a placeholder or a date that does not exist", () => {
		expect(releaseDateOf("0.0.0")).toBeNull();
		expect(releaseDateOf("2026.2.30")).toBeNull();
		expect(releaseDateOf("2026.13.1")).toBeNull();
		expect(releaseDateOf("2026-10-31")).toBeNull();
	});
});

describe("windowsInstallerName", () => {
	// The release workflow attaches exactly this name, and latest.yml points at it.
	it("names the installer by the release date", () => {
		expect(windowsInstallerName("RowCat", "2026.10.31")).toBe(
			"RowCat-2026-10-31-windows-x64.exe",
		);
	});

	it("keeps whitespace out of the file name", () => {
		expect(windowsInstallerName("My  Cat ", "2026.11.1")).toBe(
			"My-Cat-2026-11-01-windows-x64.exe",
		);
	});
});

describe("updateFeedFrom", () => {
	it("is the repository the release ran in", () => {
		expect(updateFeedFrom("someone/rowcat-fork")).toEqual({
			owner: "someone",
			repo: "rowcat-fork",
		});
	});

	it("is absent outside a release", () => {
		expect(updateFeedFrom(undefined)).toBeNull();
		expect(updateFeedFrom("")).toBeNull();
		expect(updateFeedFrom("not a repository")).toBeNull();
		expect(updateFeedFrom("a/b/c")).toBeNull();
	});
});

describe("selfUpdateSupported", () => {
	it("is Windows, and Linux only as an AppImage", () => {
		expect(selfUpdateSupported("win32", {})).toBe(true);
		expect(selfUpdateSupported("linux", {})).toBe(false);
		expect(
			selfUpdateSupported("linux", { APPIMAGE: "/x/RowCat.AppImage" }),
		).toBe(true);
	});

	// Squirrel.Mac installs only a signed app.
	it("is not macOS while the app is unsigned", () => {
		expect(selfUpdateSupported("darwin", {})).toBe(false);
	});
});

describe("updateCheckDue", () => {
	const now = 1_800_000_000_000;

	it("asks at launch, then at most once per interval", () => {
		expect(updateCheckDue(null, now)).toBe(true);
		expect(updateCheckDue(now - 1000, now)).toBe(false);
		expect(updateCheckDue(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
	});

	it("asks again after the clock moved backwards", () => {
		expect(updateCheckDue(now + 60_000, now)).toBe(true);
	});
});
