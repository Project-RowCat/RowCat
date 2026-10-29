import { toast } from "@rowcat/ui-web/components/toast";

/**
 * The layer that reports "the operation you just pressed failed". `apps/web/src/lib/toast.ts` has
 * the same name on purpose: the visible primitive (`@rowcat/ui-web`) is shared, while when and what
 * to raise is each app's product decision.
 *
 * In this app only operations whose control leaves the screen use it (today, sign-out alone).
 * Destructive operations fail inline inside `ConfirmDialog` so the operator's typed reason is not
 * lost, and query failures belong to `QueryState`/`ErrorBlock`. A second call site is a signal that
 * some operation bypasses `ConfirmDialog` — ask why it has no confirmation first.
 *
 * Error toasts never dismiss themselves (`timeout: 0`): console failures usually happen during
 * incident response. There are no success toasts — operations end by redrawing server-confirmed
 * state, and "applied" toasts soon become unread background, taking failures down with them.
 */

/** Structurally matches `@base-ui/react`'s `add` options. */
export interface ErrorToastOptions {
	type: "error";
	description: string;
	/** 0 means never auto-dismiss. */
	timeout: 0;
	priority: "high";
}

/**
 * A pure function so the layer's promises (`timeout: 0`, `priority`) live in one value a test can
 * lock; scattered across call sites, one screen's errors could vanish after a few seconds and
 * nobody would see it without making that screen actually fail.
 */
export const errorToastOptions = (message: string): ErrorToastOptions => ({
	type: "error",
	description: message,
	timeout: 0,
	priority: "high",
});

/** Browser-only: call from event handlers and effects. */
export function showErrorToast(message: string): void {
	toast.add(errorToastOptions(message));
}
