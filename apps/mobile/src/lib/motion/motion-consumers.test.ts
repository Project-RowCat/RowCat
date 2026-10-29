import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Having a vocabulary defined and having it used are different facts.
 *
 * `motion-policy.test.ts` checks that the primitives are built correctly, and
 * `motion-boundaries.test.ts` checks that feature code does not import the runtime directly. Both
 * can pass while this app still differs from the web: the same state change may be explained on the
 * web and drop abruptly here. That mismatch only shows when the two screens are compared side by
 * side.
 *
 * So this file locks representative consumers, not the count of every screen using every primitive.
 * Counting would push the next person to attach motion where it does not belong just to pass the
 * check. What is locked is the spots where the web has a consumer with the same meaning and the
 * native surface exists.
 *
 * This app's tests do not render screens (`vitest.config.ts`), so checks read source shape. Real
 * motion is verified on device (runtime QA in `README.md`).
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, prefix = ""): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? join(prefix, entry.name) : entry.name;
		if (entry.isDirectory()) {
			found.push(...walk(join(dir, entry.name), rel));
			continue;
		}
		if (!/\.tsx?$/.test(entry.name)) continue;
		if (/\.test\.tsx?$/.test(entry.name)) continue;
		found.push(rel);
	}
	return found;
}

/** All feature code. Confirms that the consumer-counting checks run against real files. */
const FEATURE_FILES = walk(join(SRC, "features")).map((path) =>
	join("features", path),
);

/**
 * ## Web ↔ native parity table
 *
 * This table is the point of this file. The values live only in documentation and tests, and
 * product code does not read them on purpose. A runtime registry would let screens announce their
 * own motion category, and at that moment motion would hold product state.
 *
 * The table does one thing: it stops someone from removing a case on one side only. If a state
 * change that the web still explains is dropped on native (or the reverse), this table breaks
 * first.
 */
type MotionParityCase = {
	/** What product event this is. It is what the user experiences, not a component name. */
	readonly concept: string;
	/** The web vocabulary that explains the event. */
	readonly web: string;
	/** The native counterpart. */
	readonly native: string;
	readonly status: "equivalent" | "intentional-difference";
	/** Representative files that actually use the native vocabulary. Empty for differences. */
	readonly consumers: readonly string[];
	/** Reason for a difference. It must be a platform or IA constraint, not a matter of taste. */
	readonly because?: string;
};

