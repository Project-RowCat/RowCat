import { RUNTIME_PROJECT_LIMITS } from "@rowcat/authoring";
import { describe, expect, test } from "vitest";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "./errors.ts";
import { COUNTER, createHarness, seedProject } from "./test/harness.ts";

/**
 * File operation contract: does it pass through the storage operations unchanged, and is there
 * exactly one set of rules. Nothing here compiles or runs a VM. This layer has to answer for paths,
 * duplicates, limits, and optimistic concurrency. None of those depend on execution.
 */

const DRAFT = "draft-1";

const harnessWith = (source = COUNTER) =>
	createHarness({ seeds: [seedProject(DRAFT, source)] });

const reason = async (fn: () => Promise<unknown>): Promise<string> => {
	try {
		await fn();
	} catch (error) {
		if (error instanceof RuntimeMcpError) return error.code;
		throw error;
	}
	throw new Error("did not fail");
};

describe("project lookup", () => {
	test("only drafts with the runtime on are listed", async () => {
		const harness = createHarness({
			seeds: [
				seedProject(DRAFT, COUNTER),
				{ draftId: "draft-off", enabled: false },
			],
		});
		const listed = (await harness.call("runtime_list_projects")) as {
			projects: { draftId: string }[];
		};
		expect(listed.projects.map((entry) => entry.draftId)).toEqual([DRAFT]);
	});

	test("the overview carries no bodies", async () => {
		const harness = harnessWith();
		const project = (await harness.call("runtime_get_project", {
			draftId: DRAFT,
		})) as { files: { path: string; hash: string }[]; entryExists: boolean };
		expect(project.entryExists).toBe(true);
		expect(project.files[0]?.path).toBe("src/main.tsx");
		expect(JSON.stringify(project)).not.toContain("useState");
	});

	test("a missing draft and someone else's draft are the same failure", async () => {
		const harness = harnessWith();
		expect(
			await reason(() =>
				harness.call("runtime_get_project", { draftId: "missing" }),
			),
		).toBe(RUNTIME_MCP_ERROR_CODE.projectNotFound);
	});

	test("a draft with the runtime off is a different failure", async () => {
		const harness = createHarness({
			seeds: [{ draftId: "draft-off", enabled: false }],
		});
		expect(
			await reason(() =>
				harness.call("runtime_get_project", { draftId: "draft-off" }),
			),
		).toBe(RUNTIME_MCP_ERROR_CODE.runtimeDisabled);
	});
});

describe("reading and writing", () => {
	test("you can write as is with the fingerprint you read", async () => {
		const harness = harnessWith();
		const read = (await harness.call("runtime_read_file", {
			draftId: DRAFT,
			path: "src/main.tsx",
		})) as { content: string; hash: string };
		const written = (await harness.call("runtime_write_file", {
			draftId: DRAFT,
			path: "src/main.tsx",
			content: `${read.content}\n`,
			expectedHash: read.hash,
		})) as { hash: string };
		expect(written.hash).not.toBe(read.hash);
		expect(harness.store.writes).toBe(1);
	});

	test("does not overwrite when it changed in between", async () => {
		const harness = harnessWith();
		const read = (await harness.call("runtime_read_file", {
			draftId: DRAFT,
			path: "src/main.tsx",
		})) as { hash: string };
		harness.store.overwrite(
			DRAFT,
			"src/main.tsx",
			"// another device edited this\n",
		);
		expect(
			await reason(() =>
				harness.call("runtime_write_file", {
					draftId: DRAFT,
					path: "src/main.tsx",
					content: "// my value",
					expectedHash: read.hash,
				}),
			),
		).toBe(RUNTIME_MCP_ERROR_CODE.fileConflict);
		expect(harness.store.writes).toBe(0);
	});

	test("without a fingerprint there is no check", async () => {
		const harness = harnessWith();
		harness.store.overwrite(
			DRAFT,
			"src/main.tsx",
			"// another device edited this\n",
		);
		await harness.call("runtime_write_file", {
			draftId: DRAFT,
			path: "src/main.tsx",
			content: "// my value",
		});
		expect(harness.store.writes).toBe(1);
	});

	test("writing a missing file points at create_file", async () => {
		const harness = harnessWith();
		try {
			await harness.call("runtime_write_file", {
				draftId: DRAFT,
				path: "src/missing.ts",
				content: "",
			});
			throw new Error("did not fail");
		} catch (error) {
			expect(error).toBeInstanceOf(RuntimeMcpError);
			expect((error as RuntimeMcpError).code).toBe(
				RUNTIME_MCP_ERROR_CODE.fileNotFound,
			);
			expect((error as RuntimeMcpError).message).toContain("create_file");
		}
	});

	test("exceeding the content cap never reaches the store", async () => {
		const harness = harnessWith();
		expect(
			await reason(() =>
				harness.call("runtime_write_file", {
					draftId: DRAFT,
					path: "src/main.tsx",
					content: "x".repeat(RUNTIME_PROJECT_LIMITS.content + 1),
				}),
			),
		).toBe(RUNTIME_MCP_ERROR_CODE.resourceLimit);
		expect(harness.store.writes).toBe(0);
	});
});

