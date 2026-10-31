import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The self-update rules that no type can hold. Each one fails silently when broken: the build is green
 * and installed copies quietly update to the wrong thing, or not at all.
 */

const desktop = resolve(fileURLToPath(import.meta.url), "../..");
const repo = resolve(desktop, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

describe("desktop self-update boundaries", () => {
	// One file knows the updater; the rest of the app sees its narrow interface (updater.ts).
	it("imports electron-updater in updater.ts only", () => {
		const importers = readdirSync(join(desktop, "src"))
			.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
			.filter((name) =>
				/from "electron-updater"/.test(read(`apps/desktop/src/${name}`)),
			);
		expect(importers).toEqual(["updater.ts"]);
	});

	/**
	 * The updater takes the newest release in the feed whatever its tag (prereleases, no channel), so a
	 * second workflow that creates releases would become every installed copy's update target.
	 */
	it("leaves desktop-release.yml the only workflow that creates GitHub releases", () => {
		const dir = ".github/workflows";
		const creators = readdirSync(join(repo, dir)).filter((name) =>
			/gh release create|softprops\/action-gh-release|releases\/?\s*-X\s*POST|createRelease/.test(
				read(`${dir}/${name}`),
			),
		);
		expect(creators).toEqual(["desktop-release.yml"]);
	});

	// `latest.yml` points at the installer by the name electron-builder gave it.
	it("attaches the installer without renaming it, beside the feed files", () => {
		const workflow = read(".github/workflows/desktop-release.yml");
		expect(workflow).toContain('"release/latest.yml"');
		expect(workflow).toMatch(/"release\/\$\{installer\}\.blockmap"/);
		expect(workflow).not.toMatch(/name="RowCat-/);
	});

	// The feed comes from where the release runs; a literal would send a fork's installers home.
	it("takes the feed from GITHUB_REPOSITORY, never a literal", () => {
		const script = read("apps/desktop/scripts/build-app.ts");
		expect(script).toContain("updateFeedFrom(process.env.GITHUB_REPOSITORY)");
		expect(script).not.toMatch(/owner:\s*"/);
		expect(script).toContain('publish: "never"');
	});
});
