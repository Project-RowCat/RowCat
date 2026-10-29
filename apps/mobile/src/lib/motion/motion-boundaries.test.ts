import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Motion boundaries: what the type system cannot catch.
 *
 * Web enforces the same rules in `apps/web/src/lib/motion/feedback.test.ts` and `engine.test.ts`.
 * Only the runtime names differ, and the mistakes look the same on both platforms: a new motion
 * written with an inline `duration: 200`. The types pass and the screen renders. The symptom shows
 * only when a token changes and that one spot does not follow, so no commit reveals it.
 *
 * This app's tests do not render screens (`vitest.config.ts`), so these checks read the **source
 * shape** instead.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
/** The layer that **defines** these rules. It does not check itself. */
const MOTION_LIB = join("lib", "motion");

function walk(dir: string, prefix = ""): { path: string; text: string }[] {
	const found: { path: string; text: string }[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? join(prefix, entry.name) : entry.name;
		if (entry.isDirectory()) {
			found.push(...walk(join(dir, entry.name), rel));
			continue;
		}
		if (!/\.tsx?$/.test(entry.name)) continue;
		found.push({
			path: rel,
			text: readFileSync(join(dir, entry.name), "utf8"),
		});
	}
	return found;
}

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const all = walk(SRC).map((file) => ({
	path: file.path,
	text: stripComments(file.text),
}));

const product = all.filter(
	(file) => !/\.test\.tsx?$/.test(file.path) && !file.path.startsWith("test/"),
);

const features = product.filter((file) => !file.path.startsWith(MOTION_LIB));

const at = (path: string) => {
	const found = all.find((file) => file.path === path);
	if (!found) throw new Error(`${path} is missing`);
	return found.text;
};

describe("the animation runtime has one place", () => {
	it("the files to check actually exist", () => {
		expect(features.length).toBeGreaterThan(100);
	});

	/**
	 * **Feature code does not import Reanimated directly.**
	 *
	 * If twenty screens each built an `Animated.View` and wrote their own timings, the app's rhythm
	 * would split per screen, and the split only shows when two screens are compared side by side. The
	 * route in is the narrow vocabulary of `lib/motion` (`PageEnter`, `FeedbackLine`, `MotionRow`,
	 * `AnimatedIconSwap`, `AnimatedLabel`, `AnimatedCount`, `MotionIndicatorGroup`).
	 *
	 * `@rowcat/ui-native`'s primitives keep the same rule within their own folder
	 * (`packages/ui-native/src/boundaries.test.ts`).
	 */
	it("one place calls react-native-reanimated: lib/motion", () => {
		for (const file of features)
			expect(file.text, file.path).not.toMatch(/react-native-reanimated/);
	});

	/**
	 * **No second abstraction.** RowCat already has its own motion vocabulary
	 * (`docs/motion/ARCHITECTURE.md`, "four branches"). Moti would add a third layer between that
	 * vocabulary and Reanimated, and then the answer to "what moves and why" would become a library
	 * prop name.
	 */
	it("takes in neither Moti nor a gesture layer", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bmoti\b/);
			expect(file.text, file.path).not.toMatch(/react-native-gesture-handler/);
			expect(file.text, file.path).not.toMatch(/@gorhom\/bottom-sheet/);
			expect(file.text, file.path).not.toMatch(/\bLayoutAnimation\b/);
		}
	});

	/**
	 * **No springs**, because web has none. Everything that moves today is an automatic transition
	 * with nothing driven by a finger. When a direct-manipulation surface such as drag or reorder
	 * arrives, this check, `@rowcat/design`'s `motion.ts` and `docs/motion/ARCHITECTURE.md` all change
	 * **together**.
	 */
	it("doesn't use springs", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bwithSpring\b/);
			expect(file.text, file.path).not.toMatch(/\.springify\(/);
		}
	});

	/**
	 * **Timings and curves are not written by hand.** `@rowcat/design` is the only source, and
	 * `lib/motion/transitions.ts` is the only place that converts it into Reanimated's shape.
	 *
	 * Only animation **configuration** is checked. Debounces, copied-indicator lifetimes and network
	 * deadlines are also milliseconds but are not motion; widening the check to cover them would just
	 * push everyone to disable it.
	 */
	it("animation config has no duration or curve literals", () => {
		for (const file of product) {
			if (file.path === join(MOTION_LIB, "transitions.ts")) continue;
			expect(file.text, file.path).not.toMatch(/duration:\s*\d/);
			expect(file.text, file.path).not.toMatch(/Easing\.bezier/);
			expect(file.text, file.path).not.toMatch(/\.duration\(\s*\d/);
		}
	});

	/**
	 * **The screen does not re-decide reduced motion.**
	 *
	 * On web a single global `MotionConfig reducedMotion="user"` holds that answer. Here the policy is
	 * built into the rhythm: transforms jump to their final value and opacity still flows
	 * (`transitions.ts`). If each screen asked `useReducedMotion()` and branched, the same preference
	 * would be interpreted in many places, and one of them would inevitably delay **when the state
	 * changes**.
	 */
	/**
	 * **One exception: the cursor of a streaming response.**
	 *
	 * That glyph is not part of this system. It is an endless decorative loop rather than a transition
	 * describing state (web's equivalent also uses Tailwind's `animate-pulse`, which bypasses tokens),
	 * so there is no rhythm to move in the first place. It stays on RN core's `Animated` and owns its
	 * own subscription.
	 *
	 * **Keeping it in this list is the point.** Deleting it would leave this check guarding nothing,
	 * and anyone adding another exception must answer whether it is also a repeating decoration that
	 * bypasses tokens.
	 */
	const OWNS_ITS_OWN_LOOP = new Set([
		join("features", "chat", "messages", "row.tsx"),
	]);

	it("screens don't subscribe to accessibility preferences", () => {
		for (const file of features) {
			expect(file.text, file.path).not.toMatch(/\buseReducedMotion\b/);
			if (OWNS_ITS_OWN_LOOP.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(/isReduceMotionEnabled/);
		}
	});
});