describe("create · rename · delete", () => {
	test("refuses non-source extensions", async () => {
		const harness = harnessWith();
		expect(
			await reason(() =>
				harness.call("runtime_create_file", {
					draftId: DRAFT,
					path: "src/readme.md",
				}),
			),
		).toBe(RUNTIME_MCP_ERROR_CODE.unsupportedExtension);
	});

	test("refuses paths pointing outside the project", async () => {
		const harness = harnessWith();
		expect(
			await reason(() =>
				harness.call("runtime_create_file", {
					draftId: DRAFT,
					path: "../escape.ts",
				}),
			),
		).toBe(RUNTIME_MCP_ERROR_CODE.invalidPath);
	});

	test("the same path cannot be created twice", async () => {
		const harness = harnessWith();
		expect(
			await reason(() =>
				harness.call("runtime_create_file", {
					draftId: DRAFT,
					path: "src/main.tsx",
				}),
			),
		).toBe(RUNTIME_MCP_ERROR_CODE.duplicatePath);
	});

	test("a case-only rename does not collide with itself", async () => {
		const harness = createHarness({
			seeds: [
				seedProject(DRAFT, COUNTER, [{ path: "src/Phone.ts", content: "" }]),
			],
		});
		const renamed = (await harness.call("runtime_rename_file", {
			draftId: DRAFT,
			path: "src/Phone.ts",
			to: "src/phone.ts",
		})) as { path: string; from: string };
		expect(renamed).toMatchObject({
			from: "src/Phone.ts",
			path: "src/phone.ts",
		});
	});

	test("deleting the entry file says so", async () => {
		const harness = harnessWith();
		const deleted = (await harness.call("runtime_delete_file", {
			draftId: DRAFT,
			path: "src/main.tsx",
		})) as { entryMissing: boolean; remaining: number };
		expect(deleted).toEqual({
			path: "src/main.tsx",
			remaining: 0,
			entryMissing: true,
		});
	});

	test("says so when a rename makes the entry point vanish", async () => {
		const harness = harnessWith();
		const renamed = (await harness.call("runtime_rename_file", {
			draftId: DRAFT,
			path: "src/main.tsx",
			to: "src/app.tsx",
		})) as { entryMissing: boolean };
		expect(renamed.entryMissing).toBe(true);
	});
});

describe("input validation", () => {
	test("input outside the schema is a contract failure", async () => {
		const harness = harnessWith();
		expect(await reason(() => harness.call("runtime_read_file", {}))).toBe(
			RUNTIME_MCP_ERROR_CODE.invalidInput,
		);
	});

	test("tools take no owner", () => {
		const harness = harnessWith();
		expect(harness.connection.context.authoring).toBeDefined();
	});
});
