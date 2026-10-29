import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Haptic boundaries: rules that still compile when broken, and whose symptoms appear only on a
 * device.
 *
 * ```text
 * one door           only lib/haptics/index.ts knows react-native-pulsar
 * no top-level load  a dev client not linked with it crashes at app start
 * no Settings        enableSound(false) deactivates the shared audio session
 * no Android link    the first line of the decision to turn on iOS only
 * ```
 */

const APP = fileURLToPath(new URL("../../..", import.meta.url));
const SRC = join(APP, "src");
const PULSAR = "react-native-pulsar";

const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
			out.push(full);
	}
	return out;
}

const sources = walk(SRC).map((path) => ({
	path: path.slice(APP.length),
	text: stripComments(readFileSync(path, "utf8")),
}));

const door = sources.find((file) => file.path === "src/lib/haptics/index.ts");

describe("the haptics door", () => {
	it("one file knows Pulsar", () => {
		expect(
			sources
				.filter((file) => file.text.includes(`"${PULSAR}"`))
				.map((file) => file.path),
		).toEqual(["src/lib/haptics/index.ts"]);
	});

	it("not imported as a value at the top — types only", () => {
		// Pulsar's JS calls `getEnforcing` at load time. A single value import would crash, at app start,
		// any binary built before this dependency was added.
		const imports = [
			...(door?.text.matchAll(
				new RegExp(`import\\s+([^;]*?)\\s+from\\s+"${PULSAR}"`, "g"),
			) ?? []),
		].map((match) => match[1]?.trim());
		expect(imports).toEqual(["type { Pattern }"]);
	});

	it("asks for the link first, then requires it", () => {
		expect(door?.text).toMatch(
			/TurboModuleRegistry\.get\("RNPulsar"\)[\s\S]*require\("react-native-pulsar"\)/,
		);
		expect(door?.text).not.toContain("getEnforcing");
	});

	it("doesn't call Settings", () => {
		// `enableSound(false)` deactivates the shared audio session, on which creator-runtime sound plays
		// (see the `index.ts` header). The others are app-wide switches too, so one call here would
		// silence haptics on other screens.
		for (const file of sources)
			for (const forbidden of [
				"Settings.",
				"enableSound",
				"enableHaptics",
				"shutDownEngine",
				"forceHapticsSupportLevel",
			])
				expect(
					file.path.startsWith("src/lib/haptics/") ? file.text : "",
					`${file.path}: ${forbidden}`,
				).not.toContain(forbidden);
	});

	it("feature code doesn't pick textures — pattern shapes aren't outside the door", () => {
		for (const file of sources) {
			if (file.path.startsWith("src/lib/haptics/")) continue;
			expect(file.text, file.path).not.toContain("discretePattern");
			expect(file.text, file.path).not.toContain("continuousPattern");
		}
	});
});

describe("iOS only", () => {
	const manifest = JSON.parse(
		readFileSync(join(APP, "package.json"), "utf8"),
	) as {
		expo?: {
			autolinking?: {
				exclude?: string[];
				ios?: { exclude?: string[] };
				android?: { exclude?: string[] };
			};
		};
	};
	const autolinking = manifest.expo?.autolinking;

	it("excluded from Android autolinking", () => {
		expect(autolinking?.android?.exclude ?? []).toContain(PULSAR);
	});

	it("not in the iOS or common exclusion lists", () => {
		// Adding it to the shared list would also exclude iOS, and the door would then fail silently with
		// no symptom.
		expect(autolinking?.exclude ?? []).not.toContain(PULSAR);
		expect(autolinking?.ios?.exclude ?? []).not.toContain(PULSAR);
	});

	it("the door blocks the platform once more", () => {
		expect(door?.text).toContain('Platform.OS !== "ios"');
	});
});

describe("Worklets install", () => {
	/**
	 * Pulsar takes Worklets as a **peer** (`*`). If it resolves to a different install than the app's,
	 * its shared state lands in another runtime, and the symptom is not an error but a pattern that
	 * silently never fires. `native-dependencies.test.ts` checks the same thing for ui-native.
	 */
	it("the app and Pulsar see the same Worklets", () => {
		const fromApp = createRequire(join(APP, "package.json")).resolve(
			"react-native-worklets/package.json",
		);
		const pulsarManifest = createRequire(join(APP, "package.json")).resolve(
			`${PULSAR}/package.json`,
		);
		const fromPulsar = createRequire(pulsarManifest).resolve(
			"react-native-worklets/package.json",
		);
		expect(fromPulsar).toBe(fromApp);
	});
});
