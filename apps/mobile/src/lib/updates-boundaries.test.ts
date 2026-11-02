import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static OTA boundary: app code does not select, fetch or apply updates.
 *
 * All three are done by the native side of `expo-updates`. What this app decides is one setting
 * (`updates` in `app.config.ts`: check at cold start, do not wait, apply at the next cold start).
 * Only the checks in this file keep that true. A one-line `reloadAsync()` added later would restart
 * the app during generation, during runtime playback, or during sign-in.
 */

const MOBILE = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(MOBILE, "src");

function files(dir: string, accept: (path: string) => boolean): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			result.push(...files(path, accept));
		} else if (accept(path)) result.push(path);
	}
	return result;
}

const isSource = (path: string) =>
	/\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path);

const productSources = files(SRC, isSource).map((path) => ({
	path: relative(MOBILE, path),
	text: readFileSync(path, "utf8"),
}));

describe("app code doesn't hold the update's lifetime", () => {
	it("no app code imports expo-updates (V1's lifetime is decided by config)", () => {
		expect(
			productSources
				.filter(({ text }) => /from\s+["']expo-updates["']/.test(text))
				.map(({ path }) => path),
		).toEqual([]);
	});

	/**
	 * Do not delete this check when adding "restart to update". That action must be explicit, and must
	 * not appear during generation, runtime playback, autosave or sign-in. When it is added, name the
	 * one place that holds that decision in this list.
	 */
	it("no place calls reloadAsync", () => {
		expect(
			productSources
				.filter(({ text }) => /reloadAsync\s*\(/.test(text))
				.map(({ path }) => path),
		).toEqual([]);
	});

	/**
	 * The update authority is the binary, not the server the member picked (`docs/ota/ARCHITECTURE.md`
	 * §업데이트 권한과 인스턴스). `updates.url` and the channel header are native config from the build
	 * environment, and two JS calls can replace them at runtime. Signing still refuses a foreign
	 * server's manifest, but with an override the server the app talks to becomes the address it asks
	 * for code — one defence layer gone, silently. The import ban above covers the usual shape; these
	 * names also catch a `require()`, a re-export or the native module reached directly.
	 */
	it("no app code overrides the update address or headers", () => {
		expect(
			productSources
				.filter(({ text }) =>
					/setUpdateURLAndRequestHeadersOverride|setUpdateRequestHeadersOverride|["']ExpoUpdates["']|require\(\s*["']expo-updates["']/.test(
						text,
					),
				)
				.map(({ path }) => path),
		).toEqual([]);
	});

	it("feature code doesn't fetch the manifest directly", () => {
		expect(
			productSources
				.filter(({ text }) => text.includes("/mobile/updates"))
				.map(({ path }) => path),
		).toEqual([]);
	});

	it("the publishing tool doesn't enter the app bundle", () => {
		expect(
			productSources
				.filter(({ text }) =>
					/from\s+["'][^"']*(scripts\/ota|aws4fetch|@expo\/fingerprint)|ROWCAT_OTA_SIGNING_KEY/.test(
						text,
					),
				)
				.map(({ path }) => path),
		).toEqual([]);
	});
});

describe("signature trust", () => {
	it("this app in the repository has no private key — only certificates are committed", () => {
		const candidates = [
			...files(
				MOBILE,
				(path) =>
					/\.(pem|key|ts|tsx|js|json)$/.test(path) &&
					!path.includes(`${MOBILE}android`) &&
					!path.includes(`${MOBILE}ios`) &&
					!path.includes(`${MOBILE}dist`) &&
					statSync(path).size < 2_000_000,
			),
		];
		const offenders = candidates
			.filter((path) => {
				const text = readFileSync(path, "utf8");
				return (
					/-----BEGIN (RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(text) &&
					!path.endsWith(".test.ts")
				);
			})
			.map((path) => relative(MOBILE, path));
		expect(offenders).toEqual([]);
	});

	it("the files in certs/ are certificates", () => {
		const certs = files(join(MOBILE, "certs"), (path) => path.endsWith(".pem"));
		for (const path of certs)
			expect({
				path: relative(MOBILE, path),
				certificate: readFileSync(path, "utf8").includes(
					"-----BEGIN CERTIFICATE-----",
				),
			}).toEqual({ path: relative(MOBILE, path), certificate: true });
	});
});

describe("the three 'updates' don't mix", () => {
	const tooling = files(join(MOBILE, "scripts/ota"), isSource).map((path) =>
		readFileSync(path, "utf8"),
	);

	/**
	 * `app_update` means "the minimum supported native version rose"; an OTA release is not that
	 * event. Once the publishing tool knows notification vocabulary, "send a notification every time
	 * we publish OTA" becomes one line away.
	 */
	it("the publishing tool doesn't know the notification plane", () => {
		for (const text of tooling) {
			expect(text).not.toMatch(/app_update|NotificationKind|broadcast/);
			expect(text).not.toMatch(/services\/notifications/);
		}
	});

	it("the publishing tool doesn't write update notes — it only reads whether they exist", () => {
		for (const text of tooling) {
			expect(text).not.toMatch(/update-notes\/releases/);
			expect(text).not.toMatch(/writeFileSync\([^)]*update-notes/);
		}
	});
});
