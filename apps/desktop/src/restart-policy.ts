/**
 * When a server that stopped on its own is started again — the `restart: unless-stopped` the compose
 * file gives the container images, for the one computer this app runs on.
 *
 * **Restarting is bounded.** A server that dies at once every time (a corrupted file, a migration that
 * cannot apply) would otherwise restart forever, filling the log and leaving the window on 「다시
 * 시작하고 있습니다」 with no way to learn that it never will. After `MAX_RESTARTS` within `WINDOW_MS`
 * the supervisor gives up and the person is told, with the log one press away.
 *
 * The delay grows so a server that cannot bind or connect yet is not hammered; it is short because the
 * person is usually looking at the window while it happens.
 */

export const RESTART_DELAYS_MS = [1_000, 3_000, 10_000] as const;
export const MAX_RESTARTS = RESTART_DELAYS_MS.length;
export const WINDOW_MS = 5 * 60 * 1000;

/** `recent` is when earlier restarts happened. Returns the delay before the next one, or null to give up. */
export function nextRestartDelay(recent: number[], now: number): number | null {
	const inWindow = recent.filter((at) => now - at < WINDOW_MS).length;
	return inWindow >= MAX_RESTARTS ? null : RESTART_DELAYS_MS[inWindow];
}
