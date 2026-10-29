import { createPublicKey, verify as verifyWithKey } from "node:crypto";

/**
 * GitHub Actions OIDC: verifies that a report really came from that workflow's run. The mobile OTA
 * job CI report (`POST /v2/mobile/update-jobs/:id/reports`) has no session; a shared secret passed
 * as a workflow input would remain visible on the run screen and could not say which run sent it,
 * which the per-run signed token does.
 *
 * Checked here, and nothing more:
 *
 * ```text
 * signature     GitHub JWKS, RS256 only
 * iss           token.actions.githubusercontent.com
 * aud           the value this deployment expects (a token meant for another deployment is not replayed here)
 * repository    the configured repository
 * workflow_ref  <repo>/.github/workflows/mobile-ota.yml@refs/heads/main
 *               (tokens from other workflows or branches do not pass)
 * event_name    workflow_dispatch
 * environment   ota-<channel> (the caller compares it with the job's channel)
 * run_id        the caller binds it to the job (first report binds, later ones must match)
 * exp, iat, nbf
 * ```
 *
 * `workflow_ref` pins the branch because anyone with write access can edit a same-named workflow on
 * another branch; GitHub's environment protection rules would also block it, but those live in
 * GitHub settings invisible to this repository, so this check is our own layer.
 *
 * Deliberately not done:
 * - Authorization: the token proves "that run sent it"; which job it belongs to and whether the
 *   job still accepts the report is the service's question.
 * - Replay defense: reports are idempotent, so a second delivery of the same token changes
 *   nothing.
 * - Logging: neither the token nor any piece of it is logged.
 */

/** Constants on purpose: making issuer or JWKS configurable would be a forgery path. */
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_TIMEOUT_MS = 5_000;
const CLOCK_SKEW_SECONDS = 60;

export interface Jwk {
	kid?: string;
	kty?: string;
	n?: string;
	e?: string;
}

export type JwksFetcher = () => Promise<readonly Jwk[]>;

let cachedJwks: { keys: readonly Jwk[]; fetchedAt: number } | null = null;
let inflight: Promise<readonly Jwk[]> | null = null;

/** Caches successes only, so one network failure does not reject every report for the TTL. */
const githubJwks: JwksFetcher = async () => {
	if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_TTL_MS)
		return cachedJwks.keys;
	if (inflight) return inflight;
	inflight = (async () => {
		const response = await fetch(JWKS_URL, {
			signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error("jwks fetch failed");
		const json = (await response.json()) as { keys?: unknown };
		if (!Array.isArray(json.keys)) throw new Error("jwks shape");
		cachedJwks = { keys: json.keys as Jwk[], fetchedAt: Date.now() };
		return cachedJwks.keys;
	})().finally(() => {
		inflight = null;
	});
	return inflight;
};

const decodeSegment = (segment: string): Record<string, unknown> | null => {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(segment, "base64url").toString("utf8"),
		);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
};

/** Extracts the token from an `Authorization: Bearer` value. Case-insensitive since the scheme prefix varies between implementations; missing or malformed is `null`, which is a rejection. */
export const bearerToken = (header: string | undefined): string | null => {
	if (!header) return null;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1]?.trim() || null;
};

export interface GitHubActionsOidcExpectation {
	audience: string;
	/** `owner/repo`. */
	repository: string;
	/** `.github/workflows/<file>`. */
	workflowPath: string;
	/** `refs/heads/<name>`. */
	workflowRef: string;
}

export interface GitHubActionsRunClaims {
	runId: string;
	/** The GitHub environment the run requested (`ota-<channel>`), or `null`. */
	environment: string | null;
}

/** Returns the run's identity on success; every failure is `null`, without saying which check failed (leaking that would help refine a forgery). */
export async function verifyGitHubActionsOidcToken(
	token: string,
	expected: GitHubActionsOidcExpectation,
	options: { now?: () => number; jwks?: JwksFetcher } = {},
): Promise<GitHubActionsRunClaims | null> {
	const now = options.now ?? Date.now;
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const [rawHeader, rawPayload, rawSignature] = parts;
	if (!rawHeader || !rawPayload || !rawSignature) return null;

	const header = decodeSegment(rawHeader);
	const payload = decodeSegment(rawPayload);
	if (!header || !payload) return null;
	// Cut `none` and symmetric-algorithm bypasses before signature verification.
	if (header.alg !== "RS256") return null;
	const kid = typeof header.kid === "string" ? header.kid : null;
	if (!kid) return null;

	let keys: readonly Jwk[];
	try {
		keys = await (options.jwks ?? githubJwks)();
	} catch {
		return null;
	}
	const jwk = keys.find((key) => key.kid === kid);
	if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;

	try {
		const publicKey = createPublicKey({
			key: { kty: "RSA", n: jwk.n, e: jwk.e },
			format: "jwk",
		});
		const ok = verifyWithKey(
			"sha256",
			Buffer.from(`${rawHeader}.${rawPayload}`),
			publicKey,
			Buffer.from(rawSignature, "base64url"),
		);
		if (!ok) return null;
	} catch {
		return null;
	}

	const seconds = Math.floor(now() / 1000);
	const exp = typeof payload.exp === "number" ? payload.exp : 0;
	const iat = typeof payload.iat === "number" ? payload.iat : 0;
	const nbf = typeof payload.nbf === "number" ? payload.nbf : 0;
	if (!exp || exp + CLOCK_SKEW_SECONDS < seconds) return null;
	if (iat && iat - CLOCK_SKEW_SECONDS > seconds) return null;
	if (nbf && nbf - CLOCK_SKEW_SECONDS > seconds) return null;

	if (payload.iss !== ISSUER) return null;
	// GitHub sends `aud` as a string; accepting an array would loosen the match to "contains".
	if (payload.aud !== expected.audience) return null;
	if (payload.repository !== expected.repository) return null;
	const workflowRef = `${expected.repository}/${expected.workflowPath}@${expected.workflowRef}`;
	if (payload.workflow_ref !== workflowRef) return null;
	if (
		payload.job_workflow_ref !== undefined &&
		payload.job_workflow_ref !== workflowRef
	)
		return null;
	if (payload.event_name !== "workflow_dispatch") return null;
	if (payload.ref !== expected.workflowRef) return null;

	const runId =
		typeof payload.run_id === "string" && /^\d{1,20}$/.test(payload.run_id)
			? payload.run_id
			: null;
	if (!runId) return null;
	const environment =
		typeof payload.environment === "string" ? payload.environment : null;
	return { runId, environment };
}
