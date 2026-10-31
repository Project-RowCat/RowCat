/**
 * The pure rules of the desktop app's self-update: what a release is called, where the feed is, when
 * to look, and on which platforms the installer can replace itself. Electron is not imported here, so
 * the rules are tested by value (`update-policy.test.ts`) and the release script reads the same ones.
 *
 * **A release is named by its date; the installer carries that date as `YYYY.M.D`.** electron-builder
 * and Windows read only `MAJOR.MINOR.PATCH` (`.github/workflows/desktop-release.yml`), and the updater
 * compares exactly that number — a newer date is a newer version, and nothing older is ever accepted,
 * because the data folder has already been migrated forward by the build that ran on it.
 */

/** `2026.10.31` → `2026-10-31`. Anything that is not a real calendar date is not a release. */
export function releaseDateOf(version: string): string | null {
	const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(version);
	if (!match) return null;
	const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
		number,
		number,
		number,
	];
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	)
		return null;
	return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The Windows installer's file name, which is also the name the release attaches and the name
 * `latest.yml` points at. **The updater downloads the file `latest.yml` names**, so the release must
 * not rename it afterwards — the workflow used to, and that rename alone would make every update a 404.
 * Whitespace becomes `-`: GitHub rewrites spaces in asset names, the updater rewrites them differently,
 * and a fork's `APP_NAME` may hold one.
 */
export function windowsInstallerName(appName: string, version: string): string {
	const date = releaseDateOf(version);
	const product = appName.trim().replace(/\s+/g, "-");
	return `${product}-${date ?? version}-windows-x64.exe`;
}

export interface UpdateFeed {
	owner: string;
	repo: string;
}

/**
 * The feed is the GitHub repository the release workflow ran in (`GITHUB_REPOSITORY`), read at
 * packaging time and written into the installer's `app-update.yml`. It is never a literal here: a fork
 * that publishes its own installer gets its own feed with nothing to edit, and an installer packaged on
 * a developer's computer has no feed at all — that build does not update itself, which is what a build
 * nobody released should do.
 */
export function updateFeedFrom(
	repository: string | undefined,
): UpdateFeed | null {
	const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(
		repository?.trim() ?? "",
	);
	if (!match) return null;
	return { owner: match[1] as string, repo: match[2] as string };
}

/**
 * Where an installed copy can replace itself.
 *
 * ```text
 * win32    the NSIS installer runs silently over the installed copy — unsigned is accepted
 * linux    only an AppImage (the runtime sets APPIMAGE); a copy unpacked anywhere else has no file to swap
 * darwin   no: Squirrel.Mac installs only a signed app, and this one is not (apps/desktop/README.md)
 * ```
 */
export function selfUpdateSupported(
	platform: NodeJS.Platform,
	env: Readonly<Record<string, string | undefined>>,
): boolean {
	if (platform === "win32") return true;
	if (platform === "linux") return Boolean(env.APPIMAGE);
	return false;
}

/**
 * How often the running app asks the feed. There is no timer: the app asks once at launch and again
 * when its window comes to the front, at most this often. An app left open for a week still learns of a
 * release the next time someone looks at it, and an app nobody looks at makes no requests.
 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A clock that moved backwards counts as due: otherwise the app would stop asking until it caught up. */
export function updateCheckDue(
	lastCheckedAt: number | null,
	now: number,
): boolean {
	if (lastCheckedAt === null || now < lastCheckedAt) return true;
	return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
}
