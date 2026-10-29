import type { NativePushPermission } from "../../lib/push/native.ts";
import type { PushPreference } from "../../lib/push/preference.ts";

/**
 * Pure state decision for the push settings section.
 *
 * Conditions are not stacked inside the component because this screen must answer six states, not
 * four. The last two matter most:
 *
 * ```text
 * OS permission granted · server registration present   receiving
 * OS permission granted · server registration absent    not receiving  ← drawing this as on is a lie
 * ```
 *
 * Folding those two into one is the most natural mistake here. A switch driven by permission alone
 * shows "on" with no server registration, and the user waits for notifications that never arrive.
 * That state does not heal itself: the device already looks on, so there is no way to turn it on
 * again.
 *
 * ## Why no `Switch`
 *
 * A switch has two values and is always one of them. Here three of the six states need different
 * user actions (enable, open system settings, retry).
 */

/** Server registration progress. The screen reads only this vocabulary. */
export type PushRegistrationPhase =
	/** Not attempted yet. */
	| "idle"
	| "registering"
	| "registered"
	/**
	 * Turning off.
	 *
	 * Not folded into `registering`: until unregistration finishes the device is still receiving, and
	 * drawing "could not register" here would show a failure the user did not cause.
	 */
	| "unregistering"
	| "failed";

export type PushFailureReason =
	/** The OS refused. */
	| "permission"
	/** No token (offline, or no EAS configuration). */
	| "token"
	/** Server registration failed. The permission remains granted. */
	| "server";

export interface PushSectionInput {
	/** Permission not read yet (first frame or read failure). */
	permission: NativePushPermission | "checking";
	canAskAgain: boolean;
	phase: PushRegistrationPhase;
	failure: PushFailureReason | null;
	/** Whether this device is signed in. Registration is tied to the account. */
	signedIn: boolean;
	/**
	 * This installation's decision. A separate axis from permission: after turning off, the OS
	 * permission still reads as granted.
	 */
	preference: PushPreference;
}

export type PushSectionState =
	/** Reading permission. No controls drawn, so no flickering buttons. */
	| { kind: "checking" }
	/** Not asked yet; offer to turn it on. */
	| { kind: "offer"; busy: boolean }
	/** Refused, but can ask again (Android 13+). */
	| { kind: "retry-permission"; busy: boolean }
	/** Refused and the OS no longer shows a prompt; send to system settings. */
	| { kind: "blocked" }
	/** Permission and registration both present. */
	| { kind: "enabled"; busy: boolean }
	/**
	 * Permission granted but no server registration.
	 *
	 * Does not fold into `enabled`. Briefly drawing "this device receives notifications" here is a
	 * lie, and a user who trusts it waits for notifications that never come.
	 */
	| { kind: "incomplete"; busy: boolean; failure: PushFailureReason };

/**
 * Order is the rule: reading → signed out → permission → registration.
 *
 * Checking permission first would draw "receiving" while signed out (a lie, since registration is
 * account-bound). Checking registration first would draw "retry" on a device whose permission was
 * refused, and pressing it does nothing.
 */
export function resolvePushSectionState(
	input: PushSectionInput,
): PushSectionState {
	const busy = input.phase === "registering" || input.phase === "unregistering";

	if (input.permission === "checking") return { kind: "checking" };

	/**
	 * A guest is treated as not yet asked. This screen admits members only, so this is effectively a
	 * guard; folding it away would leave "receiving" on screen for one frame after sign-out.
	 */
	if (!input.signedIn) return { kind: "offer", busy: false };

	if (input.permission === "denied")
		return input.canAskAgain
			? { kind: "retry-permission", busy }
			: { kind: "blocked" };

	if (input.permission === "undetermined") return { kind: "offer", busy };

	/**
	 * **A device the user turned off shows the same screen as one never turned on.**
	 *
	 * It sits after permission because priority matters: on a device the OS blocked, the only way to
	 * enable is system settings, so that guidance comes first. The point is to avoid falling into
	 * `incomplete` (turning off is not a failure); the single next step is to turn it on again.
	 */
	if (input.preference === "disabled") return { kind: "offer", busy };

	/**
	 * While turning off, the device is still receiving. The decision is written only once
	 * unregistration succeeds, and the preference check above answers then.
	 */
	if (input.phase === "registered" || input.phase === "unregistering")
		return { kind: "enabled", busy };

	/**
	 * Permission is granted but there is no registration. If the failure reason is unknown (not
	 * attempted yet), fold to server failure: the user's next step is the same (retry).
	 */
	return {
		kind: "incomplete",
		busy,
		failure: input.failure ?? "server",
	};
}

/**
 * Whether to register with the server now. The only decision for auto-refresh.
 *
 * True only when all four hold: signed in, OS permission already granted, this installation not
 * turned off, and not yet uploaded.
 *
 * The first point is that this is false without permission. If it were true, the caller would go
 * fetch a token, and that call itself shows the system prompt, so the "never ask" promise would
 * break on sign-in. `"checking"` is excluded for the same reason: folding an unknown state into
 * allowed would show the prompt on the first frame.
 *
 * The second point is that this is false after turning off. Looking at permission alone would
 * re-register an installation whose user pressed `Turn off on this device` just by reopening the app (the OS
 * permission is still granted), with no sign of that revival.
 *
 * `unset` may be true, which is why this function does not use a boolean. Only an explicitly
 * turned-off installation is blocked; an installation never chosen behaves as before the field
 * existed (devices that already granted permission keep refreshing). Folding the two into one value
 * would necessarily be wrong for one of them.
 */
export function shouldRegisterPush(input: {
	signedIn: boolean;
	permission: NativePushPermission | "checking";
	preference: PushPreference;
	registeredToken: string | null;
}): boolean {
	return (
		input.signedIn &&
		input.permission === "granted" &&
		input.preference !== "disabled" &&
		input.registeredToken === null
	);
}

/**
 * Whether a fetched token should be uploaded.
 *
 * The server is already idempotent (one row per session and installation), so this check reduces
 * round trips, not correctness. Without it the app re-uploads the same value every time it returns
 * to the foreground.
 */
export function pushTokenChanged(
	registered: string | null,
	current: string | null,
): boolean {
	return current !== null && current !== registered;
}
