import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import electronUpdater from "electron-updater";
import {
	releaseDateOf,
	selfUpdateSupported,
	updateCheckDue,
} from "./update-policy.ts";

/**
 * The installed app replacing itself with a newer release — electron-updater over the GitHub releases
 * the desktop workflow publishes (`.github/workflows/desktop-release.yml`).
 *
 * ```text
 * launch · window to the front (≤ every 6 h)   ask the feed
 *   newer release                              download it in the background
 *   downloaded                                 the menu offers 「다시 시작해서 업데이트」
 *   quit (menu, last window, OS shutdown)      the installer runs silently after the servers stop
 * launch failed                                ask now, wait ≤ 3 min, offer 「업데이트하고 다시 시작」
 * ```
 *
 * **Nothing opens by itself.** No dialog, notification or banner announces a download: a native box is
 * modal (and on macOS a modal box refuses quit), and an update is not something the person has to act
 * on — quitting already installs it. The menu item is there for whoever wants it now. Only a check the
 * person asked for answers in a box, because they pressed something and are waiting for the answer —
 * and a launch that failed, whose error box is shown anyway, offers the fix in that same box.
 *
 * **The servers stop before the installer starts.** The NSIS installer ends every process running from
 * the install folder, Postgres included, and it ends them by force. So installing now is
 * `stack.stop()` first and `quitAndInstall` second (main.ts), and installing on quit rides the quit the
 * app already takes: `before-quit` stops the stack, then `app.exit(0)` emits `quit`, which is where the
 * updater spawns the installer.
 *
 * **This module does not decide what the feed is.** electron-builder writes `app-update.yml` into the
 * installer at packaging time from the repository the release ran in (`scripts/build-app.ts`); an
 * installer packaged without one has no file, and then this is off — not failing every launch.
 *
 * What is not here: a download progress screen, a "skip this version", a channel switch, and
 * downgrades. The data folder is migrated forward by whichever build ran on it, so an older build is
 * never installed over it (`allowDowngrade` stays false).
 */

export type UpdaterState =
	| { kind: "off" }
	| { kind: "idle" }
	| { kind: "checking" }
	| { kind: "downloading"; date: string }
	| { kind: "ready"; date: string };

export type ManualCheckResult =
	| { kind: "current"; date: string | null }
	| { kind: "downloading"; date: string }
	| { kind: "ready"; date: string }
	| { kind: "failed" };

export interface DesktopUpdater {
	state(): UpdaterState;
	/** The installed release's date, or null for a build nobody released (`0.0.0`). */
	installedDate(): string | null;
	/** The background check: at launch and when the window comes forward. Never throws, never shows anything. */
	checkInBackground(): void;
	/** The menu's check. The person is waiting, so the result comes back to be said. */
	checkNow(): Promise<ManualCheckResult>;
	/**
	 * Asks the feed now and waits, at most `timeoutMs`, for a newer release to finish downloading.
	 * For a launch that failed: the next release is exactly what may fix it, and a copy that only asks
	 * after a successful start would never learn of one.
	 */
	whenReady(timeoutMs: number): Promise<boolean>;
	/** Spawns the downloaded installer and quits. The caller has already stopped the servers. */
	installAndRestart(): void;
}

interface UpdaterOptions {
	log: (source: string, line: string) => void;
	onChange: () => void;
}

