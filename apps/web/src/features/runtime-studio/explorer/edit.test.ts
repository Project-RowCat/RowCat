import type { DraftRuntimeFile } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import { runtimeEditCheck, runtimeEditIssue, runtimeEditPath } from "./edit.ts";

/**
 * Checks the rule that joins parent and name, not path syntax. Path syntax belongs to
 * @rowcat/authoring, which has its own tests. Repeating it here would make two places break when a
 * limit changes. A mistake here fails silently. Without the parent, a file created inside a folder
 * lands at the root and the user cannot find it. If renaming does not reattach the parent, renaming
 * a file moves it to the root.
 */

const file = (id: string, path: string): DraftRuntimeFile =>
	({ id, path }) as DraftRuntimeFile;

const FILES = [file("f1", "src/main.tsx"), file("f2", "src/ui/panel.tsx")];

describe("path assembly", () => {
	it("inside a folder the parent is prefixed", () => {
		expect(runtimeEditPath("src/ui", "panel.tsx")).toBe("src/ui/panel.tsx");
	});

	it("at the root it's the name as is, with no leading `/`", () => {
		expect(runtimeEditPath("", "main.tsx")).toBe("main.tsx");
	});

	it("surrounding whitespace is not part of the name", () => {
		expect(runtimeEditPath("src", "  panel.tsx  ")).toBe("src/panel.tsx");
	});
});

describe("create decision", () => {
	it("creating inside a folder gives a path under it", () => {
		const check = runtimeEditCheck(
			{ kind: "create-file", parent: "src/ui", value: "card.tsx" },
			FILES,
		);
		expect(check).toEqual({ ok: true, path: "src/ui/card.tsx" });
	});

	it("rejects when the same path exists", () => {
		const check = runtimeEditCheck(
			{ kind: "create-file", parent: "src", value: "main.tsx" },
			FILES,
		);
		expect(check?.ok).toBe(false);
	});

	/**
	 * Extensions that are not authoring sources are rejected, because they are not project files. The
	 * rule itself belongs to the authoring layer.
	 */
	it("rejects an unaccepted extension", () => {
		const check = runtimeEditCheck(
			{ kind: "create-file", parent: "src", value: "notes.md" },
			FILES,
		);
		expect(check?.ok).toBe(false);
	});

	/** Folders have no extension requirement. All other rules must match files. */
	it("folders can be created without an extension", () => {
		expect(
			runtimeEditCheck(
				{ kind: "create-folder", parent: "src", value: "hooks" },
				FILES,
			),
		).toEqual({ ok: true, path: "src/hooks" });
	});

	it("a subpath typed in the name field resolves under the parent", () => {
		expect(
			runtimeEditCheck(
				{ kind: "create-file", parent: "src", value: "ui/card.tsx" },
				FILES,
			),
		).toEqual({ ok: true, path: "src/ui/card.tsx" });
	});

	/**
	 * A path that points outside the project is not normalized away. Joining it to the parent folder
	 * does not make `..` pass.
	 */
	it("rejects `..`", () => {
		const check = runtimeEditCheck(
			{ kind: "create-file", parent: "src", value: "../escape.tsx" },
			FILES,
		);
		expect(check?.ok).toBe(false);
	});
});

describe("rename decision", () => {
	it("only the name changes, keeping the parent", () => {
		expect(
			runtimeEditCheck(
				{
					kind: "rename-file",
					fileId: "f2",
					parent: "src/ui",
					value: "card.tsx",
				},
				FILES,
			),
		).toEqual({ ok: true, path: "src/ui/card.tsx" });
	});

	/**
	 * A file is not a duplicate of itself. Renames that change only the case are common, and comparing
	 * the path with itself would make such a rename impossible.
	 */
	it("its own path is not a duplicate", () => {
		expect(
			runtimeEditCheck(
				{
					kind: "rename-file",
					fileId: "f2",
					parent: "src/ui",
					value: "Panel.tsx",
				},
				FILES,
			),
		).toEqual({ ok: true, path: "src/ui/Panel.tsx" });
	});

	it("rejects overlap with another's path", () => {
		const check = runtimeEditCheck(
			{ kind: "rename-file", fileId: "f2", parent: "src", value: "main.tsx" },
			FILES,
		);
		expect(check?.ok).toBe(false);
	});
});

describe("the sentence beside the input", () => {
	it("no sentence for an empty value", () => {
		expect(
			runtimeEditIssue(
				{ kind: "create-file", parent: "src", value: "" },
				FILES,
			),
		).toBeNull();
		expect(
			runtimeEditIssue(
				{ kind: "create-file", parent: "src", value: "   " },
				FILES,
			),
		).toBeNull();
	});

	it("no sentence for a passing value either", () => {
		expect(
			runtimeEditIssue(
				{ kind: "create-file", parent: "src", value: "card.tsx" },
				FILES,
			),
		).toBeNull();
	});

	it("carries a rejected value's reason as is", () => {
		expect(
			runtimeEditIssue(
				{ kind: "create-file", parent: "src", value: "main.tsx" },
				FILES,
			),
		).toBe("A file with the same path already exists.");
	});

	it("nothing to ask when no edit is open", () => {
		expect(runtimeEditCheck(null, FILES)).toBeNull();
		expect(runtimeEditIssue(null, FILES)).toBeNull();
	});
});
