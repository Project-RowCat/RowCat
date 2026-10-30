import { z } from "zod";
import { NICKNAME_LIMITS } from "./me.ts";

/**
 * First-run setup and deployment readiness.
 *
 * ```text
 * GET  /v2/setup                          { open }      anyone — one bit, no state of the deployment
 * POST /v2/setup/claim                    { code }      a signed-in member — becomes the first admin
 * POST /v2/setup/claim-local              { code }      this computer only — creates the local owner (admin)
 * POST /v2/auth/local-sign-in             —             this computer only — a session for the local owner
 * GET  /v2/admin/deployment/readiness     capabilities  admin only — states, never values
 * ```
 *
 * ## Why a promotion path exists at all
 *
 * Roles otherwise change only on the server (`db:seed:moderator`, which the production API image
 * now carries as `dist/db/seed-moderator.mjs`). A deployment brought up with `docker compose up` had
 * no way to get its first operator short of editing `member.role` in psql, and a first admin should
 * not need a shell in the container. The claim is the one exception, and it is narrow on purpose:
 *
 * - the code is printed only to the API's own log, so presenting it proves the caller can read the
 *   server, which is the same authority the seed script assumes;
 * - it works once — completion closes setup for good, and a deployment that already had an admin
 *   when it booted never opens it;
 * - the request names no role and no member: what it grants is fixed (`admin`) and who receives it
 *   is the session. A body that could say `{ role }` or `{ memberId }` would be a role-patch API.
 *
 * ## The local owner — a deployment used without signing in

A deployment that runs on one person's computer (the desktop app, `pnpm dev`) can be set up without an
account: `claim-local` makes the server create one member with no email address and no password, and
from then on a browser on that computer is signed in as it by `local-sign-in`. The member is an
ordinary member in every other respect — its id scopes the local database and the sync namespace like
anyone's — so nothing downstream learns a second kind of identity.

Both doors open only for a request that is provably from this computer (`apps/api/src/lib/local-request.ts`:
a loopback socket, a loopback `Host`, no forwarding headers). That is the whole of the authority: a
deployment reachable from anywhere else answers them 404, whatever its configuration. The choice is made
once, at setup, and recorded on the setup row; there is no switch that turns it on later, because the
same choice made on a running multi-member deployment would hand its operator role to whoever sits at
the server.

## Why readiness carries no values
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
	/**
	 * `claim-local` from somewhere that is not this computer. Says what to do instead (set up with an
	 * account), not why the request was judged remote — the inputs of that judgment are not the
	 * caller's business.
	 */
	localUnavailable: "setup_local_unavailable",
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

/**
 * The Better Auth path of the local owner's sign-in, under `/v2/auth`. A constant here because three
 * callers name it (the API's HTTP edge, the web, the console), and a typo in one of them is a guest
 * screen with no error.
 */
export const LOCAL_SIGN_IN_AUTH_PATH = "/local-sign-in";

/**
 * The local claim: the code, plus the name the new member goes by — there is no sign-up form to have
 * asked for one, and a placeholder would end up on every comment that member writes. The same limits
 * as a nickname change, because that is what it becomes.
 */
export const SetupClaimLocalRequest = z
	.object({
		code: z.string().max(64),
		nickname: z
			.string()
			.trim()
			.min(NICKNAME_LIMITS.min)
			.max(NICKNAME_LIMITS.max),
	})
	.strict();
export type SetupClaimLocalRequest = z.infer<typeof SetupClaimLocalRequest>;

/** The member that became admin — the caller, always (for `claim-local`, the local owner it created). */
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
