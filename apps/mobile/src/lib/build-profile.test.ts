import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	apiOriginRuleFor,
	checkEasBuildEnvironment,
	EAS_BUILD_PROFILES,
	type EasBuildContext,
	type EasBuildEnvironment,
	isPlaceholderOrigin,
} from "./build-profile.ts";

/**
 * EAS builds name their own backend, that name is not a placeholder, and TestFlight does not talk
 * to the production backend. This file pins those three claims.
 *
 * The app has no default API origin. The public repo's `eas.json` holds only example.com-style
 * placeholders; if such a value passed the build, a fork would ship a binary that reaches nothing.
 * TestFlight is a pre-release trial, so pointing it at production would send trial side effects
 * into real member data (see the `build-profile.ts` header).
 *
 * Three layers are checked together:
 *
 * ```text
 * pure rules        build-profile.ts   which (profile, origin) pairs stop the build
 * real config       eas.json           whether the profiles currently satisfy those rules
 * real build gate   app.config.ts      **gives the same answer**
 * ```
 *
 * The last one is the point of this file. `app.config.ts` imports no workspace packages (so Expo's
 * config evaluation does not depend on workspace package resolution), which leaves two copies of
 * the rules. The same matrix is run against both, comparing behaviour rather than strings, so a
 * commit that changes only one side cannot pass.
 */

const EAS_JSON = JSON.parse(
	readFileSync(
		fileURLToPath(new URL("../../eas.json", import.meta.url)),
		"utf8",
	),
) as {
	build: Record<
		string,
		{ distribution?: string; env?: Record<string, string> }
	>;
};

/**
 * The same value `app.config.ts` reads: the API origin of the committed production profile. Both
 * implementations of the matrix must read the same baseline to compare the same answers.
 */
const COMMITTED: EasBuildContext = {
	productionApiOrigin: EAS_JSON.build.production?.env?.EXPO_PUBLIC_API_ORIGIN,
};

/**
 * A name that can actually be resolved. `.test` is an RFC 2606 test TLD, but developers use it for
 * real private DNS, so it is not rejected as a placeholder (see `PLACEHOLDER_*` in
 * build-profile.ts).
 */
const LIVE_ORIGIN = "https://api.rowcat.test";
const STAGING_ORIGIN = "https://staging-api.rowcat.test";

/** (description, environment, whether it stops) — both implementations run this table. */
const MATRIX: {
	name: string;
	env: EasBuildEnvironment;
	blocked: boolean;
}[] = [
	{
		name: "outside an EAS build no rule stands",
		env: { EAS_BUILD_PROFILE: "testflight" },
		blocked: false,
	},
	{
		name: "doesn't decide without a profile name",
		env: { EAS_BUILD: "true" },
		blocked: false,
	},
	{
		name: "stops when production has no origin — there's no default origin",
		env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "production" },
		blocked: true,
	},
	{
		name: "passes when production states a real origin",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: LIVE_ORIGIN,
		},
		blocked: false,
	},
	{
		name: "a trailing slash is the same origin",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: `${LIVE_ORIGIN}/`,
		},
		blocked: false,
	},
	{
		name: "stops when production leaves the placeholder",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: "https://api.example.com",
		},
		blocked: true,
	},
	{
		name: "case doesn't hide a placeholder",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: "HTTPS://API.EXAMPLE.COM",
		},
		blocked: true,
	},
	{
		name: "stops when the web origin is a placeholder",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: LIVE_ORIGIN,
			EXPO_PUBLIC_WEB_ORIGIN: "https://example.com",
		},
		blocked: true,
	},
	{
		name: "passes when the web origin is a real value",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_API_ORIGIN: LIVE_ORIGIN,
			EXPO_PUBLIC_WEB_ORIGIN: "https://rowcat.test",
		},
		blocked: false,
	},
	{
		name: "stops when testflight has no origin",
		env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "testflight" },
		blocked: true,
	},
	{
		name: "testflight pointing at the staging API is normal",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "testflight",
			EXPO_PUBLIC_API_ORIGIN: STAGING_ORIGIN,
		},
		blocked: false,
	},
	{
		name: "stops when testflight points at the committed production API",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "testflight",
			EXPO_PUBLIC_API_ORIGIN: COMMITTED.productionApiOrigin,
		},
		blocked: true,
	},
	{
		name: "stops when preview has no origin",
		env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "preview" },
		blocked: true,
	},
	{
		/**
		 * Internal distributions do not go through the store, so this axis is not the place for the
		 * accident it guards against. A QA build that checks screens against production data is a
		 * legitimate use and is not blocked.
		 */
		name: "preview may state the production origin",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "preview",
			EXPO_PUBLIC_API_ORIGIN: LIVE_ORIGIN,
		},
		blocked: false,
	},
	{
		name: "stops when development has no origin",
		env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "development" },
		blocked: true,
	},
	{
		/** Adding a profile has repeatedly been missed in the rules file. */
		name: "unknown profiles must state an origin too",
		env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "staging" },
		blocked: true,
	},
	{
		name: "an unknown profile stating an origin passes",
		env: {
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "staging",
			EXPO_PUBLIC_API_ORIGIN: STAGING_ORIGIN,
		},
		blocked: false,
	},
];

