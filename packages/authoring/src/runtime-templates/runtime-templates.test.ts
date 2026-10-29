import { describe, expect, it } from "vitest";
import {
	checkRuntimePath,
	RUNTIME_ENTRY_PATH,
	RUNTIME_PROJECT_LIMITS,
	RUNTIME_SOURCE_EXTENSIONS,
} from "../runtime.ts";
import {
	defaultRuntimeStarter,
	featuredRuntimeTemplate,
	instantiateRuntimeTemplate,
	RUNTIME_DEFAULT_TEMPLATE_ID,
	RUNTIME_TEMPLATES,
	runtimeTemplateById,
	runtimeTemplateCategories,
	runtimeTemplatesIn,
} from "./index.ts";
import { RUNTIME_TEMPLATE_IDS } from "./types.ts";

/**
 * The registry checks identifiers, paths, and agreement with the authoring rules, but it does not
 * compile anything; this package does not know the compiler. The real compile and run are checked
 * at the assembly point that imports both packages:
 * apps/web/src/features/runtime-templates/runtime-template-compile.test.ts This file asks one
 * narrow question: can these values enter the authoring store?
 */

const every = RUNTIME_TEMPLATES.map(
	(template) => [template.id, template] as const,
);

describe("identity", () => {
	it("the vocabulary and the registry are exactly the same set", () => {
		expect([...RUNTIME_TEMPLATES].map((t) => t.id).sort()).toEqual(
			[...RUNTIME_TEMPLATE_IDS].sort(),
		);
	});

	it("ids do not repeat", () => {
		const ids = RUNTIME_TEMPLATES.map((template) => template.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("Blank is first in the list", () => {
		expect(RUNTIME_TEMPLATES[0].id).toBe("blank");
	});

	it("the default template is in the registry", () => {
		expect(runtimeTemplateById(RUNTIME_DEFAULT_TEMPLATE_ID)).not.toBeNull();
	});

	it("unknown ids do not fold to the default", () => {
		expect(runtimeTemplateById("no-such-template")).toBeNull();
	});

	/**
	 * Exactly one template is featured. If everything is featured, nothing is. The one featured
	 * template is the flagship.
	 */
	it("there is one recommendation, and it is the flagship", () => {
		expect(
			RUNTIME_TEMPLATES.filter((template) => template.featured === true),
		).toHaveLength(1);
		expect(featuredRuntimeTemplate()?.id).toBe("idol-debut");
	});

	/** The flagship sits right after Blank, so the two shown when the gallery opens are these two. */
	it("the flagship is second in the list", () => {
		expect(RUNTIME_TEMPLATES[1].id).toBe("idol-debut");
	});
});

describe("files", () => {
	it.each(every)("%s: the entry file is in the list", (_id, template) => {
		expect(template.files.map((file) => file.path)).toContain(template.entry);
	});

	it.each(every)("%s: paths do not repeat", (_id, template) => {
		const paths = template.files.map((file) => file.path);
		expect(new Set(paths).size).toBe(paths.length);
	});

	/**
	 * Each template must be a path the authoring store accepts. Otherwise a template could be
	 * selectable in the gallery yet fail to save, and the failure would only appear after the user
	 * presses `Use Template`.
	 */
	it.each(every)("%s: passes the authoring path rules", (_id, template) => {
		for (const file of template.files) {
			const checked = checkRuntimePath(file.path, "file");
			expect(checked, `${file.path}`).toMatchObject({ ok: true });
			if (checked.ok) expect(checked.path).toBe(file.path);
		}
	});

	it.each(every)("%s: extensions are in the source list", (_id, template) => {
		for (const file of template.files)
			expect(
				RUNTIME_SOURCE_EXTENSIONS.some((extension) =>
					file.path.endsWith(extension),
				),
				file.path,
			).toBe(true);
	});

	it.each(
		every,
	)("%s: file count and length are within the caps", (_id, template) => {
		expect(template.files.length).toBeLessThanOrEqual(
			RUNTIME_PROJECT_LIMITS.files,
		);
		for (const file of template.files)
			expect([...file.content].length).toBeLessThanOrEqual(
				RUNTIME_PROJECT_LIMITS.content,
			);
	});

	it.each(every)("%s: no empty files", (_id, template) => {
		for (const file of template.files)
			expect(file.content.trim().length, file.path).toBeGreaterThan(0);
	});

	/**
	 * Only Blank has a single file. If the others were folded into one file, the gallery would stop
	 * teaching what it exists to teach: splitting files and reusing components.
	 */
	it("everything but Blank is split into several files", () => {
		for (const template of RUNTIME_TEMPLATES)
			if (template.id === "blank") expect(template.files).toHaveLength(1);
			else expect(template.files.length).toBeGreaterThan(1);
	});
});

describe("sources use only the runtime vocabulary", () => {
	const sources = RUNTIME_TEMPLATES.flatMap((template) =>
		template.files.map((file) => ({
			name: `${template.id}:${file.path}`,
			content: file.content,
		})),
	);

	/**
	 * This runtime has no npm, DOM, or React Native. The compiler is the final authority, but this
	 * check runs first because its failure message names the file and the identifier.
	 */
	it.each(sources)("$name: only allowed imports", ({ content }) => {
		const specifiers = [...content.matchAll(/from\s+"([^"]+)"/g)].map(
			(match) => match[1],
		);
		for (const specifier of specifiers)
			expect(
				specifier === "@rowcat/runtime" ||
					specifier.startsWith("./") ||
					specifier.startsWith("../"),
				specifier,
			).toBe(true);
	});

	/**
	 * Relative imports omit the extension. The runtime looks for ./x as x.ts, then x.tsx. Writing
	 * ./x.ts makes it look for x.ts.ts and fail. This is the opposite of the repo rule.
	 */
	it.each(sources)("$name: relative imports carry no extension", ({
		content,
	}) => {
		const relatives = [...content.matchAll(/from\s+"(\.[^"]+)"/g)].map(
			(match) => match[1],
		);
		for (const specifier of relatives)
			expect(/\.tsx?$/.test(specifier), specifier).toBe(false);
	});

	/**
	 * Templates have no execution path either. Creators read templates first, so a template must not
	 * teach eval or new Function.
	 */
	it.each(sources)("$name: no execution channel", ({ content }) => {
		expect(content).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
	});

	/**
	 * Do not name APIs that do not exist yet (§7). A name in a template reads as 'coming soon' with no
	 * date. useStoryState, useGeneration, and usePersistentState were removed from the list once they
	 * became real. Keeping real names listed would make the claim that an API does not exist false,
	 * and a false check undermines the whole list.
	 */
	it.each(sources)("$name: calls no runtime API that does not exist", ({
		content,
	}) => {
		for (const absent of [
			"useNavigation",
			"useAudio",
			"useNetwork",
			"useAsset",
			"useSound",
			"useTimer",
		])
			expect(content).not.toContain(absent);
	});

	/**
	 * Asset references are not used yet either. asset() is in the contract, but the resolver currently
	 * returns null. A template that used it would suggest pictures are coming. The face slot is
	 * initials, and the seam is marked by a comment (Phase 8A fills it).
	 */
	it.each(sources)("$name: makes no asset references", ({ content }) => {
		expect(content).not.toMatch(/\basset\s*\(/);
		expect(content).not.toMatch(/<Image\b/);
	});

	/**
	 * Two templates use generation (§77). If browsing templates cost money, creators would fear the
	 * gallery. Messenger teaches free text, and the flagship places that technique inside a complete
	 * work. The other four are deterministic. Both generation templates work with the preview AI
	 * toggle off, and the first request is always one a person pressed.
	 */
	it("two templates use useGeneration", () => {
		const users = RUNTIME_TEMPLATES.filter((template) =>
			template.files.some((file) => file.content.includes("useGeneration")),
		).map((template) => template.id);
		expect(users.sort()).toEqual(["idol-debut", "messenger"]);
	});

	/**
	 * The AI never changes game state directly (§59, §60). The test guards against parsing model
	 * output for [UNLOCK:...] tokens or JSON.
	 */
	it.each(sources)("$name: does not parse the model's answer", ({
		content,
	}) => {
		for (const door of [/\[UNLOCK:/, /JSON\.parse\s*\(\s*result/])
			expect(content).not.toMatch(door);
	});

	/**
	 * Generation is never called from an effect on mount. The first request must always be triggered
	 * by a person (§64, §79).
	 */
	it.each(sources)("$name: does not call generation in an effect", ({
		content,
	}) => {
		const effects = [
			...content.matchAll(/useEffect\s*\(([\s\S]*?)\n\t*\}/g),
		].map((match) => match[1]);
		for (const body of effects) expect(body).not.toContain("generate(");
	});
});

describe("copy", () => {
	it.each(every)("%s: name and description are not empty", (_id, template) => {
		expect(template.name.trim().length).toBeGreaterThan(0);
		expect(template.description.trim().length).toBeGreaterThan(0);
		expect(template.demonstrates.length).toBeGreaterThan(0);
	});

	/**
	 * Cards must not promise what is not built yet, such as saying a feature is coming soon.
	 * The same rule applies to the studio introduction.
	 */
	it("does not say coming soon", () => {
		const copy = RUNTIME_TEMPLATES.flatMap((template) => [
			template.name,
			template.description,
			...template.demonstrates,
		]).join("\n");
		for (const promise of [
			"coming soon",
			"launch",
			"planned",
			"beta",
			"experimental",
			"in preparation",
		])
			expect(copy).not.toContain(promise);
	});
});

describe("instantiation", () => {
	it("is deterministic: the same template always gives the same value", () => {
		for (const template of RUNTIME_TEMPLATES)
			expect(instantiateRuntimeTemplate(template)).toEqual(
				instantiateRuntimeTemplate(template),
			);
	});

	it("comes out in path order", () => {
		for (const template of RUNTIME_TEMPLATES) {
			const paths = instantiateRuntimeTemplate(template).files.map(
				(file) => file.path,
			);
			expect(paths).toEqual([...paths].sort());
		}
	});

	it("mints no record ids", () => {
		for (const template of RUNTIME_TEMPLATES)
			for (const file of instantiateRuntimeTemplate(template).files)
				expect(Object.keys(file).sort()).toEqual(["content", "path"]);
	});

	/**
	 * Editing a template's source must not edit projects already created from it (§49). This is
	 * guaranteed structurally: created values hold no reference back to the template.
	 */
	it("the built value does not trace back to the template", () => {
		const plan = instantiateRuntimeTemplate(RUNTIME_TEMPLATES[1]);
		expect(Object.keys(plan).sort()).toEqual(["entry", "files"]);
	});

	it("the default starter project equals the default template", () => {
		const template = runtimeTemplateById(RUNTIME_DEFAULT_TEMPLATE_ID);
		expect(defaultRuntimeStarter()).toEqual(
			instantiateRuntimeTemplate(template as never),
		);
	});

	it("the default entry point is RUNTIME_ENTRY_PATH", () => {
		expect(defaultRuntimeStarter().entry).toBe(RUNTIME_ENTRY_PATH);
	});
});

describe("categories", () => {
	it("does not draw empty categories", () => {
		for (const category of runtimeTemplateCategories())
			expect(runtimeTemplatesIn(category).length).toBeGreaterThan(0);
	});

	it("filtering does not change the order", () => {
		for (const category of runtimeTemplateCategories()) {
			const filtered = runtimeTemplatesIn(category).map((t) => t.id);
			const expected = RUNTIME_TEMPLATES.filter(
				(t) => t.category === category,
			).map((t) => t.id);
			expect(filtered).toEqual(expected);
		}
	});

	it("null is everything", () => {
		expect(runtimeTemplatesIn(null)).toEqual(RUNTIME_TEMPLATES);
	});
});

/**
 * The flagship is the structure of one complete work. The four focused templates have three to six
 * files. The flagship uses every technique in one work, so it must be a real project split into
 * folders. Folded into one file, it could not teach how to split a runtime project. Compile and run
 * are checked by runtime-template-flagship.test.ts.
 */
describe("flagship", () => {
	const flagship = runtimeTemplateById("idol-debut");
	if (flagship === null) throw new Error("no flagship template");
	const paths = flagship.files.map((file) => file.path);

	it("is a project split into several folders", () => {
		expect(paths.length).toBeGreaterThanOrEqual(30);
		for (const folder of [
			"src/components/",
			"src/story/",
			"src/screens/",
			"src/systems/",
		])
			expect(
				paths.some((path) => path.startsWith(folder)),
				folder,
			).toBe(true);
	});

	it("the entry file is the authoring layer's default entry point", () => {
		expect(flagship.entry).toBe(RUNTIME_ENTRY_PATH);
	});

	/**
	 * Uses all three lifetimes. Half of what this template teaches is the distinction between them.
	 */
	it("uses all three lifetimes", () => {
		const source = flagship.files.map((file) => file.content).join("\n");
		expect(source).toContain("useState(");
		expect(source).toContain("useStoryState(");
		expect(source).toContain("usePersistentState(");
		expect(source).toContain("defineStoryState<");
		expect(source).toContain("definePersistentState<");
	});

	/**
	 * One function decides the ending. If the conditions were scattered across screens, different
	 * screens could show different endings.
	 */
	/**
	 * The weekly settlement lives in one file, the only place in this work that moves the numbers. If
	 * a screen touched stats directly, the scheduling screen's preview could diverge from the actual
	 * result, and players would see that as a lie.
	 */
	it("the weekly settlement is in one file", () => {
		const owners = flagship.files.filter((file) =>
			file.content.includes("export function settleWeek"),
		);
		expect(owners.map((file) => file.path)).toEqual([
			"src/systems/schedule.ts",
		]);
	});

	it("the ending decision is in one file", () => {
		const owners = flagship.files.filter((file) =>
			file.content.includes("export function resolveEnding"),
		);
		expect(owners.map((file) => file.path)).toEqual(["src/story/endings.ts"]);
	});

	/**
	 * The judgment for locked choices lives in the progression rule (choiceAvailable), not the screen.
	 * On the screen alone, a disabled button is a courtesy, not enforcement: an event could pass a
	 * locked choice through.
	 */
	it("the choice lock decision is in the progression rules", () => {
		const owners = flagship.files.filter((file) =>
			file.content.includes("export function choiceAvailable"),
		);
		expect(owners.map((file) => file.path)).toEqual([
			"src/systems/progression.ts",
		]);
	});

	/**
	 * Do not imitate answers. Scripts, timers, or random responses would make the AI appear to answer
	 * when generation is off in preview, and the template's claim would become false.
	 */
	it("does not imitate answers", () => {
		const source = flagship.files.map((file) => file.content).join("\n");
		expect(source).not.toMatch(/setTimeout|setInterval|Math\.random|Date\.now/);
	});

	/**
	 * The evening topic is decided by the sentence the player types. Preset question buttons would
	 * turn the screen back into a list and make the AI secondary. The judgment belongs in rules, on
	 * the same axis as choiceAvailable.
	 */
	it("the evening's topic decision is in the rules", () => {
		const owners = flagship.files.filter((file) =>
			file.content.includes("export function matchTopic"),
		);
		expect(owners.map((file) => file.path)).toEqual(["src/systems/topics.ts"]);
	});

	/** The evening screen draws no choices. The only entry point is one input line. */
	it("the evening screen draws no choices", () => {
		const evening = flagship.files.find(
			(file) => file.path === "src/screens/evening.tsx",
		);
		expect(evening, "src/screens/evening.tsx").toBeDefined();
		expect(evening?.content).not.toContain("ChoiceList");
		expect(evening?.content).toContain("Composer");
	});

	it("player copy has no developer vocabulary", () => {
		for (const wrong of ["hook", "hook demo", "API", "test"])
			expect(flagship.description).not.toContain(wrong);
	});
});
