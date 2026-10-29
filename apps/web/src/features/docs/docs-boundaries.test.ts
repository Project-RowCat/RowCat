import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Boundary of the docs screen: neither the compiler nor the VM may reach the browser bundle.
 *
 * API docs do not need `@rowcat/runtime-compiler` or `@rowcat/runtime-host`. If either enters a
 * runtime file in this folder, opening one docs page would download TypeScript and the WASM engine.
 * Inventory validation (syntax tree) and example compilation belong to tests, and test files are
 * outside this scan.
 *
 * The generator (`scripts/gen-runtime-docs.ts`) follows the same rule: it reads and validates docs
 * but does not compile. Example compilation happens in tests.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(
	HERE,
	"..",
	"..",
	"..",
	"scripts",
	"gen-runtime-docs.ts",
);

const FORBIDDEN = [
	/@rowcat\/runtime-compiler/,
	/@rowcat\/runtime-host/,
	/quickjs/i,
	/typescript-compiler-api/,
	/monaco/i,
	/dangerouslySetInnerHTML/,
	/rehype-raw/,
	/innerHTML/,
];

/**
 * Entry points into the docs: four, all using the same component.
 *
 * Two appear before the runtime is enabled (intro section, template gallery) and two after (studio
 * header, preview not yet run). The names are listed because these links disappear silently in
 * refactors; losing one leaves the screen looking normal.
 *
 * The fourth is the stage surface (`runtime-preview-stage.tsx`), not the preview pane. The stage is
 * shared by the studio and the full-screen work test, so a link placed there appears on both.
 * Listing each surface separately would let a later surface open without the link.
 */
const ENTRY_SURFACES = [
	"runtime-studio/runtime-intro.tsx",
	"runtime-studio/runtime-studio-header.tsx",
	"runtime-preview/runtime-preview-stage.tsx",
	"runtime-templates/runtime-template-gallery.tsx",
];

const runtimeFiles = readdirSync(HERE).filter(
	(name) =>
		(name.endsWith(".ts") || name.endsWith(".tsx")) && !name.includes(".test."),
);

describe("docs folder boundaries", () => {
	test.each(runtimeFiles)("%s", (name) => {
		const source = readFileSync(join(HERE, name), "utf8");
		for (const door of FORBIDDEN)
			expect(source, `${name}: ${door}`).not.toMatch(door);
	});

	test.each(ENTRY_SURFACES)("%s — the docs entry link appears", (file) => {
		const source = readFileSync(join(HERE, "..", file), "utf8");
		expect(source).toMatch(/<RuntimeDocsEntryLink\b/);
		expect(source).not.toMatch(/to="\/docs\/runtime"/);
	});

	/**
	 * The body renderer does not apply the policy meant for other people's manuscripts.
	 *
	 * `markdownUrlTransform` strips paths without a root. If it were used as `urlTransform`,
	 * `/docs/runtime/…` and `#section` links would reach the component with an empty `href`, so every
	 * link in the body would reload the current page with no error. This actually happened. The
	 * policy's content is locked by `lib/owned-markdown-url.test.ts`; this test only locks that the
	 * renderer passes through that policy.
	 */
	test("goes through the address policy of docs the body renderer owns", () => {
		const source = readFileSync(
			join(HERE, "runtime-docs-markdown.tsx"),
			"utf8",
		);
		expect(source).toMatch(/urlTransform=\{ownedDocumentUrlTransform\}/);
		expect(source).not.toMatch(/urlTransform=\{markdownUrlTransform\}/);
	});

	test("the generator does not import the compiler either", () => {
		const source = readFileSync(GENERATOR, "utf8");
		for (const door of FORBIDDEN.slice(0, 4))
			expect(source, `${door}`).not.toMatch(door);
	});
});
