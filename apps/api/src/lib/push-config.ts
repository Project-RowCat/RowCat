/**
 * Native push transport configuration: one pure decision. It reads no `process.env` and never calls
 * `process.exit`, so boot and `env:doctor` pass through the same function (same axis as
 * `config/env-resolve.ts`).
 *
 * - There is no half configuration: the only enabling value is `PUSH_TRANSPORT` and the access
 *   token is auth layered on it, so "token only" means not yet enabled rather than a typo. Blocking
 *   boot there would stop deployments that pre-filled the token.
 * - The destination is not a setting (no `EXPO_PUSH_URL`): that would let deployment config
 *   decide where push tokens go. A test that must bend that boundary does so inside its own
 *   process.
 */

/** The one transport open today; the contract header explains why it is a vocabulary. */
export const PUSH_EXPO_TRANSPORT = "expo";

export type PushTransportConfig = {
	kind: "expo";
	/** Expo access token. A secret: never in logs, responses or diagnostics (which may say only "set"). */
	accessToken: string | null;
} | null;

export type PushConfigResult =
	| { ok: true; config: PushTransportConfig }
	| { ok: false; message: string };

export interface PushEnvInput {
	transport: string;
	accessToken: string;
}

export function resolvePushConfig(input: PushEnvInput): PushConfigResult {
	const transport = input.transport.trim();
	if (!transport) return { ok: true, config: null };
	if (transport !== PUSH_EXPO_TRANSPORT)
		return {
			ok: false,
			message: `PUSH_TRANSPORT must be ${PUSH_EXPO_TRANSPORT} (got: ${transport})`,
		};
	return {
		ok: true,
		config: {
			kind: "expo",
			accessToken: input.accessToken.trim() || null,
		},
	};
}
