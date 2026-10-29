import { readFileSync } from "node:fs";
import { headingAnchor } from "@rowcat/runtime-ai-docs/heading-anchor";
import { describe, expect, test } from "vitest";
import {
	findRuntimeDocEntry,
	RUNTIME_DOC_ENTRIES,
	RUNTIME_DOC_GROUPS,
} from "#/generated/runtime-docs.ts";
import { RUNTIME_DOC_BODIES } from "#/generated/runtime-docs-content.ts";
import { RUNTIME_DOC_EXAMPLES } from "#/generated/runtime-docs-examples.ts";
import {
	CONTENT_FILE,
	EXAMPLES_FILE,
	MANIFEST_FILE,
	readRuntimeDocs,
	renderRuntimeDocsContent,
	renderRuntimeDocsExamples,
	renderRuntimeDocsManifest,
} from "../../../scripts/gen-runtime-docs.ts";
import { runtimeDocNav, runtimeDocNeighbors } from "./runtime-docs-nav.ts";

/**
 * The docs' single source and their structural invariants.
 *
 * Only here can the generator and the generated
 * output be imported together, so whether regeneration was forgotten is known only by regenerating
 * and comparing.
 *
 * Sentence content is not checked; a string being present proves nothing. This test checks
 * structure: generated output is fresh, slugs are unique, the navigation list is intact, required
 * pages exist, and the implementation's vocabulary has not leaked.
 */

const source = readRuntimeDocs();

describe("generated output freshness", () => {
	test.each([
		["runtime-docs.ts", MANIFEST_FILE, renderRuntimeDocsManifest],
		["runtime-docs-content.ts", CONTENT_FILE, renderRuntimeDocsContent],
		["runtime-docs-examples.ts", EXAMPLES_FILE, renderRuntimeDocsExamples],
	] as const)("%s matches its source", (_name, file, render) => {
		expect(readFileSync(file, "utf8")).toBe(render(source));
	});

	test("same input, same output", () => {
		expect(renderRuntimeDocsManifest(readRuntimeDocs())).toBe(
			renderRuntimeDocsManifest(source),
		);
	});
});

describe("navigation model", () => {
	test("slugs are unique and well-formed", () => {
		const slugs = RUNTIME_DOC_ENTRIES.map((entry) => entry.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const slug of slugs)
			expect(slug, `slug ${slug}`).toMatch(/^$|^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);
	});

	test("every entry's group is known, and the list draws only groups with docs", () => {
		const known = new Set(RUNTIME_DOC_GROUPS.map((group) => group.id));
		for (const entry of RUNTIME_DOC_ENTRIES)
			expect(known.has(entry.group)).toBe(true);
		for (const section of runtimeDocNav())
			expect(section.entries.length).toBeGreaterThan(0);
	});

	test("the navigation list holds the whole order once each", () => {
		const listed = runtimeDocNav().flatMap((section) =>
			section.entries.map((entry) => entry.slug),
		);
		expect(listed).toEqual(RUNTIME_DOC_ENTRIES.map((entry) => entry.slug));
	});

	test("previous and next follow the list order", () => {
		for (let index = 0; index < RUNTIME_DOC_ENTRIES.length; index += 1) {
			const entry = RUNTIME_DOC_ENTRIES[index];
			if (entry === undefined) throw new Error("unreachable");
			const { previous, next } = runtimeDocNeighbors(entry.slug);
			expect(previous?.slug ?? null).toBe(
				RUNTIME_DOC_ENTRIES[index - 1]?.slug ?? null,
			);
			expect(next?.slug ?? null).toBe(
				RUNTIME_DOC_ENTRIES[index + 1]?.slug ?? null,
			);
		}
		expect(runtimeDocNeighbors("no-such-doc")).toEqual({
			previous: null,
			next: null,
		});
	});

	test("every manifest entry has a body, and no body has a slug outside the manifest", () => {
		for (const entry of RUNTIME_DOC_ENTRIES)
			expect(typeof RUNTIME_DOC_BODIES[entry.slug], entry.slug).toBe("string");
		for (const slug of Object.keys(RUNTIME_DOC_BODIES))
			expect(findRuntimeDocEntry(slug), slug).not.toBeNull();
	});

	test("an unknown slug is null", () => {
		expect(findRuntimeDocEntry("nope")).toBeNull();
		expect(findRuntimeDocEntry("concepts")).toBeNull();
	});
});

