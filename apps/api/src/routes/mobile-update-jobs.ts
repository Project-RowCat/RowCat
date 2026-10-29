import {
	MobileUpdateJobReport,
	type MobileUpdateJobReportResponse,
} from "@rowcat/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { publicApiUrl } from "../env.ts";
import { invalidInput } from "../lib/errors.ts";
import {
	bearerToken,
	type GitHubActionsRunClaims,
	verifyGitHubActionsOidcToken,
} from "../lib/github-actions-oidc.ts";
import { readJson } from "../lib/http.ts";
import {
	MOBILE_UPDATE_WORKFLOW_PATH,
	MOBILE_UPDATE_WORKFLOW_REF,
	mobileUpdateCi,
} from "../services/mobile-updates/ci-trigger.ts";
import { applyMobileUpdateJobReport } from "../services/mobile-updates/jobs.ts";

/**
 * CI's publish-job report, `POST /v2/mobile/update-jobs/:id/reports`.
 *
 * No session: the sender is one GitHub Actions run authenticated by its OIDC token
 * (`lib/github-actions-oidc.ts`). It is not under the operations console prefix, where "an
 * operator's request" and "CI's report" would read as the same resource.
 *
 * What a report cannot do:
 * - Create a release. It carries only the id of an already-registered release, re-checked against
 *   the registration table; the contract has no slot for body, signature, channel or runtime.
 * - Report to another job. The run's environment (`ota-<channel>`) must match the job's channel,
 *   and once the first report binds the run id to the job, other runs are rejected.
 *
 * The expected `aud` is this endpoint's own address, so a token meant for a sandbox deployment
 * cannot be replayed on production. A deployment without the CI connection answers 403.
 *
 * Neither token nor body is logged.
 */

export const MOBILE_UPDATE_REPORT_AUDIENCE = `${publicApiUrl.replace(/\/$/, "")}/mobile/update-jobs`;

type Verifier = (token: string) => Promise<GitHubActionsRunClaims | null>;

let verifierOverride: Verifier | null = null;

/** Test-only: plugs in a verifier that does not reach GitHub's JWKS. */
export function __setMobileUpdateReportVerifierForTest(next: Verifier | null) {
	verifierOverride = next;
}

const verify: Verifier = (token) => {
	if (verifierOverride) return verifierOverride(token);
	const ci = mobileUpdateCi();
	if (!ci) return Promise.resolve(null);
	return verifyGitHubActionsOidcToken(token, {
		audience: MOBILE_UPDATE_REPORT_AUDIENCE,
		repository: ci.repository,
		workflowPath: MOBILE_UPDATE_WORKFLOW_PATH,
		workflowRef: MOBILE_UPDATE_WORKFLOW_REF,
	});
};

export const mobileUpdateJobReports = new Hono<AppEnv>().post(
	"/:id/reports",
	async (c) => {
		if (!mobileUpdateCi()) return c.json({ ok: false }, 403);
		const token = bearerToken(c.req.header("Authorization"));
		if (!token) return c.json({ ok: false }, 401);
		const claims = await verify(token);
		if (!claims) return c.json({ ok: false }, 401);

		const parsed = MobileUpdateJobReport.safeParse(await readJson(c));
		if (!parsed.success) throw invalidInput(parsed.error);
		const body: MobileUpdateJobReportResponse =
			await applyMobileUpdateJobReport(c.req.param("id"), parsed.data, claims);
		c.header("cache-control", "no-store");
		return c.json(body);
	},
);