export function createUpdater({
	log,
	onChange,
}: UpdaterOptions): DesktopUpdater {
	const installedDate = () => releaseDateOf(app.getVersion());
	const feedConfig = join(process.resourcesPath, "app-update.yml");
	const reason = !app.isPackaged
		? "not packaged"
		: !selfUpdateSupported(process.platform, process.env)
			? `${process.platform} cannot replace an unsigned app`
			: !existsSync(feedConfig)
				? "this installer was packaged without a feed"
				: null;
	if (reason) {
		log("update", `off: ${reason}`);
		return {
			state: () => ({ kind: "off" }),
			installedDate,
			checkInBackground: () => {},
			checkNow: async () => ({ kind: "failed" }),
			whenReady: async () => false,
			installAndRestart: () => {},
		};
	}

	// The getter builds the platform's updater on first access — only reached where one is supported.
	const { autoUpdater } = electronUpdater;
	autoUpdater.logger = {
		info: (message) => log("update", String(message)),
		warn: (message) => log("update", `warn: ${String(message)}`),
		error: (message) => log("update", `error: ${String(message)}`),
	};
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowDowngrade = false;
	/**
	 * The release is found through `github.com/<repo>/releases/latest`: the newest published release
	 * that is not a draft or a prerelease. Prereleases stay off on purpose — with them on, the provider
	 * takes the first entry of `releases.atom`, and that feed lists **bare tags** too: the `mcp-v*` tag
	 * the npm publish pushes, or a `desktop-<date>` tag whose run has not published yet, would become
	 * every copy's target and 404. `channel` is no fix either (it skips every tag that is not semver,
	 * which is all of ours). So the release workflow publishes desktop releases as the repository's
	 * latest release, and it must stay the only workflow that publishes releases here.
	 */
	autoUpdater.allowPrerelease = false;

	let current: UpdaterState = { kind: "idle" };
	let lastCheckedAt: number | null = null;
	/** Woken on every state change — what `whenReady` waits on. */
	const listeners = new Set<() => void>();
	const set = (next: UpdaterState) => {
		current = next;
		onChange();
		for (const wake of listeners) wake();
	};
	const dateOf = (version: string) => releaseDateOf(version) ?? version;

	autoUpdater.on("checking-for-update", () => {
		if (current.kind === "idle") set({ kind: "checking" });
	});
	autoUpdater.on("update-not-available", () => {
		if (current.kind === "checking") set({ kind: "idle" });
	});
	autoUpdater.on("update-available", (info) => {
		if (current.kind !== "ready")
			set({ kind: "downloading", date: dateOf(info.version) });
	});
	autoUpdater.on("update-downloaded", (info) => {
		log("update", `downloaded ${info.version}; installs on quit`);
		set({ kind: "ready", date: dateOf(info.version) });
	});
	// The default listener only logs, which is the policy: a background failure shows nothing.
	autoUpdater.on("error", () => {
		if (current.kind === "checking" || current.kind === "downloading")
			set({ kind: "idle" });
	});

	const check = async () => {
		lastCheckedAt = Date.now();
		const result = await autoUpdater.checkForUpdates();
		/**
		 * With `autoDownload` the result carries the download, and a failed download (a dropped
		 * connection, a full disk, a checksum mismatch) rejects it after the `error` event has already
		 * logged it and reset the state. Unobserved, that rejection is an uncaught error in the main
		 * process, which Electron answers with a modal box.
		 */
		result?.downloadPromise?.catch(() => {});
		return result;
	};

	/** Resolves on the next state change or at the deadline, whichever is first. */
	const nextChange = (until: number) =>
		new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				listeners.delete(done);
				resolve();
			};
			const timer = setTimeout(done, Math.max(0, until - Date.now()));
			listeners.add(done);
		});

	return {
		state: () => current,
		installedDate,
		checkInBackground: () => {
			if (
				current.kind === "ready" ||
				!updateCheckDue(lastCheckedAt, Date.now())
			)
				return;
			check().catch(() => {
				// Logged by the updater; the next launch or focus asks again.
			});
		},
		checkNow: async () => {
			if (current.kind === "ready")
				return { kind: "ready", date: current.date };
			try {
				const result = await check();
				if (!result?.isUpdateAvailable)
					return { kind: "current", date: installedDate() };
				return { kind: "downloading", date: dateOf(result.updateInfo.version) };
			} catch {
				return { kind: "failed" };
			}
		},
		whenReady: async (timeoutMs) => {
			const until = Date.now() + timeoutMs;
			if (current.kind !== "ready" && current.kind !== "downloading")
				await check().catch(() => null);
			while (
				(current.kind === "checking" || current.kind === "downloading") &&
				Date.now() < until
			)
				await nextChange(until);
			return current.kind === "ready";
		},
		installAndRestart: () => {
			if (current.kind !== "ready") return;
			// Silent, then start the new copy: the person asked for a restart, not for an installer.
			autoUpdater.quitAndInstall(true, true);
		},
	};
}
