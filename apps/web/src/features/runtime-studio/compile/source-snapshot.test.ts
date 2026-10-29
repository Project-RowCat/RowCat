import { compiled } from "@rowcat/runtime-host/test/fixtures";
import { describe, expect, it } from "vitest";
import { runtimeCompileSignature } from "./signature.ts";
import {
	currentRuntimeProjectSnapshot,
	emptyRuntimeEditedSources,
	type RuntimeEditedSources,
	type RuntimeSourceRecord,
	reconcileEditedSources,
	startEditingSource,
} from "./source-snapshot.ts";

/**
 * Checks that the preview runs the editor's current code. The defect is a race between the 500 ms
 * autosave timer and a click, which rendering cannot reproduce. So the snapshot rule lives in a
 * pure module and is checked as values. The first fixture: the record has the old code, the editor
 * has the new code, and the save has not happened yet.
 */

const IMPORT = `import { Text } from "@rowcat/runtime";`;
const OLD = `${IMPORT}\nexport default function App() {\n\treturn <Text>OLD</Text>;\n}\n`;
const NEW = `${IMPORT}\nexport default function App() {\n\treturn <Text>NEW</Text>;\n}\n`;

const record = (
	id: string,
	path: string,
	content: string,
): RuntimeSourceRecord => ({ id, path, content });

/** The user has edited these files' values; autosave has not written anything yet. */
const edited = (...entries: [string, string][]): RuntimeEditedSources =>
	entries.reduce<RuntimeEditedSources>(
		(map, [id, content]) => startEditingSource(map, id, content),
		emptyRuntimeEditedSources(),
	);

describe("debounce race: running does not wait for saving", () => {
	it("when the record has old code and the editor new code, the snapshot is the new code", () => {
		const snapshot = currentRuntimeProjectSnapshot({
			files: [record("main", "src/main.tsx", OLD)],
			entry: "src/main.tsx",
			edited: edited(["main", NEW]),
			assets: [],
		});
		expect(snapshot).toEqual({
			entry: "src/main.tsx",
			files: [{ path: "src/main.tsx", content: NEW }],
			assets: [],
		});
		expect(snapshot.files[0].content).not.toContain("OLD");
	});

	it("when that snapshot really compiles, the emit has the new code", () => {
		const snapshot = currentRuntimeProjectSnapshot({
			files: [record("main", "src/main.tsx", OLD)],
			entry: "src/main.tsx",
			edited: edited(["main", NEW]),
			assets: [],
		});
		const artifact = compiled(snapshot.files, snapshot.entry);
		const main = artifact.modules.find(
			(module) => module.id === "src/main.tsx",
		);
		expect(main?.code).toContain("NEW");
		expect(main?.code).not.toContain("OLD");
	});

	it("without an edited value it's the record's value; untouched files are the store's", () => {
		const snapshot = currentRuntimeProjectSnapshot({
			files: [record("main", "src/main.tsx", OLD)],
			entry: "src/main.tsx",
			edited: emptyRuntimeEditedSources(),
			assets: [],
		});
		expect(snapshot.files).toEqual([{ path: "src/main.tsx", content: OLD }]);
	});
});

describe("several files: files not open and files edited are one list", () => {
	const MAIN = `import { Text } from "@rowcat/runtime";\nimport { label } from "./state";\nexport default function App() {\n\treturn <Text>{label}</Text>;\n}\n`;
	const STATE_OLD = `export const label = "OLD";\n`;
	const STATE_NEW = `export const label = "NEW";\n`;

	it("main.tsx stands as saved, state.ts with its unsaved edit", () => {
		const snapshot = currentRuntimeProjectSnapshot({
			files: [
				record("main", "src/main.tsx", MAIN),
				record("state", "src/state.ts", STATE_OLD),
			],
			entry: "src/main.tsx",
			edited: edited(["state", STATE_NEW]),
			assets: [],
		});
		expect(snapshot.files).toEqual([
			{ path: "src/main.tsx", content: MAIN },
			{ path: "src/state.ts", content: STATE_NEW },
		]);
	});

	it("the compiled behavior uses the unsaved state.ts", () => {
		const snapshot = currentRuntimeProjectSnapshot({
			files: [
				record("main", "src/main.tsx", MAIN),
				record("state", "src/state.ts", STATE_OLD),
			],
			entry: "src/main.tsx",
			edited: edited(["state", STATE_NEW]),
			assets: [],
		});
		const artifact = compiled(snapshot.files, snapshot.entry);
		const state = artifact.modules.find(
			(module) => module.id === "src/state.ts",
		);
		expect(state?.code).toContain("NEW");
		expect(state?.code).not.toContain("OLD");
		/** The entry point still depends on the same module: the edit did not change the module graph. */
		const main = artifact.modules.find(
			(module) => module.id === "src/main.tsx",
		);
		expect(
			main?.dependencies.map((dependency) => dependency.resolved),
		).toContain("src/state.ts");
	});
});