describe("pure rules", () => {
	for (const entry of MATRIX)
		it(entry.name, () => {
			expect(checkEasBuildEnvironment(entry.env, COMMITTED) !== null).toBe(
				entry.blocked,
			);
		});

	/**
	 * In the public repo the committed baseline is a placeholder, so the "overlaps production" rows of
	 * the matrix stop first with the placeholder message. The overlap rule itself is checked here
	 * separately with real origins.
	 */
	it("stops for that reason when testflight has the same origin as production", () => {
		const error = checkEasBuildEnvironment(
			{
				EAS_BUILD: "true",
				EAS_BUILD_PROFILE: "testflight",
				EXPO_PUBLIC_API_ORIGIN: `${LIVE_ORIGIN}/`,
			},
			{ productionApiOrigin: LIVE_ORIGIN },
		);
		expect(error).toContain("points at the production backend");
	});

	it("without a committed production baseline, testflight can't be decided and stops", () => {
		const error = checkEasBuildEnvironment(
			{
				EAS_BUILD: "true",
				EAS_BUILD_PROFILE: "testflight",
				EXPO_PUBLIC_API_ORIGIN: STAGING_ORIGIN,
			},
			{},
		);
		expect(error).toContain("can't decide");
	});

	it("placeholders are only RFC 2606 example names", () => {
		for (const origin of [
			"https://example.com",
			"https://api.example.com",
			"https://api.example.net",
			"https://example.org",
			"https://api.rowcat.example",
			"https://api.rowcat.invalid",
		])
			expect({ origin, placeholder: isPlaceholderOrigin(origin) }).toEqual({
				origin,
				placeholder: true,
			});
		for (const origin of [
			LIVE_ORIGIN,
			"http://localhost:3001",
			"http://192.168.0.10:3001",
			"https://notexample.com",
			"https://example.com.evil.test",
			"not-a-url",
		])
			expect({ origin, placeholder: isPlaceholderOrigin(origin) }).toEqual({
				origin,
				placeholder: false,
			});
	});
});

/**
 * **The same matrix runs against `app.config.ts`.**
 *
 * Because the config file imports no workspace packages, the rules exist twice. If the two
 * implementations diverge, a combination can pass tests and still fail the build — one of them
 * being a TestFlight build that points at the production backend.
 *
 * Comparing strings is the point. A check that searches the source for constants says nothing when
 * the value is **wrong**.
 */
