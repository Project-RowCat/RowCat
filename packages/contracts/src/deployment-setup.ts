import { z } from "zod";

/**
 * First-run setup and deployment readiness.
 *
 * ```text
 * GET  /v2/setup                          { open }      anyone — one bit, no state of the deployment
 * POST /v2/setup/claim                    { code }      a signed-in member — becomes the first admin
 * GET  /v2/admin/deployment/readiness     capabilities  admin only — states, never values
 * ```
 *
 * ## Why a promotion path exists at all
 *
 * Roles otherwise change only on the server (`db:seed:moderator`), and the production API image
 * does not carry that script: a deployment brought up with `docker compose up` had no way to get
 * its first operator short of editing `member.role` in psql. The claim is the one exception, and it
 * is narrow on purpose:
 *
 * - the code is printed only to the API's own log, so presenting it proves the caller can read the
 *   server, which is the same authority the seed script assumes;
 * - it works once — completion closes setup for good, and a deployment that already had an admin
 *   when it booted never opens it;
 * - the request names no role and no member: what it grants is fixed (`admin`) and who receives it
 *   is the session. A body that could say `{ role }` or `{ memberId }` would be a role-patch API.
 *
 * ## Why readiness carries no values
 *
 * `env:doctor` stays a process because its report includes public-but-specific values (hosts,
 * origins, Services IDs). This projection is the capability, its state and the variable names that
 * govern it, so the screen can say what is off and what to set without the response becoming a
 * copy of the deployment's configuration.
 */

export const SETUP_ERROR_CODE = {
	/** Setup was completed, or the deployment already had an admin when it booted. Not retryable. */
	closed: "setup_closed",
	/** The code does not match. One message for every mismatch; how it was wrong is not said. */
	invalidCode: "setup_code_invalid",
	rateLimited: "setup_rate_limited",
} as const;
export type SetupErrorCode =
	(typeof SETUP_ERROR_CODE)[keyof typeof SETUP_ERROR_CODE];

export const SetupStatusDto = z.object({ open: z.boolean() });
export type SetupStatusDto = z.infer<typeof SetupStatusDto>;

/**
 * Only the code. Normalization (`normalizeSetupCode` in `@rowcat/domain`) is the server's too, so
 * the cap is generous: a pasted code with surrounding whitespace must reach the folding rule, not be
 * refused here as too long.
 */
export const SetupClaimRequest = z
	.object({ code: z.string().max(64) })
	.strict();
export type SetupClaimRequest = z.infer<typeof SetupClaimRequest>;

/** The member that became admin — the caller, always. */
export const SetupClaimResponse = z.object({ memberId: z.string() });
export type SetupClaimResponse = z.infer<typeof SetupClaimResponse>;

/** `env:doctor`'s six states. The API pins the equivalence with its own type. */
export const DeploymentCapabilityStatus = z.enum([
	"ready",
	"disabled",
	"degraded",
	"blocked",
	"invalid",
	"n/a",
]);
export type DeploymentCapabilityStatus = z.infer<
	typeof DeploymentCapabilityStatus
>;

export const DeploymentCapabilityGroup = z.enum([
	"core",
	"auth",
	"infra",
	"mail",
	"push",
	"identity",
	"generation",
	"membership",
]);
export type DeploymentCapabilityGroup = z.infer<
	typeof DeploymentCapabilityGroup
>;

/**
 * An allowlist: no `summary` or `detail`, because those are where the doctor puts hosts and IDs.
 * `.strict()` so a server that starts sending them is rejected by the SDK rather than drawn.
 */
export const DeploymentCapabilityDto = z
	.object({
		id: z.string(),
		group: DeploymentCapabilityGroup,
		label: z.string(),
		status: DeploymentCapabilityStatus,
		/** Whether this state would block a production release (`env:doctor --mode production`). */
		blocksRelease: z.boolean(),
		/** Environment variable names that decide this capability. Names, never values. */
		variables: z.array(z.string()),
	})
	.strict();
export type DeploymentCapabilityDto = z.infer<typeof DeploymentCapabilityDto>;

export const DeploymentReadinessDto = z
	.object({
		/** The `NODE_ENV` the server runs under, as the doctor reads it. */
		mode: z.enum(["development", "production"]),
		capabilities: z.array(DeploymentCapabilityDto),
	})
	.strict();
export type DeploymentReadinessDto = z.infer<typeof DeploymentReadinessDto>;
