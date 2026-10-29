import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Checks that the rolling number is not swallowed by the presence context. This failure is among
 * the quietest in the repo. AnimatedCount re-mounts a cell whose value changed in order to roll it.
 * framer-motion decides the mount animation through isInitialAnimationBlocked, which is true when
 * presenceContext.initial === false. The gallery grid wraps cards in `<AnimatePresence
 * initial={false}>` so cards on the first screen do not rise, and that value propagates through
 * context to all descendants. PresenceChild's context also omits `initial` from its useMemo
 * dependencies, so once it becomes false it stays false, and every digit mounted later is affected.
 * Nothing errors or warns in that state. The number is correct, types and tests pass, and the
 * screen simply does not roll (in a browser, getAnimations() returns an empty array and the style
 * is already at its final value). The 24 cards on the `Discover` tab really behaved this way. The check
 * therefore covers a pair: the grid holds the policy, and this component cuts it below itself. If
 * one side disappears, the reason for the other disappears too, so both are verified together (same
 * rule as the Screen(edges) and ComposerArea pair on mobile). It does not assert Motion's emitted
 * styles (same rule as list-motion.test.ts). Real movement is checked in a browser.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (...parts: string[]) =>
	readFileSync(join(HERE, "..", "..", ...parts), "utf8");

/**
 * Source with comments stripped, so this file's header does not report itself as a violation.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const count = code(read("lib", "motion", "animated-count.tsx"));
const gallery = code(read("features", "gallery", "gallery-page.tsx"));

/** Each self-closing `<AnimatedCount … />` in a file, matched by this regex. */
const uses = (source: string): string[] =>
	source.match(/<AnimatedCount\b[\s\S]*?\/>/g) ?? [];

const surface = (...parts: string[]) => code(read("features", ...parts));

describe("rolling numbers and the presence context", () => {
	/**
	 * This component lives in one of those places: the gallery grid. If this line disappeared, nothing
	 * would explain what the checks below protect, so the reason is recorded here.
	 */
	it("the gallery grid suppresses the cards' first entrance; that is where this problem comes from", () => {
		expect(gallery).toMatch(/<AnimatePresence\s+initial=\{false\}/);
	});

	/**
	 * A nested presence sends `initial: undefined` on its first render, which re-enables the mount
	 * animation below it. Removing this would silently stop the numbers from rolling on the `Discover` tab.
	 */
	it("the number cuts that context below itself", () => {
		expect(count).toMatch(/<AnimatePresence\b/);
	});

	/**
	 * Cut, not flip. Writing `initial={false}` here would send a new context that still carries the
	 * same value, so the fix would do nothing. That single line also looks like an ordinary diff in
	 * review.
	 */
	it("that presence does not plant the same suppression again", () => {
		expect(count).not.toMatch(/<AnimatePresence[^>]*initial=\{false\}/);
	});

	/**
	 * The guarantee that cells do not roll on first render comes from each cell's own `initial`, not
	 * from the context (isInitialAnimationBlocked is also true when initial === false). If that
	 * disappears too, all 24 counts would roll in at once on a list's first render.
	 */
	it("unchanged digits still do not move on mount", () => {
		expect(count).toMatch(/initial=\{cell\.changed \? [^}]+ : false\}/);
	});
});

/**
 * Checks that the choice of cadence is not re-decided per cell. The policy widened from "is this
 * the answer to what the user just did" to "did the value change in the same cell", so consumers
 * went from five to fourteen. More than half change every second or on every keystroke. If those
 * roll at the default cadence, the screen gets permanently moving elements, with no error, type
 * failure, or visible symptom, just noise. That noise would also turn numbers that announce a
 * single event (favorites, balance) into background. The table runs both ways: listing only the
 * surfaces that must be continuous lets removing cadence="continuous" pass, and listing only the
 * surfaces that must default lets the reverse pass.
 */
const CONTINUOUS_SURFACES: string[][] = [
	// Shrinks every second.
	["auth", "verification-notice.tsx"],
	["account", "email-section.tsx"],
	["sync", "pair-device-dialog.tsx"],
	// Changes on every keystroke.
	["account", "profile-section.tsx"],
	["persona", "persona-editor.tsx"],
	["chat", "memory", "dialog.tsx"],
	["chat", "room", "rename-dialog.tsx"],
	["moderation", "appeal-dialog.tsx"],
	["moderation", "report-dialog.tsx"],
	["story", "comments", "comment-composer.tsx"],
	// Changes every frame while the control is being turned off.
	["settings", "theme-customization-section.tsx"],
];

