import type { SyncSnapshot } from "@rowcat/sync";
import type { AutoSyncSnapshot } from "../../lib/local-sync/auto-sync.ts";
import {
	SYNC_AUTO_BLOCKED,
	SYNC_AUTO_DISABLED,
	SYNC_AUTO_ENABLED,
	SYNC_AUTO_OFFLINE,
	SYNC_AUTO_RETRYING,
	SYNC_STATUS_CHECKING,
	SYNC_STATUS_DISABLED,
	SYNC_STATUS_DISABLED_NOTE,
	SYNC_STATUS_LOCKED,
	SYNC_STATUS_LOCKED_NOTE,
	SYNC_STATUS_NEVER_SYNCED,
	SYNC_STATUS_SYNCING,
	syncErrorText,
	syncLastSyncedText,
} from "./sync-copy.ts";

/**
 * Screen decisions for the sync section. Pure, so they can be checked without rendering. Web's
 * `sync-section.tsx` kept these rules inside the component; this app pulls them out because its
 * tests do not render screens.
 *
 * The state vocabulary (`SyncState`) is not passed to the screen as-is. The section needs only four
 * answers: is it on, is it open on this device, is it synced automatically, and when was it last
 * synced.
 */

/**
 * Which action group is showing now. Not the same as `snapshot.state`.
 *
 * Keying on the raw state would make the buttons reappear each time `ready ↔ syncing` alternates.
 * Only three axes actually change the buttons (same decision as web).
 */
export type SyncControls = "setup" | "unlock" | "trusted" | "none";

export function syncControlsFor(snapshot: SyncSnapshot): SyncControls {
	if (snapshot.state === "disabled") return "setup";
	if (snapshot.state === "locked") return "unlock";
	return snapshot.trusted ? "trusted" : "none";
}

/** A status paragraph: a headline line and, if present, a supporting line. */
export interface SyncStatusText {
	headline: string;
	note: string | null;
}

export function syncStatusTextFor(snapshot: SyncSnapshot): SyncStatusText {
	const { state, lastSyncedAt, lastError } = snapshot;
	if (state === "idle" || state === "checking")
		return { headline: SYNC_STATUS_CHECKING, note: null };
	if (state === "disabled")
		return { headline: SYNC_STATUS_DISABLED, note: SYNC_STATUS_DISABLED_NOTE };
	if (state === "locked")
		return { headline: SYNC_STATUS_LOCKED, note: SYNC_STATUS_LOCKED_NOTE };
	if (state === "syncing") return { headline: SYNC_STATUS_SYNCING, note: null };
	if (state === "error") return syncErrorText(lastError);
	return {
		headline: lastSyncedAt
			? syncLastSyncedText(lastSyncedAt)
			: SYNC_STATUS_NEVER_SYNCED,
		note: null,
	};
}

/**
 * What automatic sync is currently waiting on: one sentence below the status line.
 *
 * This line exists instead of alerting on every failure. Repeatedly announcing "sync failed" to a
 * user whose Wi-Fi dropped is noise, not information.
 */
export function autoSyncTextFor(auto: AutoSyncSnapshot): string {
	if (!auto.enabled) return SYNC_AUTO_DISABLED;
	if (auto.phase === "offline") return SYNC_AUTO_OFFLINE;
	if (auto.phase === "backoff") return SYNC_AUTO_RETRYING;
	if (auto.phase === "blocked" && auto.errorCategory !== null)
		return SYNC_AUTO_BLOCKED;
	return SYNC_AUTO_ENABLED;
}
