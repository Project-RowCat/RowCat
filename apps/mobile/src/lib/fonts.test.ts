import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontFace } from "@rowcat/design";
import { describe, expect, it } from "vitest";

/**
 * A safety net for font loading: **do referenced names match registered names?**
 *
 * This check exists because the failure is silent. If a `fontFamily` referenced by
 * `@rowcat/ui-native` is not registered, RN raises no error and **falls back to the system font**.
 * Latin text looks nearly the same in both fonts, so it does not show on the developer's screen;
 * only Korean spacing and line height diverge.
 *
 * It reads the source, as this app's convention does (React is not rendered).
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "fonts.ts");

describe("product fonts", () => {
	it("registers every name in the shared vocabulary", async () => {
		const text = await import("node:fs/promises").then((fs) =>
			fs.readFile(source, "utf8"),
		);
		for (const face of Object.values(fontFace)) {
			expect(text).toContain(`"${face}": require(`);
		}
	});

	it("the registered names don't grow beyond the vocabulary", async () => {
		const text = await import("node:fs/promises").then((fs) =>
			fs.readFile(source, "utf8"),
		);
		const registered = [...text.matchAll(/"([^"]+)":\s*require\(/g)].map(
			(m) => m[1],
		);
		expect(registered.sort()).toEqual(Object.values(fontFace).sort());
	});

	it("the registered files actually exist", async () => {
		const text = await import("node:fs/promises").then((fs) =>
			fs.readFile(source, "utf8"),
		);
		const paths = [...text.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
		expect(paths.length).toBe(Object.keys(fontFace).length);
		for (const p of paths) {
			expect(existsSync(join(here, p))).toBe(true);
		}
	});
});
