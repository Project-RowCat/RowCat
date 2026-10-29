import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lineHeight, space } from "@rowcat/design";
import { describe, expect, it } from "vitest";
import { controlHeight, targetSlop, touchTarget } from "./metrics.ts";

/**
 * Locks the semantics of the primitives, not their look. The package's tests do not render React,
 * as in apps/mobile. They check whether the accessibility axis exists in the code, not a snapshot.
 * Regressions here are silent: an unnamed button still works, and a button without `busy` still
 * runs. Only people using assistive tech find that the app has become unusable for them.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const codeOf = (file: string): string =>
	readFileSync(`${HERE}${file}`, "utf8")
		.replaceAll(/\/\*[\s\S]*?\*\//g, " ")
		.replaceAll(/(^|[^:])\/\/.*$/gm, "$1");

describe("button", () => {
	const button = codeOf("button.tsx");

	it("announces disabled and busy as states", () => {
		expect(button).toMatch(/accessibilityState=\{\{\s*disabled/);
		expect(button).toContain("busy: Boolean(busy)");
	});

	/**
	 * While busy, the button must actually not press. Otherwise the same request goes out twice.
	 * Visual dimming alone is not enough.
	 */
	it("really cannot be pressed while busy", () => {
		expect(button).toContain("const blocked = Boolean(busy || disabled);");
		expect(button).toContain("disabled={blocked}");
	});

	/**
	 * An icon-only button is read as just "button" by screen readers. The required `label` of
	 * IconButton is what keeps it named.
	 */
	it("IconButton's name is required", () => {
		const icon = button.slice(button.indexOf("export function IconButton"));
		expect(icon).toContain("label: string;");
		/**
		 * If `label` were optional (`label?:`), an unnamed button would become expressible. The check
		 * blocks that.
		 */
		expect(icon).not.toContain("label?:");
		expect(icon).toContain("accessibilityLabel={label}");
	});

	/**
	 * A toggle button must not rely on color alone. The selected state is announced to assistive tech.
	 */
	it("IconButton announces selection as state", () => {
		expect(button).toContain("...(selected === undefined ? {} : { selected })");
	});

	/**
	 * Color-blind users read blue text as plain text. The underline keeps the link affordance without
	 * color.
	 */
	it("link buttons keep their underline", () => {
		expect(button).toContain('textDecorationLine: "underline"');
	});
});

describe("the button foreground follows the variant", () => {
	const button = codeOf("button.tsx");

	/**
	 * This table records the defect this slice fixed. The label and spinner followed the variant, but
	 * the icon was fixed to `tone="foreground"`. On the light theme the primary surface is nearly
	 * black, so its icon was black on black. On the dark theme the same pairing was inverted and
	 * looked fine. Each theme therefore hid one broken pairing, and neither the type checker nor
	 * rendering catches it, since both values are valid color names.
	 */
	const EXPECTED = {
		primary: "primary-foreground",
		secondary: "secondary-foreground",
		outline: "foreground",
		ghost: "foreground",
		destructive: "destructive",
	} as const;

	/** Reads the table from source, because this package's tests do not import components. */
	const declared: Record<string, string> = Object.fromEntries(
		[
			...(
				/export const BUTTON_FOREGROUND = \{([\s\S]*?)\}/.exec(button)?.[1] ??
				""
			).matchAll(/(\w+):\s*"([a-z-]+)"/g),
		].map(([, variant, tone]) => [variant, tone]),
	);

	it("the table really exists", () => {
		expect(Object.keys(declared).sort()).toEqual(Object.keys(EXPECTED).sort());
	});

	it.each(
		Object.entries(EXPECTED),
	)("%s's foreground is %s", (variant, tone) => {
		expect(declared[variant]).toBe(tone);
	});

	/**
	 * What is guaranteed is that the three read the same cell. Reverting to per-component color
	 * choices would break this check.
	 */
	it("label, icon and spinner read the same cell", () => {
		expect(button).toContain("const foreground = BUTTON_FOREGROUND[variant];");
		expect(button).toContain("const ink = colors[foreground];");
		expect(button).toContain('<ActivityIndicator size="small" color={ink} />');
		expect(button).toContain(
			'<Icon name={icon} size="md" tone={foreground} />',
		);
		expect(button).toContain("{ color: ink }");
	});

	/**
	 * There is exactly one shape of regression: an icon inside `Button` fixing a color name again.
	 * `IconButton` has no variants and takes `tone` as an argument, so it is outside this check.
	 */
	it("Button's icon does not pin a color name", () => {
		const body = button.slice(
			button.indexOf("export function Button"),
			button.indexOf("export function IconButton"),
		);
		expect(body).not.toMatch(/tone="[a-z-]+"/);
	});
});