describe("motion holds no product state", () => {
	/**
	 * **Irreversible actions do not wait for a transition to finish.**
	 *
	 * If delete, save, publish, move, send or stop ran inside an animation callback, those actions
	 * would **never happen** whenever frames do not arrive. So feature code has no completion
	 * callbacks at all. The one place that needs that wiring (unmounting a closing surface) belongs to
	 * the presentation layer (`motion/animate.ts` in `@rowcat/ui-native`).
	 */
	it("feature code has no animation completion callbacks", () => {
		for (const file of features) {
			expect(file.text, file.path).not.toMatch(/\brunOnJS\b/);
			expect(file.text, file.path).not.toMatch(/onAnimationComplete/);
			expect(file.text, file.path).not.toMatch(/withCallback/);
		}
	});
});

describe("the virtualized conversation is a boundary", () => {
	/**
	 * **P0.** The virtualizer measures conversation line heights and uses them to hold the scroll
	 * position. Adding entrance, exit or layout transitions here fights that measurement, and the
	 * symptom is not an animation glitch but **a scroll that jumps** — which happens exactly while the
	 * user is reading a reply.
	 *
	 * Web has the same boundary (`docs/motion/ARCHITECTURE.md`).
	 */
	const VIRTUALIZED = [
		join("features", "chat", "messages", "list.tsx"),
		join("features", "chat", "messages", "row.tsx"),
		join("features", "chat", "messages", "body.tsx"),
		join("features", "playtest", "playtest-screen.tsx"),
	];

	it("those files actually exist", () => {
		for (const path of VIRTUALIZED) expect(() => at(path)).not.toThrow();
	});

	it("message rows have no enter, exit or layout transition", () => {
		for (const path of VIRTUALIZED) {
			const text = at(path);
			expect(text, path).not.toMatch(/\bentering=/);
			expect(text, path).not.toMatch(/\bexiting=/);
			expect(text, path).not.toMatch(/\blayout=\{/);
			expect(text, path).not.toMatch(/\bMotionRow\b/);
			expect(text, path).not.toMatch(/\bPageEnter\b/);
		}
	});

	/**
	 * **Do not smooth the height of a streaming response.** The line grows because its content grows,
	 * and its geometry belongs to the virtualizer and scroll tracking.
	 */
	it("doesn't animate the height of a streaming row", () => {
		for (const path of VIRTUALIZED)
			expect(at(path), path).not.toMatch(/height:\s*withTiming/);
	});

	/**
	 * Motion that does not change the box size **is allowed**; the copy glyph is an example (its
	 * hidden copy in `animated-icon-swap.tsx` fixes the box). So this boundary applies to **the
	 * measured line**, not to the whole conversation folder.
	 */
	it("row operations swap glyphs", () => {
		expect(
			at(join("features", "chat", "messages", "action-bar.tsx")),
		).toContain("AnimatedIconSwap");
	});
});

describe("doesn't create global press feedback", () => {
	/**
	 * Web explicitly rejected this branch (`whileTap`). Native already has platform press feedback
	 * (opacity and background in the `pressed` state); layering a shrink on top would add a motion
	 * category web does not have, and the two apps of one product would behave differently.
	 */
	it("doesn't add a shrink on press", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/pressed\s*&&\s*\{\s*transform/);
			expect(file.text, file.path).not.toMatch(/whileTap/);
		}
	});
});

describe("no staggered entrance", () => {
	/**
	 * The list reads late, and ordinary data arrival becomes choreography. Web rejected it for the
	 * same reason.
	 */
	it("doesn't multiply delays across rows", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\.delay\(\s*index/);
			expect(file.text, file.path).not.toMatch(/\bstagger\b/i);
		}
	});
});
