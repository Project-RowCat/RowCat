import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of the places where selection state diverges: checkbox, switch, tabs and select. They
 * look different but say the same thing: the same item changed state. The scan exists because the
 * mistakes that break this always have the same shape. A second copy of the primitive's state is
 * created in React to attach a transition, so there are two sources of truth. The screen then holds
 * that state, and the indicator becomes the state.
 *
 * It checks policy, not the browser's computed styles. Real motion is verified in a browser. Same
 * convention as boundaries.test.ts and primitive-motion.test.ts.
 */

const read = (name: string) =>
	readFileSync(
		fileURLToPath(new URL(`./components/${name}`, import.meta.url)),
		"utf8",
	);

/**
 * Source with comments removed, so comments that name the rule they describe do not flag themselves
 * (same reason as boundaries.test.ts).
 */
const codeOf = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const checkbox = read("checkbox.tsx");
const checkboxCode = codeOf(checkbox);
const switchSource = read("switch.tsx");
const switchCode = codeOf(switchSource);
const tabs = read("tabs.tsx");
const tabsCode = codeOf(tabs);
const select = read("select.tsx");
const selectCode = codeOf(select);
const menuCode = codeOf(read("dropdown-menu.tsx"));
const sliderCode = codeOf(read("slider.tsx"));

