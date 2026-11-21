import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The root `.pnpmfile.cjs` deletes `@better-auth/expo`'s `expo-*` peer declarations. Left in, pnpm
 * linked them into the API's production install (and with them the whole mobile stack, ~380 MB of
 * the API image), because an optional peer is linked whenever the workspace holds the package.
 *
 * `@better-auth/expo/client` (`lib/auth.ts`) still imports every one of them. They resolve because
 * this app lists each as its own dependency: Metro looks in `apps/mobile/node_modules`, the same way
 * the client's `react-native` import resolves, which the package never declared. Drop one from
 * `package.json` and nothing fails until that import runs on a device, so this pins the pairing:
 * every peer the hook cuts is a dependency here.
 */

const MOBILE = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const manifest = JSON.parse(readFileSync(`${MOBILE}package.json`, "utf8")) as {
	dependencies: Record<string, string>;
};

const { hooks } = createRequire(import.meta.url)(`${ROOT}.pnpmfile.cjs`) as {
	hooks: {
		readPackage: (pkg: {
			name: string;
			peerDependencies?: Record<string, string>;
		}) => { peerDependencies?: Record<string, string> };
	};
};

// Read by path: the package's `exports` does not list `./package.json`.
const installed = JSON.parse(
	readFileSync(`${MOBILE}node_modules/@better-auth/expo/package.json`, "utf8"),
) as { name: string; peerDependencies: Record<string, string> };

describe("@better-auth/expo peers the pnpm hook cuts", () => {
	const declared = Object.keys(installed.peerDependencies);
	const kept = Object.keys(
		hooks.readPackage({
			name: installed.name,
			peerDependencies: { ...installed.peerDependencies },
		}).peerDependencies ?? {},
	);
	const cut = declared.filter((name) => !kept.includes(name));

	it("cuts the expo packages", () => {
		expect(cut.length).toBeGreaterThan(0);
		for (const name of cut) expect(name).toMatch(/^expo-/);
	});

	it.each(cut)("%s is this app's own dependency", (name) => {
		expect(manifest.dependencies[name]).toBeDefined();
	});
});
