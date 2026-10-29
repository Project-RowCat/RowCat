import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static scan of boundaries: rules the type checker cannot catch. The web renderer has a matching
 * file. Every rule here fails the same way: compilation passes, and the failure shows up first on a
 * device.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = readdirSync(SRC)
	.filter((name) => /\.tsx?$/.test(name))
	.filter((name) => !name.endsWith("boundaries.test.ts"))
	.map((name) => ({
		path: name,
		text: stripComments(readFileSync(join(SRC, name), "utf8")),
	}));

const product = files.filter((file) => !/\.test\.tsx?$/.test(file.path));

describe("does not run creator code", () => {
	it("there is no dynamic code generation at all", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\beval\s*\(/);
			expect(file.text, file.path).not.toMatch(/new\s+Function\b/);
			expect(file.text, file.path).not.toMatch(/\bimport\s*\(/);
		}
	});

	it("does not treat creator text as markup", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/dangerouslySetInnerHTML/);
			expect(file.text, file.path).not.toMatch(/\bWebView\b/);
		}
	});
});

describe("creator props do not become RN props", () => {
	/**
	 * A single JSX spread would give runtime props full permission over React Native props. The type
	 * checker does not guard this, because ResolvedNodeProps is a value we construct, so spreading it
	 * still type-checks. This check does guard it.
	 */
	it("there is no JSX spreading at all", () => {
		/**
		 * Object spreads in .ts files are out of scope. They copy our own defaults, which carry only the
		 * slots the contract defines. The real danger is spreading into JSX props: whatever arrives there
		 * becomes a React Native component's prop.
		 */
		for (const file of product) {
			if (!file.path.endsWith(".tsx")) continue;
			expect(file.text, file.path).not.toMatch(/<\s*\w[^>]*\{\s*\.\.\./);
		}
	});

	it("there is no generic transform moving styles wholesale", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/Object\.assign\s*\(/);
			expect(file.text, file.path).not.toMatch(/StyleSheet\.flatten/);
		}
	});
});

