import type { RuntimeHostValue } from "@rowcat/runtime-host/patches";
import { describe, expect, it } from "vitest";
import { assertKnownProp, resolveProps } from "./props.ts";

const props = (entries: Record<string, RuntimeHostValue>) =>
	new Map(Object.entries(entries));

describe("one table per kind", () => {
	it("only names that kind accepts pass", () => {
		expect(() => assertKnownProp("stack", "gap")).not.toThrow();
		expect(() => assertKnownProp("stack", "onPress")).toThrow(/has no prop/);
		expect(() => assertKnownProp("text", "source")).toThrow(/has no prop/);
		expect(() => assertKnownProp("#text", "style")).toThrow(/has no prop/);
	});

	it("RN prop names do not pass through as is", () => {
		for (const name of [
			"onLayout",
			"testID",
			"pointerEvents",
			"accessibilityLabel",
			"children",
		])
			expect(() => assertKnownProp("view", name), name).toThrow(/has no prop/);
	});
});

describe("handlers", () => {
	it("takes out only the number", () => {
		expect(
			resolveProps("button", props({ onPress: { $handler: 41 } })).onPress,
		).toBe(41);
	});

	it("refuses values that are not numbers", () => {
		expect(() => resolveProps("button", props({ onPress: 41 }))).toThrow(
			/handler reference/,
		);
		expect(() =>
			resolveProps("button", props({ onPress: { handler: 41 } })),
		).toThrow(/handler reference/);
	});
});

describe("assets", () => {
	it("takes out only the logical path: does not turn it into an address", () => {
		const resolved = resolveProps(
			"image",
			props({ source: { $asset: "characters/sena/smile" } }),
		);
		expect(resolved.asset).toBe("characters/sena/smile");
	});

	it("does not take strings as assets", () => {
		expect(() =>
			resolveProps("image", props({ source: "https://example.com/a.png" })),
		).toThrow(/asset reference/);
	});

	it("a path that looks like an address is still a path", () => {
		expect(
			resolveProps("image", props({ source: { $asset: "https://x/a.png" } }))
				.asset,
		).toBe("https://x/a.png");
	});
});

describe("vocabulary", () => {
	it("ratings and alignments are in the list", () => {
		expect(resolveProps("button", props({ tone: "ghost" })).tone).toBe("ghost");
		expect(() => resolveProps("button", props({ tone: "danger" }))).toThrow(
			/expected one of/,
		);
		expect(resolveProps("image", props({ fit: "fill" })).fit).toBe("fill");
		expect(() => resolveProps("image", props({ fit: "none" }))).toThrow(
			/expected one of/,
		);
	});

	it("disabled is a boolean", () => {
		expect(resolveProps("button", props({ disabled: true })).disabled).toBe(
			true,
		);
		expect(() => resolveProps("button", props({ disabled: 1 }))).toThrow(
			/boolean/,
		);
	});
});

describe("progress", () => {
	it("no value means progress with no known end", () => {
		expect(resolveProps("progress", props({})).progress).toBeNull();
	});

	it("folds the value to 0 to 1", () => {
		expect(resolveProps("progress", props({ value: 2 })).progress).toBe(1);
		expect(resolveProps("progress", props({ value: -3 })).progress).toBe(0);
		expect(resolveProps("progress", props({ value: 0.25 })).progress).toBe(
			0.25,
		);
	});
});

describe("defaults", () => {
	it("without props it is that kind's default", () => {
		const resolved = resolveProps("button", props({}));
		expect(resolved).toMatchObject({
			onPress: null,
			disabled: false,
			tone: "primary",
		});
	});

	it("text nodes take no props", () => {
		expect(() => resolveProps("#text", props({ style: null }))).toThrow(
			/has no prop/,
		);
	});
});
