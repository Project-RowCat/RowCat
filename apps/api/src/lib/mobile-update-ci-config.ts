import {
	MOBILE_UPDATE_CHANNELS,
	type MobileUpdateChannel,
} from "@rowcat/contracts";

/**
 * CI wiring for mobile OTA publish jobs: repository, token and channels are all set or all empty.
 * The token starts the workflow; it is not signing authority.
 *
 * A half configuration is a boot error: a deployment missing only the token would show a publish
 * button that fails on every press with no hint that configuration is the cause, and one missing
 * channels is a connection that can publish nothing.
 *
 * The workflow file and branch are not settings (constants in
 * `services/mobile-updates/ci-github.ts`): they are the basis for trusting CI's OIDC report, and
 * opening them would let a deployment accept tokens from another workflow.
 */
export interface MobileUpdateCiConfig {
	repository: string;
	token: string;
	channels: readonly MobileUpdateChannel[];
}

export type MobileUpdateCiConfigResult =
	| { ok: true; config: MobileUpdateCiConfig | null }
	| { ok: false; message: string };

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function resolveMobileUpdateCiConfig(input: {
	repository: string;
	token: string;
	channels: string;
}): MobileUpdateCiConfigResult {
	const repository = input.repository.trim();
	const token = input.token.trim();
	const rawChannels = input.channels
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	const present = [repository, token, rawChannels.length > 0 ? "x" : ""];
	if (present.every((value) => !value)) return { ok: true, config: null };
	if (present.some((value) => !value))
		return {
			ok: false,
			message:
				"fill OTA_CI_GITHUB_REPOSITORY · OTA_CI_GITHUB_TOKEN · OTA_CI_CHANNELS together or leave them all empty",
		};
	if (!REPOSITORY_PATTERN.test(repository))
		return {
			ok: false,
			message: `OTA_CI_GITHUB_REPOSITORY is owner/repo: ${repository}`,
		};
	const channels: MobileUpdateChannel[] = [];
	for (const value of rawChannels) {
		if (!(MOBILE_UPDATE_CHANNELS as readonly string[]).includes(value))
			return {
				ok: false,
				message: `OTA_CI_CHANNELS has an unknown channel: ${value}`,
			};
		if (!channels.includes(value as MobileUpdateChannel))
			channels.push(value as MobileUpdateChannel);
	}
	return { ok: true, config: { repository, token, channels } };
}