describe("identity is the file id", () => {
	it("after a rename the edited content attaches to the new path; no orphan at the old path", () => {
		const before = [record("x", "src/old.ts", "export const v = 1;\n")];
		let map = edited(["x", "export const v = 2;\n"]);
		/** A rename changes only the record's path. The content is still the old, unsaved value. */
		const after = [record("x", "src/new.ts", "export const v = 1;\n")];
		map = reconcileEditedSources(map, after);
		expect(
			currentRuntimeProjectSnapshot({
				files: after,
				entry: "src/main.tsx",
				edited: map,
				assets: [],
			}).files,
		).toEqual([{ path: "src/new.ts", content: "export const v = 2;\n" }]);
		expect(
			currentRuntimeProjectSnapshot({
				files: before,
				entry: "src/main.tsx",
				edited: map,
				assets: [],
			}).files,
		).toHaveLength(1);
	});

	it("edits to a vanished file are dropped", () => {
		const map = reconcileEditedSources(edited(["gone", "x"]), [
			record("main", "src/main.tsx", OLD),
		]);
		expect(map.size).toBe(0);
	});
});

describe("the record catches up", () => {
	it("when the value we sent comes back it leaves the table and the snapshot stays", () => {
		const map = edited(["main", NEW]);
		const echoed = reconcileEditedSources(map, [
			record("main", "src/main.tsx", NEW),
		]);
		expect(echoed.size).toBe(0);
		expect(
			currentRuntimeProjectSnapshot({
				files: [record("main", "src/main.tsx", NEW)],
				entry: "src/main.tsx",
				edited: echoed,
				assets: [],
			}).files[0].content,
		).toBe(NEW);
	});

	it("an old record that hasn't caught up can't revert an edit", () => {
		const map = edited(["main", NEW]);
		/** A liveQuery re-read before autosave arrives: the value is still the old one. */
		const same = reconcileEditedSources(map, [
			record("main", "src/main.tsx", OLD),
		]);
		expect(same).toBe(map);
	});

	it("the record carries remote changes to files not being edited", () => {
		const map = reconcileEditedSources(emptyRuntimeEditedSources(), [
			record("main", "src/main.tsx", "remote"),
		]);
		expect(map.size).toBe(0);
		expect(
			currentRuntimeProjectSnapshot({
				files: [record("main", "src/main.tsx", "remote")],
				entry: "src/main.tsx",
				edited: map,
				assets: [],
			}).files[0].content,
		).toBe("remote");
	});

	it("returns the same table when nothing changes; memoization stands on that identity", () => {
		const map = edited(["main", NEW]);
		expect(
			reconcileEditedSources(map, [record("main", "src/main.tsx", OLD)]),
		).toBe(map);
		expect(startEditingSource(map, "main", NEW)).toBe(map);
	});
});

describe("the run signal and the staleness decision are the same representation", () => {
	it("the snapshot's signal is built by the same function as the compile signal", () => {
		const snapshot = currentRuntimeProjectSnapshot({
			files: [
				record("state", "src/state.ts", "b"),
				record("main", "src/main.tsx", "a"),
			],
			entry: "src/main.tsx",
			edited: edited(["main", "a2"]),
			assets: [],
		});
		expect(runtimeCompileSignature(snapshot.files)).toBe(
			runtimeCompileSignature([
				{ path: "src/main.tsx", content: "a2" },
				{ path: "src/state.ts", content: "b" },
			]),
		);
	});

	it("reverting the edit to the value at run time reverts the signal too", () => {
		const files = [record("main", "src/main.tsx", OLD)];
		const at = (map: RuntimeEditedSources): string =>
			runtimeCompileSignature(
				currentRuntimeProjectSnapshot({
					files,
					entry: "src/main.tsx",
					edited: map,
					assets: [],
				}).files,
			);
		const ran = at(edited(["main", NEW]));
		expect(at(edited(["main", `${NEW}// b`]))).not.toBe(ran);
		expect(at(edited(["main", NEW]))).toBe(ran);
	});
});