/** Values that change in place, but where the next change does not arrive right away. */
const DEFAULT_SURFACES: string[][] = [
	["social", "favorite-control.tsx"],
	["profile", "profile-header.tsx"],
	["gallery", "gallery-toolbar.tsx"],
	["create", "../../features/create/analytics/overview.tsx"],
	["create", "create-workspace-navigation.tsx"],
	["create", "../../features/create/editor/tag-input.tsx"],
	["notifications", "notification-bell.tsx"],
];

describe("intensity is chosen per site", () => {
	it.each(
		CONTINUOUS_SURFACES,
	)("a number changing every second or keystroke is continuous (%s/%s)", (...parts: string[]) => {
		const found = uses(surface(...parts));
		expect(found.length).toBeGreaterThan(0);
		for (const use of found) expect(use).toContain('cadence="continuous"');
	});

	it.each(
		DEFAULT_SURFACES,
	)("a number reporting a one-off event uses the default intensity (%s/%s)", (...parts: string[]) => {
		const found = uses(surface(...parts));
		expect(found.length).toBeGreaterThan(0);
		for (const use of found) expect(use).not.toContain("cadence=");
	});
});

/**
 * Only the number rolls; its surroundings stay put. The fastest implementation keys the whole
 * button or sentence on the value, which re-creates the control every second. Focus, the accessible
 * name, and presence would all flicker together. The mistake is not visible until pressed in a
 * browser.
 */
describe("the surroundings stand still", () => {
	it.each([
		["auth", "verification-notice.tsx", "verification"],
		["account", "email-section.tsx", "emailSection"],
	])("the resend button's copy is static and only the remaining seconds roll (%s/%s)", (folder, file, group) => {
		const source = surface(folder, file);
		// Keeping the rolling part inside a template string means the component can never stay put.
		expect(source).not.toMatch(/resendIn[^)]*\$\{/);
		expect(source).toContain(`t("${group}.resendIn")`);
		expect(source).toContain(`t("${group}.seconds")`);
		expect(uses(source)).toHaveLength(1);
	});

	/**
	 * The limit is an unchanging fact, so it belongs outside the rolling box. Inside it (value={`${n}
	 * / ${max}`}), every keystroke sends the limit through the digit-position check, and when digit
	 * widths overlap (499 → 500), the limit's text rolls along too.
	 */
	it.each([
		["account", "profile-section.tsx", "BIO_LIMITS"],
		["persona", "persona-editor.tsx", "CHAT_PERSONA_NAME_MAX_LENGTH"],
		["chat", "memory", "dialog.tsx", "CHAT_MEMORY_CONTENT_MAX_LENGTH"],
		["chat", "room", "rename-dialog.tsx", "CHAT_ROOM_TITLE_MAX_LENGTH"],
		/*
		 * This dialog's limit comes from the pure check (checkAppealMessage). To state the excess without
		 * truncating, the screen and the check must see the same number. Only the name differs; the rule
		 * is unchanged: what rolls is the current character count, and the limit stands outside that box.
		 */
		["moderation", "appeal-dialog.tsx", "check.limit"],
		["moderation", "report-dialog.tsx", "REPORT_LIMITS"],
		["story", "comments", "comment-composer.tsx", "STORY_COMMENT_LIMITS"],
		[
			"create",
			"../../features/create/editor/tag-input.tsx",
			"STORY_PUBLISH_LIMITS",
		],
	] as string[][])("the cap sits outside the rolling box (%s/%s)", (...parts: string[]) => {
		const limit = parts[parts.length - 1] as string;
		const source = surface(...parts.slice(0, -1));
		expect(source).toContain(limit);
		for (const use of uses(source)) expect(use).not.toContain(limit);
	});
});

/**
 * Appearing, disappearing, and changing value are different events. The notification badge is the
 * only surface that experiences all of them in one place. 0 → 3 is an appearance, 3 → 4 is a
 * change, and 4 → 0 is a disappearance. If the presence key were tied to the count, all three would
 * collapse into one and the bell would pulse on every 60-second refresh. Conversely, if the number
 * inside did not roll, a new notification would produce no visible motion.
 */
