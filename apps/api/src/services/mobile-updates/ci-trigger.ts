import type {
	MobileUpdateChannel,
	MobileUpdateJobKind,
	MobileUpdatePlatform,
} from "@rowcat/contracts";
import { mobileUpdateCiConfig } from "../../env.ts";
import type { MobileUpdateCiConfig } from "../../lib/mobile-update-ci-config.ts";

/**
 * Port that asks CI to start a publish job; it neither signs nor exports. `dispatch` starts one
 * workflow (closed-vocabulary inputs only); `run` reads a run's state (the reconcile job uses it to
 * find lost reports).
 *
 * The only credential this process holds is the right to start a workflow. Signing keys are secrets
 * of the GitHub environment (`ota-<channel>`) and never reach this deployment, so a compromised API
 * can at most re-run the publish tool from an allowed branch's code.
 *
 * The workflow file and branch are constants: they are the basis for trusting CI's reports
 * (`workflow_ref` in `lib/github-actions-oidc.ts`). Making them configurable would make a
 * deployment expressible that starts one workflow and accepts another's token.
 *
 * That workflow is not in this repository. The public release ships it as an example in
 * `docs/ota/example-workflows.md`; a fork copies it to this path on `main` and these constants and
 * the OIDC check then hold. A deployment without it leaves the CI config (`mobileUpdateCiConfig`)
 * empty and this port is not created (console: read, rollout, pause, resume only; publishing via
 * the CLI).
 *
 * No free-form strings are sent: the operator's reason is not an input (it lives in the job row and
 * audit record). Workflow inputs stay on the run page and flow into shell steps, so only the job id
 * and closed-vocabulary values may ride.
 */

export const MOBILE_UPDATE_WORKFLOW_PATH = ".github/workflows/mobile-ota.yml";
export const MOBILE_UPDATE_WORKFLOW_FILE = "mobile-ota.yml";
/** Branch the workflow *definition* is read from; a different axis from the source commit to publish (input `source`). */
export const MOBILE_UPDATE_WORKFLOW_BRANCH = "main";
export const MOBILE_UPDATE_WORKFLOW_REF = `refs/heads/${MOBILE_UPDATE_WORKFLOW_BRANCH}`;

/** GitHub environment name; each channel's signing key is that environment's secret. */
export const mobileUpdateEnvironmentFor = (channel: MobileUpdateChannel) =>
	`ota-${channel}`;

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

export interface MobileUpdateCiDispatchInput {
	jobId: string;
	kind: MobileUpdateJobKind;
	channel: MobileUpdateChannel;
	platform: MobileUpdatePlatform;
	/** Branch name or 40-char commit. Empty for rollback (the workflow runs from the branch head). */
	source: string;
	/** `draft` or an integer percent. Empty for rollback. */
	rollout: string;
	/** Note date id or `none`. Empty for rollback. */
	note: string;
	targetReleaseId: string;
	toEmbedded: boolean;
}

export interface MobileUpdateCiRun {
	status: "queued" | "in_progress" | "completed";
	/** `success | failure | cancelled | …`; `null` if not finished. */
	conclusion: string | null;
}

export interface MobileUpdateCiTrigger {
	dispatch(
		input: MobileUpdateCiDispatchInput,
	): Promise<{ runId: string | null; runUrl: string | null }>;
	run(runId: string): Promise<MobileUpdateCiRun | null>;
}

const headers = (config: MobileUpdateCiConfig) => ({
	Accept: "application/vnd.github+json",
	Authorization: `Bearer ${config.token}`,
	"X-GitHub-Api-Version": "2022-11-28",
	"Content-Type": "application/json",
	"User-Agent": "rowcat-api",
});

/**
 * GitHub Actions `workflow_dispatch`.
 *
 * The run id is known only when the response supplies it (`return_run_details`); on older GitHub it
 * stays `null` and CI's first report binds the run to the job. It is never looked up by name or
 * time, since another job starting at the same moment would bind the wrong run.
 *
 * The failure response body is kept out of logs and exceptions: it can carry repository settings,
 * and callers would be tempted to relay it to the operator.
 */
export function githubCiTrigger(
	config: MobileUpdateCiConfig,
): MobileUpdateCiTrigger {
	return {
		async dispatch(input) {
			const response = await fetch(
				`${GITHUB_API}/repos/${config.repository}/actions/workflows/${MOBILE_UPDATE_WORKFLOW_FILE}/dispatches`,
				{
					method: "POST",
					headers: headers(config),
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					body: JSON.stringify({
						ref: MOBILE_UPDATE_WORKFLOW_BRANCH,
						return_run_details: true,
						inputs: {
							job_id: input.jobId,
							kind: input.kind,
							channel: input.channel,
							platform: input.platform,
							source: input.source,
							rollout: input.rollout,
							note: input.note,
							target_release: input.targetReleaseId,
							to_embedded: input.toEmbedded ? "true" : "false",
						},
					}),
				},
			);
			if (response.status === 204) return { runId: null, runUrl: null };
			if (!response.ok)
				throw new Error(`workflow dispatch failed (${response.status})`);
			const json = (await response.json().catch(() => ({}))) as {
				workflow_run_id?: unknown;
				html_url?: unknown;
			};
			const runId =
				typeof json.workflow_run_id === "number" ||
				typeof json.workflow_run_id === "string"
					? String(json.workflow_run_id)
					: null;
			const runUrl =
				typeof json.html_url === "string" &&
				json.html_url.startsWith("https://github.com/")
					? json.html_url
					: null;
			return { runId, runUrl };
		},
		async run(runId) {
			const response = await fetch(
				`${GITHUB_API}/repos/${config.repository}/actions/runs/${encodeURIComponent(runId)}`,
				{
					headers: headers(config),
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				},
			);
			if (response.status === 404) return null;
			if (!response.ok)
				throw new Error(`run lookup failed (${response.status})`);
			const json = (await response.json()) as {
				status?: unknown;
				conclusion?: unknown;
			};
			const status =
				json.status === "completed"
					? "completed"
					: json.status === "in_progress"
						? "in_progress"
						: "queued";
			return {
				status,
				conclusion:
					typeof json.conclusion === "string" ? json.conclusion : null,
			};
		},
	};
}

/** CI run page URL, built from the run id when the response gave none (contains no token). */
export const runUrlFor = (repository: string, runId: string) =>
	`https://github.com/${repository}/actions/runs/${runId}`;

/** This deployment's CI connection: repository, channels it registers for, trigger. The token lives only inside the trigger. */
export interface MobileUpdateCi {
	repository: string;
	channels: readonly MobileUpdateChannel[];
	trigger: MobileUpdateCiTrigger;
}

let override: MobileUpdateCi | null | undefined;

/** The deployment's CI connection, or `null` when unconfigured: publish requests get 503 and the screen draws no button. */
export function mobileUpdateCi(): MobileUpdateCi | null {
	if (override !== undefined) return override;
	if (!mobileUpdateCiConfig) return null;
	return {
		repository: mobileUpdateCiConfig.repository,
		channels: mobileUpdateCiConfig.channels,
		trigger: githubCiTrigger(mobileUpdateCiConfig),
	};
}

/** Test only: plugs in a connection that never reaches real GitHub; `undefined` restores the default. */
export function __setMobileUpdateCiForTest(
	next: MobileUpdateCi | null | undefined,
): void {
	override = next;
}
