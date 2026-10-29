import type { ChatMessage, ChatStore, ChatTailRewrite } from "@rowcat/chat";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { buildAiResponseEvidence } from "#/features/moderation/ai-evidence.ts";
import { ReportDialog } from "#/features/moderation/report-dialog.tsx";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { showErrorToast } from "#/lib/toast.ts";
import {
	countLaterMessages,
	deleteFromFailureMessage,
	deleteFromMessageCopy,
	regenerateFailureMessage,
	regenerateWarningCopy,
} from "./actions.ts";
import { ConfirmRewriteDialog } from "./confirm-rewrite-dialog.tsx";
import { EditMessageDialog } from "./edit-dialog.tsx";

/**
 * The **owner** of message actions: which message is acted on, and what is done to it.
 *
 * The value lives in the parent on purpose. Hanging a dialog tree on each row would mount 500
 * dialogs in a 500-message conversation, all standing **inside the DOM the virtualizer measures**.
 * Rows draw only the trigger, and only one dialog ever opens. Room management already uses the same
 * shape (`room-management.tsx`).
 *
 * **Every irreversible operation goes through `rewriteHistory`.** The store is not called directly
 * because generation ownership lives in the conversation hook: the running generation must be
 * aborted, the epoch raised so a generation that runs to the end cannot reach a save, and only then
 * the commit. Calling `store.deleteFromMessage()` straight from here drops that order, and a late
 * response lands in the spot just deleted.
 *
 * The number of messages to delete is **recounted on every render.** While the window is open the
 * subscription stays alive (writes from another tab, sync that arrived), so counting once on open
 * would let the number the user reads diverge from the range actually deleted. If the anchor itself
 * disappears, the window closes: a confirmation with no basis cannot say what it consents to.
 */

/** The one action currently open. */
interface Target {
	message: ChatMessage;
	action: "edit" | "regenerate" | "delete-from";
	/**
	 * The store **instance** at the moment the trigger was pulled.
	 *
	 * Ownership is not judged by member id because of `Alice → sign out → Alice`. The id is the same,
	 * but in between the database connection was closed and reopened, and writes aimed at the old
	 * instance go to a closed connection. This is the same ownership axis that generation turns and
	 * room management use (`features/conversation/generation-owner.ts`).
	 */
	store: ChatStore;
}

export interface MessageActions {
	requestEdit: (message: ChatMessage) => void;
	requestRegenerate: (message: ChatMessage) => void;
	requestDeleteFrom: (message: ChatMessage) => void;
	/**
	 * Reports an AI response. **It appears only on assistant messages** (§47).
	 *
	 * Unlike the other three, this does not touch the store. It is a write that goes out to the
	 * server, so it passes neither the ownership check (`ownsStore`) nor the epoch raise; there is no
	 * local state to revert. This hook still owns it because **a dialog needs one owner**: attaching a
	 * window to each row would mount hundreds of windows in a 500-message conversation.
	 */
	requestReport: (message: ChatMessage) => void;
	/** The one open dialog. The caller renders it once in its own tree. */
	dialogs: ReactNode;
}

