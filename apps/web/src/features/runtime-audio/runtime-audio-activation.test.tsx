import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	RuntimeAudioActivation,
	runtimeAudioActivationLabel,
} from "./runtime-audio-activation.tsx";

/**
 * Automatic audio activation. The trusted layer draws it, and both surfaces use the same component.
 * The tests check three things:
 * - Disappearing condition. When `required` is false, nothing renders. The renderer's observation
 *   updates that value, so the button must remove itself. If the screen tracked that moment
 *   separately, the button could stay visible after sound had already started.
 * - Synchronous call. The press handler calls `activateAudio` directly. Wrapping it in `async` or
 *   deferring it past an `await` makes the browser stop treating the call as a user gesture, and
 *   playback is refused again. This mistake compiles, and its only symptom is that tapping produces
 *   no sound.
 * - Two surfaces. The authoring preview and product playback use the same component. If only the
 *   preview were lenient, sound heard while authoring would go silent after publishing.
 */

describe("when it disappears", () => {
	it("draws nothing when not required", () => {
		expect(
			RuntimeAudioActivation({ required: false, onActivate: () => undefined }),
		).toBeNull();
	});

	it("draws one when required", () => {
		const element = RuntimeAudioActivation({
			required: true,
			onActivate: () => undefined,
		});
		expect(isValidElement(element)).toBe(true);
	});
});

describe("press", () => {
	/**
	 * The handler is passed through as is. `onClick={() => void onActivate()}` would be harmless, but
	 * an `async` function or a call after an `await` loses the gesture. This is the only part
	 * verifiable as a value: the test walks the React element tree without a renderer.
	 */
	it("pressing calls activateAudio", () => {
		const activate = vi.fn();
		const element = RuntimeAudioActivation({
			required: true,
			onActivate: activate,
		});
		const press = findOnClick(element);
		expect(press).toBeTypeOf("function");
		press?.();
		expect(activate).toHaveBeenCalledTimes(1);
	});

	/** The handler returns no `Promise`. An async boundary would break the user gesture. */
	it("the handler is synchronous", () => {
		const element = RuntimeAudioActivation({
			required: true,
			onActivate: () => undefined,
		});
		expect(findOnClick(element)?.()).toBeUndefined();
	});
});

interface ElementLike {
	props?: Record<string, unknown>;
}

function findOnClick(node: unknown): (() => unknown) | null {
	if (!isValidElement(node)) {
		if (Array.isArray(node)) {
			for (const child of node) {
				const found = findOnClick(child);
				if (found) return found;
			}
		}
		return null;
	}
	const props = (node as ElementLike).props ?? {};
	if (typeof props.onClick === "function")
		return props.onClick as () => unknown;
	return findOnClick(props.children);
}

const FEATURES = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(FEATURES, path), "utf8");

describe("wiring", () => {
	/**
	 * The authoring-side placement is the surface (`runtime-preview-stage.tsx`). The studio preview
	 * pane and the full-screen work test share this surface, so the autoplay-policy notice appears in
	 * one place for both. If each surface had its own, a creator who set `playing` in one could see
	 * nothing happen, and that silence produces no error.
	 */
	it("preview and product playback stand up the same component", () => {
		for (const path of [
			"runtime-preview/runtime-preview-stage.tsx",
			"runtime-player/runtime-conversation.tsx",
		]) {
			const source = read(path);
			expect(source, path).toMatch(/<RuntimeAudioActivation/);
			expect(source, path).toMatch(/audioActivationRequired/);
			expect(source, path).toMatch(/activateAudio/);
		}
	});

	/**
	 * The renderer's observation has to actually reach the hooks. Without this line the state stays
	 * false, the button never appears, and the failure is silent.
	 */
	it("both hooks receive the renderer's observation", () => {
		for (const path of [
			"runtime-preview/use-runtime-preview.ts",
			"runtime-player/use-runtime-player.ts",
		]) {
			const source = read(path);
			expect(source, path).toMatch(/onAudioActivationChange:/);
			expect(source, path).toMatch(/activateAudio: \(\) =>/);
		}
	});

	/**
	 * Never bypass the autoplay policy with timers. The shortest "fix" is calling `play()` again
	 * periodically. That code either fails, or occasionally succeeds and plays sound the user never
	 * allowed.
	 */
	it("no automatic retry", () => {
		const folder = join(import.meta.dirname);
		for (const name of readdirSync(folder)) {
			if (name.endsWith(".test.tsx")) continue;
			const source = readFileSync(join(folder, name), "utf8");
			expect(source, name).not.toMatch(/setInterval|setTimeout/);
		}
	});

	/** The label belongs to this file. Creator content does not get to define the wording. */
	it("the label is fixed copy", () => {
		expect(runtimeAudioActivationLabel().length).toBeGreaterThan(0);
	});
});
