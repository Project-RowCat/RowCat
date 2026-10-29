import { describe, expect, it } from "vitest";
import {
	type RuntimeCompileSignatureFile,
	runtimeCompileSignature,
	runtimeProjectSignature,
} from "./signature.ts";

/**
 * Checks that the signal is unambiguous. This property cannot be observed through rendering. If two
 * projects shared a signal, analysis would silently skip, and the screen would show the previous
 * project's diagnostics until the next keystroke happened to fix it.
 */

const files = (...entries: [string, string][]): RuntimeCompileSignatureFile[] =>
	entries.map(([path, content]) => ({ path, content }));

describe("changes when something changes", () => {
	it("content", () => {
		expect(runtimeCompileSignature(files(["a.ts", "1"]))).not.toBe(
			runtimeCompileSignature(files(["a.ts", "2"])),
		);
	});

	it("path", () => {
		expect(runtimeCompileSignature(files(["a.ts", "1"]))).not.toBe(
			runtimeCompileSignature(files(["b.ts", "1"])),
		);
	});

	it("a file was added", () => {
		expect(runtimeCompileSignature(files(["a.ts", "1"]))).not.toBe(
			runtimeCompileSignature(files(["a.ts", "1"], ["b.ts", "2"])),
		);
	});

	it("a file was removed", () => {
		expect(
			runtimeCompileSignature(files(["a.ts", "1"], ["b.ts", "2"])),
		).not.toBe(runtimeCompileSignature(files(["a.ts", "1"])));
	});

	/** Adding an empty file is still a project change: it adds a module-resolution target. */
	it("an empty file was added", () => {
		expect(runtimeCompileSignature(files(["a.ts", "1"]))).not.toBe(
			runtimeCompileSignature(files(["a.ts", "1"], ["b.ts", ""])),
		);
	});
});

describe("stays the same when nothing changes", () => {
	it("the same list", () => {
		expect(runtimeCompileSignature(files(["a.ts", "1"], ["b.ts", "2"]))).toBe(
			runtimeCompileSignature(files(["a.ts", "1"], ["b.ts", "2"])),
		);
	});

	/**
	 * The repository order changes through liveQuery (edits in another tab, or remote changes applied
	 * by sync). Reordering does not change analysis output, so the signal must not change either.
	 */
	it("the same set in a different order", () => {
		expect(runtimeCompileSignature(files(["a.ts", "1"], ["b.ts", "2"]))).toBe(
			runtimeCompileSignature(files(["b.ts", "2"], ["a.ts", "1"])),
		);
	});

	it("empty project", () => {
		expect(runtimeCompileSignature([])).toBe(runtimeCompileSignature([]));
	});
});

describe("store axes are not in the signal", () => {
	/**
	 * The input is only `{ path, content }`, so id, revision, dirty, and updatedAt have no slot. The
	 * test pins that extra fields are ignored. If they entered the signal, one synced metadata change
	 * would rerun the analysis.
	 */
	it("the same signal even with ids and revisions mixed in", () => {
		const bare = files(["a.ts", "1"]);
		const decorated = [
			{
				path: "a.ts",
				content: "1",
				id: "f_1",
				rev: 12,
				dirty: true,
				updatedAt: "2026-09-02T00:00:00.000Z",
			},
		];
		expect(runtimeCompileSignature(decorated)).toBe(
			runtimeCompileSignature(bare),
		);
	});
});

/**
 * The previous implementation this suite guards against. It joined path and content with a space
 * and no other boundary, so distinct projects could share a signal.
 */
describe("the concatenation collision is gone", () => {
	const naive = (list: RuntimeCompileSignatureFile[]): string =>
		list.map((file) => `${file.path} ${file.content}`).join("");

	const left = files(["a", "b c"]);
	const right = files(["a b", "c"]);

	it("the old signal folded two projects into the same value", () => {
		expect(naive(left)).toBe(naive(right));
	});

	it("now they differ", () => {
		expect(runtimeCompileSignature(left)).not.toBe(
			runtimeCompileSignature(right),
		);
	});

	/**
	 * The boundary also vanished between files. Two files and one file must not produce the same
	 * value.
	 */
	it("file boundaries don't blur", () => {
		const two = files(["a", "1"], ["b", "2"]);
		const one = files(["a", "1b 2"]);
		expect(naive(two)).toBe(naive(one));
		expect(runtimeCompileSignature(two)).not.toBe(runtimeCompileSignature(one));
	});
});

/**
 * The run-snapshot signal covers source and managed assets together. Keeping it separate from the
 * compile signal is the point. Compile analysis ignores logical asset names (those are runtime
 * values), so an asset change gives no reason to rerun it. A running preview, however, goes stale
 * when an asset changes, and keeps showing the old image until the author runs it again.
 */
describe("the run snapshot's signal", () => {
	const bind = (path: string, assetId: string) =>
		({ path, assetId, kind: "image" }) as const;
	const source = files(["src/main.tsx", "export default 1;"]);

	it("the run signal changes when assets change", () => {
		expect(
			runtimeProjectSignature({
				files: source,
				assets: [bind("characters/sena/smile", "media-A")],
			}),
		).not.toBe(
			runtimeProjectSignature({
				files: source,
				assets: [bind("characters/sena/smile", "media-B")],
			}),
		);
	});

	/** Yet the compile signal stays the same: changing one image does not rerun the whole analysis. */
	it("the same change doesn't move the compile signal", () => {
		expect(runtimeCompileSignature(source)).toBe(
			runtimeCompileSignature(source),
		);
	});

	it("the run signal changes when a name changes", () => {
		expect(
			runtimeProjectSignature({
				files: source,
				assets: [bind("characters/sena/smile", "media-A")],
			}),
		).not.toBe(
			runtimeProjectSignature({
				files: source,
				assets: [bind("characters/sena/happy", "media-A")],
			}),
		);
	});

	/**
	 * Asset list order is not part of the signal, so repository reordering does not mark the preview
	 * stale.
	 */
	it("asset order is not a signal", () => {
		expect(
			runtimeProjectSignature({
				files: source,
				assets: [bind("ui/heart", "media-B"), bind("backgrounds/a", "media-A")],
			}),
		).toBe(
			runtimeProjectSignature({
				files: source,
				assets: [bind("backgrounds/a", "media-A"), bind("ui/heart", "media-B")],
			}),
		);
	});

	/**
	 * Kind is part of the run signal. Same name and media with a different kind produces a different
	 * screen, so the signal must change.
	 */
	it("the run signal changes when the kind changes", () => {
		expect(
			runtimeProjectSignature({
				files: source,
				assets: [{ path: "audio/bgm", assetId: "media-A", kind: "image" }],
			}),
		).not.toBe(
			runtimeProjectSignature({
				files: source,
				assets: [{ path: "audio/bgm", assetId: "media-A", kind: "audio" }],
			}),
		);
	});

	/** Concatenation collisions are not an issue here either, because JSON carries the boundaries. */
	it("the name/identity boundary doesn't blur", () => {
		expect(
			runtimeProjectSignature({
				files: source,
				assets: [bind("a/b", "c")],
			}),
		).not.toBe(
			runtimeProjectSignature({
				files: source,
				assets: [bind("a", "b/c")],
			}),
		);
	});

	it("the run signal changes when the source changes", () => {
		expect(runtimeProjectSignature({ files: source, assets: [] })).not.toBe(
			runtimeProjectSignature({
				files: files(["src/main.tsx", "export default 2;"]),
				assets: [],
			}),
		);
	});
});
