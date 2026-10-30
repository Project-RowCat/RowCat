import type {
	DeploymentCapabilityGroup,
	DeploymentCapabilityStatus,
	DeploymentReadinessDto,
} from "@rowcat/contracts";
import { CAPABILITY_VARIABLES } from "../../config/capability-variables.ts";
import {
	buildDoctorReport,
	type CapabilityGroup,
	type CapabilityStatus,
} from "../../config/env-doctor.ts";

/**
 * What this running deployment can do: `env:doctor`'s capabilities, projected to states and
 * variable names (admin only, `GET /v2/admin/deployment/readiness`).
 *
 * `env:doctor` was kept a process because its report carries values — origins, hosts, Services IDs,
 * the SMTP endpoint. This projection is an allowlist that drops `summary` and `detail` whole rather
 * than scrubbing them, so a value a future branch adds to `detail` cannot reach the response. What an
 * operator needs on the screen is "mail is off, these variables turn it on"; the specifics stay with
 * `pnpm env:doctor`, which reads the same report.
 *
 * Built from the process environment the server booted with. Config does not change while the
 * process runs, so the result is computed once.
 */

/** The doctor's vocabulary and the contract's must be the same set; a one-sided addition fails here. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const statusesAgree: Same<CapabilityStatus, DeploymentCapabilityStatus> = true;
const groupsAgree: Same<CapabilityGroup, DeploymentCapabilityGroup> = true;
void statusesAgree;
void groupsAgree;

let cached: DeploymentReadinessDto | null = null;

export function readDeploymentReadiness(): DeploymentReadinessDto {
	if (cached) return cached;
	const report = buildDoctorReport({ env: { ...process.env } });
	cached = {
		mode: report.mode,
		capabilities: report.capabilities.map((capability) => ({
			id: capability.id,
			group: capability.group,
			label: capability.label,
			status: capability.status,
			blocksRelease: capability.blocksRelease === true,
			variables: [...(CAPABILITY_VARIABLES[capability.id] ?? [])],
		})),
	};
	return cached;
}
