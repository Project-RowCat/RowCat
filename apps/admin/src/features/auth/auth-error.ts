/**
 * Auth failure copy for the operations console.
 *
 * `apps/web/src/features/auth/auth-error.ts` has a same-named file on purpose: the two apps never
 * import each other, and these sentences address operators so they may diverge. What is shared is
 * the failure-drawing layer (`@rowcat/ui-web`'s toast primitive).
 */

/**
 * Sign-out did not finish. The reason is not split: whatever failed, the fact the operator needs is
 * that they are still signed in, which matters because this screen holds members' emails and
 * sanction history.
 */
export const SIGN_OUT_FAILED =
	"Couldn't sign out. You're still signed in, so please try again.";
