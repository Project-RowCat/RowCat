import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically checks the motion policy of the runtime studio. This is a coding tool, and the rule
 * motion must keep here is: where speed is the value, changes are instant; only where a state
 * change needs explaining does anything move.
 *
 * Violations are silent. A fade around Monaco delays file switches by 180ms, a transition on the
 * resizer makes the handle trail the pointer, and an array-index key turns one diagnostic into
 * another. Types, renders, and value tests all still pass.
 *
 * The test checks the policy, not the style Motion emits (same convention as lib/motion/*.test.ts).
 * Real motion is checked in a browser: switch tabs quickly, hold an arrow key, drag the handle, and
 * toggle reduced motion.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (name: string) => readFileSync(join(HERE, name), "utf8");

/**
 * Source with comments removed. Headers in this folder name the rules they describe, so matching
 * against raw text would give false hits.
 */
const code = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Walks recursively. The folder now has subfolders, and a shallow read would miss the editor,
 * explorer, and command files entirely, so motion added there would still pass.
 */
const sourceNames = (dir = HERE, prefix = ""): string[] => {
	const found: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			found.push(...sourceNames(full, `${prefix}${name}/`));
			continue;
		}
		if (/\.tsx?$/.test(name) && !name.includes(".test."))
			found.push(prefix + name);
	}
	return found;
};

const sources = () =>
	sourceNames().map((name) => ({ name, source: code(read(name)) }));

