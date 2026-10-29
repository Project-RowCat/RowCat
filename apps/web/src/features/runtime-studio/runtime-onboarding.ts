/**
 * The first-run onboarding line for the studio, and the memory of having dismissed it.
 *
 * - It exists because the workspace opens as a real TS/TSX project right after a template is
 *   picked. The user then needs four answers (what the template made, where to start, how to run
 *   it, where the docs are). All four are already on screen (explorer rows, the Run button,
 *   bottom-panel tabs, the header's book icon), but a first-time user does not see them.
 * - It is not a tour. A step-by-step overlay with Next blocks the first action of someone who
 *   came to write code, and reading without absorbing becomes the fastest way out. One line is
 *   enough, and the workspace below stays usable.
 * - It does not know the template's identity. Pointing at 'start in systems/progression.ts' would
 *   require the project to record which template it came from. Templates are copied at creation and
 *   are not a runtime dependency (`DraftRuntimeProject` has no such field), and adding one would
 *   break hints for existing projects whenever a template is removed. Instead it points at this
 *   project's real value, the entry file path, which moves with the file.
 * - Its memory is a device preference, stored in `localStorage` like the pane width. It is not
 *   part of drafts or sync: it records that this user learned the tool, not a property of the work,
 *   and it means nothing in published snapshots or cross-device merges. It is not per account
 *   either; on a shared browser, another person seeing the line once more costs one line of hint.
 * - All reads and writes are wrapped in `try`. The API throws in private mode and when storage is
 *   refused, and the studio must not fail to open because of a hint line.
 */

const STORAGE_KEY = "rowcat.runtime.onboarded";

/**
 * Whether the user has already dismissed the line on this device. If storage cannot be read, the
 * line is shown.
 */
export function runtimeOnboardingDismissed(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

export function dismissRuntimeOnboarding(): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, "1");
	} catch {
		// If the dismissal cannot be remembered, it still closes for this session. The hint line must
		// never block the screen.
	}
}

/**
 * Whether to draw the line now, and only after files have arrived. In a frame where the list is
 * empty (storage still loading), 'start with this file' would point at a file that does not exist
 * yet, and pressing it would do nothing.
 */
export const showsRuntimeOnboarding = (input: {
	dismissed: boolean;
	fileCount: number;
}): boolean => !input.dismissed && input.fileCount > 0;