export function useMessageActions({
	messages,
	rewriteHistory,
}: {
	/** The message window currently subscribed. It is the basis for counting the messages to delete. */
	messages: readonly ChatMessage[];
	/** The conversation hook's gate: abort, epoch raise and continuation happen inside it, in that order. */
	rewriteHistory: <T>(
		perform: () => Promise<T>,
		options?: { regenerate?: (result: T) => boolean },
	) => Promise<T>;
}): MessageActions {
	const { t } = useTranslation(["chat", "common"]);
	const { store, ownsStore } = useChatScope();
	const [target, setTarget] = useState<Target | null>(null);
	/**
	 * The report target is **one message id.** The message object is not kept, because the evidence
	 * must be selected again from the list **at send time**, not when it was opened. The subscription
	 * stays alive while the window is open (writes from other tabs, incoming sync), so a stored copy
	 * could diverge from what the screen shows. What the user confirmed must match what goes up.
	 */
	const [reportId, setReportId] = useState<string | null>(null);
	/** Whether to send my preceding message along. On by default, since a response without context is hard to judge. */
	const [includePreceding, setIncludePreceding] = useState(true);

	/**
	 * When the scope's owner changes, close the open dialog.
	 *
	 * If Alice leaves a confirmation open and signs out, and Bob signs in, that window on Bob's screen
	 * would be asking whether to delete Alice's conversation. Closing is not enough once a press has
	 * already happened, so ownership is checked once more just before the write.
	 */
	useEffect(() => {
		setTarget((current) =>
			current && current.store !== store ? null : current,
		);
	}, [store]);

	const close = useCallback(() => setTarget(null), []);

	/**
	 * The evidence selected again from the current list. If there is none (the message is gone, or it
	 * is not an assistant message), no window is drawn: empty evidence is never invented.
	 */
	const reportSelection = useMemo(
		() =>
			reportId
				? buildAiResponseEvidence(messages, reportId, { includePreceding })
				: null,
		[messages, reportId, includePreceding],
	);

	const request = useCallback(
		(action: Target["action"]) => (message: ChatMessage) => {
			// The scope is not open yet, or the viewer is a guest: there is no database to change.
			if (!store) return;
			setTarget({ message, action, store });
		},
		[store],
	);

	/**
	 * Asks ownership again **just before** the irreversible step.
	 *
	 * The account can change while the dialog is open, and this closure then holds a reference to a
	 * database that is already closed (or someone else's). It is important not to swap in the store of
	 * the scope now open: an operation started on Alice's screen would then end in Bob's database.
	 */
	const run = useCallback(
		async (
			perform: (store: ChatStore, message: ChatMessage) => Promise<unknown>,
		) => {
			if (!target) return;
			if (!ownsStore(target.store)) {
				setTarget(null);
				return;
			}
			await perform(target.store, target.message);
			/**
			 * The window closes **after** the commit finishes. Closing first leaves no place to show a
			 * failure, and the user reads an undeleted conversation as deleted. A failure propagates up for
			 * the dialog to catch (this function does not swallow it).
			 */
			setTarget(null);
		},
		[target, ownsStore],
	);

	/**
	 * An action that runs immediately with no confirmation: **only regenerate of the last response.**
	 *
	 * What it deletes is the one response just read, a button the user pressed because they did not
	 * like it. An earlier response would throw away the whole conversation below it, so that path asks
	 * first.
	 */
	const regenerateNow = useCallback(
		(message: ChatMessage) => {
			if (!store) return;
			void rewriteHistory(() => store.deleteFromMessage(message.id), {
				regenerate: (result: ChatTailRewrite) => result.applied,
			}).catch((failure: unknown) => {
				/**
				 * **There is no confirmation window, so there is no place for copy — hence a toast.**
				 *
				 * The other two (regenerate and delete-from) receive a failure while their confirmation window
				 * stays open, but only the last-response regenerate skips confirmation. That action is an item
				 * in the overflow menu, so the menu closes the moment it is pressed, and a failure leaves the
				 * conversation unchanged — on screen it is indistinguishable from **a button that did
				 * nothing**.
				 *
				 * The copy is the **same constant** the confirmation window uses (`message-actions.ts`).
				 */
				console.error("[chat] couldn't regenerate", failure);
				showErrorToast(regenerateFailureMessage());
			});
		},
		[store, rewriteHistory],
	);

	/**
	 * The count left behind the anchor. Null when the anchor is gone, and the window then closes.
	 *
	 * Counting during render is the point: when the subscription updates, this number moves with it.
	 */
	const later = target ? countLaterMessages(messages, target.message.id) : null;

	useEffect(() => {
		if (target && later === null) setTarget(null);
	}, [target, later]);

	const rewriteDialog =
		target === null || later === null ? null : target.action === "edit" ? (
			<EditMessageDialog
				// Passes the stored **original** as-is, not the text drawn on screen.
				content={target.message.content}
				/** Only the copy reads this value. Choosing which statement to save is done by `onSave` below. */
				role={target.message.role}
				later={later}
				onClose={close}
				onSave={(content) =>
					run((store, message) =>
						/**
						 * **The role picks the statement, and that statement also decides whether to continue
						 * generating.**
						 *
						 * Editing a user utterance removes the conversation that followed it and leaves a turn with
						 * no answer, so it **continues generating** (the §7 order exactly): the transaction commits,
						 * then the history is read again, then generation starts.
						 *
						 * Editing an assistant response **does not generate.** The meaning of that action is exactly
						 * "keep this answer as it is, but word it this way". Starting generation here would append a
						 * new response right after the sentence just written by hand: it does not delete what the
						 * user wanted, but it adds a turn nobody asked for, and on managed generation it spends the
						 * operator's key. To regenerate, there is a separate action labelled `Regenerate` next to it.
						 */
						message.role === "assistant"
							? rewriteHistory(() =>
									store.editAssistantMessage(message.id, content),
								)
							: rewriteHistory(
									() => store.editUserMessage(message.id, content),
									{ regenerate: (result: ChatTailRewrite) => result.applied },
								),
					)
				}
			/>
		) : target.action === "regenerate" ? (
			<ConfirmRewriteDialog
				title={t("useActions.regenerateFromThisReply")}
				description={
					regenerateWarningCopy(later) ??
					t("useActions.thisReplyIsGeneratedAgain")
				}
				confirmLabel={t("useActions.regenerate")}
				pendingLabel={t("useActions.cleaningUp")}
				failureMessage={regenerateFailureMessage()}
				onClose={close}
				onConfirm={() =>
					run((store, message) =>
						rewriteHistory(() => store.deleteFromMessage(message.id), {
							regenerate: (result: ChatTailRewrite) => result.applied,
						}),
					)
				}
			/>
		) : (
			<ConfirmRewriteDialog
				title={t("useActions.deleteFromHere")}
				description={deleteFromMessageCopy(later)}
				confirmLabel={t("common:actions.delete")}
				pendingLabel={t("deleting")}
				failureMessage={deleteFromFailureMessage()}
				onClose={close}
				onConfirm={() =>
					run((store, message) =>
						/**
						 * Delete does not continue generating. What the user asked for is cleanup, not a new answer;
						 * starting generation here would refill the spot just emptied.
						 */
						rewriteHistory(() => store.deleteFromMessage(message.id)),
					)
				}
			/>
		);

	/**
	 * Both windows come out of one place. They never open at the same time (both open from menu
	 * items), but that is not forced by a single state: rewriting goes through the local store's
	 * ownership rule and reporting does not, so folding them into one state would erase that
	 * difference.
	 */
	const dialogs = (
		<>
			{rewriteDialog}
			{reportSelection && (
				<ReportDialog
					target={{
						type: "ai_response",
						evidence: reportSelection.evidence,
					}}
					targetLabel={t("useActions.aiReply")}
					evidencePreview={reportSelection.preview}
					includePreceding={includePreceding}
					onIncludePrecedingChange={setIncludePreceding}
					onClose={() => setReportId(null)}
				/>
			)}
		</>
	);

	return {
		requestEdit: request("edit"),
		/**
		 * For the last response, skip confirmation. The count is taken again here because the basis must
		 * be the list at the moment the trigger is pressed.
		 */
		requestRegenerate: useCallback(
			(message: ChatMessage) => {
				const rest = countLaterMessages(messages, message.id);
				if (rest === null) return;
				if (rest === 0) regenerateNow(message);
				else if (store) setTarget({ message, action: "regenerate", store });
			},
			[messages, store, regenerateNow],
		),
		requestDeleteFrom: request("delete-from"),
		/**
		 * Opens only saved assistant messages. A streaming temporary response is not in the list, so it
		 * never reaches here; a user message gets `null` from `buildAiResponseEvidence`. The point is
		 * that both decisions come from the same function (§47).
		 */
		requestReport: useCallback((message: ChatMessage) => {
			if (message.role !== "assistant") return;
			setIncludePreceding(true);
			setReportId(message.id);
		}, []),
		dialogs,
	};
}
