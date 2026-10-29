import { resetViewerState } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DeleteAccountTrigger } from "#/features/account/delete-account-trigger.tsx";
import type { AccountDeletion } from "#/features/account/use-account-deletion.ts";
import { signOutFailed } from "#/features/auth/auth-error.ts";
import { authClient } from "#/lib/auth.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { showErrorToast } from "#/lib/toast.ts";

/**
 * Shared surface and exit path for the entry gates (age, guardian consent).
 *
 * The gates differ in what they ask, but two things must match:
 * - Surface: both use the same background and padding. If they differed, users would feel
 *   moved to another place each time they pass a gate.
 * - Exit: logout and account deletion. No gate may trap a person.
 *
 * The logout order (end session, clear cached server state, invalidate the router) is a rule, not
 * markup. If each gate wrote it, one would eventually skip the cache clear, and the previous user's
 * nickname and state would stay on screen after logout.
 *
 * Account deletion is not sent to the account screen. That screen sits behind the gates, so a link
 * there loops back to the consent that is blocking the user. A link that looks like an exit but
 * loops is worse than none, because users believe it works. The action is shared with the account
 * screen (features/account/delete-account-trigger.tsx).
 */

/**
 * The gate renders no children, so no product screen mounts while this surface is shown.
 *
 * Entry follows the same rules as route transitions, especially during hydration: no start value is
 * given. If /me resolves in the route loader, this surface reaches the server HTML already in its
 * final state, and an opacity: 0 start would cause a hydration mismatch and leave the gate
 * invisible. If JavaScript never arrives, the user sees neither the app nor the gate. The decision
 * already lives in PageEnter (lib/motion/page-enter.ts); a second copy would eventually be fixed in
 * only one place.
 *
 * Exit is not animated. A user who has consented wants the product screen, not this surface
 * disappearing, which is the same reason routes have no exit.
 *
 * The wrapper goes around the child, not the inner div, because the grid cell is that div. A
 * transformed element placed there would shift centering by the transform.
 */
export function GateSurface({ children }: { children: ReactNode }) {
	return (
		<main className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background p-6">
			<div className="w-full max-w-md py-8">
				<PageEnter>{children}</PageEnter>
			</div>
		</main>
	);
}

/**
 * GateExit takes `note` from the screen because the reason for being held differs per gate. Age
 * says 'if you do not tell us'; guardian consent says 'if approval is not obtained'. Fixing the copy
 * here would make one of them untrue.
 */
export function GateExit({
	note,
	deletion,
	busy,
}: {
	note: string;
	deletion: AccountDeletion;
	/** Whether the gate's main action is in progress. The exit is locked too while it is. */
	busy?: boolean;
}) {
	const { t } = useTranslation("onboarding");
	const queryClient = useQueryClient();
	const router = useRouter();
	const [signingOut, setSigningOut] = useState(false);
	const disabled = Boolean(busy) || signingOut || deletion.phase === "deleting";

	return (
		<div className="mt-6 flex flex-col gap-3 border-t pt-5">
			<p className="text-xs leading-6 text-muted-foreground">{note}</p>
			<div className="flex flex-wrap items-center gap-2">
				{/*
				 * Logout is never gated. It runs in the order given in the file header. The gate then removes
				 * itself once the viewer becomes null.
				 */}
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={async () => {
						setSigningOut(true);
						try {
							await authClient.signOut();
							await resetViewerState(queryClient);
							await router.invalidate();
						} catch {
							/**
							 * This is the exit path, so failure must not be silent. A trapped user who presses this and
							 * sees nothing happen is left on a screen they cannot leave.
							 */
							showErrorToast(signOutFailed());
						} finally {
							setSigningOut(false);
						}
					}}
				>
					{signingOut ? t("gate.signingOut") : t("gate.signOut")}
				</Button>
				<DeleteAccountTrigger deletion={deletion} size="sm" />
			</div>
			{/*
			 * The guide stays a link rather than copying what is deleted and what remains. That answer has
			 * one source, the document.
			 */}
			<Link
				to="/account-deletion"
				className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				{t("gate.deletionDetails")}
			</Link>
		</div>
	);
}