describe("badges separate entrance from value change", () => {
	const bell = surface("notifications", "notification-bell.tsx");

	it("presence tracks only whether the badge exists; the key is not tied to the number", () => {
		expect(bell).toMatch(
			/<AnimatePresence\s+initial=\{false\}>\s*\{attention\.badge &&/,
		);
		expect(bell).not.toMatch(/key=\{\s*attention\.badge/);
		expect(bell).not.toMatch(/key=\{\s*unreadCount/);
	});

	it("value changes are carried by the number inside", () => {
		expect(bell).toContain("<AnimatedCount value={attention.badge} />");
	});

	/**
	 * The dot also only appears and disappears. The bell now has two indicators (count and dot), and
	 * they are never drawn together; exclusivity is guaranteed by the shared pure function
	 * notificationAttention. So even with two presences no frame overlaps, and each still links only
	 * presence. Nothing rolls inside the dot: it means one thing, "something new is here", and it is
	 * one line even when three notices are pending.
	 */
	it("the dot tracks only presence and nothing rolls inside", () => {
		expect(bell).toMatch(
			/<AnimatePresence\s+initial=\{false\}>\s*\{attention\.dot &&/,
		);
		const dot = bell.slice(bell.indexOf("{attention.dot &&"));
		expect(dot).not.toContain("AnimatedCount");
	});
});

/**
 * Do not roll when the frame never arrives. Before the policy widened, this was an accepted cost,
 * since the only thing moving this number was a heart pressed in this tab. Now the every-second
 * countdown and background refreshes share this component. If the value changes while the document
 * is hidden, returning to the tab shows the old number and rolls from there. framer-motion's frame
 * loop advances only 40 ms per frame, so the roll covers one transition, not one frame
 * (motion-dom's batcher.mjs). Deleting this causes no error or warning. Only someone who left the
 * tab and came back sees a briefly wrong number.
 */
describe("hidden tabs", () => {
	it("if the document is hidden when the value changes, no previous value is kept", () => {
		expect(count).toMatch(/document\.hidden/);
		expect(count).toMatch(
			/previous:\s*hidden \|\| !hasTime \? value : shown\.value/,
		);
	});

	/**
	 * Does not subscribe to visibility. Subscribing would re-render every number on the screen on each
	 * tab switch, and that cost buys nothing. The moment this value needs reading is the moment it has
	 * already changed and a render is already running.
	 */
	it("does not subscribe to visibility", () => {
		expect(count).not.toContain("useSyncExternalStore");
		expect(count).not.toContain("visibilitychange");
	});
});

/**
 * Bursts of changes do not roll. When the next value arrives before the current glyph finishes, as
 * while dragging a slider, the cell would repeatedly re-mount transparent. The most frequently
 * changing spot would then be the least readable. The judgment is countRollHasTime, a single
 * function both apps call.
 */
describe("bursts of changes", () => {
	it("goes through the shared decision and does not restate the threshold here", () => {
		expect(count).toContain("countRollHasTime(now - shown.changedAt, cadence)");
		expect(count).not.toMatch(/changedAt\s*[<>]=?\s*\d/);
	});

	/** Mounting is not a change, so the first change is not misclassified as a burst. */
	it("the first change right after mount rolls", () => {
		expect(count).toMatch(/changedAt:\s*Number\.NEGATIVE_INFINITY/);
	});
});

/**
 * Motion holds no product state (see the section titled `motion holds no product state`). When a value arrives
 * every second, the most plausible mistakes are: queueing missed changes to replay 30 → 29 → 28 in
 * order, moving the value after the transition ends, or smoothing it with timers. All three make
 * the on-screen number lag behind the application's number.
 */
describe("the number is still owned outside", () => {
	it("a transition's completion does not move the value", () => {
		expect(count).not.toContain("onAnimationComplete");
		expect(count).not.toContain("setTimeout");
		expect(count).not.toContain("setInterval");
	});

	/**
	 * The state is one value: the last value drawn. The moment an array of pending values exists, the
	 * screen draws the head of the queue instead of the current number.
	 */
	it("does not queue pending values", () => {
		// Counts the call sites. Counting import lines too would loosen this check by one.
		expect(count.match(/useState\(/g) ?? []).toHaveLength(1);
		expect(count).not.toContain("useRef");
	});

	/**
	 * The digit cells still use `tabular-nums`. Without it, the column width jitters as the number
	 * rolls.
	 */
	it("digit width is fixed", () => {
		expect(count).toContain("tabular-nums");
	});

	/**
	 * No measuring and no layout animation. Since a value that changes on every keystroke now flows
	 * through here, this rule is the performance condition: `layout` measures each frame, and that
	 * cost falls on every digit cell it paints.
	 */
	it("does not measure", () => {
		expect(count).not.toMatch(/\blayout\b/);
		expect(count).not.toContain("ResizeObserver");
		expect(count).not.toContain("getBoundingClientRect");
	});
});
