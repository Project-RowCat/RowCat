import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MobileUpdateChannel } from "@rowcat/contracts";
import {
	checkEasBuildEnvironment,
	sameOrigin,
} from "../../src/lib/build-profile.ts";

/**
 * Publish environment: the environment baked into the binary and the one baked into the OTA bundle
 * must match.
 *
 * `EXPO_PUBLIC_*` is baked into the bundle, so if the exporting shell differs from what built that
 * channel's binary, one OTA turns a TestFlight binary into a client of the production backend (or
 * the reverse) - the accident the build-profile check exists to prevent, arriving through the OTA
 * side door.
 *
 * The committed source of the binary's values is that profile's `env` in `eas.json`, and this
 * function uses it as-is. A shell value that differs stops the run rather than guessing which side
 * is right. Values `eas.json` omits (preview's API origin) are given by `--api-origin` and must
 * still pass the build-profile rule (`checkEasBuildEnvironment`).
 *
 * Environment variables set only on the EAS server are invisible here; if the binary was built with
 * them, this check cannot report a mismatch until they are moved into `eas.json` or `--api-origin`
 * (`docs/ota/OPERATIONS.md`).
 */

export interface EasJson {
	build: Record<string, { env?: Record<string, string> }>;
}

export const readEasJson = (mobileRoot: string): EasJson =>
	JSON.parse(readFileSync(join(mobileRoot, "eas.json"), "utf8")) as EasJson;

export interface ChannelEnvironment {
	channel: MobileUpdateChannel;
	/** Every `EXPO_PUBLIC_*` baked into the bundle; other public values are removed from the export environment. */
	publicEnv: Record<string, string>;
	apiOrigin: string;
}

export type ChannelEnvironmentResult =
	| { ok: true; environment: ChannelEnvironment }
	| { ok: false; problems: string[] };

export function resolveChannelEnvironment(input: {
	channel: MobileUpdateChannel;
	easJson: EasJson;
	shellEnv: Readonly<Record<string, string | undefined>>;
	apiOriginFlag?: string;
}): ChannelEnvironmentResult {
	const { channel, easJson, shellEnv } = input;
	const profile = easJson.build[channel];
	const problems: string[] = [];
	if (!profile)
		return {
			ok: false,
			problems: [`eas.json has no "${channel}" build profile`],
		};

	const declared = profile.env ?? {};
	const publicEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(declared))
		if (key.startsWith("EXPO_PUBLIC_")) publicEnv[key] = value;

	// A shell value that differs from the committed one stops the run, and so does a key present only
	// in the shell (it was never in the binary). The API origin is handled separately below.
	for (const [key, value] of Object.entries(shellEnv)) {
		if (!key.startsWith("EXPO_PUBLIC_") || value === undefined || value === "")
			continue;
		if (key === "EXPO_PUBLIC_API_ORIGIN" && !(key in declared)) continue;
		if (declared[key] === undefined)
			problems.push(
				`${key} in the shell isn't in eas.json's "${channel}" profile — that value was not baked into the binary`,
			);
		else if (declared[key] !== value)
			problems.push(
				`${key} (${value}) in the shell differs from eas.json's "${channel}" value (${declared[key]})`,
			);
	}

	const declaredOrigin = declared.EXPO_PUBLIC_API_ORIGIN?.trim() || undefined;
	const shellOrigin = shellEnv.EXPO_PUBLIC_API_ORIGIN?.trim() || undefined;
	const flagOrigin = input.apiOriginFlag?.trim() || undefined;
	const supplied = [declaredOrigin, shellOrigin, flagOrigin].filter(
		(value): value is string => value !== undefined,
	);
	for (const value of supplied)
		if (!sameOrigin(value, supplied[0] as string))
			problems.push(
				`the API origins disagree (eas.json ${declaredOrigin ?? "∅"} · shell ${shellOrigin ?? "∅"} · --api-origin ${flagOrigin ?? "∅"})`,
			);
	const chosen = supplied[0];

	// Runs the build-profile rule as-is (no second rule). The production API origin comes from the
	// same place the binary build reads: the committed `eas.json` production profile.
	const productionApiOrigin =
		easJson.build.production?.env?.EXPO_PUBLIC_API_ORIGIN?.trim() || undefined;
	const buildRule = checkEasBuildEnvironment(
		{
			EAS_BUILD: "true",
			EAS_BUILD_PROFILE: channel,
			EXPO_PUBLIC_API_ORIGIN: chosen,
			EXPO_PUBLIC_WEB_ORIGIN: publicEnv.EXPO_PUBLIC_WEB_ORIGIN,
		},
		{ productionApiOrigin },
	);
	if (buildRule) problems.push(buildRule);

	// A production bundle must target the committed production origin. With no default origin, a value
	// that came only from the shell or `--api-origin` is no evidence it matches the binary.
	if (
		channel === "production" &&
		chosen !== undefined &&
		!(productionApiOrigin && sameOrigin(chosen, productionApiOrigin))
	)
		problems.push(
			"the production channel's bundle doesn't point at the API origin eas.json's production profile states",
		);

	if (problems.length > 0 || chosen === undefined)
		return { ok: false, problems };

	publicEnv.EXPO_PUBLIC_API_ORIGIN = chosen;
	return {
		ok: true,
		environment: { channel, publicEnv, apiOrigin: new URL(chosen).origin },
	};
}

/**
 * Process environment for export and config evaluation: drops every shell `EXPO_PUBLIC_*` and
 * layers on only the channel's values. EAS build markers (`EAS_BUILD*`) are dropped too, since an
 * export is not a build.
 */
export function exportProcessEnv(
	shellEnv: Readonly<Record<string, string | undefined>>,
	environment: ChannelEnvironment,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(shellEnv)) {
		if (value === undefined) continue;
		if (key.startsWith("EXPO_PUBLIC_")) continue;
		if (key.startsWith("EAS_BUILD")) continue;
		// Publish-environment secrets (signing key, storage credentials) are not passed to the export
		// process. Metro only bakes in `EXPO_PUBLIC_*`, but we do not rely on that: a value never passed
		// cannot be baked in by any plugin. `assertNoSecretsInBundle` in `publish.ts` checks the bundle
		// once more.
		if (key.startsWith("ROWCAT_OTA") || key.startsWith("AWS_")) continue;
		result[key] = value;
	}
	return {
		...result,
		...environment.publicEnv,
		ROWCAT_OTA_CHANNEL: environment.channel,
		NODE_ENV: "production",
	};
}