/**
 * Whether links in the body point to somewhere that exists. The generator does not validate links,
 * and a dead link looks normal on screen; it is found only by clicking, and even then no error
 * appears. One anchor was already dead this way (`#이미지--좁은-예외`, one hyphen too many), and nothing
 * could have caught it while the body's links were absent.
 *
 * Anchors are made by the renderer's own function. A separate rule written here would pass the
 * check while on-screen anchors were different strings.
 */
const HEADING = /^#{1,4}\s+(.+)$/gm;

const anchorsOf = (body: string): Set<string> =>
	new Set(
		[...body.matchAll(HEADING)].map((match) => headingAnchor(match[1] ?? "")),
	);

/**
 * Only internal destinations of `[…](destination)` in the body. External URLs are outside this
 * check.
 */
const internalLinks = (body: string): string[] =>
	[...body.matchAll(/\]\((\/docs\/runtime[^)\s]*|#[^)\s]+)\)/g)].map(
		(match) => match[1] ?? "",
	);

describe("internal links in bodies", () => {
	test.each(
		RUNTIME_DOC_ENTRIES.map(
			(entry) => [entry.slug || "index", entry.slug] as const,
		),
	)("every link in %s points somewhere real", (_label, slug) => {
		const body = RUNTIME_DOC_BODIES[slug] ?? "";
		for (const href of internalLinks(body)) {
			const hashIndex = href.indexOf("#");
			const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
			const hash = hashIndex === -1 ? null : href.slice(hashIndex + 1);
			const target =
				path.length === 0
					? slug
					: path.replace(/^\/docs\/runtime\/?/, "").replace(/\/$/, "");
			expect(findRuntimeDocEntry(target), `${slug}: ${href}`).not.toBeNull();
			if (hash !== null)
				expect(
					anchorsOf(RUNTIME_DOC_BODIES[target] ?? ""),
					`${slug}: ${href}`,
				).toContain(hash);
		}
	});
});

/**
 * The pages the completion criteria require. Renaming one changes its address (docs links appear in
 * the studio and in support answers), so the names are locked here by value.
 */
const REQUIRED_PAGES = [
	"",
	"quick-start",
	"project-structure",
	"preview-and-publish",
	"concepts/components",
	"concepts/styling",
	"concepts/events",
	"concepts/state",
	"concepts/generation",
	"concepts/assets",
	"reference",
	"reference/components",
	"reference/hooks",
	"reference/state",
	"reference/generation",
	"reference/styling",
	"reference/assets",
	"reference/errors-and-limits",
	"runtime-model/security",
	"runtime-model/supported-imports",
	"runtime-model/unsupported-apis",
];

describe("required pages", () => {
	test.each(REQUIRED_PAGES)("%s", (slug) => {
		expect(findRuntimeDocEntry(slug)).not.toBeNull();
	});

	test("quick start, state, persistent state, generation and multi-file examples exist", () => {
		const ids = RUNTIME_DOC_EXAMPLES.map((example) => example.id);
		for (const required of [
			"quick-start",
			"story-state",
			"persistent-state",
			"migration",
			"generation",
			"multi-file",
		])
			expect(ids, required).toContain(required);
	});
});

/**
 * Implementation vocabulary must not leak into the public docs.
 *
 * Creators need to know what does and does not work, not how it was built. These words all come
 * from `docs/creator-runtime` (internal records), and their presence in public docs would mix two
 * readers. `IndexedDB` and `localStorage` are not on the list: they are names to use when calling
 * out an unsupported browser API.
 */
const INTERNAL_VOCABULARY: RegExp[] = [
	/QuickJS/i,
	/\bWASM\b/i,
	/WebAssembly/,
	/Dexie/i,
	/SQLite/i,
	/\bHLC\b/,
	/RuntimeArtifact/,
	/RuntimePlayerPersistence/,
	/sessionHydrated/,
	/storyStateCommitted|persistentStateCommitted/,
	/serverVersion/,
	/\bdirty\b/,
	/패치 묶음|패치 프로토콜|리컨사일러/,
	/\b워커\b/,
	/Phase\s*\d/i,
	/코덱/,
	/동기화 봉투|봉투 암호/,
];

describe("internal vocabulary", () => {
	test.each(
		RUNTIME_DOC_ENTRIES.map(
			(entry) => [entry.slug || "index", entry.slug] as const,
		),
	)("%s has no implementation vocabulary", (_label, slug) => {
		const body = RUNTIME_DOC_BODIES[slug] ?? "";
		for (const word of INTERNAL_VOCABULARY)
			expect(body, `${slug}: ${word}`).not.toMatch(word);
	});
});
