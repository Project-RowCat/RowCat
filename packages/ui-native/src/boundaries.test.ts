import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of the package boundaries: rules the type checker cannot catch. Every rule here still
 * compiles when broken. Importing `@rowcat/ui-web` does produce a type error, but the others
 * (product concepts entering, color literals appearing) pass silently and turn this package into
 * part of the product.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Scans subfolders too. The scan originally read only the top level of `src`, which was equivalent
 * while the package had no folders. `motion/` broke that premise: a top-level-only scan would let
 * any rule be bypassed by creating a folder.
 */
function walk(dir: string, prefix = ""): { path: string; text: string }[] {
	const found: { path: string; text: string }[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			found.push(...walk(join(dir, entry.name), rel));
			continue;
		}
		if (!/\.tsx?$/.test(entry.name)) continue;
		found.push({
			path: rel,
			text: stripComments(readFileSync(join(dir, entry.name), "utf8")),
		});
	}
	return found;
}

const all = walk(SRC)
	/**
	 * The scanner holds the forbidden words as patterns itself, so it would always fail on itself. It
	 * excludes itself.
	 */
	.filter((file) => !file.path.endsWith("boundaries.test.ts"));

describe("brings in no web presentation", () => {
	it("there are files to check", () => {
		expect(all.length).toBeGreaterThan(10);
	});

	/**
	 * `@rowcat/ui-web` renders on the DOM and never renders here. Importing it would break the bundle
	 * before anything else. The reverse direction (ui-web importing this package) is checked by
	 * `packages/ui-web/src/boundaries.test.ts`.
	 */
	it("imports neither @rowcat/ui-web nor apps/web", () => {
		for (const file of all) {
			expect(file.text, file.path).not.toMatch(/@rowcat\/ui-web/);
			expect(file.text, file.path).not.toMatch(/from\s+["'].*apps\/web/);
		}
	});

	/**
	 * Checks that this package's own source does not call DOM libraries directly.
	 * @rn-primitives/* depends transitively on @radix-ui/react-*, because those packages also ship a
	 * react-native-web variant. That code lives only in .web.js files, which Metro does not bundle for
	 * native. The package can only guarantee that its own source does not import those libraries, and
	 * that is what this check verifies.
	 */
	it("does not import DOM-only libraries directly", () => {
		const forbidden = [
			/from\s+["']@base-ui/,
			/from\s+["']@radix-ui/,
			/from\s+["']react-dom/,
			/from\s+["']tailwind-merge/,
			/from\s+["']class-variance-authority/,
			/from\s+["']lucide-react["']/,
		];
		for (const file of all)
			for (const pattern of forbidden)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
	});

	/**
	 * Does not add dependencies that require a native rebuild, with two exceptions. Half the reason
	 * @rn-primitives was chosen is that it is pure JavaScript, with no pod install or Gradle sync.
	 * - react-native-svg, required by lucide-react-native. Cost: the same icon set as web.
	 * - expo-blur, required by scrim.tsx. Cost: the same backdrop as web. The second was the most
	 *   recent addition. Web's floating layers use bg-black/10 with backdrop-blur, and most of the
	 *   look comes from the blur. Moving only the black to 10% lets the background compete with the
	 *   window, and inventing an opacity breaks the link with web. In RN this module is the only
	 *   equivalent of CSS backdrop-filter. The exceptions are listed rather than removed, so a change
	 *   that breaks this rule again shows in review as a build pipeline change.
	 */
	it("brings in no library requiring native modules", () => {
		const forbidden = [
			/react-native-gesture-handler/,
			/@gorhom\/bottom-sheet/,
			/\bmoti\b/,
		];
		for (const file of all)
			for (const pattern of forbidden)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
	});

	/** The exception is confined to one file, so blur does not appear per component. */
	it("scrim.tsx is the only place importing expo-blur", () => {
		for (const file of all) {
			if (file.path === "scrim.tsx") continue;
			expect(file.text, file.path).not.toMatch(/from\s+["']expo-blur/);
		}
		expect(all.find((file) => file.path === "scrim.tsx")?.text).toMatch(
			/from\s+"expo-blur"/,
		);
	});

	/**
	 * Reanimated belongs to the `motion/` folder. This is not a removal from the list; a place was
	 * created for it. The primitives once appeared and disappeared with no motion, which made the
	 * product differ from web (see the header of `motion/animate.ts`). The rhythm is introduced here
	 * with the exception confined to one folder. Without that rule, the next person would write
	 * animations with their own timing in any file, and the rhythm would diverge per component.
	 * Components may render `Animated.View`. The rule blocks creating timing, easing, or accessibility
	 * policy in place. The two checks below cover those concerns.
	 */
	it("motion/ is the only place calling Reanimated's animation API", () => {
		const owned = [
			/\bwithTiming\b/,
			/\buseSharedValue\b/,
			/\buseAnimatedStyle\b/,
			/\bEasing\b/,
			/\bReduceMotion\b/,
			/\binterpolate\b/,
		];
		for (const file of all) {
			if (file.path.startsWith("motion/")) continue;
			for (const pattern of owned)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
		}
	});

	/**
	 * No springs, because web has none. All current motion is automatic transition (open, close,
	 * reflow) with no direct manipulation. A spring on motion with no physical counterpart makes
	 * deceleration harder to predict (matches `motion.ts` in @rowcat/design). When drag or reorder
	 * surfaces appear, this check and its documentation must change together.
	 */
	it("uses no springs", () => {
		for (const file of all) {
			expect(file.text, file.path).not.toMatch(/\bwithSpring\b/);
			expect(file.text, file.path).not.toMatch(/\.springify\(/);
		}
	});

	/**
	 * SVG is touched only by lucide-react-native and one brand mark. If this package's source imported
	 * react-native-svg directly, it would gain a second drawing library (hand-drawn shapes, charts,
	 * decoration), and 'why SVG?' would stop having one answer. The one exception exists because that
	 * mark is not in Lucide. Brand marks are not part of an icon set (web also keeps the mark directly
	 * in features/auth), and a generic icon would leave the button's destination only in its text. The
	 * list is deliberate: a new exception must pass review, and the review question is 'is this also a
	 * drawing absent from Lucide?'. Decoration, charts, and hand-drawn shapes cannot answer that.
	 */
	const DRAWS_SVG = new Set(["brand-mark.tsx"]);

	it("only brand marks import react-native-svg directly", () => {
		for (const file of all) {
			if (DRAWS_SVG.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(/from\s+["']react-native-svg/);
		}
	});

	it("does not rely on browser globals", () => {
		const forbidden = [
			/\bwindow\./,
			/\bdocument\./,
			/\blocalStorage\b/,
			/\bmatchMedia\b/,
		];
		for (const file of all)
			for (const pattern of forbidden)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
	});
});

describe("does not know the product", () => {
	/**
	 * The most irreversible mistake this package guards against. Once something like
	 * `<StoryStartButton story={story} />` enters, changing a button means knowing the work contract.
	 * The coupling does not show as a compile error: it works, and the next person adds `<ChuruBalance
	 * />` beside it.
	 */
	it("no product vocabulary appears", () => {
		const forbidden = [
			/\bStory\b/,
			/\bChatRoom\b/,
			/\bChuru\b/i,
			/\bGenerationTarget\b/,
			/\bViewer\b/,
			/\bComment\b/,
			/\bDraft\b/,
		];
		for (const file of all)
			for (const pattern of forbidden)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
	});

	it("imports no data, navigation or storage", () => {
		const forbidden = [
			/@rowcat\/(sdk|query|domain|contracts|chat|authoring|sync)\b/,
			/@tanstack\/react-query/,
			/\bexpo-router\b/,
			/\bexpo-sqlite\b/,
			/\bexpo-secure-store\b/,
			/\bbetter-auth\b/,
			/\bfetch\s*\(/,
		];
		for (const file of all)
			for (const pattern of forbidden)
				expect(file.text, `${file.path} — ${pattern}`).not.toMatch(pattern);
	});

	/**
	 * The only workspace package this package may depend on is @rowcat/design. The list above blocks
	 * only names known now, so this allowlist catches packages added later.
	 */
	it("the only workspace dependency is @rowcat/design", () => {
		for (const file of all)
			for (const [, name] of file.text.matchAll(/@rowcat\/([a-z-]+)/g))
				expect(name, file.path).toBe("design");
	});
});

describe("behavior from primitives, presentation from us", () => {
	/**
	 * Accessibility wiring is not hand-written. role=dialog, aria-modal, focus movement, Android back,
	 * and screen reader escape all fail silently, and the failure shows only to specific users. That
	 * layer belongs to @rn-primitives/*. Using RN's Modal directly means remembering all four, and one
	 * was missed once.
	 */
	it("the sheet stands on the Dialog primitive, not Modal", () => {
		const sheet = all.find((file) => file.path === "sheet.tsx");
		expect(sheet?.text).toMatch(/@rn-primitives\/dialog/);
		expect(sheet?.text).not.toMatch(/from\s+["']react-native["'][\s\S]*Modal/);
	});

	/**
	 * A group where one value is chosen needs role=radiogroup to be read as 'second of five'. The
	 * group is separate from its container (`choice.tsx`). It once lived inside the sheet, and that
	 * name became a constraint: anyone choosing a value outside a sheet could not find it and attached
	 * role=radio to a Pressable by hand.
	 */
	it("the choice group stands on the radio-group primitive", () => {
		const choice = all.find((file) => file.path === "choice.tsx");
		expect(choice?.text).toMatch(/@rn-primitives\/radio-group/);
		for (const file of all) {
			if (file.path === "choice.tsx") continue;
			expect(file.text, file.path).not.toMatch(/@rn-primitives\/radio-group/);
		}
	});

	/**
	 * Floating layers each stand on their own primitive. Anchored menus are especially easy to
	 * hand-write: measure the trigger, flip when off screen, set role=menu and menuitem, handle
	 * Android back, and return focus to the trigger on close. Rewriting those with Modal, BackHandler,
	 * and absolute coordinates compiles and renders; the mistakes show only to assistive technology.
	 */
	it("the anchored menu stands on the dropdown-menu primitive", () => {
		const menu = all.find((file) => file.path === "menu.tsx");
		expect(menu?.text).toMatch(/@rn-primitives\/dropdown-menu/);
		expect(menu?.text).not.toMatch(/\bBackHandler\b/);
		expect(menu?.text).not.toMatch(/from\s+["']react-native["'][\s\S]*Modal/);
	});

	it("the confirmation dialog stands on the alert-dialog primitive", () => {
		const alert = all.find((file) => file.path === "alert-dialog.tsx");
		expect(alert?.text).toMatch(/@rn-primitives\/alert-dialog/);
		expect(alert?.text).not.toMatch(/\bBackHandler\b/);
	});

	/**
	 * `Dialog` is not an alias for `Sheet`. The whole slice rests on this line. Someone asked for a
	 * centered box will most quickly write `export const Dialog = Sheet`. The file name and call sites
	 * change while the screen still shows a bottom panel, and review does not reveal it. So they are
	 * separated structurally: dialogs do not import Sheet and center themselves (justifyContent:
	 * center), while sheets still attach to the bottom.
	 */
	it("the dialog is not another name for the sheet", () => {
		const dialog = all.find((file) => file.path === "dialog.tsx");
		expect(dialog?.text).toMatch(/@rn-primitives\/dialog/);
		expect(dialog?.text).not.toMatch(/from\s+["']\.\/sheet\.tsx["']/);
		expect(dialog?.text).toMatch(/justifyContent:\s*"center"/);

		const sheet = all.find((file) => file.path === "sheet.tsx");
		expect(sheet?.text).not.toMatch(/from\s+["']\.\/dialog\.tsx["']/);
		expect(sheet?.text).toMatch(/content:\s*\{\s*bottom:\s*0/);
	});

	/**
	 * Being bottom-anchored does not make something a sheet. Reusing Sheet for bottom-anchored dialogs
	 * would silently change the heading hierarchy, dismissal, back surface, and accessibility name,
	 * which all belong to the sheet. Placement is only coordinates, so its resolution lives in a pure
	 * module with no RN import (`dialog-placement.ts`). `dialog.tsx` only maps that answer onto
	 * styles.
	 */
	it("bottom placement does not go through the sheet", () => {
		const placement = all.find((file) => file.path === "dialog-placement.ts");
		expect(placement?.text).toBeTruthy();
		/** Must stay pure so it can be checked without rendering. */
		expect(placement?.text).not.toMatch(/from\s+["']react/);
		expect(placement?.text).not.toMatch(/\bPlatform\b/);

		const dialog = all.find((file) => file.path === "dialog.tsx");
		expect(dialog?.text).toMatch(/resolveDialogPlacement/);
		expect(dialog?.text).not.toMatch(/\bSheet\b/);
		expect(dialog?.text).toMatch(/justifyContent:\s*"flex-end"/);
		expect(dialog?.text).toMatch(/panelBottom:/);
	});

	/**
	 * Plain sheets live only inside this package. Keeping Dialog separate from Sheet says the two
	 * containers differ, but not who may see a sheet. While Sheet was public, feature code could put
	 * arbitrary content in a bottom panel, and the policy held only through an exception list, which
	 * any new name passes. Access is therefore locked to one file, `choice-sheet.tsx`, whose API has
	 * no children (checked by `public-api.test.ts`). A change adding a second consumer must answer in
	 * review why a bottom sheet suits that interaction. Even with an answer, the new capability should
	 * get its own narrow API rather than re-exposing Sheet.
	 */
	it("choice-sheet is the only place importing the sheet", () => {
		const SHEET_CONSUMERS = new Set(["choice-sheet.tsx"]);
		for (const file of all) {
			if (file.path === "sheet.tsx") continue;
			if (SHEET_CONSUMERS.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(/from\s+["']\.\/sheet\.tsx["']/);
		}

		const consumer = all.find((file) => file.path === "choice-sheet.tsx");
		expect(consumer?.text).toMatch(/from\s+["']\.\/sheet\.tsx["']/);
	});

	/**
	 * The root must not reopen it either. The check above covers imports inside the package; this one
	 * covers the exit through `index.ts`. They are different axes, so neither is enough alone. A
	 * re-export line returning to `index.ts` would let feature code call the sheet while the internal
	 * consumer count stays at one. `public-api.test.ts` counts the same fact by name. A substring
	 * check for `/Sheet/` would pass for `ChoiceSheet`, so that name-set check is the real one.
	 */
	it("the root does not re-export the sheet", () => {
		const index = all.find((file) => file.path === "index.ts");
		expect(index?.text).toBeTruthy();
		expect(index?.text).not.toMatch(/from\s+["']\.\/sheet\.tsx["']/);
		expect(index?.text).toMatch(/from\s+["']\.\/choice-sheet\.tsx["']/);
	});

	/**
	 * The navigation drawer is neither a sheet nor a dialog. It accepts arbitrary nodes but cannot
	 * cross the presentation boundary, because its geometry and purpose are fixed in its API (see the
	 * `navigation-drawer.tsx` header). Three ways that fixing could come undone, each of which
	 * compiles:
	 * - Opening a Sheet inside it: one container changes silently, and the name says drawer while
	 *   the thing is a sheet.
	 * - Letting callers pass placement, size, or snapPoints: it becomes a general container.
	 * - Making it rise from the bottom: a one-line coordinate change, visible only as an ordinary
	 *   diff.
	 */
	it("the navigation drawer stands on the left without the sheet", () => {
		const drawer = all.find((file) => file.path === "navigation-drawer.tsx");
		expect(drawer?.text).toBeTruthy();
		/**
		 * Behavior belongs to the primitive. Do not hand-write back, escape, or focus handling, and do
		 * not use BackHandler or import `./sheet.tsx`.
		 */
		expect(drawer?.text).toMatch(/@rn-primitives\/dialog/);
		expect(drawer?.text).not.toMatch(/\bBackHandler\b/);
		expect(drawer?.text).not.toMatch(/from\s+["']\.\/sheet\.tsx["']/);
		expect(drawer?.text).not.toMatch(/from\s+["']\.\/dialog\.tsx["']/);
		expect(drawer?.text).not.toMatch(/\bSheet\b/);

		/**
		 * The left edge. The axis that separates it from the bottom-anchored container is horizontal, not
		 * vertical.
		 */
		expect(drawer?.text).toMatch(/alignItems:\s*"flex-start"/);
		expect(drawer?.text).not.toMatch(/justifyContent:\s*"flex-end"/);
		/**
		 * The left corners are square and only the right corners are rounded. Rounding all four would
		 * make it a floating card.
		 */
		expect(drawer?.text).toMatch(/borderTopRightRadius/);
		expect(drawer?.text).not.toMatch(/borderTopLeftRadius/);

		/**
		 * Does not take placement or size arguments. If any one opens, it becomes a general container
		 * under a different name.
		 */
		for (const hatch of ["placement", "size?", "snapPoints", "detents"])
			expect(drawer?.text, hatch).not.toContain(hatch);
	});

	/**
	 * Motion values are not written by hand. Duration and curve come from one source: `motion.ts` in
	 * `@rowcat/design`, with the same rule on web (`docs/motion/ARCHITECTURE.md`). A literal
	 * `duration: 200` here would make the two apps' rhythm diverge within one product.
	 */
	it("motion values come from design tokens", () => {
		const rhythm = all.find((file) => file.path === "motion/rhythm.ts");
		expect(rhythm?.text).toMatch(/motionDurationMs/);
		expect(rhythm?.text).toMatch(/motionEasing/);

		/**
		 * No file writes milliseconds by hand. This is the same check web's `feedback.test.ts` runs on
		 * feature files, and the mistake has the same shape: a new motion gets `duration: 200` inline.
		 * Types pass and it renders. The symptom is that the spot does not follow when the token changes,
		 * which no single commit shows.
		 */
		for (const file of all)
			expect(file.text, file.path).not.toMatch(/duration:\s*\d/);
	});

	/**
	 * One place asks about reduced motion, and it is the rhythm module. The package once subscribed to
	 * `AccessibilityInfo` directly through one hook, which was right while only the drawer moved.
	 * Reanimated already reads the setting (`ReduceMotion.System`), so a separate subscription would
	 * be a second system, and the first frame is where the two would diverge. The policy is a value in
	 * `ReduceMotionPolicy` (`motion/rhythm.ts`): transform changes jump to the final value (`system`),
	 * and opacity still flows (`never`). Web's global `MotionConfig reducedMotion='user'` does the
	 * same.
	 */
	it("does not subscribe to accessibility preferences a second time", () => {
		for (const file of all)
			expect(file.text, file.path).not.toMatch(/\bAccessibilityInfo\b/);
		const rhythm = all.find((file) => file.path === "motion/rhythm.ts");
		expect(rhythm?.text).toMatch(/ReduceMotionPolicy/);
	});

	/**
	 * Default placement is center. Changing the default to `adaptive` would move the geometry of every
	 * currently centered window (rename, message edit) without any call-site decision, and compile and
	 * other tests would still pass. Which window sits at the bottom is that window's product decision.
	 */
	it("the default placement is center", () => {
		const dialog = all.find((file) => file.path === "dialog.tsx");
		expect(dialog?.text).toMatch(/placement\s*=\s*"center"/);
	});

	/**
	 * Floating layers all pass through one portal. Only `portal.tsx` may call `@rn-primitives/portal`
	 * directly. If each layer starts its own PortalHost, stacking order cannot be explained. Each
	 * primitive's Portal goes into that single host (the default name when none is passed).
	 */
	it("there is one place mounting PortalHost", () => {
		for (const file of all) {
			if (file.path === "portal.tsx") continue;
			expect(file.text, file.path).not.toMatch(/\bPortalHost\b/);
			expect(file.text, file.path).not.toMatch(/hostName/);
		}
	});

	/**
	 * The reverse direction is locked too: primitives do not decide appearance. Their promise is not
	 * to style (Radix-style). If they begin to expect colors or dimensions from this side, theming
	 * leaves the package's hands.
	 */
	it("takes no colors or dimensions from primitives", () => {
		for (const file of all)
			expect(file.text, file.path).not.toMatch(
				/@rn-primitives\/[a-z-]+["'][\s\S]{0,40}(colors|theme|tokens)/,
			);
	});
});

describe("fonts are one family per weight", () => {
	/**
	 * An unknown `fontFamily` is a fallback, not an error. A weight specified without its family draws
	 * the text in the system font. On Latin text the two look alike, so there is no visible symptom;
	 * what differs is Korean letter spacing and glyph height. Weights are therefore specified only in
	 * `typography.ts`, which exports the two as a pair (`{ fontFamily, fontWeight }`). Code that
	 * passes this check cannot contain a weight without its family.
	 */
	const owner = "typography.ts";

	it("typography.ts is the only file writing fontWeight", () => {
		for (const file of all) {
			if (file.path === owner) continue;
			expect(file.text, file.path).not.toMatch(/fontWeight\s*:/);
		}
	});

	it("it is also the only file writing fontFamily", () => {
		for (const file of all) {
			if (file.path === owner) continue;
			expect(file.text, file.path).not.toMatch(/fontFamily\s*:/);
		}
	});

	/** The font name's source is the shared token. Do not write a `Pretendard-…` literal here. */
	it("writes no font name literals", () => {
		for (const file of all) {
			expect(file.text, file.path).not.toMatch(/["']Pretendard/);
		}
	});

	it("that file reads names from the shared vocabulary", () => {
		const typography = all.find((file) => file.path === owner);
		expect(typography).toBeDefined();
		expect(typography?.text).toMatch(/from\s+["']@rowcat\/design["']/);
		expect(typography?.text).toContain("fontFace");
	});
});

describe("writes no colors by hand", () => {
	/**
	 * Half of this package's reason to exist is removing literals such as `#71717a` from screens. If
	 * they reappear here, nothing improves. The source of values is `@rowcat/design` alone. Two
	 * exceptions, neither of which is a theme value:
	 * - The scrim layer (`scrim.tsx`) darkens the backdrop with the same value as web's
	 *   `bg-black/10`, so it darkens in both themes. Four floating layers once each held this literal
	 *   with values of 0.5 and 0.6. Now one file owns the color and the blur.
	 * - The brand mark. Its color belongs to another party's asset, so it must not follow the theme.
	 *   Once it does, it is no longer that brand's mark (see the `brand-mark.tsx` header). Apple's
	 *   mark does follow `tone`, because its guidelines require contrast. The exceptions are listed so
	 *   new ones cannot accumulate without review. Shadows are not checked because `shadowColor` is
	 *   never written (RN's default is black).
	 */
	const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\bhsl\(|\boklch\(/;
	const ALLOWED_RGBA = new Set(["scrim.tsx"]);
	/** Brand colors belong to other parties and have no token. See the header comment above. */
	const ALLOWED_HEX = new Set(["brand-mark.tsx"]);

	it("hex and oklch literals exist only in brand marks", () => {
		for (const file of all) {
			if (ALLOWED_HEX.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(COLOR_LITERAL);
		}
	});

	/**
	 * Even inside this exception, one mark must follow the theme. Apple's guidelines require black or
	 * white that contrasts with the background. A fixed color there would vanish in one theme, and
	 * that vanishing is invisible in the theme the developer uses. So within the file-name exception,
	 * that one mark is locked again.
	 */
	it("the brand mark exception stays within the Google palette", () => {
		const mark = all.find((file) => file.path === "brand-mark.tsx");
		expect(mark).toBeDefined();
		const literals = [...(mark?.text ?? "").matchAll(/#[0-9a-fA-F]{6}\b/g)].map(
			([hex]) => hex,
		);
		expect(literals.sort()).toEqual([
			"#34A853",
			"#4285F4",
			"#EA4335",
			"#FBBC05",
		]);
		/**
		 * The monochrome mark reads the theme color. This asserts that the wiring is actually connected.
		 */
		expect(mark?.text).toMatch(/fill=\{colors\[tone\]\}/);
	});

	it("rgba() appears only in dimming layers", () => {
		for (const file of all) {
			if (ALLOWED_RGBA.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(/\brgba?\(/);
		}
	});

	/**
	 * All four floating layers use the same backdrop. Each once had its own literal, and the values
	 * differed (drawer 0.5, the rest 0.6). The difference is visible only when two layers are opened
	 * alternately in one session.
	 */
	it("every floating layer uses the shared backdrop", () => {
		for (const path of [
			"sheet.tsx",
			"dialog.tsx",
			"alert-dialog.tsx",
			"navigation-drawer.tsx",
		]) {
			const file = all.find((entry) => entry.path === path);
			expect(file, path).toBeDefined();
			expect(file?.text, path).toContain("SCRIM_COLOR");
			expect(file?.text, path).toContain("<ScrimBlur />");
		}
	});
});

describe("writes no spacing by hand", () => {
	/**
	 * Unlike colors, the spacing check is narrow. The package has real off-grid numbers (control
	 * heights, targets, radii, icon boxes; `metrics.ts` is where they live). A rule banning all
	 * numbers would catch those too and would soon be turned off. It checks gap, padding*, and margin*
	 * only. It flags hand-written values that exist in `space` (1, 4, 8, 12, 16, 24, 32, 48). It
	 * allows off-scale numbers (such as the 3 in a badge), zero, and token arithmetic (`space.sm +
	 * 2`). The same rule exists in `apps/mobile/src/lib/boundaries.test.ts`. The two scan different
	 * source trees, so they cannot share one file.
	 */
	const SPACING_PROPERTY =
		/\b(gap|rowGap|columnGap|padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingStart|paddingEnd|margin|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|marginStart|marginEnd):\s*(-?\d+)\b/g;
	const SCALE = new Set([1, 4, 8, 12, 16, 24, 32, 48]);

	it("shared scale values do not appear as literals", () => {
		for (const file of all)
			for (const [text, , value] of file.text.matchAll(SPACING_PROPERTY))
				expect(
					SCALE.has(Math.abs(Number(value))),
					`${file.path}: \`${text}\` is a value on the space scale.`,
				).toBe(false);
	});
});

describe("screens do not re-resolve the theme", () => {
	/**
	 * `useColorScheme` is called in one place only. Calls per component multiply the points where the
	 * preference (`system`) and the resolved appearance can diverge. When a user preference is stored
	 * later, all of those call sites would have to be found.
	 */
	it("only theme.tsx calls useColorScheme", () => {
		for (const file of all) {
			if (file.path === "theme.tsx") continue;
			expect(file.text, file.path).not.toMatch(/\buseColorScheme\b/);
			expect(file.text, file.path).not.toMatch(/\bAppearance\b/);
		}
	});
});

describe("each safe-area edge has exactly one owner", () => {
	/**
	 * This check keeps a defect from this slice from recurring. The `Screen` comment long said the
	 * bottom of chat screens was owned by `KeyboardComposerArea`, but no such component existed. That
	 * edge had no owner, so the composer sat over the home indicator. Compile and tests passed, and
	 * the symptom was a few-point overlap that is easy to miss even on the default simulator device.
	 * This locks down who owns what:
	 * - Top, left, right, and document-flow bottom: screen.tsx (SafeAreaView edges).
	 * - Bottom of the input bar: composer-area.tsx (useSafeAreaInsets plus keyboard presence).
	 * - Sheet bottom and sides: sheet.tsx (a portal, so it does not inherit Screen's padding).
	 * - Keyboard geometry: screen.tsx and sheet.tsx (KeyboardAvoidingView measures its own frame).
	 */
	const SAFE_AREA_OWNERS = new Set([
		"screen.tsx",
		"composer-area.tsx",
		"sheet.tsx",
		/**
		 * Floating layers are all portals and do not inherit Screen's padding, so each must check its own
		 * geometry against the safe area. The menu passes that value to the primitive as an argument
		 * (collision avoidance reads it). The dialog applies it directly to width and margins.
		 */
		"menu.tsx",
		/**
		 * Lists that open from a closed control are anchor layers too. They check their geometry against
		 * the safe area and pass that value to the primitive as an argument, because collision avoidance
		 * reads it to flip and clamp.
		 */
		"select.tsx",
		"dialog.tsx",
		"alert-dialog.tsx",
		/**
		 * The navigation drawer sits on three screen edges: top, bottom, and left. As a portal it does
		 * not inherit Screen's padding, so it must check those three edges itself. Miss one and text sits
		 * under the status bar or over the home indicator.
		 */
		"navigation-drawer.tsx",
	]);

	it("only those three files read the safe area", () => {
		for (const file of all) {
			if (SAFE_AREA_OWNERS.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(
				/react-native-safe-area-context/,
			);
			expect(file.text, file.path).not.toMatch(/\buseSafeAreaInsets\b/);
			expect(file.text, file.path).not.toMatch(/\bSafeAreaView\b/);
		}
	});

	it("only the screen and floating layers adjust for the keyboard", () => {
		/**
		 * Only layers that can hold a form are on this list. `AlertDialog` is not: confirmation dialogs
		 * hold no input fields. Listing it in advance would invite someone to add a field later, at which
		 * point it is a form, not a confirmation.
		 */
		const OWNERS = new Set(["screen.tsx", "sheet.tsx", "dialog.tsx"]);
		for (const file of all) {
			if (OWNERS.has(file.path)) continue;
			expect(file.text, file.path).not.toMatch(/\bKeyboardAvoidingView\b/);
		}
	});

	/**
	 * The place that reads keyboard lifecycle signals is also single. Per-component listeners would
	 * leave two corrections on one screen that do not know about each other, and their sum is always
	 * wrong. `keyboard.ts` exports no values, only a boolean. Height is computed by
	 * KeyboardAvoidingView measuring its own frame.
	 */
	it("one file listens to keyboard events", () => {
		for (const file of all) {
			if (file.path === "keyboard.ts") continue;
			expect(file.text, file.path).not.toMatch(/\bKeyboard\.addListener\b/);
			expect(file.text, file.path).not.toMatch(
				/keyboardDidShow|keyboardWillShow/,
			);
		}
	});

	/**
	 * Focus is not keyboard. With a hardware keyboard attached, a field takes focus but no soft
	 * keyboard appears. If bottom padding were removed on focus at that point, the input bar would sit
	 * down over the home indicator. This state is reproduced by default on the developer's simulator
	 * (Connect Hardware Keyboard).
	 */
	it("does not infer the keyboard from focus", () => {
		for (const file of all)
			expect(file.text, file.path).not.toMatch(
				/(?:isFocused|focused|onFocus)[\s\S]{0,60}(?:paddingBottom|insets\.bottom)/,
			);
	});

	/**
	 * Device insets are not written by hand. Values such as a 44pt notch, 34pt home indicator, or 47pt
	 * cutout differ by device, and the mistake is visible only on that device. Only properties that
	 * define edges are checked here, separately from the spacing check. Control height 44 is not
	 * flagged, because it lives in `metrics.ts`.
	 */
	const EDGE_PROPERTY =
		/\b(paddingTop|paddingBottom|marginTop|marginBottom|top|bottom):\s*(\d+)\b/g;
	const DEVICE_INSETS = new Set([20, 21, 30, 34, 44, 47, 50, 59]);

	it("notch and home-indicator numbers do not appear as literals", () => {
		for (const file of all)
			for (const [text, , value] of file.text.matchAll(EDGE_PROPERTY))
				expect(
					DEVICE_INSETS.has(Number(value)),
					`${file.path}: \`${text}\` is a device safe-area number.`,
				).toBe(false);
	});
});

/**
 * A centered group centers its controls too. `Button` by default grows to its content and sticks to
 * the left (`alignSelf: flex-start`), and `alignSelf` overrides the parent's `alignItems`. Placing
 * a button directly in a center-aligned box therefore centers the icon, title, and description but
 * leaves only the button at the left edge. `EmptyState` was rendering that way, and the mismatch
 * existed everywhere this component was used. `Button` is not changed to take an alignment
 * argument. The left-hugging default is right for left-reading groups such as `Notice`. The
 * decision to center belongs to the centered container.
 */
describe("actions in centered state groups stand on that axis", () => {
	const state = all.find((file) => file.path === "state.tsx");

	it("EmptyState actions stand centered", () => {
		expect(state, "could not find state.tsx").toBeDefined();

		const empty = /export function EmptyState\([\s\S]*?\n\}\n/.exec(
			state?.text ?? "",
		)?.[0];
		expect(empty, "could not find the EmptyState body").toBeDefined();
		/** The button takes this group's alignment style, not the default `hug`. */
		expect(empty).toMatch(/style=\{state\.emptyAction\}/);

		const style = /\n\temptyAction: \{([^}]*)\}/.exec(state?.text ?? "")?.[1];
		expect(style, "could not find the emptyAction style").toBeDefined();
		expect(style).toMatch(/alignSelf: "center"/);
	});

	/**
	 * The opposite side is locked too. `Notice` is a left-reading group, so its control belongs on the
	 * left. Centering it there would separate the retry action from its sentence in error notices.
	 */
	it("Notice stays a left-reading group", () => {
		const notice = /\n\tnotice: \{([^}]*)\}/.exec(state?.text ?? "")?.[1];
		expect(notice, "could not find the notice style").toBeDefined();
		expect(notice).not.toMatch(/alignItems/);
	});
});