describe("the editor is instant", () => {
	/**
	 * The component hosting Monaco has no motion at all. Changing files is the most frequent operation
	 * here, and a fade, slide, or cross-fade on top of it would delay showing the new model by that
	 * duration.
	 */
	it("runtime-code-editor.tsx does not bring in Motion", () => {
		const editor = code(read("editor/code-editor.tsx"));
		expect(editor).not.toMatch(/from "motion\//);
		expect(editor).not.toMatch(/AnimatePresence|<m\./);
	});

	/**
	 * The page assembles the panel geometry and so has no moving elements. If an `m.*` entered here,
	 * the claims 'no motion around Monaco' and 'panel width and height change instantly' could no
	 * longer be checked statically. This is why the narrow-screen pane choice and the editor's empty
	 * state live in their own files.
	 */
	it("runtime-studio-page.tsx has no moving elements", () => {
		const page = code(read("runtime-studio-page.tsx"));
		expect(page).not.toMatch(/from "motion\//);
		expect(page).not.toMatch(/AnimatePresence|<m\.|layoutId|PageEnter/);
	});

	/**
	 * The resizer value follows the pointer exactly. A CSS or Motion transition on size would make the
	 * handle trail the pointer and make a press-again undo just as late. Color transitions
	 * (`transition-colors`) are not covered: they are not geometry.
	 */
	it("the resizer has no size transition", () => {
		const resizer = code(read("layout/resizer.tsx"));
		expect(resizer).not.toMatch(/from "motion\//);
		expect(resizer).not.toMatch(
			/transition-(?:all|\[|width|height|transform)|duration-/,
		);
	});

	/**
	 * Panel width and height are set immediately through CSS variables and inline height. If those
	 * boxes became `m.div` or gained transition classes, collapsing the explorer (⌘B) or opening the
	 * bottom panel would make Monaco re-measure throughout the transition.
	 */
	it("pane geometry has no transition", () => {
		const page = code(read("runtime-studio-page.tsx"));
		for (const line of page.split("\n"))
			if (/--runtime-(?:explorer|preview)|layout\.panel/.test(line))
				expect(line).not.toMatch(/transition|duration/);
		expect(page).not.toMatch(/transition-\[|transition-all/);
	});
});

describe("active indicator", () => {
	/**
	 * The five surfaces (open tabs, active file, narrow-screen pane, panel tab, severity filter) are
	 * meant to be active together. If their names collided, the indicator would fly between surfaces.
	 * `active-indicator.test.ts` catches collisions between files; this test checks that all five
	 * actually exist, since a scan that finds nothing would pass forever.
	 */
	it("five surfaces move within their own namespaces", () => {
		const groups = new Map<string, string>();
		for (const { name, source } of sources())
			for (const match of source.matchAll(/\bgroup="([^"]+)"/g))
				groups.set(match[1] ?? "", name);
		expect(groups).toEqual(
			new Map([
				["runtime-editor-tab", "editor/tabs.tsx"],
				["runtime-explorer-active", "explorer/panel.tsx"],
				["runtime-mobile-tab", "layout/mobile-tabs.tsx"],
				["runtime-panel-tab", "layout/bottom-panel.tsx"],
				["runtime-problems-filter", "layout/bottom-panel.tsx"],
			]),
		);
	});

	/**
	 * The indicator does not carry state. If the background drops in place (reduced motion or dropped
	 * frames), which item is active must still be conveyed by accessibility attributes and text style.
	 */
	it("accessibility attributes still state the active state", () => {
		expect(code(read("editor/tabs.tsx"))).toMatch(/aria-selected=\{selected\}/);
		expect(code(read("layout/mobile-tabs.tsx"))).toMatch(
			/aria-selected=\{selected\}/,
		);
		expect(code(read("explorer/panel.tsx"))).toMatch(/aria-current=\{/);
		expect(code(read("layout/bottom-panel.tsx"))).toMatch(
			/aria-pressed=\{active\}/,
		);
	});

	/**
	 * Layout projection is used only for the active indicator. Trees and diagnostic lists can have
	 * hundreds of lines; a `layout` on each row would re-measure all of them on every render. Here
	 * `layoutId` appears only inside `MotionActiveIndicator`.
	 */
	it("rows get no layout", () => {
		for (const { name, source } of sources()) {
			expect(source, name).not.toMatch(/\blayoutId=/);
			expect(source, name).not.toMatch(/\blayout=/);
			expect(source, name).not.toMatch(/\blayout\b\s*$/m);
		}
	});
});

describe("keys are identity", () => {
	/**
	 * The editor tab key is the file id. A path key would make a rename look like close-and-reopen,
	 * and an index key would leave the active indicator 'in place' on a different file when a
	 * neighboring tab closes.
	 */
	it("editor tabs are keyed by file id", () => {
		expect(code(read("editor/tabs.tsx"))).toMatch(
			/<ContextMenu key=\{file\.id\}/,
		);
	});

	/**
	 * Explorer file rows are keyed by file id too. A path key would make a rename read as delete plus
	 * create in presence, so the same file would vanish and reappear. Folders have no record, so their
	 * path is their identity.
	 */
	it("explorer file rows are keyed by file id, folder rows by path", () => {
		const explorer = code(read("explorer/panel.tsx"));
		expect(explorer).toMatch(/`file:\$\{node\.fileId\}`/);
		expect(explorer).toMatch(/`folder:\$\{node\.path\}`/);
		expect(explorer).toMatch(/key=\{nodeKey\(/);
	});

	/**
	 * Diagnostic row keys are `problem.key` (position plus code). An index key would make a filter
	 * change look like a row turning into a different diagnostic, and the screen would disagree with
	 * the canonical sort in runtime-problems.ts.
	 */
	it("diagnostic rows are keyed by problem.key", () => {
		const panel = code(read("layout/bottom-panel.tsx"));
		expect(panel).toMatch(/key=\{problem\.key\}/);
	});

	/**
	 * Moving elements never take positional keys. Path and highlight segments that derive identity
	 * from position are fine, since they are non-reordering text. Presence always keys on value
	 * identity.
	 */
	it("moving elements are not keyed by position", () => {
		for (const { name, source } of sources())
			expect(source, name).not.toMatch(/<m\.\w+[^>]*key=\{index\}/);
	});
});

describe("row entry and exit", () => {
	/**
	 * Exiting rows are not pressed. The guard is on presence state (exit-guard.ts); putting it on the
	 * `exit` target would never apply on a tab where frames do not arrive.
	 */
	it("exiting rows can't be pressed, and that guard isn't on the animation target", () => {
		for (const name of ["explorer/panel.tsx", "layout/bottom-panel.tsx"]) {
			const source = code(read(name));
			expect(source, name).toMatch(/useExitGuard\(\)/);
			expect(source, name).toMatch(/style=\{exiting\}/);
			expect(source, name).not.toMatch(/pointerEvents/);
		}
	});

	/**
	 * Rows present on first render do not animate in. If the whole tree animated when the studio
	 * opened, or thirty diagnostic lines animated when the panel opened, the screen would read as just
	 * built. Each folder expansion would also animate its children.
	 */
	it("presence suppresses the first render's entry", () => {
		for (const name of ["explorer/panel.tsx", "layout/bottom-panel.tsx"]) {
			const source = code(read(name));
			const presences = source.match(/<AnimatePresence\b[^>]*>/g) ?? [];
			expect(presences.length, name).toBeGreaterThan(0);
			for (const presence of presences)
				expect(presence, name).toMatch(/initial=\{false\}/);
		}
	});

	/** No list in this repo uses popLayout, so exiting rows stay in the flow. */
	it("does not use popLayout", () => {
		for (const { name, source } of sources())
			expect(source, name).not.toMatch(/popLayout/);
	});

	/**
	 * No sequential entrance. If thirty diagnostic lines entered one by one, the list would take
	 * seconds to finish, and the screen would look as if it had not yet answered.
	 */
	it("no staggered entry", () => {
		for (const { name, source } of sources())
			expect(source, name).not.toMatch(/stagger|delayChildren|delay:/);
	});
});

describe("the policy has one owner", () => {
	/**
	 * Reduced motion is decided once, by the global `MotionConfig reducedMotion="user"`. If the screen
	 * asked the preference again, two systems would answer the same question and could diverge on
	 * server render.
	 */
	it("reduced motion is not re-decided here", () => {
		for (const { name, source } of sources())
			expect(source, name).not.toMatch(
				/matchMedia|useReducedMotion|prefers-reduced-motion|MotionConfig|LazyMotion/,
			);
	});

	/**
	 * Animated elements come only from `motion/react-m` (engine.test.ts scans the whole app). Checked
	 * again here because this folder is the newest consumer of that rule.
	 */
	it("animated elements come only from motion/react-m", () => {
		for (const { name, source } of sources()) {
			expect(source, name).not.toMatch(/<motion\./);
			expect(source, name).not.toMatch(
				/import\s+\{[^}]*\bmotion\b[^}]*\}\s+from\s+"motion\/react"/,
			);
		}
	});

	/**
	 * Durations and curves come from `@rowcat/design` (feedback.test.ts scans the whole app). Every
	 * transition in this folder passes through a name from `lib/motion`.
	 */
	it("durations and curves are not hand-written", () => {
		for (const { name, source } of sources()) {
			expect(source, name).not.toMatch(/\bduration:\s*[\d.]/);
			expect(source, name).not.toMatch(/\bease:\s*\[/);
			expect(source, name).not.toMatch(/stiffness|damping|type:\s*"spring"/);
		}
	});

	/**
	 * Motion holds no product state. If delete, move, save, or focus waited for an animation to
	 * finish, that action would never happen on a tab where frames do not arrive.
	 */
	it("no product operations in completion callbacks", () => {
		for (const { name, source } of sources())
			expect(source, name).not.toMatch(
				/onAnimationComplete|onExitComplete|onLayoutAnimationComplete/,
			);
	});

	/** No always-running decoration. The screen comes to a full stop when the user lets go. */
	it("no always-running decoration", () => {
		for (const { name, source } of sources())
			expect(source, name).not.toMatch(
				/animate-pulse|animate-bounce|animate-ping|repeat:\s*Infinity|repeatType/,
			);
	});
});

describe("uses the shared rhythm", () => {
	/**
	 * This folder defines no rhythm of its own. Entrance, exit, wording, counts, and the active
	 * indicator all use `lib/motion` names; there are no copies such as `RuntimeAnimatedLabel`.
	 */
	it("uses only lib/motion names", () => {
		const imports = new Set<string>();
		for (const { source } of sources())
			for (const match of source.matchAll(
				/import\s+\{([^}]+)\}\s+from\s+"#\/lib\/motion\/[^"]+"/g,
			))
				for (const name of (match[1] ?? "").split(","))
					imports.add(name.trim());
		expect([...imports].sort()).toEqual([
			"AnimatedCount",
			// Glyph ↔ spinner swap on the add-asset button, the same swap pattern as copy and follow.
			"AnimatedIconSwap",
			"COPY_FEEDBACK_MS",
			"MotionActiveIndicator",
			"contentEnter",
			"contentExit",
			"rowEnter",
			"rowExit",
			"standardTransition",
			"useExitGuard",
		]);
		for (const name of sourceNames())
			expect(name).not.toMatch(/animated|motion-|transition/i);
	});

	/**
	 * Quick open adds nothing on top of the shared dialog's motion. The result list changes on every
	 * keystroke, so it is instant; the only motion is the entrance of the empty-state sentence.
	 */
	it("the quick open result list is instant", () => {
		const dialog = code(read("commands/quick-open-dialog.tsx"));
		expect(dialog).not.toMatch(/<m\.(?:ul|li)\b/);
		expect(dialog).not.toMatch(/AnimatePresence/);
	});

	/**
	 * Delete confirmation and context menus use the primitive's motion as-is. No second transition is
	 * layered on top.
	 */
	it("no second transition on dialogs and menus", () => {
		for (const name of [
			"explorer/delete-dialog.tsx",
			"runtime-studio-header.tsx",
		])
			expect(code(read(name)), name).not.toMatch(
				/<m\.div|DialogContent[^>]*initial/,
			);
	});
});
