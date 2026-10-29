import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **A playtest follows the draft's execution model.** In a draft with the runtime enabled, the four
 * conversation materials are locked (`resolveConversationAuthoringMode`). Building a conversation
 * from that draft yields an empty screen with no opening and no prompt. That is not a failure; it
 * is a screen with nothing to test, and no cause is written anywhere. This defect threw no error,
 * so no test caught it.
 *
 * The web tests in this repo have no React rendering. What is checked is the wiring, not the
 * rendered output, and the source alone answers that.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const code = (...parts: string[]) =>
	stripComments(readFileSync(join(HERE, ...parts), "utf8"));

describe("execution model branches", () => {
	/**
	 * The decision is made on the same single axis as the lock. Splitting it by file count, prompt
	 * body, the published playback mode, or the current address would let these values diverge, and
	 * then two screens would give different answers, one of them an empty conversation.
	 */
	it("the page branches on `isRuntimeEnabled` alone", () => {
		const page = code("playtest-page.tsx");
		expect(page).toContain("isRuntimeEnabled(runtime.project)");
		expect(page).toContain("<RuntimePlaytest");
		expect(page).not.toContain("playMode");
		expect(page).not.toContain("files.length");
	});

	/**
	 * Draw neither side before the first result. Collapsing to `null` would render the conversation
	 * screen for one frame on a runtime draft, and that frame is exactly the screen this defect used
	 * to produce.
	 */
	it("a placeholder while the project is not known yet", () => {
		expect(code("playtest-page.tsx")).toContain(
			'if (bootstrap.status === "loading" || runtime.loading)',
		);
	});
});

describe("the runtime branch is not a second execution path", () => {
	/**
	 * Uses the same hook as the studio preview, which starts the worker, and the same surface, which
	 * draws the result.
	 */
	it("uses the preview hook and surface as is", () => {
		const surface = code("runtime-playtest.tsx");
		expect(surface).toContain("useRuntimePreview(");
		expect(surface).toContain("<RuntimePreviewStage");
	});

	/**
	 * The asset resolver is passed in from outside: it is the same function playback uses. Starting to
	 * build addresses here would make pictures visible during authoring disappear after publishing.
	 */
	it("makes no asset resolver and passes the same one as playback", () => {
		const surface = code("runtime-playtest.tsx");
		expect(surface).toContain("resolveAsset: resolveWebRuntimeAsset");
		expect(surface).not.toContain("runtimeAssetUrl");
	});

	/**
	 * AI is an opt-in choice for the next run. This screen must not flip the hook's default (off). If
	 * opening a draft turned on billable state, creators would fear the run button.
	 */
	it("does not turn AI on by default", () => {
		expect(code("runtime-playtest.tsx")).not.toContain(
			"setGenerationEnabled(true)",
		);
	});
});