describe("brings in no packages outside the boundary", () => {
	it("knows nothing of the app, authoring, the compiler or the web renderer", () => {
		for (const file of files)
			for (const forbidden of [
				/@rowcat\/authoring/,
				/@rowcat\/runtime-compiler/,
				/@rowcat\/runtime-renderer-web/,
				/@rowcat\/ui-native/,
				/@rowcat\/ui-web/,
				/@rowcat\/sdk/,
				/@rowcat\/query/,
				/@rowcat\/chat/,
				/expo-/,
				/apps\/mobile/,
			])
				expect(forbidden.test(file.text), `${file.path} — ${forbidden}`).toBe(
					false,
				);
	});

	/**
	 * The host may import only the contract shape: two entries of the same kind, patches (tree
	 * vocabulary) and commands (control command vocabulary). Neither brings in a session, engine, or
	 * generated sandbox. The rule blocks the root, not the number of subpaths.
	 */
	it("from the host it brings in only the contract's shapes", () => {
		const allowed = new Set([
			"@rowcat/runtime-host/patches",
			"@rowcat/runtime-host/commands",
		]);
		for (const file of files) {
			const imports = file.text.match(/@rowcat\/runtime-host[^"']*/g) ?? [];
			for (const specifier of imports)
				expect(allowed.has(specifier), `${file.path} — ${specifier}`).toBe(
					true,
				);
		}
	});

	it("knows neither network nor Node", () => {
		for (const file of product) {
			expect(file.text, file.path).not.toMatch(/\bfetch\s*\(/);
			expect(file.text, file.path).not.toMatch(/from\s+["']node:/);
			expect(file.text, file.path).not.toMatch(/\bXMLHttpRequest\b/);
		}
	});
});

describe("the pure layer knows nothing of React Native", () => {
	/**
	 * These four are pure functions that run without RN, so this test needs no simulator. If any one
	 * imports react-native, the test would need a native mock from that moment on, and code that
	 * passes such a mock breaks on a device.
	 */
	it("tree-store, props, styles and errors do not import react/react-native", () => {
		const pure = [
			"tree-store.ts",
			"props.ts",
			"styles.ts",
			"errors.ts",
			/**
			 * Transition rules (goals, policy, plan) are pure too. If they moved into motion.tsx, claims
			 * such as 'does not move at first' and 'changing only the policy does not replay' could not be
			 * checked without a simulator, and the rules would break on a device.
			 */
			"motion.ts",
			/**
			 * Deciding whether a reference narrows to a handle is also pure, so it must be checked by value.
			 */
			"control-handle.ts",
		];
		for (const name of pure) {
			const file = files.find((entry) => entry.path === name);
			expect(file, name).toBeDefined();
			expect(file?.text, name).not.toMatch(/from\s+["']react-native["']/);
			expect(file?.text, name).not.toMatch(/from\s+["']react["']/);
		}
	});
});

/**
 * Attaching or detaching a transition must not change the component's kind. The failure pattern is
 * conditionally picking Animated.View only when transition is set. Types pass and the screen draws,
 * but when the creator adds or removes that prop, React remounts the slot. A focused TextInput
 * loses focus, a ScrollView loses its position, and a child Audio loses playback. None of these
 * throws an error. What can be checked without a device is that the choice is not conditional, and
 * this test checks it.
 */
describe("transitions do not change a component's identity", () => {
	const hostNode = files.find((file) => file.path === "host-node.tsx");

	it("host-node.tsx exists", () => {
		expect(hostNode).toBeDefined();
	});

	/**
	 * Animated components must be created once at module level. Creating them inside render makes each
	 * render a new component type, so every render remounts.
	 */
	it("does not create animated components inside render", () => {
		const text = hostNode?.text ?? "";
		const creations = [...text.matchAll(/createAnimatedComponent\s*\(/g)];
		expect(creations.length).toBeGreaterThan(0);
		/** All declarations must be at top level. Indentation means they are inside a function. */
		for (const match of creations) {
			const lineStart = text.lastIndexOf("\n", match.index) + 1;
			expect(text.slice(lineStart, match.index)).toMatch(
				/^const \w+ = Animated\.$/,
			);
		}
	});

	/**
	 * No ternary may choose the component. motion is an entry in the style array, not a value that
	 * decides what to draw.
	 */
	it("does not choose components by motion or transition", () => {
		const text = hostNode?.text ?? "";
		expect(text).not.toMatch(/motion\s*(!==|===)\s*null\s*\?\s*</);
		expect(text).not.toMatch(/transition\s*(!==|===)\s*null\s*\?\s*</);
		expect(text).not.toMatch(/\?\s*Animated\.\w+\s*:/);
	});

	/**
	 * The two nodes that expose control handles (scroll and text input) must always be animated
	 * components. Swapping them conditionally would tie the node's focus and scroll position to a
	 * single prop.
	 */
	it("scroll and text input are always animated components", () => {
		const text = hostNode?.text ?? "";
		expect(text).toMatch(/<AnimatedScrollView/);
		expect(text).toMatch(/<AnimatedTextInput/);
		expect(text).not.toMatch(/<ScrollView[\s>]/);
		expect(text).not.toMatch(/<NativeTextInput[\s>]/);
	});

	/**
	 * Sounds still are not drawn. If Audio received the transition layer, its lifetime would be tied
	 * to the drawing layer, and a visual change from the parent would restart playback.
	 */
	it("no transition layer sits on sound", () => {
		const props = files.find((file) => file.path === "props.ts");
		const allowed = props?.text.match(/audio: \[[^\]]*\]/s)?.[0] ?? "";
		expect(allowed).not.toContain("transition");
	});
});

/**
 * The shrink axis must match between the two renderers. Yoga's flexShrink defaults to 0 and CSS
 * defaults to 1. Leaving the difference in place makes the same work lay out differently. On web,
 * stacked content squashed and a ScrollView did not scroll (a real defect that existed). On native,
 * a long sentence in a row was clipped instead of wrapping. The rule is one line: only children of
 * a row shrink. The source is read rather than the value, because theme.ts imports react-native.
 * This repo does not mock RN, so that module is not loaded here.
 */
describe("the shrinking axis", () => {
	const theme = files.find((file) => file.path === "theme.ts");
	const hostNode = files.find((file) => file.path === "host-node.tsx");

	it("only children of rows have flexShrink", () => {
		expect(theme?.text).toMatch(/rowChild:\s*\{\s*flexShrink:\s*1\s*\}/);
	});

	/**
	 * If the default touches a vertical stacking box, content to scroll gets pressed against the box.
	 * That is the web's defect carried over to native.
	 */
	it("the default for vertically stacked boxes has none", () => {
		const table = theme?.text ?? "";
		for (const key of ["box", "screen", "scrollContent"]) {
			const entry = new RegExp(`\\n\\t${key}:\\s*\\{([^}]*)\\}`).exec(table);
			expect(entry, key).not.toBeNull();
			expect(entry?.[1], key).not.toContain("flexShrink");
		}
	});

	/**
	 * Buttons do not shrink even inside a row. This is the same exception as the web's .rc-row >
	 * .rc-button. Without it, a `<Button>Send</Button>` next to an input with grow: 1 was squeezed
	 * narrower than its own label, and the creator had no way out (ButtonProps has no style prop).
	 * Pressable has a style slot and still shrinks. That asymmetry is the point of this check.
	 */
	it("the button's style array has no shrink", () => {
		const text = hostNode?.text ?? "";
		const button =
			/case "button":[\s\S]*?case "pressable":/.exec(text)?.[0] ?? "";
		expect(button).not.toBe("");
		expect(button).toContain("runtimeStyles.button");
		expect(button).not.toMatch(/style=\{\[\s*shrink,/);
	});

	/**
	 * The inRow flag is set only when a row draws its children. If another box set it, the rule would
	 * flip.
	 */
	it("inRow is turned on only in rows", () => {
		const text = hostNode?.text ?? "";
		expect(text).toContain("children(node.children, false, true)");
		expect([
			...text.matchAll(/children\(node\.children,\s*\w+,\s*true\)/g),
		]).toHaveLength(1);
	});
});
