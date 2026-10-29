import type { ChatMessage, ChatStore, ChatTailRewrite } from "@rowcat/chat";
import { buildAiResponseEvidence } from "@rowcat/chat";
import {
	AlertDialog,
	DropdownMenu,
	MenuItem,
	MenuSeparator,
} from "@rowcat/ui-native";
import {
	Fragment,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useChatScope } from "../../../lib/local-data/scope.tsx";
import {
	countLaterMessages,
	DELETE_FROM_CONFIRM_TITLE,
	DELETE_FROM_FAILURE_MESSAGE,
	deleteFromMessageCopy,
	MESSAGE_ACTION_ICON,
	MESSAGE_ACTION_LABEL,
	messageActionsFor,
	messageMenuLabel,
	REGENERATE_CONFIRM_TITLE,
	REGENERATE_FAILURE_MESSAGE,
	REGENERATE_PLAIN_COPY,
	regenerateWarningCopy,
} from "./actions.ts";
import { EditMessageDialog } from "./edit-dialog.tsx";
import { ReportMessageModal } from "./report-modal.tsx";

/**
 * Owner of message actions: which message the user is acting on and with what.
 *
 * - The overflow menu lives in the row, the windows live once per screen (`surfaces`). An
 *   anchored menu measures its own trigger so it must sit in the row, and it is cheap while closed
 *   (one `View` and a trigger; portal and content mount on open). Edit, report and confirm dialogs
 *   have no reason to hang off a row, and a single slot makes stacking two unrepresentable. Same
 *   shape as the web's `message-action-bar.tsx` on narrow screens.
 * - Every irreversible action goes through `rewriteHistory`, never the store directly: generation
 *   ownership belongs to the conversation hook, which must cut the running generation and raise the
 *   epoch before committing. Calling `store.deleteFromMessage()` here would let a late response
 *   attach to the slot just cleared.
 * - The count to delete is recounted every render: the subscription stays live while a dialog is
 *   open (sync from another device, a generation committing), so a count captured at open time
 *   diverges from what is actually deleted. This is also why `Alert.alert` was dropped; it is
 *   imperative and freezes the sentence. If the anchor disappears the dialog closes, since a
 *   confirmation without a reference cannot say what it consents to.
 *
 * ```text
 * edit                      Dialog        fills the surface on short devices (`message-edit-presentation.ts`)
 * report                    Dialog(full)  reason, description, evidence and notice must be visible
 * regenerate · delete-from  AlertDialog   one irreversible confirmation
 * copy                      outside menu  needs room to show its mark (`message-action-bar.tsx`)
 * ```
 */

type SurfaceAction = "edit" | "report" | "regenerate" | "delete-from";

interface Target {
	message: ChatMessage;
	action: SurfaceAction;
	/**
	 * The store instance at the moment of the trigger. Not judged by member id: in `Alice → sign out →
	 * Alice` the id matches but the connection was closed and reopened, and writes to the old instance
	 * hit a closed connection. Same ownership axis as generation turns.
	 */
	store: ChatStore;
}

export interface MessageActions {
	/**
	 * Overflow menu for a row, including its trigger (an anchored menu measures its trigger, so both
	 * share a tree). Aligned to the bubble's side: mine right, replies left.
	 */
	renderMenu: (message: ChatMessage, align: "start" | "end") => ReactNode;
	/** The open window; the caller draws it once in its own tree. */
	surfaces: ReactNode;
}

