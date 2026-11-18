import { describe, expect, test } from "vitest";
import {
	browserOpenerFor,
	openableAddress,
	openBrowser,
} from "./open-browser.ts";

describe("whether this computer has a browser for the person", () => {
	test("each desktop has its fixed opener", () => {
		expect(browserOpenerFor("darwin", {})?.command).toBe("open");
		expect(browserOpenerFor("win32", {})).toEqual({
			command: "rundll32.exe",
			args: ["url.dll,FileProtocolHandler"],
		});
		expect(browserOpenerFor("linux", { DISPLAY: ":0" })?.command).toBe(
			"xdg-open",
		);
		expect(
			browserOpenerFor("linux", { WAYLAND_DISPLAY: "wayland-0" })?.command,
		).toBe("xdg-open");
	});

	/** The browser that would open is the remote machine's, and nobody is looking at it. */
	test("over SSH, nowhere", () => {
		for (const ssh of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]) {
			expect(
				browserOpenerFor("linux", { DISPLAY: ":0", [ssh]: "x" }),
			).toBeNull();
			expect(browserOpenerFor("darwin", { [ssh]: "x" })).toBeNull();
			expect(browserOpenerFor("win32", { [ssh]: "x" })).toBeNull();
		}
	});

	/** `xdg-open` would fall back to a text browser that takes over this terminal. */
	test("a Linux session without a display, nowhere", () => {
		expect(browserOpenerFor("linux", {})).toBeNull();
	});
});

describe("which addresses may be handed over", () => {
	test("http(s) passes", () => {
		expect(
			openableAddress("https://rowcat.test/device?user_code=ABCDEFGH"),
		).toBe("https://rowcat.test/device?user_code=ABCDEFGH");
		expect(openableAddress("http://localhost:3000/device")).toBe(
			"http://localhost:3000/device",
		);
	});

	test("anything the opener would run, or that carries credentials, does not", () => {
		expect(openableAddress("file:///C:/Windows/System32/calc.exe")).toBeNull();
		expect(openableAddress("javascript:alert(1)")).toBeNull();
		expect(openableAddress("C:\\Windows\\System32\\calc.exe")).toBeNull();
		expect(openableAddress("https://user:pass@rowcat.test/device")).toBeNull();
		expect(openableAddress("not an address")).toBeNull();
	});

	test("a refused address starts nothing", () => {
		expect(openBrowser("file:///etc/passwd", "darwin", {})).toBe(false);
		expect(openBrowser("https://rowcat.test/device", "linux", {})).toBe(false);
	});
});
