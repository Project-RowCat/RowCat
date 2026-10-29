import { writeFileSync } from "node:fs";
import type {
	MobileUpdateJobStage,
	MobileUpdatePlatform,
} from "@rowcat/contracts";

/**
 * The publish tool's result file, read by CI to report to the operations console.
 *
 * ```text
 * ok        true means `releases` are what this run registered (or already existed)
 * stage     the stage that stopped a failed run; closed vocabulary (`MOBILE_UPDATE_JOB_STAGES`)
 * releases  platform · id · status · percentage
 * ```
 *
 * Carries no error text: command output mixes in environment variables, paths and provider
 * responses, and this file's values travel through CI into the console's screen and cache. The
 * original failure is in the CI log, which the console reaches through the run link.
 *
 * Written only when `--result-file` is given, never for a human run in a terminal.
 */
export type ReleaseStage = Exclude<
	MobileUpdateJobStage,
	"source" | "install" | "unknown"
>;

export interface RegisteredRelease {
	platform: MobileUpdatePlatform;
	id: string;
	status: string;
	rolloutPercentage: number;
}

export interface ReleaseResultFile {
	ok: boolean;
	stage: ReleaseStage | null;
	releases: RegisteredRelease[];
}

/** The current stage; on failure its name becomes the result file's `stage`. */
export class StageTracker {
	current: ReleaseStage = "environment";

	enter(stage: ReleaseStage): void {
		this.current = stage;
	}
}

export function writeResultFile(path: string, result: ReleaseResultFile): void {
	writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
}