const PARITY: readonly MotionParityCase[] = [
	/**
	 * The separate "route arrived" line was removed.
	 *
	 * It used to be an intentional difference (web: `PageEnter`; native: the platform push). On device
	 * the push turned out to be a second movement that the web does not have. With the stack set to
	 * `animation: "none"`, the frame (header) stands from the first frame and only the body layer
	 * enters, which matches what the web shows, where the shell persists. So the two lines were folded
	 * into one: this app now has a single layer that signals arrival.
	 *
	 * This table does not guard that absence; `route-motion.test.ts` does (the stack animates nothing,
	 * the back gesture is alive, and entrance has no condition).
	 */
	{
		concept: "the screen's body resolved",
		web: "PageEnter",
		native: "PageEnter",
		status: "equivalent",
		consumers: [
			"features/account/account-screen.tsx",
			"features/settings/settings-general-screen.tsx",
			"features/settings/settings-ai-screen.tsx",
			"features/settings/settings-persona-screen.tsx",
			"features/create/draft-list-panel.tsx",
			"features/create/published-work-panel.tsx",
			"features/create/creator-analytics-panel.tsx",
			"features/create/draft-editor-screen.tsx",
			"features/story/story-detail-screen.tsx",
			"features/profile/creator-profile-screen.tsx",
		],
	},
	{
		concept: "the operation's answer appears and leaves",
		web: "AnimatePresence + feedbackEnter/feedbackExit",
		native: "FeedbackLine",
		status: "equivalent",
		consumers: [
			"features/account/email-section.tsx",
			"features/account/login-methods-section.tsx",
			"features/account/passkeys-section.tsx",
			"features/account/sessions-section.tsx",
			"features/account/profile-section.tsx",
			"features/account/avatar-field.tsx",
			"features/account/adult-visibility-control.tsx",
			"features/profile/follow-control.tsx",
		],
	},
	{
		concept: "rows with identity appear, disappear and move",
		web: "rowEnter / rowExit / layout",
		native: "MotionRow",
		status: "equivalent",
		consumers: [
			"features/account/sessions-section.tsx",
			"features/account/passkeys-section.tsx",
			"features/persona/persona-library-section.tsx",
			"features/chat/memory/panel.tsx",
			"features/create/lore-section.tsx",
			"features/create/start-scene-section.tsx",
			"features/create/scene-image-section.tsx",
		],
	},
	{
		concept: "the same control's glyph changes state",
		web: "AnimatedIconSwap",
		native: "AnimatedIconSwap",
		status: "equivalent",
		consumers: [
			"features/chat/composer.tsx",
			"features/chat/messages/action-bar.tsx",
			"features/chat/memory/panel.tsx",
		],
	},
	{
		concept: "the word swaps in place",
		web: 'AnimatePresence mode="wait" + labelSwapIn/Out',
		native: "AnimatedLabel",
		status: "equivalent",
		consumers: [
			"features/create/published-work-panel.tsx",
			"features/account/login-methods-section.tsx",
			"features/moderation/my-reports-section.tsx",
			"features/settings/provider-connections-section.tsx",
		],
	},
	{
		concept: "the number changes in place",
		web: "AnimatedCount",
		native: "AnimatedCount",
		status: "equivalent",
		consumers: [
			"features/create/creator-analytics-panel.tsx",
			"features/notifications/notification-shortcut.tsx",
			"features/profile/profile-header.tsx",
			"features/story/favorite-control.tsx",
			"features/chat/room/rename-dialog.tsx",
			"features/chat/memory/panel.tsx",
			"features/story/comments/comment-composer.tsx",
			"features/moderation/report-dialog.tsx",
			"features/moderation/appeal-dialog.tsx",
		],
	},
	{
		concept: "here among siblings — the active indicator stands",
		web: "MotionActiveIndicator (layoutId)",
		native: "MotionIndicatorGroup (measured frames)",
		status: "equivalent",
		consumers: [
			"features/shell/app-sidebar.tsx",
			"features/settings/settings-navigation.tsx",
			"features/notifications/notifications-tabs.tsx",
			// The dial in room settings: narration scope, description density, and expression level.
			"features/chat/room-settings/narration.tsx",
			"features/chat/room-settings/intensity.tsx",
		],
	},
	{
		/**
		 * The split between "appears" and "slides between" is the most recently changed row in this
		 * table.
		 *
		 * For a while both facts sat in one row as `equivalent`, and on device the second was false
		 * (runtime QA in `docs/motion/ARCHITECTURE.md`). Keeping them in one row would hide the
		 * difference just to keep the consumer check green, so the row is split: the first row still says
		 * both apps use the same vocabulary, and this row records that the vocabulary does different
		 * things at different moments.
		 *
		 * Half of that has changed. Once the settings shell became a layout route
		 * (`app/settings/_layout.tsx`), the indicator's movement carries across category switches. The
		 * notification tab's two segments are a state inside one screen, so their siblings never
		 * disappear. Both now slide. The one that remains is the drawer, which closes when an item is
		 * pressed.
		 */
		concept: "that indicator slides between siblings",
		web: "layoutId shared layout — the moving bar survives a route change",
		native:
			"settings and notifications slide · the drawer stands in its new place",
		status: "intentional-difference",
		consumers: [],
		because:
			"To slide, the sibling group has to survive the state change. The settings bar belongs to the layout route and meets that condition, and the notifications tab is state within one screen so it meets it from the start — what remains is the drawer, which closes the moment an item is pressed, so there are no siblings on screen to slide between. Reversing it would mean navigating with the drawer left open, and that is not a motion correction but a navigation IA change.",
	},
	{
		concept: "create's cell picker",
		web: "visible sibling tabs + active indicator",
		native:
			"Select — there are no siblings for the indicator to travel between",
		status: "intentional-difference",
		consumers: [],
		because:
			"It's the narrow-screen IA decision (`features/create/create-screen.tsx`). We don't invent an active indicator in a container whose siblings aren't visible.",
	},
	{
		concept: "the follow button's picture and word swap",
		web: "AnimatedIconSwap + word swap inside a hand-built button",
		native: "@rowcat/ui-native's Button — `icon` and `label` are scalars",
		status: "intentional-difference",
		consumers: [],
		because:
			"For product motion to enter the primitive, that package would have to know the app's motion vocabulary (the boundary runs the other way), and rebuilding the button by hand makes variants, targets and accessibility two copies.",
	},
];

describe("the parity table points at real code", () => {
	it("the feature files to check actually exist", () => {
		expect(FEATURE_FILES.length).toBeGreaterThan(100);
	});

	/** If a file listed in the table disappears, its row guards nothing. */
	it("every consumer in the table exists", () => {
		for (const entry of PARITY)
			for (const path of entry.consumers)
				expect(FEATURE_FILES, `${entry.concept}: ${path}`).toContain(path);
	});

	/** A difference exists only with a reason. A difference without one is an omission. */
	it("intended differences have a basis, and equal ones have consumers", () => {
		for (const entry of PARITY) {
			if (entry.status === "intentional-difference") {
				expect(entry.because, entry.concept).toBeTruthy();
				expect(entry.consumers, entry.concept).toHaveLength(0);
				continue;
			}
			expect(entry.consumers.length, entry.concept).toBeGreaterThan(0);
		}
	});
});

