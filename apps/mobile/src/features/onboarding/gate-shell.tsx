import { space } from "@rowcat/design";
import {
	Button,
	LinkButton,
	Notice,
	ScrollScreen,
	Separator,
	Text,
} from "@rowcat/ui-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { WEB_ORIGIN } from "../../lib/env.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { accountDeletionGuideUrl } from "../../lib/public-web.ts";
import { DeleteAccountTrigger } from "../account/delete-account-trigger.tsx";
import type { AccountDeletion } from "../account/use-account-deletion.ts";
import {
	GATE_DELETE_GUIDE_LABEL,
	GATE_SIGN_OUT_FAILED,
	GATE_SIGN_OUT_LABEL,
	GATE_SIGNING_OUT_LABEL,
} from "./gate-copy.ts";

/**
 * The surface and exit path shared by the entry gates (the native counterpart of web's
 * `features/onboarding/gate-shell.tsx`). The two gates (age, guardian consent) must agree on two
 * things:
 *
 * - The surface: both use the same background and spacing. If they diverge, the person reads the
 *   transition from one gate to the next as being moved somewhere else.
 * - The exit path: sign-out and account deletion. No gate traps the person.
 *
 * Keeping this in one file matters because a per-gate copy eventually drops the sign-out ordering
 * or routes deletion to the account screen, which sits behind the gate. An exit that loops back to
 * the gate is worse than no exit.
 *
 * Sign-out calls the existing transition owner (`lib/session-transition.ts`) instead of
 * `authClient.signOut()`: the ordering (end session, clear held server state, release local scope)
 * lives there as a rule, and a second path would not carry that ordering.
 */

/**
 * The surface the gates cover. It is a `ScrollScreen` because both are top-to-bottom document
 * flows, one of them a form (age). Safe area and keyboard avoidance already live in that component,
 * so the gates do not repeat them.
 *
 * This is not an overlay above the tree. While it is shown the product screens are not mounted at
 * all (`app/_layout.tsx` renders it instead of the navigator). Web once covered the app with `fixed
 * inset-0`, leaving the header and sidebar focusable while hidden; this does not repeat that.
 */
export function GateSurface({ children }: { children: ReactNode }) {
	return <ScrollScreen contentStyle={surface.content}>{children}</ScrollScreen>;
}

/**
 * Exit from a gate: sign-out and account deletion.
 *
 * The screen passes `note` because the reason a person is held differs per gate (age: "if you do
 * not tell us"; guardian consent: "if approval is not received"). Fixing the wording here would
 * make one of them untrue.
 */
export function GateExit({
	note,
	deletion,
	busy,
}: {
	note: string;
	deletion: AccountDeletion;
	/** Whether the gate's primary action is in progress; the exit path is locked too. */
	busy?: boolean;
}) {
	const identity = useMobileIdentity();
	const signingOut = identity.pending === "sign-out";
	const disabled = Boolean(busy) || signingOut || deletion.phase === "deleting";

	const guideUrl = accountDeletionGuideUrl(WEB_ORIGIN);

	return (
		<View style={surface.exit}>
			<Separator />
			<Text variant="caption" tone="muted-foreground">
				{note}
			</Text>
			<View style={surface.exitActions}>
				<Button
					label={signingOut ? GATE_SIGNING_OUT_LABEL : GATE_SIGN_OUT_LABEL}
					variant="ghost"
					disabled={disabled}
					busy={signingOut}
					onPress={() => void identity.signOut()}
				/>
				{/**
				 * **Deletion is not routed to the account screen.** That screen sits behind
				 * this gate, so routing there would loop back: deleting would first require
				 * a birth date (or guardian approval). The trigger itself is shared with the
				 * account screen.
				 */}
				<DeleteAccountTrigger deletion={deletion} />
			</View>
			{/**
			 * **This is the exit path, so it must not fail silently.** If a person held at the gate
			 * presses this and nothing happens, they are left with a screen they cannot leave.
			 *
			 * The failure is read from the identity provider, not local state. Local state would never
			 * be drawn: while sign-out runs the session folds to `booting` (`resolveSessionState` hides
			 * the previous identity) and the gate unmounts on that frame. When the failure returns the
			 * viewer, the gate remounts and component state is already gone.
			 *
			 * Only sign-out can be started from a gate, so the meaning of this value does not drift
			 * (a successful auth clears this slot when its next procedure starts).
			 */}
			{identity.failure ? (
				<Notice tone="destructive" message={GATE_SIGN_OUT_FAILED} />
			) : null}
			{/**
			 * The guide stays a link. Having the trigger here does not mean copying "what is deleted
			 * and what remains" onto this screen; the single source of that answer is the document.
			 */}
			{guideUrl ? (
				<View style={surface.links}>
					<LinkButton
						label={GATE_DELETE_GUIDE_LABEL}
						onPress={() => void WebBrowser.openBrowserAsync(guideUrl)}
					/>
				</View>
			) : null}
		</View>
	);
}

const surface = StyleSheet.create({
	content: { gap: space.md },
	links: { alignItems: "flex-start", gap: space.xs },
	exit: { gap: space.sm, marginTop: space.lg },
	exitActions: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
});
