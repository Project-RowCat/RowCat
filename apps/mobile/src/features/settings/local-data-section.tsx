import { AlertDialog, Button } from "@rowcat/ui-native";
import { useEffect, useRef, useState } from "react";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { resetViewerLocalData } from "../../lib/local-reset.ts";
import { useLocalResetPorts } from "../../lib/local-reset-ports.ts";
import {
	LOCAL_DATA_ACTION_LABEL,
	LOCAL_DATA_AFTER_NOTE,
	LOCAL_DATA_CANCEL_LABEL,
	LOCAL_DATA_CONFIRM_DESCRIPTION,
	LOCAL_DATA_CONFIRM_TITLE,
	LOCAL_DATA_FAILURE_MESSAGE,
	LOCAL_DATA_KEPT,
	LOCAL_DATA_PENDING_LABEL,
	LOCAL_DATA_REMOVED,
	LOCAL_DATA_ROW_DESCRIPTION,
	LOCAL_DATA_ROW_LABEL,
	LOCAL_DATA_SECTION_DESCRIPTION,
	LOCAL_DATA_SECTION_TITLE,
	LOCAL_DATA_SYNC_NOTE,
} from "./local-data-copy.ts";
import {
	type LocalResetAwaiting,
	localResetSettled,
} from "./local-reset-turn.ts";
import { SettingsField, SettingsSection } from "./settings-parts.tsx";

/**
 * This device's data: **one operation, which erases.**
 *
 * ## Why not on the account screen
 *
 * The account screen's danger zone deals with the account's **lifetime** (deletion). This is about
 * what this device holds, which is on the same axis as appearance. Logout, account deletion and
 * device data erasure mean entirely different things, and gathering them in one place would leave
 * the user unable to learn the difference on screen (the web places this operation under `General` in
 * settings for the same reason).
 *
 * ## This section does not draw account values
 *
 * It reads one member id and nothing else; that value is the **owner of the local scope**, not an
 * account resource. Nickname, email and sync state are still owned by `/account`.
 *
 * ## It does not reuse the account-deletion cleanup path
 *
 * It calls neither `abandonViewer`, `resetViewerState` nor `signOut`. Those three are wiring for
 * **after the account has gone**, whereas here the account stays alive. In particular
 * `abandonViewer` blocks that member's reactivation **permanently** for the life of the process, so
 * using it would lock the user out of their own account in exchange for erasing data (see the
 * header of `lib/local-reset.ts`).
 *
 * ## Guests get no section at all
 *
 * There is no open scope, so there is nothing to erase. No disabled button holds a place: the same
 * rule as the drawer not drawing the `Recent conversations` section for guests (in this screen only members
 * arrive, so this branch is effectively a guard).
 *
 * ## It does not wait for the scope to open
 *
 * Erasure acts on the **name**, so it needs no open connection. Waiting for `status === "ready"`
 * and disabling the button would blink an unpressable control while the screen loads, and that
 * blink would not mean the operation is actually blocked.
 */
export function LocalDataSection() {
	const { viewerId, scope, status } = useMobileLocalScope();
	const ports = useLocalResetPorts();
	const [confirming, setConfirming] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/**
	 * Folds a second confirmation in the same tick. `pending` is true only **after** a render arrives,
	 * so if two fingers land in the same frame both checks read false, and an irreversible operation
	 * would start twice.
	 */
	const runningRef = useRef(false);
	/**
	 * The reset currently being awaited. This is the axis that holds the lock **until a new scope
	 * opens** after success; the decision belongs to a pure function (`local-reset-turn.ts`).
	 */
	const awaitingRef = useRef<LocalResetAwaiting | null>(null);
	/** Axis that forces one re-render when the effect below releases the lock. The value itself is never read. */
	const [settled, setSettled] = useState(0);

	/**
	 * **The lock of a successful reset is released here.**
	 *
	 * Previously the success branch never released the lock (its comment said it prevented pressing
	 * again before the transition finished), so the lock stayed **even after** that transition ended:
	 * someone who stayed on the same screen could not erase again. Conversely, releasing it
	 * immediately in `finally` opens a window where the data is gone and no new scope exists yet.
	 *
	 * So it is released on an observed fact: this member now owns a scope of a **new instance**.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: settled is a re-render generation.
	useEffect(() => {
		const awaiting = awaitingRef.current;
		if (!awaiting) return;
		if (!localResetSettled(awaiting, { viewerId, status, scope })) return;
		awaitingRef.current = null;
		runningRef.current = false;
		setPending(false);
	}, [viewerId, status, scope, settled]);

	if (!viewerId) return null;

	const close = () => {
		if (runningRef.current) return;
		setConfirming(false);
		setError(null);
	};

	const reset = (): void => {
		if (runningRef.current) return;
		runningRef.current = true;
		/**
		 * Captures the values to compare against **at the start**. Reading them from render state would
		 * give the values of the render that created this callback, which may already be the next scope.
		 */
		awaitingRef.current = { viewerId, previousScope: scope };
		setPending(true);
		setError(null);
		void resetViewerLocalData(viewerId, ports)
			.then(() => {
				/**
				 * Close the dialog but **keep the lock.** The scope is reopening at this moment
				 * (`resetViewerData` also reactivates it), and the effect above observes that the transition
				 * has finished. Releasing here would open a window with neither data nor scope.
				 *
				 * This branch can also run after reactivation has already finished (the deletion was very
				 * fast). In that case the effect has no reason to run again, so bump the generation to wake it.
				 */
				setConfirming(false);
				setSettled((n) => n + 1);
			})
			.catch(() => {
				/**
				 * On failure, **the dialog stays open**, because what the user can do is inside it: retry or
				 * close (`docs/design/FAILURE-FEEDBACK.md`).
				 *
				 * Released immediately here. Nothing was erased, so there is no transition to wait for.
				 */
				awaitingRef.current = null;
				runningRef.current = false;
				setPending(false);
				setError(LOCAL_DATA_FAILURE_MESSAGE);
			});
	};

	return (
		<SettingsSection
			title={LOCAL_DATA_SECTION_TITLE}
			description={LOCAL_DATA_SECTION_DESCRIPTION}
		>
			<SettingsField
				label={LOCAL_DATA_ROW_LABEL}
				description={LOCAL_DATA_ROW_DESCRIPTION}
			>
				<Button
					label={LOCAL_DATA_ACTION_LABEL}
					variant="destructive"
					fullWidth
					onPress={() => setConfirming(true)}
				/>
			</SettingsField>

			{/**
			 * An irreversible confirmation, so this is an `AlertDialog` (that cell of the presentation table). The
			 * question this dialog answers is not "is this really okay?" but **what is lost, what remains, and whether
			 * it can come back**. Those sentences live in `local-data-copy.ts`, and a pure test locks the claims by value.
			 */}
			<AlertDialog
				open={confirming}
				title={LOCAL_DATA_CONFIRM_TITLE}
				description={[
					LOCAL_DATA_CONFIRM_DESCRIPTION,
					LOCAL_DATA_REMOVED,
					LOCAL_DATA_KEPT,
					LOCAL_DATA_SYNC_NOTE,
					LOCAL_DATA_AFTER_NOTE,
				].join("\n\n")}
				confirmLabel={
					pending ? LOCAL_DATA_PENDING_LABEL : LOCAL_DATA_ACTION_LABEL
				}
				cancelLabel={LOCAL_DATA_CANCEL_LABEL}
				destructive
				busy={pending}
				error={error}
				onConfirm={reset}
				onCancel={close}
			/>
		</SettingsSection>
	);
}
