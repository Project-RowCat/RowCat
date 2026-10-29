import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { renderCorpusModule } from "../scripts/generate.ts";
import {
	findRuntimeAiDoc,
	findRuntimeAiSymbol,
	RUNTIME_AI_GROUPS,
} from "./corpus.ts";
import { RUNTIME_AI_CORPUS } from "./generated/corpus.ts";
import {
	renderLlmsFullTxt,
	renderLlmsTxt,
	renderRuntimeApiJson,
} from "./llms.ts";
import { searchRuntimeDocs } from "./search.ts";
import { buildRuntimeAiCorpus } from "./source/build.ts";

/**
 * Freshness and cross-validation of the corpus. This is the only place where the generator and its
 * output can be imported together.
 *
 * It does not check sentence content, which would only prove a string is still present. It checks
 * structure: the committed corpus matches its source, the two sources point at each other, and the
 * output agents read contains every fact in the corpus.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(HERE, "generated", "corpus.ts");

const fresh = buildRuntimeAiCorpus();

describe("freshness of generated output", () => {
	test("the committed corpus equals the source", () => {
		expect(readFileSync(GENERATED, "utf8")).toBe(renderCorpusModule(fresh));
	});

	test("the same input gives the same output", () => {
		expect(renderCorpusModule(buildRuntimeAiCorpus())).toBe(
			renderCorpusModule(fresh),
		);
	});
});

describe("cross-checking the two sources", () => {
	/**
	 * If this test fails, a public API landed before its documentation. The only fix is to add the
	 * name to the `symbols` frontmatter of the reference page that describes it. No exception list is
	 * offered. Once one exists, adding a line to it becomes the fastest way to ship an undocumented
	 * API.
	 */
	test("no public API is without docs", () => {
		expect(
			RUNTIME_AI_CORPUS.undocumented,
			`public API without docs: ${RUNTIME_AI_CORPUS.undocumented.join(", ")}`,
		).toEqual([]);
	});

	test("every name's owning doc really exists", () => {
		for (const symbol of RUNTIME_AI_CORPUS.symbols)
			expect(
				findRuntimeAiDoc(RUNTIME_AI_CORPUS, symbol.doc),
				`${symbol.name} → ${symbol.doc}`,
			).not.toBeNull();
	});

	test("every name the docs claim to own really exists", () => {
		for (const doc of RUNTIME_AI_CORPUS.docs)
			for (const name of doc.symbols)
				expect(
					findRuntimeAiSymbol(RUNTIME_AI_CORPUS, name),
					`${name} in ${doc.slug || "index"}`,
				).not.toBeNull();
	});

	test("no name is owned by two pages", () => {
		const seen = new Map<string, string>();
		for (const doc of RUNTIME_AI_CORPUS.docs)
			for (const name of doc.symbols) {
				expect(seen.has(name), `${name}: ${seen.get(name)} ↔ ${doc.slug}`).toBe(
					false,
				);
				seen.set(name, doc.slug);
			}
	});

	test("signatures carry no implementation", () => {
		for (const symbol of RUNTIME_AI_CORPUS.symbols) {
			if (symbol.kind !== "function" && symbol.kind !== "hook") continue;
			expect(symbol.signature, symbol.name).not.toMatch(/\breturn\b/);
		}
	});
});

describe("agent guidance", () => {
	test("is not empty", () => {
		expect(RUNTIME_AI_CORPUS.agentGuide.length).toBeGreaterThan(500);
	});

	/** Links in the guide must resolve to real docs. A dead link sends the agent off course. */
	test("every link points at a real doc", () => {
		for (const match of RUNTIME_AI_CORPUS.agentGuide.matchAll(
			/\]\((\/docs\/runtime[^)\s]*)\)/g,
		)) {
			const href = match[1] ?? "";
			const path = (href.split("#")[0] ?? "")
				.replace(/^\/docs\/runtime\/?/, "")
				.replace(/\/$/, "");
			expect(
				findRuntimeAiDoc(RUNTIME_AI_CORPUS, path),
				`points at a missing doc: ${href}`,
			).not.toBeNull();
		}
	});

	/**
	 * Tool names the guide calls must be real names. An agent that calls a tool that does not exist is
	 * the failure this guards against.
	 */
	test("MCP tool names written there have a consistent shape", () => {
		for (const match of RUNTIME_AI_CORPUS.agentGuide.matchAll(
			/\bruntime_[a-z_]+/g,
		))
			expect(match[0]).toMatch(/^runtime_[a-z]+(_[a-z]+)*$/);
	});
});