describe("the representative consumer actually uses that vocabulary", () => {
	/**
	 * Each listed spot must actually render the component. The check looks for the opening tag
	 * (`<Name`) so that a change which keeps the import but removes the call site does not pass.
	 */
	const VOCABULARY: Record<string, string> = {
		"the screen's body resolved": "PageEnter",
		"the operation's answer appears and leaves": "FeedbackLine",
		"rows with identity appear, disappear and move": "MotionRow",
		"the same control's glyph changes state": "AnimatedIconSwap",
		"the word swaps in place": "AnimatedLabel",
		"the number changes in place": "AnimatedCount",
		"here among siblings — the active indicator stands": "MotionIndicatorGroup",
	};

	it("every equal entry in the table has a vocabulary attached", () => {
		for (const entry of PARITY) {
			if (entry.status !== "equivalent") continue;
			expect(VOCABULARY[entry.concept], entry.concept).toBeTruthy();
		}
	});

	for (const entry of PARITY) {
		if (entry.status !== "equivalent") continue;
		const component = VOCABULARY[entry.concept];
		if (!component) continue;
		it(`${entry.concept} — <${component}>`, () => {
			for (const path of entry.consumers) {
				const text = stripComments(read(path));
				expect(text, `${path}: <${component}>`).toContain(`<${component}`);
			}
		});
	}
});

describe("numbers we decided not to roll", () => {
	/**
	 * Per-work rows are meant to be scanned. If twenty rows times three cells all rolled on one
	 * refresh, the screen of someone comparing would move as a whole. The rolling spot is the fixed
	 * set of three totals, and the web makes the same distinction (`creator-analytics-overview.tsx` vs
	 * `creator-analytics-work-list.tsx`).
	 *
	 * The totals and the rows live in the same file, so a file-level check cannot separate them. Only
	 * the body of the row component is extracted.
	 */
	it("per-story performance rows don't roll", () => {
		const path = join("features", "create", "creator-analytics-panel.tsx");
		const text = stripComments(read(path));
		const row = text.slice(text.indexOf("function AnalyticsRow"));
		expect(text, `${path}: AnalyticsRow`).toContain("function AnalyticsRow");
		expect(row, `${path}: AnalyticsRow`).not.toContain("<AnimatedCount");
	});
});

describe("places we decided not to use the vocabulary stay as they are", () => {
	/**
	 * Virtualized conversations have no arrival transition. The geometry of those screens belongs to
	 * the virtualizer, and the input belongs to the keyboard layer. Adding a layer on top makes
	 * scrolling jump (`motion-boundaries.test.ts` holds the same boundary per line).
	 */
	it("the conversation and story test screens have no PageEnter", () => {
		for (const path of [
			join("features", "chat", "chat-screen.tsx"),
			join("features", "playtest", "playtest-screen.tsx"),
		])
			expect(stripComments(read(path)), path).not.toContain("<PageEnter");
	});

	/**
	 * Pages appended by "load more" do not rise row by row. If twenty rows appeared one at a time on
	 * each `Show more`, the list would read as freshly created. The web rejected this for the same reason.
	 */
	it("infinite list rows have no MotionRow", () => {
		for (const path of [
			join("features", "discover", "discover-screen.tsx"),
			join("features", "notifications", "notifications-screen.tsx"),
			join("features", "chat-library", "chat-library-screen.tsx"),
			join("features", "profile", "creator-profile-screen.tsx"),
			join("features", "story", "story-detail-screen.tsx"),
			join("features", "create", "draft-list-panel.tsx"),
		])
			expect(stripComments(read(path)), path).not.toContain("<MotionRow");
	});

	/**
	 * Do not animate the arrival of a placeholder. On screens where one list shell covers loading,
	 * error, empty and result states, the moment the shell mounts is the moment the placeholder is
	 * drawn. Adding an arrival transition there would make waiting double up.
	 */
	it("list shell screens have no arrival transition", () => {
		for (const path of [
			join("features", "discover", "discover-screen.tsx"),
			join("features", "notifications", "notifications-screen.tsx"),
			join("features", "chat-library", "chat-library-screen.tsx"),
		])
			expect(stripComments(read(path)), path).not.toContain("<PageEnter");
	});
});