export function useMessageActions({
	messages,
	rewriteHistory,
}: {
	/** The subscribed message window; the basis for counting what gets deleted. */
	messages: readonly ChatMessage[];
	/** The conversation hook's door: abort, epoch raise and continued generation happen inside, in order. */
	rewriteHistory: <T>(
		perform: () => Promise<T>,
		options?: { regenerate?: (result: T) => boolean },
	) => Promise<T>;
}): MessageActions {
	const { store, ownsStore } = useChatScope();
	const [target, setTarget] = useState<Target | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/**
	 * Whether the report includes my preceding message. The evidence itself is not held: it is
	 * re-selected from the list at send time so what the user confirmed equals what goes up.
	 */
	const [includePreceding, setIncludePreceding] = useState(true);

	/**
	 * Close open windows when the scope's owner changes: otherwise Bob would see Alice's confirmation.
	 * Ownership is re-checked right before writing for the already-pressed case.
	 */
	useEffect(() => {
		setTarget((current) =>
			current && current.store !== store ? null : current,
		);
	}, [store]);

	const close = useCallback(() => {
		setTarget(null);
		setError(null);
		setBusy(false);
	}, []);

	/**
	 * Re-ask ownership right before an irreversible write. The account can change while a window is
	 * up, leaving this closure with a reference to a closed (or someone else's) database. Never swap
	 * in the currently open scope's store, or an action started on Alice's screen would end in Bob's
	 * database.
	 */
	const run = useCallback(
		<T,>(
			owner: ChatStore,
			perform: (store: ChatStore) => Promise<T>,
		): Promise<T> | null => (ownsStore(owner) ? perform(owner) : null),
		[ownsStore],
	);

	/** Count after the anchor; null when the anchor is gone, which closes the window. */
	const later = target ? countLaterMessages(messages, target.message.id) : null;

	useEffect(() => {
		if (target && later === null) setTarget(null);
	}, [target, later]);

	/**
	 * The two tail-rewriting actions share one execution path; the only difference is whether
	 * generation continues. Delete does not, since the user asked for cleanup rather than a new
	 * answer.
	 */
	const rewrite = useCallback(
		(
			message: ChatMessage,
			owner: ChatStore,
			options: { regenerate: boolean; failure: string },
		) => {
			if (busy) return;
			setBusy(true);
			setError(null);
			const performed = run(owner, (chat) =>
				rewriteHistory(() => chat.deleteFromMessage(message.id), {
					/**
					 * Do not generate if the rewrite did nothing (the anchor vanished); that would attach an
					 * answer to an action the user effectively cancelled.
					 */
					regenerate: (result: ChatTailRewrite) =>
						options.regenerate && result.applied,
				}),
			);
			if (!performed) {
				// Ownership lost: close quietly rather than write to someone else's database.
				setBusy(false);
				return setTarget(null);
			}
			void performed
				.then(() => close())
				.catch(() => {
					setBusy(false);
					setError(options.failure);
				});
		},
		[busy, run, rewriteHistory, close],
	);

	/** Evidence re-selected from the current list; if none (message gone or not assistant) the form is not drawn rather than inventing empty evidence. */
	const reportSelection = useMemo(
		() =>
			target?.action === "report"
				? buildAiResponseEvidence(messages, target.message.id, {
						includePreceding,
					})
				: null,
		[target, messages, includePreceding],
	);

	const select = useCallback(
		(message: ChatMessage, action: SurfaceAction, owner: ChatStore) => {
			setError(null);
			setBusy(false);
			if (action === "report") setIncludePreceding(true);
			/**
			 * Only `Regenerate` may skip confirmation: regenerating the last response is common and deletes only
			 * the response the user just read and disliked.
			 */
			if (
				action === "regenerate" &&
				regenerateWarningCopy(countLaterMessages(messages, message.id) ?? 0) ===
					null
			) {
				setTarget(null);
				return rewrite(message, owner, {
					regenerate: true,
					failure: REGENERATE_FAILURE_MESSAGE,
				});
			}
			/** The primitive already closed the menu (`closeOnPress`), so accessibility focus has one owner. */
			setTarget({ message, action, store: owner });
		},
		[messages, rewrite],
	);

	const renderMenu = useCallback(
		(message: ChatMessage, align: "start" | "end") => {
			// Scope not open yet, or a guest: no database to edit.
			if (!store) return null;
			/**
			 * Order and contents come from the shared rule (`messageActionsFor`); a per-role branch here
			 * would diverge the two apps' menus. Copy is excluded: it lives on the row's action strip, since
			 * pressing it in the menu closes the menu along with its copied mark.
			 */
			const actions = messageActionsFor(message.role).filter(
				(action) => action !== "copy",
			);
			return (
				<DropdownMenu
					label={messageMenuLabel(message.role)}
					align={align}
					size="sm"
					tone="muted-foreground"
				>
					{actions.map((action) => (
						<Fragment key={action}>
							{action === "delete-from" ? <MenuSeparator /> : null}
							<MenuItem
								icon={MESSAGE_ACTION_ICON[action]}
								label={MESSAGE_ACTION_LABEL[action]}
								destructive={action === "delete-from"}
								onSelect={() => select(message, action as SurfaceAction, store)}
							/>
						</Fragment>
					))}
				</DropdownMenu>
			);
		},
		[store, select],
	);

	const surfaces =
		target === null || later === null ? null : target.action === "edit" ? (
			<EditMessageDialog
				/** The stored original, not the text as drawn. */
				content={target.message.content}
				later={later}
				onClose={close}
				onSave={(content) => {
					const performed = run(target.store, (chat) =>
						/**
						 * The role picks the door, and the door decides whether generation follows (same rule as the
						 * web). Editing a user utterance leaves an unanswered turn, so generation continues after
						 * commit. Editing an assistant response does not: the action means "keep this answer, worded
						 * this way", and generating would append an unrequested turn after the hand-written text.
						 */
						target.message.role === "assistant"
							? rewriteHistory(() =>
									chat.editAssistantMessage(target.message.id, content),
								)
							: rewriteHistory(
									() => chat.editUserMessage(target.message.id, content),
									{
										regenerate: (result: ChatTailRewrite) => result.applied,
									},
								),
					);
					/** Ownership lost: closes quietly without writing to someone else's database. */
					return performed ?? Promise.resolve(null);
				}}
			/>
		) : target.action === "report" ? (
			reportSelection ? (
				<ReportMessageModal
					selection={reportSelection}
					includePreceding={includePreceding}
					onIncludePrecedingChange={setIncludePreceding}
					onClose={close}
				/>
			) : null
		) : target.action === "delete-from" ? (
			<AlertDialog
				open
				title={DELETE_FROM_CONFIRM_TITLE}
				/** Recounted every render so sync arriving while open is reflected. */
				description={deleteFromMessageCopy(later)}
				confirmLabel="Delete"
				destructive
				busy={busy}
				error={error}
				onConfirm={() =>
					rewrite(target.message, target.store, {
						regenerate: false,
						failure: DELETE_FROM_FAILURE_MESSAGE,
					})
				}
				onCancel={close}
			/>
		) : (
			<AlertDialog
				open
				title={REGENERATE_CONFIRM_TITLE}
				description={regenerateWarningCopy(later) ?? REGENERATE_PLAIN_COPY}
				confirmLabel="Regenerate"
				destructive
				busy={busy}
				error={error}
				onConfirm={() =>
					rewrite(target.message, target.store, {
						regenerate: true,
						failure: REGENERATE_FAILURE_MESSAGE,
					})
				}
				onCancel={close}
			/>
		);

	return { renderMenu, surfaces };
}