describe("llms.txt", () => {
	const text = renderLlmsTxt(RUNTIME_AI_CORPUS);

	test("has the spec's head", () => {
		const lines = text.split("\n");
		expect(lines[0]).toMatch(/^# /);
		expect(lines.slice(0, 4).some((line) => line.startsWith("> "))).toBe(true);
	});

	test("every doc is listed", () => {
		for (const doc of RUNTIME_AI_CORPUS.docs)
			expect(text, doc.slug || "index").toContain(`(${doc.url})`);
	});

	test("every public name is listed", () => {
		for (const symbol of RUNTIME_AI_CORPUS.symbols)
			expect(text, symbol.name).toContain(`\`${symbol.name}\``);
	});

	test("names without docs are not listed", () => {
		for (const name of RUNTIME_AI_CORPUS.undocumented)
			expect(text, name).not.toContain(`\`${name}\``);
	});

	test("an origin makes absolute addresses", () => {
		const absolute = renderLlmsTxt(RUNTIME_AI_CORPUS, {
			origin: "https://example.test/",
		});
		expect(absolute).toContain("(https://example.test/docs/runtime");
		expect(absolute).not.toContain("(/docs/runtime");
	});

	test("the full text contains every body", () => {
		const full = renderLlmsFullTxt(RUNTIME_AI_CORPUS);
		for (const doc of RUNTIME_AI_CORPUS.docs)
			expect(full, doc.slug || "index").toContain(doc.body.trimEnd());
	});
});

describe("runtime-api.json", () => {
	const parsed = JSON.parse(renderRuntimeApiJson(RUNTIME_AI_CORPUS)) as {
		apiVersion: number;
		symbols: { name: string; kind: string; signature: string }[];
		docs: { slug: string }[];
	};

	test("holds the same as the corpus", () => {
		expect(parsed.apiVersion).toBe(RUNTIME_AI_CORPUS.apiVersion);
		expect(parsed.symbols.map((symbol) => symbol.name)).toEqual(
			RUNTIME_AI_CORPUS.symbols.map((symbol) => symbol.name),
		);
		expect(parsed.docs.length).toBe(RUNTIME_AI_CORPUS.docs.length);
	});

	test("no signature is empty", () => {
		for (const symbol of parsed.symbols)
			expect(symbol.signature.length, symbol.name).toBeGreaterThan(0);
	});
});

describe("doc search", () => {
	test("a name finds the page describing that name", () => {
		for (const name of ["useStoryState", "asset", "Progress"]) {
			const symbol = findRuntimeAiSymbol(RUNTIME_AI_CORPUS, name);
			expect(symbol, name).not.toBeNull();
			const hits = searchRuntimeDocs(RUNTIME_AI_CORPUS, { query: name });
			expect(hits[0]?.slug, name).toBe(symbol?.doc);
		}
	});

	/** The public docs are Korean, so these queries stay Korean (escaped). */
	test("finds it even with a Korean particle attached", () => {
		const hits = searchRuntimeDocs(RUNTIME_AI_CORPUS, {
			query: "\uc0c1\ud0dc\ub97c \uc800\uc7a5",
		});
		expect(hits.length).toBeGreaterThan(0);
	});

	test("the same query gives the same order", () => {
		const first = searchRuntimeDocs(RUNTIME_AI_CORPUS, {
			query: "\uc774\ubbf8\uc9c0",
		});
		const second = searchRuntimeDocs(RUNTIME_AI_CORPUS, {
			query: "\uc774\ubbf8\uc9c0",
		});
		expect(first.map((hit) => hit.slug)).toEqual(second.map((hit) => hit.slug));
	});

	test("empty and non-matching queries give empty results", () => {
		expect(searchRuntimeDocs(RUNTIME_AI_CORPUS, { query: "   " })).toEqual([]);
		expect(
			searchRuntimeDocs(RUNTIME_AI_CORPUS, { query: "zzzzqqqxyzzy" }),
		).toEqual([]);
	});

	test("narrows by group", () => {
		const hits = searchRuntimeDocs(RUNTIME_AI_CORPUS, {
			query: "\uc0c1\ud0dc",
			group: "reference",
		});
		for (const hit of hits) expect(hit.group).toBe("reference");
	});

	test("the result count is bounded", () => {
		expect(
			searchRuntimeDocs(RUNTIME_AI_CORPUS, {
				query: "\ub7f0\ud0c0\uc784",
				limit: 999,
			}).length,
		).toBeLessThanOrEqual(20);
	});

	test("every group is in the vocabulary", () => {
		for (const doc of RUNTIME_AI_CORPUS.docs)
			expect(RUNTIME_AI_GROUPS).toContain(doc.group);
	});
});
