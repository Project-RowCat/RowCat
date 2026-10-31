import { describe, expect, it } from "vitest";
import {
	buildRuntimeTree,
	checkRuntimeFileContent,
	checkRuntimePath,
	createDraftRuntimeFileRecord,
	createDraftRuntimeProjectRecord,
	type DraftRuntimeFile,
	isRuntimeEnabled,
	isRuntimeSourcePath,
	normalizeRuntimePath,
	planRuntimeFileCreate,
	planRuntimeFileRename,
	RUNTIME_ENTRY_PATH,
	RUNTIME_PROJECT_LIMITS,
	runtimeFolderOf,
	runtimeFolderPaths,
	runtimeProjectIdFor,
	sortRuntimeFiles,
} from "./runtime.ts";

/**
 * Pure rules for runtime projects. They guarantee three things:
 * - A project cannot point outside itself.
 * - The same path cannot appear twice.
 * - The same list is always drawn in the same order. All three must be fixed before the execution
 *   engine exists. Narrowing them later would break projects already stored.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const file = (id: string, path: string, content = ""): DraftRuntimeFile =>
	createDraftRuntimeFileRecord(
		{ draftId: "draft-1", path, content },
		{ id, now: NOW, rev: REV },
	);

describe("path normalization", () => {
	it("folds several ways of writing the same path into one", () => {
		for (const input of [
			"src/main.tsx",
			" src/main.tsx ",
			"./src/main.tsx",
			"/src/main.tsx",
			"src//main.tsx",
			"src\\main.tsx",
			"src/./main.tsx",
		])
			expect(normalizeRuntimePath(input)).toBe("src/main.tsx");
	});

	it("keeps `..` unfolded: what follows must refuse it", () => {
		expect(normalizeRuntimePath("src/../secret.ts")).toBe("src/../secret.ts");
	});
});

describe("path decisions", () => {
	it("returns the normalized path", () => {
		const checked = checkRuntimePath("/src//components/phone.tsx");
		expect(checked).toEqual({ ok: true, path: "src/components/phone.tsx" });
	});

	it("refuses paths pointing outside the project", () => {
		for (const input of ["../a.ts", "src/../../a.ts", ".."])
			expect(checkRuntimePath(input)).toMatchObject({
				ok: false,
				code: "traversal",
			});
	});

	it("absolute paths pass after folding to the root", () => {
		/**
		 * A leading `/` is folded, not rejected. Users write the project's src, not the filesystem root.
		 * Rejecting it would force them to delete the first character of every pasted path.
		 */
		expect(checkRuntimePath("/src/main.tsx")).toEqual({
			ok: true,
			path: "src/main.tsx",
		});
	});

	it("refuses characters that are not allowed", () => {
		for (const input of [
			"src/main file.ts",
			"src/\ud55c\uae00.ts",
			"src/a:b.ts",
		])
			expect(checkRuntimePath(input)).toMatchObject({
				ok: false,
				code: "invalid_character",
			});
	});

	it("refuses an empty path", () => {
		expect(checkRuntimePath("   ")).toMatchObject({ ok: false, code: "empty" });
	});

	it("refuses files without an extension or with another one", () => {
		for (const input of ["src/main", "src/data.json", "src/main.js"])
			expect(checkRuntimePath(input)).toMatchObject({
				ok: false,
				code: "unsupported_extension",
			});
	});

	it("does not treat an extension-only name as a file", () => {
		expect(checkRuntimePath(".ts")).toMatchObject({
			ok: false,
			code: "unsupported_extension",
		});
	});

	it("folders require no extension", () => {
		expect(checkRuntimePath("src/components", "folder")).toEqual({
			ok: true,
			path: "src/components",
		});
	});

	it("the other rules apply to folders too", () => {
		expect(checkRuntimePath("../x", "folder")).toMatchObject({
			ok: false,
			code: "traversal",
		});
	});

	/**
	 * The compiler's virtual file system keeps its own files under these two top-level folders, so a
	 * creator file there would be read as the compiler's (runtime-compiler paths.ts).
	 */
	it("refuses the folders the compiler reserves, for files and folders alike", () => {
		for (const input of [
			"node_modules/x.ts",
			".rowcat/entry-check.ts",
			"./node_modules/a/b.tsx",
		])
			expect(checkRuntimePath(input)).toMatchObject({
				ok: false,
				code: "reserved",
			});
		for (const input of ["node_modules", ".rowcat", ".rowcat/sub"])
			expect(checkRuntimePath(input, "folder")).toMatchObject({
				ok: false,
				code: "reserved",
			});
	});

	it("only the first segment is reserved", () => {
		for (const input of [
			"src/node_modules/x.ts",
			"src/.rowcat/x.ts",
			"Node_Modules/x.ts",
			"rowcat/x.ts",
		])
			expect(checkRuntimePath(input)).toEqual({ ok: true, path: input });
	});

	it("enforces depth and length caps", () => {
		const deep = `${Array.from({ length: RUNTIME_PROJECT_LIMITS.depth }, (_, i) => `d${i}`).join("/")}/a.ts`;
		expect(checkRuntimePath(deep)).toMatchObject({
			ok: false,
			code: "too_deep",
		});

		const longSegment = `src/${"a".repeat(RUNTIME_PROJECT_LIMITS.segment + 1)}.ts`;
		expect(checkRuntimePath(longSegment)).toMatchObject({
			ok: false,
			code: "segment_too_long",
		});
	});
});

