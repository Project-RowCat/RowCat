import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	RUNTIME_HOST_ORIGIN_WHITELIST,
	runtimeHostNavigationAllowed,
} from "./navigation-policy.ts";

const SCOPE =
	"file:///var/containers/Bundle/Application/X/RowCat.app/RowcatRuntimeAssets.bundle/runtime/";

describe("the navigation decision", () => {
	it("opens the harness document and its sibling", () => {
		expect(runtimeHostNavigationAllowed(`${SCOPE}harness.html`, SCOPE)).toBe(
			true,
		);
		expect(runtimeHostNavigationAllowed(`${SCOPE}quickjs-ng.wasm`, SCOPE)).toBe(
			true,
		);
	});

	it("rejects every other destination whatever its scheme", () => {
		for (const url of [
			"https://attacker.example/?data=secret",
			"http://attacker.example/",
			"rowcat://chat/runtime/other",
			"about:blank",
			"javascript:alert(1)",
			"data:text/html,hi",
			"file:///etc/passwd",
			`${SCOPE.slice(0, -1)}-other/harness.html`,
			`${SCOPE}../Info.plist`,
			`${SCOPE}%2e%2e/Info.plist`,
		])
			expect(runtimeHostNavigationAllowed(url, SCOPE), url).toBe(false);
	});

	it("without a scope nothing opens", () => {
		expect(runtimeHostNavigationAllowed(`${SCOPE}harness.html`, null)).toBe(
			false,
		);
		expect(runtimeHostNavigationAllowed(`${SCOPE}harness.html`, "")).toBe(
			false,
		);
	});
});

/**
 * **Every navigation must reach that decision.** `react-native-webview` hands a URL that fails
 * `originWhitelist` to `Linking.openURL` and never asks our callback, so a narrow whitelist was a
 * fence that failed open (Safari with attacker data, or a `rowcat://` deep link).
 */
describe("nothing is handed to the OS", () => {
	const APP = fileURLToPath(new URL("../../..", import.meta.url));
	const view = readFileSync(
		join(APP, "src/lib/runtime-native/runtime-host-view.tsx"),
		"utf8",
	);

	it("the whitelist lets every URL through to the decision", () => {
		expect(RUNTIME_HOST_ORIGIN_WHITELIST).toEqual(["*"]);
	});

	it("the iOS host wires the whitelist and the decision, and nothing else", () => {
		expect(view).toMatch(/originWhitelist=\{RUNTIME_HOST_ORIGIN_WHITELIST\}/);
		expect(view.match(/originWhitelist=/g)).toHaveLength(1);
		expect(view).toMatch(
			/onShouldStartLoadWithRequest=\{[\s\S]*?runtimeHostNavigationAllowed\(/,
		);
		expect(view).not.toMatch(/\bLinking\b/);
	});

	/**
	 * The library's own rule, read from the installed source: a URL failing the whitelist goes to
	 * `Linking`, and only the else-branch consults our callback. If a library upgrade changes that
	 * shape, this fails and the fence above needs a fresh look.
	 */
	it("the installed library still routes whitelist misses to Linking", () => {
		const require_ = createRequire(join(APP, "package.json"));
		const shared = readFileSync(
			join(
				dirname(require_.resolve("react-native-webview/package.json")),
				"src/WebViewShared.tsx",
			),
			"utf8",
		);
		expect(shared).toMatch(
			/if \(!passesWhitelist\([\s\S]*?Linking\.openURL[\s\S]*?\} else if \(onShouldStartLoadWithRequest\)/,
		);
		/** Its compiled pattern for `*` is `^.*`, which every extracted origin (even `""`) passes. */
		expect(shared).toMatch(/replace\(\/\\\\\\\*\/g, '\.\*'\)/);
	});
});