describe("app.config.ts gives the same answer", () => {
	const ORIGINAL = { ...process.env };

	afterEach(() => {
		process.env = { ...ORIGINAL };
		vi.resetModules();
	});

	const loadConfig = async (
		env: EasBuildEnvironment & { EAS_BUILD_RUNNER?: string },
	): Promise<Error | null> => {
		process.env = { ...ORIGINAL };
		for (const key of [
			"EAS_BUILD",
			"EAS_BUILD_PROFILE",
			"EAS_BUILD_RUNNER",
			"EXPO_PUBLIC_API_ORIGIN",
			"EXPO_PUBLIC_WEB_ORIGIN",
		])
			delete process.env[key];
		/**
		 * The OTA axis is not this matrix's question. It is turned off so that a channel without a
		 * committed certificate does not turn a "pass" here into a "stop". That axis is covered by
		 * `ota-config.test.ts`.
		 */
		process.env.ROWCAT_OTA = "off";
		delete process.env.ROWCAT_OTA_CHANNEL;
		for (const [key, value] of Object.entries(env))
			if (value !== undefined) process.env[key] = value;

		vi.resetModules();
		try {
			await import("../../app.config.ts");
			return null;
		} catch (error) {
			return error as Error;
		}
	};

	for (const entry of MATRIX)
		it(entry.name, async () => {
			const thrown = await loadConfig(entry.env);
			expect(thrown !== null).toBe(entry.blocked);
			if (thrown)
				expect(thrown.message).toBe(
					checkEasBuildEnvironment(entry.env, COMMITTED),
				);
		});

	/**
	 * **With no EAS account and project, the build stops in the real build runner.** The public repo
	 * points at no operator's EAS project; a fork fills it in after `eas init`. This block says
	 * nothing once those values are filled in.
	 */
	it("an empty EAS identity stops on the build runner and says what to do", async () => {
		const config = (await import("../../app.config.ts")).default;
		if (config.extra?.eas?.projectId) return;
		const thrown = await loadConfig({
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: "production",
			EAS_BUILD_RUNNER: "eas-build",
			EXPO_PUBLIC_API_ORIGIN: LIVE_ORIGIN,
		});
		expect(thrown?.message).toContain("eas init");
		expect(config.owner).toBeUndefined();
	});
});

/**
 * **Does each declared profile satisfy its own rules?**
 *
 * Public-repo values are placeholders that a fork fills in. So the question is not "does it pass
 * now" but **"is it a placeholder, or does a filled-in value satisfy the rules"** — this block
 * keeps its meaning after a fork fills in the values.
 */
describe("eas.json", () => {
	const profiles = Object.entries(EAS_JSON.build);

	it("declared profiles are in the vocabulary", () => {
		expect(profiles.map(([name]) => name).sort()).toEqual(
			[...EAS_BUILD_PROFILES].sort(),
		);
	});

	it("origins written down are placeholders or follow their own rules", () => {
		for (const [name, profile] of profiles) {
			const origin = profile.env?.EXPO_PUBLIC_API_ORIGIN;
			if (!origin || isPlaceholderOrigin(origin)) continue;
			expect({
				name,
				error: checkEasBuildEnvironment(
					{
						EAS_BUILD: "true",
						EAS_BUILD_PROFILE: name,
						EXPO_PUBLIC_API_ORIGIN: origin,
					},
					COMMITTED,
				),
			}).toEqual({ name, error: null });
		}
	});

	/**
	 * **The TestFlight rule's baseline must not depend on an operator's memory.** Both values must be
	 * committed. If they were exported in the shell per build, someone would eventually omit one, and
	 * the next move would be "just put the production origin in".
	 */
	it("production and testflight have API origins in eas.json", () => {
		for (const name of ["production", "testflight"])
			expect({
				name,
				declared: Boolean(EAS_JSON.build[name]?.env?.EXPO_PUBLIC_API_ORIGIN),
			}).toEqual({ name, declared: true });
	});

	it("testflight and production have different APIs", () => {
		const testflight = EAS_JSON.build.testflight?.env?.EXPO_PUBLIC_API_ORIGIN;
		const production = EAS_JSON.build.production?.env?.EXPO_PUBLIC_API_ORIGIN;
		expect(new URL(testflight as string).origin).not.toBe(
			new URL(production as string).origin,
		);
	});

	it("origins written down are all https", () => {
		for (const [name, profile] of profiles)
			for (const key of ["EXPO_PUBLIC_API_ORIGIN", "EXPO_PUBLIC_WEB_ORIGIN"]) {
				const value = profile.env?.[key];
				if (value)
					expect({ name, key, protocol: new URL(value).protocol }).toEqual({
						name,
						key,
						protocol: "https:",
					});
			}
	});

	/**
	 * **TestFlight must go through App Store Connect.** With `distribution: "internal"` the build is
	 * ad-hoc and does not reach TestFlight, which removes the reason this profile exists (a
	 * pre-release trial that goes through the store review path).
	 */
	it("only the two profiles going to the store are store distributions", () => {
		const store = profiles
			.filter(([, profile]) => profile.distribution === "store")
			.map(([name]) => name)
			.sort();
		expect(store).toEqual(["testflight"]);
		/** production does not set `distribution`; EAS's default is store. */
		expect(EAS_JSON.build.production?.distribution).toBeUndefined();
		expect(apiOriginRuleFor("production")).toBe("explicit");
		expect(apiOriginRuleFor("testflight")).toBe("non-production");
	});
});
