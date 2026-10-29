import { describe, expect, it } from "vitest";
import {
	settingsReturnPath,
	settingsReturnSearch,
	validateSettingsSearch,
} from "./settings-return.ts";

/**
 * The return location must stay safe and must never break the screen. The address bar is
 * user-editable input, so two things are guaranteed: only a narrow set of values is accepted (no
 * open redirect can be expressed), and unknown values never break the screen. One mistyped
 * character must not turn settings into an error page.
 */
describe("settingsReturnPath", () => {
	it("accepts only conversation paths", () => {
		expect(settingsReturnPath("/chat/abc123")).toBe("/chat/abc123");
		expect(settingsReturnPath("/chat/runtime/story-1")).toBe(
			"/chat/runtime/story-1",
		);
	});

	/**
	 * Values that lead outside the app cannot be represented at all. This is the same rule as the
	 * `?redirect=` parameter on sign-in.
	 */
	it.each([
		["another screen", "/settings"],
		["an absolute URL", "https://evil.example/chat/x"],
		["protocol-relative", "//evil.example/chat/x"],
		["a double slash in the path", "/chat//evil.example"],
		["with a query", "/chat/abc?next=/x"],
		["with a fragment", "/chat/abc#x"],
		["with whitespace", "/chat/a b"],
		["not a string", 42],
		["missing", undefined],
	])("%s is dropped", (_label, value) => {
		expect(settingsReturnPath(value)).toBeNull();
	});

	it("an overly long value is dropped", () => {
		expect(settingsReturnPath(`/chat/${"a".repeat(300)}`)).toBeNull();
	});
});

describe("validateSettingsSearch", () => {
	it("an unknown value does not break the screen", () => {
		expect(validateSettingsSearch({ from: "https://evil.example" })).toEqual(
			{},
		);
		expect(validateSettingsSearch({})).toEqual({});
		expect(validateSettingsSearch({ tab: "x" })).toEqual({});
	});

	it("keeps only values that hold", () => {
		expect(validateSettingsSearch({ from: "/chat/abc", tab: "x" })).toEqual({
			from: "/chat/abc",
		});
	});
});

describe("settingsReturnSearch", () => {
	it("empty outside a conversation", () => {
		expect(settingsReturnSearch("/create/draft-1/test")).toEqual({});
		expect(settingsReturnSearch("/")).toEqual({});
	});

	it("in a conversation it carries the current place", () => {
		expect(settingsReturnSearch("/chat/abc")).toEqual({ from: "/chat/abc" });
	});
});