describe("file plans", () => {
	const files = [file("f1", "src/main.tsx"), file("f2", "src/state.ts")];

	it("refuses duplicate paths, comparing after normalization", () => {
		expect(planRuntimeFileCreate(files, "./src/state.ts")).toMatchObject({
			ok: false,
			code: "duplicate",
		});
	});

	it("different case is a different path", () => {
		expect(planRuntimeFileCreate(files, "src/State.ts")).toEqual({
			ok: true,
			path: "src/State.ts",
		});
	});

	it("enforces the file count cap", () => {
		const full = Array.from({ length: RUNTIME_PROJECT_LIMITS.files }, (_, i) =>
			file(`f${i}`, `src/f${i}.ts`),
		);
		expect(planRuntimeFileCreate(full, "src/one-more.ts")).toMatchObject({
			ok: false,
			code: "too_many",
		});
	});

	it("in a rename the file itself is not a duplicate", () => {
		expect(planRuntimeFileRename(files, "f2", "src/state.ts")).toEqual({
			ok: true,
			path: "src/state.ts",
		});
		expect(planRuntimeFileRename(files, "f2", "src/main.tsx")).toMatchObject({
			ok: false,
			code: "duplicate",
		});
	});

	it("content length counts code points", () => {
		const emoji = "🐱".repeat(RUNTIME_PROJECT_LIMITS.content);
		expect(checkRuntimeFileContent(emoji)).toMatchObject({ ok: true });
		expect(checkRuntimeFileContent(`${emoji}x`)).toMatchObject({
			ok: false,
			code: "content_too_long",
		});
	});
});

describe("records", () => {
	it("project identity derives from the draft and differs from the draft id", () => {
		const id = runtimeProjectIdFor("draft-1");
		expect(id).toBe("authoring-runtime:draft-1");
		expect(id).not.toBe("draft-1");
		expect(runtimeProjectIdFor("draft-1")).toBe(runtimeProjectIdFor("draft-1"));
	});

	it("a new project is born on, pointing at the entry file", () => {
		const project = createDraftRuntimeProjectRecord(
			{ draftId: "draft-1" },
			{ now: NOW, rev: REV },
		);
		expect(project).toMatchObject({
			id: "authoring-runtime:draft-1",
			draftId: "draft-1",
			enabled: true,
			entry: RUNTIME_ENTRY_PATH,
			deletedAt: null,
			dirty: 1,
			serverVersion: 0,
		});
	});

	it("the record answers whether it is on: absent means not on", () => {
		expect(isRuntimeEnabled(null)).toBe(false);
		expect(isRuntimeEnabled(undefined)).toBe(false);
		expect(
			isRuntimeEnabled(
				createDraftRuntimeProjectRecord(
					{ draftId: "d", enabled: false },
					{ now: NOW, rev: REV },
				),
			),
		).toBe(false);
	});

	/**
	 * The starter-file check lives in the template registry's test
	 * (runtime-templates/runtime-templates.test.ts). When the starter project was the only one, this
	 * file knew it. Now the creator picks among templates.
	 */
});

describe("values derived from paths", () => {
	it("the source decision is one extension list", () => {
		expect(isRuntimeSourcePath("a.ts")).toBe(true);
		expect(isRuntimeSourcePath("a.tsx")).toBe(true);
		expect(isRuntimeSourcePath("a.json")).toBe(false);
	});

	it("a root file's folder is an empty string", () => {
		expect(runtimeFolderOf("main.tsx")).toBe("");
		expect(runtimeFolderOf("src/components/phone.tsx")).toBe("src/components");
	});
});

describe("sorting", () => {
	it("ascending path with id on ties: reads no locale", () => {
		const files = [
			file("b", "src/b.ts"),
			file("a", "src/a.ts"),
			file("z", "lib/z.ts"),
		];
		expect(sortRuntimeFiles(files).map((f) => f.path)).toEqual([
			"lib/z.ts",
			"src/a.ts",
			"src/b.ts",
		]);
	});

	it("does not change the input", () => {
		const files = [file("b", "src/b.ts"), file("a", "src/a.ts")];
		sortRuntimeFiles(files);
		expect(files.map((f) => f.id)).toEqual(["b", "a"]);
	});
});

describe("tree", () => {
	const files = [
		file("f1", "src/main.tsx"),
		file("f2", "src/components/phone.tsx"),
		file("f3", "readme.ts"),
		file("f4", "src/state.ts"),
	];

	it("derives folders from paths and draws folders first", () => {
		const tree = buildRuntimeTree(files);
		expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
			"folder:src",
			"file:readme.ts",
		]);

		const src = tree[0];
		if (src.kind !== "folder") throw new Error("src must be a folder");
		expect(src.children.map((node) => `${node.kind}:${node.name}`)).toEqual([
			"folder:components",
			"file:main.tsx",
			"file:state.ts",
		]);
	});

	it("a folder without files shows only when handed in: it is not a record", () => {
		const withoutFolder = buildRuntimeTree(files);
		expect(runtimeFolderPaths(withoutFolder)).not.toContain("src/hooks");

		const withFolder = buildRuntimeTree(files, ["src/hooks"]);
		expect(runtimeFolderPaths(withFolder)).toContain("src/hooks");
	});

	it("does not create the same folder twice", () => {
		const tree = buildRuntimeTree(files, ["src", "src/components"]);
		expect(tree.filter((node) => node.name === "src")).toHaveLength(1);
	});

	it("an empty list is an empty tree", () => {
		expect(buildRuntimeTree([])).toEqual([]);
	});
});
