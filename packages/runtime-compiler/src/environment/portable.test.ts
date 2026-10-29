import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nodeDigest, nodeRuntimeLibs } from "./node.ts";
import { portableDigest, portableRuntimeEnvironment } from "./portable.ts";
import { sha256Hex } from "./sha256.ts";

/**
 * Both environments must produce the same digest. If they diverge, the same manuscript compiled in
 * the browser and in Node gets two identities, and the difference would only show up as a cache
 * miss.
 */
describe("portable digest", () => {
	it.each([
		"",
		"abc",
		"\ud55c\uae00 and emoji 🐈 and a line break\n",
		"a".repeat(55),
		"a".repeat(56),
		"a".repeat(64),
		"a".repeat(1000),
	])("sha256Hex(%j) equals node:crypto", (input) => {
		expect(sha256Hex(input)).toBe(
			createHash("sha256").update(input, "utf8").digest("hex"),
		);
		expect(portableDigest(input)).toBe(nodeDigest(input));
	});

	it("the environment holds the passed library and a portable digest", () => {
		const libs = nodeRuntimeLibs();
		const environment = portableRuntimeEnvironment(libs);
		expect(environment.defaultLibs).toBe(libs);
		expect(environment.digest("x")).toBe(nodeDigest("x"));
	});
});
