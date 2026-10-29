import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static boundary of the server-side OTA: the API only selects; it neither signs nor streams
 * assets. Signing authority lives in the release environment
 * (`apps/mobile/scripts/ota/signing.ts`), asset bytes in object storage / CDN, and `app_update` is
 * unrelated to OTA.
 *
 * The console control plane (reads, direct transitions, job requests, CI reports) stays inside the
 * same boundary: if that code gained a way to sign or accepted signed bundles over HTTP, the
 * console would be a remote code uploader.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function sources(dir: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) result.push(...sources(path));
		else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
			result.push(path);
	}
	return result;
}

const runtime = sources(SRC)
	.filter((path) => !path.includes(`${join(SRC, "test")}/`))
	.map((path) => ({
		path: relative(SRC, path),
		text: readFileSync(path, "utf8"),
	}));

const ota = runtime.filter(
	({ path }) =>
		path.startsWith("services/mobile-updates/") ||
		path === "routes/mobile-updates.ts" ||
		path === "routes/mobile-update-jobs.ts" ||
		path === "routes/admin/mobile-updates.ts" ||
		path === "jobs/mobile-updates/reconcile-jobs.ts",
);

/** Control plane reachable over HTTP: code called by a session operator or a CI OIDC report. */
const controlPlane = runtime.filter(({ path }) =>
	[
		"routes/admin/mobile-updates.ts",
		"routes/mobile-update-jobs.ts",
		"services/mobile-updates/admin.ts",
		"services/mobile-updates/jobs.ts",
		"services/mobile-updates/ci-trigger.ts",
	].includes(path),
);

describe("the API runtime has no means to sign", () => {
	it("there is no code that reads a private key or signs", () => {
		for (const { path, text } of ota) {
			expect({
				path,
				sign: /\bcreatePrivateKey\b|\bsign\(/.test(text),
			}).toEqual({
				path,
				sign: false,
			});
			expect(text).not.toContain("ROWCAT_OTA_SIGNING_KEY");
		}
	});

	it("doesn't import the publish tool", () => {
		for (const { text } of runtime)
			expect(text).not.toMatch(/from\s+["'][^"']*scripts\/ota/);
	});
});

describe("the manifest route doesn't stream assets", () => {
	const route = ota.find(({ path }) => path === "routes/mobile-updates.ts");

	it("doesn't bring in storage, media or the file system", () => {
		expect(route?.text).toBeTruthy();
		expect(route?.text).not.toMatch(
			/lib\/media|node:fs|readFile|createReadStream/,
		);
	});

	it("doesn't touch the DB directly — it calls the service", () => {
		expect(route?.text).not.toMatch(/db\/client|db\/schema|drizzle-orm/);
	});

	it("doesn't read the session — compatibility is decided by the binary, not the account", () => {
		expect(route?.text).not.toMatch(
			/requireViewer|c\.get\("viewer"\)|viewerId/,
		);
	});
});

describe("OTA is not the notification plane", () => {
	it("neither creates app_update nor calls the notification service", () => {
		for (const { text } of ota) {
			expect(text).not.toMatch(/app_update/);
			expect(text).not.toMatch(/services\/notifications|createNotification/);
		}
	});
});

describe("the operations console's control plane doesn't accept code", () => {
	it("the files to scan actually exist", () => {
		expect(controlPlane).toHaveLength(5);
	});

	it("there is no path that receives a signed bundle over HTTP — registration is a process in the release environment", () => {
		for (const { path, text } of controlPlane)
			expect({
				path,
				upload:
					/\bregisterRelease\b|\bvalidateReleaseBundle\b|MobileUpdateReleaseBundle/.test(
						text,
					),
			}).toEqual({ path, upload: false });
	});

	it("no statement writes a release's body or signature — the only thing that moves is the transition table", () => {
		for (const { path, text } of controlPlane)
			expect({
				path,
				write:
					/update\(mobile_update_release\)|insert\(mobile_update_release\)/.test(
						text,
					),
			}).toEqual({ path, write: false });
	});

	it("the CI token doesn't leave the trigger", () => {
		for (const { path, text } of controlPlane) {
			if (path === "services/mobile-updates/ci-trigger.ts") continue;
			expect({
				path,
				token: /\.token\b|OTA_CI_GITHUB_TOKEN/.test(text),
			}).toEqual({
				path,
				token: false,
			});
		}
	});

	it("no statement edits or deletes history — it is append-only", () => {
		for (const { path, text } of ota)
			expect({
				path,
				mutate:
					/(update|delete)\(mobile_update_release_event\)/.test(text) ||
					/delete\(mobile_update_release\)/.test(text),
			}).toEqual({ path, mutate: false });
	});
});