describe("check mark", () => {
	/**
	 * If this check finds nothing, every assertion below passes silently. Confirm the target exists
	 * first.
	 */
	it("there is something to scan", () => {
		expect(checkboxCode).toContain("CheckboxPrimitive.Indicator");
	});

	/**
	 * Core rule: Base UI alone owns checked state. A useState copy of checked, added to drive a
	 * transition, would eventually diverge from the real value in controlled consumers (forms, consent
	 * screens and report dialogs all use that). The symptom is not an error. It is 'checked, but the
	 * indicator does not follow.'
	 */
	it("does not keep a second copy of the check state in React", () => {
		expect(checkboxCode).not.toMatch(/\buseState\b/);
		expect(checkboxCode).not.toMatch(/\buseEffect\b/);
		expect(checkboxCode).not.toMatch(/\buseRef\b/);
	});

	/**
	 * The primitive's lifetime is not changed. keepMounted would leave the check glyph inside
	 * unchecked boxes, and hiding it would depend on class strings in this file. One misplaced line
	 * would show a check in an off box.
	 */
	it("does not force-mount the indicator", () => {
		expect(checkboxCode).not.toMatch(/keepMounted/);
	});

	/**
	 * Transitions need both lifetime attributes Base UI exposes. With only one, only one direction
	 * moves, and that asymmetry reintroduces the original problem (the glyph pops out) in the other
	 * direction.
	 */
	it("reads both entering and exiting states", () => {
		expect(checkboxCode).toMatch(/data-starting-style:/);
		expect(checkboxCode).toMatch(/data-ending-style:/);
	});

	/**
	 * Both states must animate opacity. Base UI waits for getAnimations() on the indicator before
	 * unmounting it. A motion without opacity is invisible to that check, so the exit gets cut off.
	 * Popups follow the same rule (primitive-motion.ts).
	 */
	it.each([
		"data-starting-style",
		"data-ending-style",
	])("%s has both opacity and scale", (state) => {
		expect(checkboxCode).toContain(`${state}:opacity-0`);
		expect(checkboxCode).toMatch(new RegExp(`${state}:scale-\\d`));
	});

	/**
	 * The box does not change size; only the glyph moves. If the box scaled, adjacent text would
	 * shift.
	 */
	it("the box size stays the same", () => {
		expect(checkboxCode).toContain("size-4");
		expect(checkboxCode).not.toMatch(/data-checked:scale-/);
	});

	/**
	 * The rhythm comes from lib/primitive-motion.ts. Milliseconds written in class strings would not
	 * follow token changes.
	 */
	it("writes no duration or curve in classes", () => {
		expect(checkboxCode).toContain("checkboxIndicatorRhythm");
		expect(checkboxCode).not.toMatch(/\bduration-\[?\d/);
		expect(checkboxCode).not.toMatch(/\bease-\[/);
	});

	/**
	 * Reduced motion reaches this too: only the transform is removed, while opacity keeps flowing.
	 * This matches what the app's MotionConfig reducedMotion="user" does for Motion.
	 */
	it("reduced motion removes only transforms", () => {
		expect(checkboxCode).toContain("motion-reduce:transition-opacity");
	});

	/**
	 * The stroke is empty only on the first frame of entry. The basis is the same lifetime attribute
	 * the indicator uses (data-starting-style). The exit attribute does not touch the stroke. A
	 * rewinding stroke reads as erasing, which would make unchecking a heavier event than it should
	 * be.
	 */
	it("the stroke is empty only on the first entering frame", () => {
		expect(checkboxCode).toMatch(
			/group-data-starting-style\/indicator:\[stroke-dashoffset:var\(--stroke-length\)\]/,
		);
		expect(checkboxCode).not.toMatch(
			/data-ending-style[^"\s]*stroke-dashoffset/,
		);
	});

	/**
	 * The stroke length lives in one place. A number written into the class would be a second copy
	 * that does not follow path changes, and a shortened dash silently cuts off the end of the check.
	 */
	it("writes no dash length number in classes", () => {
		// `:0` in the pattern means fully drawn, not a length.
		expect(checkboxCode).not.toMatch(/stroke-dash(?:array|offset):[1-9]/);
		expect(checkboxCode).toContain("--stroke-length");
	});

	/**
	 * The stroke is spatial movement, so it snaps under reduced motion. The indicator's opacity still
	 * flows, so the state change is still readable. Same judgment as the transform removal above.
	 */
	it("reduced motion snaps the stroke", () => {
		const strokes =
			checkboxCode.match(/transition-\[stroke-dashoffset\][^"]*/g) ?? [];
		expect(strokes.length).toBeGreaterThan(0);
		for (const stroke of strokes)
			expect(stroke).toContain("motion-reduce:transition-none");
	});

	it("the stroke's rhythm also comes from `primitive-motion.ts`", () => {
		expect(checkboxCode).toContain("checkboxTickDrawRhythm");
	});

	/**
	 * Indeterminate is not a check. Base UI draws the indicator in both states, but data-checked is
	 * set only on the checked one. If the fill were tied to that attribute alone, a mixed box would be
	 * an empty frame with a foreground glyph. If the check glyph stayed, 'partly selected' would read
	 * as 'selected'.
	 */
	it("the mixed state is filled with a horizontal stroke", () => {
		expect(checkboxCode).toContain("data-indeterminate:bg-primary");
		expect(checkboxCode).toContain("group-data-indeterminate/indicator:hidden");
		expect(checkboxCode).toContain("group-data-indeterminate/indicator:block");
	});
});

describe("menu check mark", () => {
	/**
	 * In the sort menu, picking `Popular` (popularity) leaves the period picker open, and radio rows
	 * default to open. If the indicator jumped between rows in that gap, the same glyph would convey
	 * the same meaning on two rhythms.
	 */
	it.each([
		"CheckboxItemIndicator",
		"RadioItemIndicator",
	])("%s reads the same rhythm and lifetime attributes", (indicator) => {
		expect(menuCode).toMatch(
			new RegExp(
				`<MenuPrimitive\\.${indicator}\\s+style=\\{menuIndicatorRhythm\\}\\s+className=\\{menuIndicatorClassName\\}`,
			),
		);
	});

	it("entering and exiting states both have opacity", () => {
		expect(menuCode).toContain("data-starting-style:opacity-0");
		expect(menuCode).toContain("data-ending-style:opacity-0");
		expect(menuCode).toContain("motion-reduce:transition-opacity");
	});

	/**
	 * The one place this differs from the checkbox: no stroke. A single selection in a radio group
	 * moves the mark from one row to another. Adding a stroke would turn that single choice into three
	 * motions (the leaving mark, the arriving mark, and the stroke). See menuIndicatorRhythm.
	 */
	it("draws no stroke", () => {
		expect(menuCode).not.toContain("stroke-dashoffset");
	});

	it("does not keep a second copy of the indicator state in React", () => {
		expect(menuCode).not.toMatch(/\buseState\b/);
		expect(menuCode).not.toMatch(/keepMounted/);
	});
});

describe("slider thumb", () => {
	/**
	 * A hover ring alone says nothing while dragging by touch, because touch has no hover.
	 * data-dragging, which Base UI sets during a drag, is the only signal for that state. It is not
	 * held in React state.
	 */
	it("says it is held while dragging", () => {
		expect(sliderCode).toMatch(/data-dragging:ring-4/);
		expect(sliderCode).not.toMatch(/\buseState\b/);
	});

	/**
	 * The thumb's position does not animate. The value has already changed and the adjacent preview
	 * (gradient or crop image) updates immediately. If the thumb slid to follow, the two would drift
	 * apart.
	 */
	it("does not interpolate the thumb and range positions", () => {
		expect(sliderCode).not.toMatch(
			/transition-(?:all|\[[^\]]*(?:left|inset|width|translate))/,
		);
	});
});

describe("switch", () => {
	it("there is something to scan", () => {
		expect(switchCode).toContain("SwitchPrimitive.Thumb");
	});

	/**
	 * Core rule: the rhythm comes from lib/primitive-motion.ts. The mistake this check catches is
	 * silent: deleting the single `style={switchRhythm}` line raises no error. The thumb once rolled
	 * at Tailwind's defaults (150ms, a different curve). Now the theme's default transition points at
	 * the same token (--default-transition-*), so removing the line changes nothing today, which makes
	 * it quieter still. The name is what shows where to change the rhythm if the switch must diverge
	 * from app-wide hover.
	 */
	it("writes no duration or curve in classes", () => {
		expect(switchCode).toContain("switchRhythm");
		expect(switchCode).not.toMatch(/\bduration-\[?\d/);
		expect(switchCode).not.toMatch(/\bease-\[/);
	});

	/**
	 * The thumb animates a single property (transform), so reduced motion removes the whole
	 * transition. The state is still conveyed by the track color. The property list must sit in the
	 * class layer so the variant can override it (same rule as primitive-motion.ts).
	 */
	it("reduced motion snaps the thumb", () => {
		expect(switchCode).toContain("motion-reduce:transition-none");
	});

	it("does not keep a second copy of the check state in React", () => {
		expect(switchCode).not.toMatch(/\buseState\b/);
		expect(switchCode).not.toMatch(/\buseEffect\b/);
	});
});

describe("select popup", () => {
	it("there is something to scan", () => {
		expect(selectCode).toContain("SelectPrimitive.Popup");
	});

	/**
	 * Core rule: motion is on the closing side only, and only that side can be expressed because of
	 * the primitive's lifetime. Base UI sets inline transition: none during 'starting' so the
	 * selection opens instantly, and on close it waits for the popup's animation before hiding the
	 * positioner (rationale in selectPopupRhythm's comment). Adding opening-side styles would be dead
	 * code and would look like an attempt to override that protection, so this is locked too.
	 */
	it("only closing moves, by opacity", () => {
		expect(selectCode).toContain("data-ending-style:opacity-0");
		expect(selectCode).toContain("transition-opacity");
		expect(selectCode).not.toContain("data-starting-style:");
	});

	/**
	 * Opacity only. This select places the chosen item over the trigger word (alignItemWithTrigger),
	 * so movement or scaling would pull the item off that word. For the same reason there is no
	 * motion-reduce narrowing: opacity is not an axis that reduced motion removes.
	 */
	it("does not move or shrink while closing", () => {
		expect(selectCode).not.toMatch(/data-ending-style:(?:scale|translate|-)/);
	});

	/**
	 * The class references the token CSS variables for rhythm. Unlike the checkbox and switch, this
	 * popup does not carry its rhythm in inline style, because the alignment layout rewrites the style
	 * attribute and erases the transition values React placed there. This was measured. At that time
	 * the transition silently fell back to Tailwind's 150ms default; now it falls back to the theme's
	 * default transition. Removing the variable reference would be exactly the same silent regression,
	 * so its presence is locked.
	 */
	it("references duration and curve through token variables", () => {
		expect(selectCode).toContain("duration-(--motion-duration-primitive)");
		expect(selectCode).toContain("ease-(--motion-easing-standard)");
		expect(selectCode).not.toMatch(/\bduration-\[?\d/);
		expect(selectCode).not.toMatch(/\bease-\[/);
	});
});

describe("active tab indicator", () => {
	it("there is something to scan", () => {
		expect(tabsCode).toContain("TabsPrimitive.Indicator");
	});

	/**
	 * Core rule: there is one indicator. Giving each row its own background would make selection read
	 * as 'one turns off, another turns on'. What actually happened is that one selection moved. So
	 * neither the background nor the underline may remain on the trigger. A leftover would create two
	 * indicators, and the moving and the turning-on would overlap.
	 */
	it("the trigger has no background of its own", () => {
		const trigger = tabsCode.slice(tabsCode.indexOf("function TabsTrigger"));
		expect(trigger).not.toMatch(/data-active:bg-/);
		expect(trigger).not.toMatch(/data-active:shadow-/);
		expect(trigger).not.toMatch(/after:/);
	});

	/** The active tab keeps its own text color. The indicator handles the background. */
	it("the trigger keeps the active text color", () => {
		expect(tabsCode).toContain("data-active:text-foreground");
	});

	/**
	 * The indicator is positioned at the inner edge of the list. Without `relative`, absolute
	 * positioning climbs to an ancestor and the indicator lands somewhere else on screen. The failure
	 * is visible, but it does not show which class caused it.
	 */
	it("the list is the indicator's reference", () => {
		expect(tabsCode).toMatch(/group\/tabs-list relative/);
	});

	/**
	 * The indicator reads the values Base UI measured (--active-tab-width, --active-tab-left). If this
	 * code called getBoundingClientRect or set up a ResizeObserver, it would have to remeasure on
	 * every scroll, resize and font load. Missing one would leave the indicator in the wrong place.
	 */
	it("we do not measure positions", () => {
		expect(tabsCode).toContain("--active-tab-width");
		expect(tabsCode).toContain("--active-tab-left");
		expect(tabsCode).not.toMatch(
			/getBoundingClientRect|ResizeObserver|offsetLeft/,
		);
		expect(tabsCode).not.toMatch(
			/\buseState\b|\buseEffect\b|\buseLayoutEffect\b/,
		);
	});

	/**
	 * No shared layout name. The app's active indicator moves via a global layoutId, which requires a
	 * namespace (active-indicator.tsx). A shared primitive cannot answer that: several Tabs may be
	 * mounted on one screen, and none of them can supply a unique name. Scoping by the DOM removes the
	 * question.
	 */
	it("makes no global layout name", () => {
		expect(tabsCode).not.toMatch(/layoutId|LayoutGroup|useId/);
	});

	/**
	 * The two variants are different things: a filled surface and a 2px line. A list has only one
	 * variant, so they cannot mix, but the separation must live in the class code so that changing one
	 * does not touch the other.
	 */
	it("the surface and the line each have their own variant", () => {
		expect(tabsCode).toContain("tabsIndicatorVariants");
		const indicator = tabsCode.slice(
			tabsCode.indexOf("const tabsIndicatorVariants"),
			tabsCode.indexOf("function TabsList"),
		);
		expect(indicator).toMatch(/default:\s*\n?\s*"[^"]*bg-background/);
		expect(indicator).toMatch(/line: "[^"]*after:bg-foreground/);
	});

	/**
	 * The indicator is decorative and must not take pointer events. If it sat over the trigger and
	 * took clicks, the tab would stop working.
	 */
	it("the indicator does not intercept presses", () => {
		expect(tabsCode).toContain("pointer-events-none");
	});

	it("writes no duration or curve in classes", () => {
		expect(tabsCode).toContain("tabsIndicatorRhythm");
		expect(tabsCode).not.toMatch(/\bduration-\[?\d/);
		expect(tabsCode).not.toMatch(/\bease-\[/);
	});

	it("reduced motion removes movement", () => {
		expect(tabsCode).toContain("motion-reduce:transition-none");
	});

	/**
	 * Tab content is not part of this slice. Content can include forms, focusable controls and
	 * components that size themselves. Putting those under a transition would make focus jitter inside
	 * a moving box and force auto-height to recalculate every frame. Only the indicator moves.
	 */
	it("cell content has no motion", () => {
		const content = tabsCode.slice(tabsCode.indexOf("function TabsContent"));
		expect(content).not.toMatch(/motion|animate|transition|AnimatePresence/);
	});
});

/**
 * Accessibility authority stays with Base UI. This block catches changes that swap a primitive out
 * to make it prettier. Doing so removes keyboard navigation, roles, state and form integration all
 * at once, while the screen still looks fine.
 */
describe("primitives carry semantics", () => {
	it("the checkbox stands on Base UI", () => {
		expect(checkboxCode).toContain("CheckboxPrimitive.Root");
		expect(checkboxCode).not.toMatch(/<button|type="checkbox"|role="checkbox"/);
	});

	it.each([
		["TabsPrimitive.Root"],
		["TabsPrimitive.List"],
		["TabsPrimitive.Tab"],
		["TabsPrimitive.Panel"],
	])("tabs use %s as is", (part) => {
		expect(tabsCode).toContain(part);
	});

	/** The screen does not decide which tab is active. Drawing is always based on data-active. */
	it("screens do not re-decide the active state", () => {
		expect(tabsCode).not.toMatch(/\bvalue\s*===|selected\s*===|activeTab\s*\?/);
	});

	/**
	 * A moving indicator does not state status; the primitive does. The checkbox's
	 * `aria-invalid:aria-checked:` is not flagged here. That class reads state the primitive already
	 * wrote in order to pick a color. It does not claim state. Blocking it would also block styles
	 * from following state.
	 */
	it("the indicator does not assert state itself", () => {
		expect(tabsCode).not.toMatch(/aria-selected=|role="tab"/);
		expect(checkboxCode).not.toMatch(/aria-checked=/);
	});
});