describe("state surfaces", () => {
	const state = codeOf("state.tsx");

	/**
	 * `alert` tells the screen reader to interrupt what it is saying. That is right for failures only.
	 * On an informational state it would interrupt on every open.
	 */
	it("the alert role attaches only to destructive", () => {
		expect(state).toContain('accessibilityRole={failed ? "alert" : undefined}');
		expect(state).toContain('const failed = tone === "destructive";');
	});
});

describe("decoration is not in the accessibility tree", () => {
	/**
	 * Beside an avatar the name is always present as text. Labeling the image too would make the
	 * screen reader say the name twice, so a list of twenty comments would become forty lines of
	 * speech.
	 */
	it("avatars hide from screen readers", () => {
		const avatar = codeOf("avatar.tsx");
		expect(avatar).toContain("accessible={false}");
		expect(avatar).toContain("accessibilityElementsHidden");
		expect(avatar).toContain('importantForAccessibility="no-hide-descendants"');
	});

	/** An icon without a label is decorative. That decision lives in `Icon` alone. */
	it("unnamed icons fold to decoration", () => {
		expect(codeOf("icon.tsx")).toContain("accessible={label !== undefined}");
	});
});

describe("destructive color comes from semantic tokens", () => {
	/**
	 * If `destructive` became a red literal, contrast would break on the light theme. The two themes'
	 * values are intentionally different (see the comment on tokens.ts in @rowcat/design).
	 */
	it("buttons, badges and notices read the destructive token", () => {
		for (const file of ["button.tsx", "badge.tsx", "state.tsx"]) {
			const code = codeOf(file);
			expect(code, file).toMatch(/colors\.destructive|alpha\("destructive"/);
		}
	});
});

describe("targets fit a finger", () => {
	/**
	 * The iOS HIG and Material floor. If this drops, card hearts start hitting the neighboring card.
	 */
	it("the minimum target is 44pt", () => {
		expect(touchTarget).toBe(44);
	});

	/**
	 * These are the web's `h-8`, `h-9`, and `h-10`. The test pins them because drift is silent: one
	 * could grow and the screen would still look fine. Only comparing the two apps side by side shows
	 * it.
	 */
	it("visible control heights match the web scale", () => {
		expect(controlHeight).toEqual({ sm: 32, md: 36, lg: 40 });
	});

	/**
	 * The target stays at 44. With only this line, the change would reduce accessibility. With only
	 * the line above, density would diverge from the web. Both must hold together.
	 */
	it("targetSlop widens targets to 44 at every size", () => {
		for (const visible of Object.values(controlHeight)) {
			expect(visible + 2 * targetSlop(visible)).toBeGreaterThanOrEqual(
				touchTarget,
			);
		}
	});

	/** Zero when the target is already 44 or more. Negative slack would shrink the target. */
	it("targetSlop never returns negatives", () => {
		expect(targetSlop(touchTarget)).toBe(0);
		expect(targetSlop(80)).toBe(0);
	});

	/**
	 * Every standalone control adds the slack. With a visible height of 36, a control without
	 * `hitSlop` has a target under 44. The gap is invisible on screen; it shows only when a finger
	 * misses.
	 */
	it("standalone controls widen targets with hitSlop", () => {
		for (const file of [
			"button.tsx",
			"select.tsx",
			"menu.tsx",
			"navigation-drawer.tsx",
			"sheet.tsx",
		]) {
			expect(codeOf(file), file).toMatch(/hitSlop=\{targetSlop\(/);
		}
	});

	/**
	 * Adjacent rows must not get `hitSlop`. Overlapping targets go to whichever sibling was drawn
	 * later, so a finger can hit a row other than the one it sees. This failure leaves no trace.
	 */
	it("menu and select rows have no hitSlop", () => {
		for (const file of ["menu.tsx", "select.tsx"]) {
			const code = codeOf(file);
			expect(code.match(/hitSlop=/g)?.length, file).toBe(1);
		}
	});

	/**
	 * A link button is a single line of text, so its visible height falls short of 44. `hitSlop` fills
	 * the rest. The screen looks the same without it; only a finger notices. It must still exceed 44
	 * at the smallest variant (caption, 16pt line height).
	 */
	it("link button targets exceed 44pt through hitSlop", () => {
		expect(codeOf("button.tsx")).toMatch(/hitSlop=\{space\.lg\}/);
		expect(lineHeight.caption + 2 * space.lg).toBeGreaterThanOrEqual(
			touchTarget,
		);
	});

	/**
	 * The same 36 square as the web's `size="icon"` (`size-9`). The target is guaranteed by the list
	 * above.
	 */
	it("IconButton is the same square as the web icon button", () => {
		const button = codeOf("button.tsx");
		expect(button).toMatch(/icon: \{[\s\S]*?height: controlHeight\.md/);
		expect(button).toMatch(/icon: \{[\s\S]*?width: controlHeight\.md/);
	});

	/**
	 * Button height is a minimum, not a maximum. At larger font scales a fixed height clips the label
	 * vertically. Only users who set that scale would see it.
	 */
	it("button height does not clip text", () => {
		const button = codeOf("button.tsx");
		expect(button).toContain("minHeight: controlHeight[size]");
		expect(button).not.toContain("height: controlHeight[size]");
	});
});

describe("sheet", () => {
	const sheet = codeOf("sheet.tsx");

	/**
	 * Dismissal has four paths. Three come from the primitive (backdrop tap, Android back, screen
	 * reader escape), and the component draws one visible close button. An earlier `Modal` version had
	 * two "close" labels because the backdrop also carried one. The primitive's Overlay is now
	 * `accessible={false}`, so only one label should exist.
	 */
	it("there is one visible close button", () => {
		expect(sheet).toContain("DialogPrimitive.Close");
		expect(sheet.match(/accessibilityLabel="Close"/g)?.length).toBe(1);
	});

	it("the title is the dialog's name", () => {
		expect(sheet).toContain("DialogPrimitive.Title");
	});

	/** Tap-outside dismissal comes from the primitive's `Overlay`. */
	it("the backdrop is the primitive's Overlay", () => {
		expect(sheet).toContain("DialogPrimitive.Overlay");
	});

	/** A selected value is not color-only: weight and marker are both set. */
	it("the selected row has both weight and a mark", () => {
		const choice = codeOf("choice.tsx");
		expect(choice).toContain('weight={selected ? "semibold" : "regular"}');
		expect(choice).toContain('<Icon name="check"');
	});
});

describe("anchored menu", () => {
	const menu = codeOf("menu.tsx");

	/**
	 * A trigger with only an icon has no name for a screen reader; it reads only as "button". So
	 * `label` is required.
	 */
	it("the trigger's name is required", () => {
		expect(menu).toMatch(/\tlabel: string;/);
		expect(menu).toContain("accessibilityLabel={label}");
	});

	/** `role="menu"`, `menuitem`, focus, and back-dismissal are provided by the primitive. */
	it("the primitive owns the role and the way to close", () => {
		expect(menu).toContain("MenuPrimitive.Content");
		expect(menu).toContain("MenuPrimitive.Item");
		expect(menu).toContain("MenuPrimitive.Overlay");
	});

	/**
	 * Insets are passed in as an argument. Without them the menu lands under the Dynamic Island or
	 * over the home indicator, and only owners of that device see the misplacement.
	 */
	it("collision avoidance reads the safe area", () => {
		expect(menu).toContain("insets={{");
		expect(menu).toContain("insets.top");
		expect(menu).toContain("insets.bottom");
	});

	/**
	 * Rows touch each other, so `hitSlop` cannot widen them. The visible height is the target, and it
	 * must equal the web's row (`px-2 py-1.5 text-sm` = 32). Not being able to widen the row is not a
	 * reason to make it taller (see ITEM_HEIGHT in menu.tsx).
	 */
	it("menu row height matches the web row", () => {
		expect(menu).toContain("const ITEM_HEIGHT = controlHeight.sm");
		expect(menu).toContain("minHeight: ITEM_HEIGHT");
	});

	/**
	 * Disabled rows are really not selectable. Without a disabled state, callers could only undo the
	 * choice inside `onSelect`. Such a bug is silent: the row looks normal, assistive tech reads it as
	 * a normal `menuitem`, and pressing it closes the menu with nothing happening. The primitive's
	 * `disabled` passes down to `Pressable`, so `closeOnPress` also stops.
	 */
	it("rows accept a disabled state", () => {
		expect(menu).toMatch(/\tdisabled\?: boolean;/);
	});

	it("disabled passes straight to the primitive", () => {
		const item = menu.slice(menu.indexOf("export function MenuItem"));
		expect(item).toContain("disabled={disabled}");
		/** Setting `accessibilityState.disabled` is the primitive's job. */
		expect(item).toContain("MenuPrimitive.Item");
	});

	/**
	 * Dimming and color must follow the same convention as `SelectOption`. If two menu rows lock
	 * differently, no one can say which one is canonical.
	 */
	it("disabled rows follow the same convention as SelectOption", () => {
		const select = codeOf("select.tsx");
		expect(menu).toContain("disabled && menu.disabled");
		expect(select).toContain("disabled && select.disabled");
		expect(menu).toMatch(/disabled: \{ opacity: 0\.\d+ \}/);
		/**
		 * A disabled row shows no pressed background. A dimmed row must not appear to respond to a press.
		 */
		expect(menu).toContain("!disabled &&");
	});

	/**
	 * A disabled destructive row is not red. A warning color on something that cannot happen now loses
	 * its meaning, and it also weakens the red on enabled rows.
	 */
	it("disabled rows do not use the destructive color", () => {
		expect(menu).toMatch(/disabled\s*\?\s*"muted-foreground"/);
	});
});

describe("dialog", () => {
	const dialog = codeOf("dialog.tsx");
	const alert = codeOf("alert-dialog.tsx");

	/**
	 * Checks that the title has the heading role, and that our `Text` draws it with the line limit on
	 * that same node. This test does not use `DialogPrimitive.Title`. An earlier version of the check
	 * assumed the primitive binds the title to the dialog's name. That is not true in this version
	 * (1.5.x): Title only sets `role="heading"` and is not linked to `Content` by id. It also does not
	 * accept `asChild` and always renders react-native `Text`. Nesting our `Text` inside it would drop
	 * `numberOfLines`, which React Native reads only on the root node; a 64-character title pushed the
	 * header onto two lines. The confirmation dialog keeps `DialogPrimitive.Title`, because its title
	 * and description have no line limit and nesting kills nothing there.
	 */
	it("the title reads as a heading and our Text draws it", () => {
		expect(dialog).toContain('accessibilityRole="header"');
		expect(dialog).not.toContain("DialogPrimitive.Title");
		expect(alert).toContain("AlertDialogPrimitive.Title");
		expect(alert).toContain("AlertDialogPrimitive.Description");
	});

	/**
	 * Do not clip the header's title or description. Web's `DialogTitle` and `DialogDescription` have
	 * no `truncate` (a description wraps to two lines). An earlier `numberOfLines={1}` on the
	 * description rested on a wrong claim that web truncates there, and it cut this dialog's closing
	 * sentence with an ellipsis.
	 */
	it("does not clip the header's title or description", () => {
		const head = /accessibilityRole="header"[\s\S]*?\{description\}/.exec(
			dialog,
		)?.[0];
		expect(head, "could not find the header block").toBeDefined();
		expect(head).not.toContain("numberOfLines");
	});

	/**
	 * The title matches the web's `text-sm font-medium`: a body-size line, slightly heavier. It was
	 * once `title` (17/600), which made the same dialog open much heavier in the app.
	 */
	it("the title is medium on the body scale", () => {
		expect(dialog).toMatch(/variant="body"\s+weight="medium"/);
	});

	/**
	 * The `full` variant has no background, so it must keep a visible close button. There must be
	 * exactly one.
	 */
	it("there is one visible close button", () => {
		expect(dialog.match(/label="Close"/g)?.length).toBe(1);
	});

	/**
	 * A finger lifted outside the box must reach the backdrop. `Content` covers the whole screen, so
	 * the layers around it must let touches pass through. Without this, tapping outside the dialog
	 * does nothing.
	 */
	it("backdrop taps are live", () => {
		expect(dialog.match(/pointerEvents="box-none"/g)?.length).toBe(2);
	});

	/**
	 * A confirmation dialog is not dismissed by an outside tap, since it asks about an irreversible
	 * action. Its layer catches the touch, so the screen behind it does not receive it.
	 */
	it("confirmation dialogs do not let taps through", () => {
		expect(alert).toContain("onStartShouldSetResponder={() => true}");
		expect(alert).not.toContain("box-none");
	});

	/**
	 * Cancel comes first. Only the confirm action takes the destructive color, and destructive is
	 * never the default action.
	 */
	it("cancel on the left, destructive confirm on the right", () => {
		const cancel = alert.indexOf("label={cancelLabel}");
		const confirm = alert.indexOf("label={confirmLabel}");
		expect(cancel).toBeGreaterThan(-1);
		expect(confirm).toBeGreaterThan(cancel);
		expect(alert).toContain(
			'variant={destructive ? "destructive" : "primary"}',
		);
	});
});

describe("floating layers", () => {
	/**
	 * Screens must not open their own portals. If each screen started opening one, no one could
	 * explain the stacking order of floating layers. `PortalOutlet` is the only exit.
	 */
	it("exports the portal host renamed as one", () => {
		expect(codeOf("portal.tsx")).toContain("export function PortalOutlet");
		expect(codeOf("index.ts")).toContain("PortalOutlet");
	});
});
