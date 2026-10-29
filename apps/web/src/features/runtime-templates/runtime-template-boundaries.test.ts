import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_TEMPLATE_IDS, RUNTIME_TEMPLATES } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import {
	RUNTIME_TEMPLATE_GALLERY,
	runtimeTemplateCategoryLabel,
	runtimeTemplateComplexityLabel,
} from "./runtime-template-copy.ts";

/**
 * Statically checks what the gallery must not do. The folder makes two promises:
 * - Drawing a card does not run creator code. The tempting shortcut is 'the preview exists, so
 *   run the thumbnail too'. That would load the compiler and the WASM VM every time the gallery
 *   opens, download several MB to someone who has picked nothing, and show five VM sessions on one
 *   screen (§16).
 * - Template source does not live in components. If starter-file bodies returned as strings
 *   inside TSX, it would be impossible to say whether the registry or the screen is the source, and
 *   that copy would pass neither the registry tests nor compile verification (§10).
 *
 * Only executed code is scanned; test files are excluded. The compile and mount checks
 * (`runtime-template-runtime.test.ts`) take the compiler and VM as values, which is correct: that
 * file verifies the assembly point, not the screen.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * Strips comments before scanning. A header comment that describes a forbidden name would otherwise
 * trip the scan, and only executed code should be scanned.
 */
const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function* sources(root: string): Generator<string> {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* sources(path);
			continue;
		}
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
		yield path;
	}
}

const files = () =>
	[...sources(HERE)].map((path) => ({
		name: path.slice(HERE.length),
		source: stripComments(readFileSync(path, "utf8")),
	}));

const FORBIDDEN: { door: RegExp; why: string }[] = [
	{
		door: /@rowcat\/runtime-host/,
		why: "Do not stand up a VM to draw one card. Execution belongs to the preview worker; the gallery only draws pictures.",
	},
	{
		door: /@rowcat\/runtime-compiler/,
		why: "Do not compile for a thumbnail: opening the gallery would load the whole lib.es2022 family.",
	},
	{
		door: /@rowcat\/runtime-renderer-web/,
		why: "Drawing a thumbnail with the runtime renderer makes that picture require execution (§17).",
	},
	{
		door: /\beval\s*\(|new\s+Function\s*\(/,
		why: "A path that runs creator code on this origin. What this folder handles is strings not yet saved anywhere.",
	},
	{
		door: /<iframe|createObjectURL|new\s+Worker\s*\(/,
		why: "The same axis: an execution path that is easy to believe is isolated.",
	},
	{
		door: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
		why: "Everything this folder draws is text.",
	},
];

describe("no execution", () => {
	it.each(FORBIDDEN)("$door is absent from this folder", ({ door, why }) => {
		const offenders = files()
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});
});

describe("template source has one original", () => {
	/**
	 * There is exactly one way a starter file's body returns to a component: someone decides 'this
	 * template only, slightly differently' should be handled here. That string would pass neither the
	 * registry's tests nor compile verification, so non-compiling code would reach the creator
	 * silently.
	 */
	it("does not build runtime source in this folder", () => {
		const offenders = files()
			.filter((file) =>
				/from\s+"@rowcat\/runtime"|export\s+default\s+function\s+App/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(
			offenders,
			"template source belongs to the @rowcat/authoring registry",
		).toEqual([]);
	});

	it("does not rewrite the registry in this folder", () => {
		const offenders = files()
			.filter((file) =>
				/"(blank|visual-novel|messenger)"\s*:/.test(file.source),
			)
			/**
			 * The preview table maps id to picture, so it is the exception. It points to a component, not to
			 * source.
			 */
			.filter((file) => file.name !== "runtime-template-preview.tsx")
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});

describe("previews", () => {
	/**
	 * The picture is a `Record<RuntimeTemplateId, …>`, so adding a template to the registry breaks
	 * compilation. This test checks by value, once more, that the table covers all of them.
	 */
	it("has a picture for every template", () => {
		const table = readFileSync(
			join(HERE, "runtime-template-preview.tsx"),
			"utf8",
		);
		for (const id of RUNTIME_TEMPLATE_IDS)
			expect(table, `no picture for ${id}`).toContain(id);
	});

	/**
	 * No screenshots. They do not follow the theme, and they are not retaken when a template is
	 * edited.
	 */
	it("brings in no image assets", () => {
		const offenders = files()
			.filter((file) => /\.(png|jpg|jpeg|webp|gif|svg)("|')/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});

describe("copy", () => {
	it("has a label for every category and difficulty", () => {
		for (const template of RUNTIME_TEMPLATES) {
			expect(runtimeTemplateCategoryLabel(template.category)).toBeTruthy();
			expect(runtimeTemplateComplexityLabel(template.complexity)).toBeTruthy();
		}
	});

	/**
	 * The copy must keep the fact that a template is not a kind of work. Read as 'what kind of work
	 * will you make?', the creator believes the choice will lock them in later.
	 */
	it("does not ask the creator to choose a kind of work", () => {
		const copy = [
			RUNTIME_TEMPLATE_GALLERY.title,
			RUNTIME_TEMPLATE_GALLERY.description,
		].join("\n");
		for (const wrong of ["kind of work", "type of work", "choose a genre"])
			expect(copy).not.toContain(wrong);
		/** Says instead that the work can be edited: every file created belongs to the creator. */
		expect(RUNTIME_TEMPLATE_GALLERY.description).toContain("can be edited");
	});

	it("makes no promise it cannot keep", () => {
		const copy = [
			RUNTIME_TEMPLATE_GALLERY.title,
			RUNTIME_TEMPLATE_GALLERY.description,
			RUNTIME_TEMPLATE_GALLERY.creating,
			RUNTIME_TEMPLATE_GALLERY.failed,
			...RUNTIME_TEMPLATES.map((template) =>
				runtimeTemplateCategoryLabel(template.category),
			),
			...RUNTIME_TEMPLATES.map((template) =>
				runtimeTemplateComplexityLabel(template.complexity),
			),
		].join("\n");
		for (const promise of ["soon", "coming", "launch", "beta", "experimental"])
			expect(copy).not.toContain(promise);
	});
});

describe("has one save path", () => {
	/**
	 * If a per-file creation loop appears in this folder, a half-committed template becomes
	 * representable (§27). Atomicity belongs to the repository transaction; the only thing called here
	 * is `enableRuntime`.
	 */
	it("does not create files one by one", () => {
		const offenders = files()
			.filter((file) => /createRuntimeFile|updateRuntimeFile/.test(file.source))
			.map((file) => file.name);
		expect(
			offenders,
			"template creation is one enableRuntime call; a loop produces partial creation",
		).toEqual([]);
	});

	it("calls the store from one place", () => {
		const offenders = files()
			.filter((file) => /enableRuntime|setRuntimeEnabled/.test(file.source))
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual(["use-create-runtime-project.ts"]);
	});
});
