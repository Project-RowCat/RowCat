import { isRuntimeEnabled } from "@rowcat/authoring";
import {
	chatPlaceholderNames,
	openingMessage,
	type PlaytestDebugTab,
	turnForMessage,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Link, useParams } from "@tanstack/react-router";
import { Bug, Info, TriangleAlert } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatComposer } from "#/features/chat/composer/composer.tsx";
import { MessageList } from "#/features/chat/messages/list.tsx";
import { CopyMessageAction } from "#/features/conversation/copy-message-action.tsx";
import { generationRecovery } from "#/features/conversation/generation-error.ts";
import { GenerationRecoveryActionButton } from "#/features/conversation/generation-recovery-action.tsx";
import { draftTitleLabel } from "#/lib/i18n/vocab.ts";
import { useDraftRuntimeProject } from "#/lib/local-authoring/hooks.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import { ConversationDebugger } from "./debugger/conversation-debugger.tsx";
import { PlaytestConfirmDialog } from "./playtest-confirm-dialog.tsx";
import {
	playtestDisclosure,
	playtestEmptyConversationHint,
	playtestEmptyPromptNote,
	playtestEphemeralNote,
	playtestReloadConfirm,
	playtestReloadFailure,
	playtestResetConfirm,
	playtestSceneConfirm,
} from "./playtest-copy.ts";
import { PlaytestInspector } from "./playtest-inspector.tsx";
import type { PlaytestState } from "./playtest-session.ts";
import { PlaytestShell } from "./playtest-shell.tsx";
import { PlaytestToolbar } from "./playtest-toolbar.tsx";
import { RuntimePlaytest } from "./runtime-playtest.tsx";
import { usePlaytest } from "./use-playtest.ts";
import { usePlaytestBootstrap } from "./use-playtest-bootstrap.ts";

/**
 * Playtest screen: runs the draft without publishing it. This is not a chat screen.
 * - `ChatPage` is not reused because it owns things this screen lacks: local room lookup, message
 *   pagination, in-room search, room management, actions on saved messages, and the meaning of
 *   `/chat/:roomId`. The screen reuses lower-level parts: the input, the history list, the
 *   generation fields, and the same generation hook.
 * - It sends one request type to the server, the generation stream. It does not publish, does not
 *   create rooms or call the chat store (a static scan enforces this), and saves nothing; the
 *   conversation lives only while the screen is open. There are no view counts or metrics, since
 *   this is not work viewing.
 * - Layout: the toolbar (context, a one-line summary of current conditions, the settings trigger)
 *   stays on top even when collapsed. The disclosure line is always visible. The conversation takes
 *   the remaining height. The input is pinned to the bottom. The inspector opens only when needed.
 * - Browser only (the route wraps it in `ClientOnly`). The draft lives in IndexedDB, and an
 *   unpublished manuscript should not appear in server-rendered HTML.
 */

/** The actions that need confirmation. At most one confirmation can be open at a time. */
type PendingAction = "reset" | "reload" | { startSceneId: string | null };

export function PlaytestPage() {
	const { t } = useTranslation(["playtest", "common"]);
	const { draftId } = useParams({ from: "/(app)/create/$draftId_/test" });
	const bootstrap = usePlaytestBootstrap(draftId);
	/**
	 * The draft's execution model, on the same axis that locks the four conversation materials
	 * (`DraftRuntimeProject.enabled`, the basis of `resolveConversationAuthoringMode`).
	 *
	 * Nothing is drawn until the first result. Folding to `null` would flash the chat screen for a
	 * frame on a runtime draft. An empty conversation with no opening, appearing in that frame, is
	 * exactly what makes an author think their work is empty.
	 */
	const runtime = useDraftRuntimeProject(draftId);

	if (bootstrap.status === "loading" || runtime.loading)
		return (
			<PlaytestShell>
				<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					{t("playtestPage.loadingTheDraft")}
				</div>
			</PlaytestShell>
		);

	if (bootstrap.status === "missing")
		return (
			<PlaytestShell>
				<PageEnter className="rounded-lg border p-6 text-center">
					<p className="text-sm font-medium">
						{t("playtestPage.thisDraftIsnTIn")}
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("playtestPage.ifYouMadeItIn")}
					</p>
					<Button
						variant="outline"
						className="mt-4"
						render={<Link to="/create" search={{}} />}
					>
						{t("playtestPage.backToDrafts")}
					</Button>
				</PageEnter>
			</PlaytestShell>
		);

	/**
	 * A runtime draft runs code. Before this branch existed, the screen assembled a conversation from
	 * the four locked sections, and the result was an empty conversation with no opening and no
	 * prompt. It was not a failure, just a screen with nothing to test, so no cause was written
	 * anywhere.
	 */
	if (isRuntimeEnabled(runtime.project))
		return (
			<RuntimePlaytest
				key={draftId}
				project={runtime.project}
				title={draftTitleLabel(bootstrap.state.source.draft)}
			/>
		);

	/**
	 * Remounts keyed by the draft id. Two drafts are different documents, so a conversation must not
	 * carry over. Using the id as the key means no effect is needed to clear state.
	 */
	return <Playtest key={draftId} initial={bootstrap.state} />;
}

function Playtest({ initial }: { initial: PlaytestState }) {
	const { t } = useTranslation(["playtest", "common"]);
	const playtest = usePlaytest(initial);
	const { generation, snapshot } = playtest;
	const [pending, setPending] = useState<PendingAction | null>(null);
	const [reloading, setReloading] = useState(false);
	const [reloadFailed, setReloadFailed] = useState(false);
	/**
	 * Whether the inspector is open is screen state, not product state.
	 *
	 * It is stored nowhere: not in IndexedDB, the URL, the draft, or generation preferences. Because
	 * this component remounts on draft id, opening a different draft starts it closed, which is
	 * correct. In front of a new document, the first thing seen should be the conversation, not
	 * settings.
	 */
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const inspectorId = useId();
	/**
	 * Whether the debugger is open, and what it shows, is screen state and is not stored in the URL or
	 * in storage. The turn it points to has an identity valid only in this session. Putting it in the
	 * URL would make a refreshed screen point to a turn that no longer exists.
	 */
	const [debuggerOpen, setDebuggerOpen] = useState(false);
	const [debugTab, setDebugTab] = useState<PlaytestDebugTab>("prompt");
	const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
	const debuggerId = useId();

	/**
	 * The path from a response to its turn. Nothing is guessed: the mapping comes from the identity
	 * returned by the confirmed save (`turnForMessage`). Assuming that the last line belongs to the
	 * last turn would break when an earlier generation finishes late, and the debugger would present
	 * another turn's prompt as the source of this response.
	 */
	const openTurnForMessage = (messageId: string) => {
		const turn = turnForMessage(playtest.debug, messageId);
		if (turn === null) return;
		setSelectedTurnId(turn.turnId);
		setDebugTab("prompt");
		setDebuggerOpen(true);
	};

	/**
	 * The only condition for confirmation is whether there is anything to discard. If no message has
	 * been exchanged yet, no dialog opens. Attaching confirmation to every action makes the dialog go
	 * unread, so it is not read even when it matters.
	 */
	const confirmOrRun = (action: PendingAction, run: () => void) => {
		if (playtest.messages.length === 0) return run();
		setPending(action);
	};

	const reloadLatest = () => {
		setReloadFailed(false);
		setReloading(true);
		void playtest.reloadLatestDraft().then(
			(ok) => {
				setReloadFailed(!ok);
				setReloading(false);
			},
			(failure: unknown) => {
				console.error("[playtest] couldn't read the latest draft", failure);
				setReloadFailed(true);
				setReloading(false);
			},
		);
	};

	const runPending = () => {
		if (pending === "reset") return playtest.resetConversation();
		if (pending === "reload") return reloadLatest();
		if (pending) playtest.selectStartScene(pending.startSceneId);
	};

	const confirmCopy =
		pending === "reset"
			? playtestResetConfirm()
			: pending === "reload"
				? playtestReloadConfirm()
				: playtestSceneConfirm();

	/**
	 * The opening at the top of the history, drawn from the start scene currently picked.
	 *
	 * It is derived from the snapshot, so changing the start scene or re-reading the latest draft
	 * changes it too; all of those start a new session. This is one of the things an author actually
	 * wants to check here: how the chosen scene reads as the first line of the conversation.
	 *
	 * It calls the same function as the chat screen. Writing it again would make the opening drawn
	 * here differ from the one after publishing, and that difference would only show after publishing.
	 */
	const opening = useMemo(() => openingMessage(snapshot.seed), [snapshot.seed]);

	/**
	 * What `{{char}}` and `{{user}}` resolve to. Same function as the chat screen.
	 *
	 * This screen has no room, so no character was added to one; the playtest creates no records. The
	 * remaining sources are the character cards in the snapshot and the counterpart the work suggests.
	 * These match the first screen of a room started from the published work. That match is this
	 * screen's reason to exist.
	 */
	const names = useMemo(
		() => chatPlaceholderNames(snapshot.seed),
		[snapshot.seed],
	);

	/** The opening is always first; nothing can precede it. */
	const rows = useMemo(
		() => (opening ? [opening, ...playtest.messages] : playtest.messages),
		[opening, playtest.messages],
	);

	/**
	 * A conversation with nothing exchanged yet, and no response in progress. Once the first token
	 * starts flowing, the spot is already a conversation, and a hint left above it gets in the way.
	 *
	 * When there is an opening, the hint is not shown. It is a layer on top of the list, so it would
	 * overlap any text below it (the chat screen makes the same decision).
	 */
	const conversationEmpty =
		rows.length === 0 &&
		!generation.generating &&
		generation.streamingText === "";

	/**
	 * A failure line and the one action available from that failure. It uses the same pure function as
	 * the chat screen (`generationRecovery`). While this screen held its own copy of the recovery
	 * ladder, a new branch on the chat side silently made this screen stale.
	 *
	 * `continuable` is always false, which is a property of this conversation: playtest sessions have
	 * no function to append confirmed messages (`canContinue` is false).
	 */
	const recovery = generationRecovery({
		error: generation.error,
		unanswered: generation.unanswered,
		continuable: false,
		stopped: generation.stopped,
	});

	return (
		<PlaytestShell title={snapshot.title}>
			<PageEnter className="flex min-h-0 flex-1 flex-col gap-2">
				<PlaytestToolbar
					draftId={snapshot.draftId}
					title={snapshot.title}
					preference={playtest.preference}
					startSceneId={playtest.startSceneId}
					startScenes={snapshot.startScenes}
					inspectorId={inspectorId}
					inspectorOpen={inspectorOpen}
					onToggleInspector={() => setInspectorOpen((open) => !open)}
					debuggerId={debuggerId}
					debuggerOpen={debuggerOpen}
					onToggleDebugger={() => setDebuggerOpen((open) => !open)}
				/>

				{/*
				 * The notice about the publication boundary. It is not collapsed and is always visible, because
				 * this is
				 * where an unpublished manuscript goes to an external provider, so showing it once is not enough.
				 * Confirmation dialogs per message are not used, since they go unread.
				 *
				 * The border and background were removed, but the sentences were not shortened at all. Reducing
				 * visual
				 * weight and reducing facts are different, and the second is not something this screen may do
				 * (`playtest-copy.test.ts` pins those claims by value). It is also not placed inside settings, so
				 * users
				 * do not have to open settings to learn where their manuscript goes.
				 */}
				<p className="flex shrink-0 items-start gap-1.5 text-xs text-muted-foreground">
					<Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
					<span>
						{playtestDisclosure()} {playtestEphemeralNote()}
					</span>
				</p>

				{/*
				 * An empty prompt does not block. The test is an authoring tool, not a publish gate. Instead, the
				 * result
				 * explains why it may look flat. The dashed border and icon are kept so it stays distinct from the
				 * info
				 * line; only the padding is reduced.
				 */}
				{!snapshot.seed.scenario.trim() && (
					<p className="flex shrink-0 items-start gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
						<TriangleAlert
							aria-hidden="true"
							className="mt-0.5 size-3.5 shrink-0"
						/>
						<span>{playtestEmptyPromptNote()}</span>
					</p>
				)}

				{/*
				 * The condition inspector mounts only when the trigger opens it. Keeping it closed might seem to
				 * keep its
				 * lookups (catalog, connections) asleep too, but they are not: the toolbar already uses the same
				 * lookups
				 * for the summary, and identical keys are merged.
				 */}
				<AnimatePresence>
					{inspectorOpen && (
						<PlaytestInspector
							key="playtest-inspector"
							id={inspectorId}
							playtest={playtest}
							reloading={reloading}
							onSelectStartScene={(startSceneId) =>
								confirmOrRun({ startSceneId }, () =>
									playtest.selectStartScene(startSceneId),
								)
							}
							onReset={() => confirmOrRun("reset", playtest.resetConversation)}
							onReloadLatest={() => confirmOrRun("reload", reloadLatest)}
						/>
					)}
				</AnimatePresence>

				{/*
				 * The debugger mounts only when the trigger opens it. The records are accumulated by the hook all
				 * along
				 * (the store in `usePlaytest`), so turns created while it was closed are still there when it opens.
				 */}
				<AnimatePresence>
					{debuggerOpen && (
						<ConversationDebugger
							key="playtest-debugger"
							id={debuggerId}
							state={playtest.debug}
							tab={debugTab}
							onTabChange={setDebugTab}
							selectedTurnId={selectedTurnId}
							onSelectTurn={setSelectedTurnId}
							onClose={() => setDebuggerOpen(false)}
						/>
					)}
				</AnimatePresence>

				{reloadFailed && (
					<p role="alert" className="shrink-0 text-sm text-destructive">
						{playtestReloadFailure()}
					</p>
				)}

				{/*
				 * The conversation takes all the remaining height. It is the same list as the chat screen. Nothing
				 * more
				 * can be loaded upward (`hasMore` is always false), so only that axis is empty.
				 *
				 * The empty-state line sits on top of the list rather than in the flow. In the flow, the list would
				 * be
				 * shorter by that amount, and the scroll position would jump once when the first message arrives;
				 * the
				 * virtualizer owns that geometry. The line is `pointer-events-none` and not focusable.
				 */}
				<div className="relative flex min-h-0 flex-1 flex-col">
					<MessageList
						messages={rows}
						loading={false}
						hasMore={false}
						onLoadOlder={() => undefined}
						streamingText={generation.streamingText}
						generating={generation.generating}
						/*
						 * The test draws the same picture. The snapshot passed the same normalization as publishing
						 * (`buildPlaytestSnapshot`), so the scenes shown here are the scenes shown after publishing.
						 * That is this screen's reason to exist.
						 */
						sceneImages={snapshot.seed.sceneImages}
						names={names}
						/*
						 * Of the chat screen's other four actions, none is offered here. Each needs a storage
						 * transaction (`editUserMessage`, `deleteFromMessage`) or a server-known identity
						 * (reporting), and this screen has neither.
						 */
						/*
						 * The two actions are copy and debug. Debug requires neither storage nor a server identity:
						 * it opens the record held in this session's memory, which makes it the only second action
						 * this screen can offer.
						 *
						 * No action is offered on lines without a record (the opening, user messages, responses
						 * created before instrumentation). A disabled button would be a button that does nothing when
						 * pressed.
						 */
						renderActions={(row) => (
							<div
								className={
									row.role === "user"
										? "flex items-center justify-end"
										: "flex items-center justify-start"
								}
							>
								<CopyMessageAction
									content={row.content}
									align={row.role === "user" ? "end" : "start"}
								/>
								{row.role === "assistant" &&
									turnForMessage(playtest.debug, row.id) !== null && (
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label={t("playtestPage.openThisReplySDebug")}
											title={t("playtestPage.openThisReplySDebug")}
											className="text-muted-foreground/70 hover:text-foreground"
											onClick={() => openTurnForMessage(row.id)}
										>
											<Bug aria-hidden="true" />
										</Button>
									)}
							</div>
						)}
					/>
					{/*
					 * Same rhythm as the chat screen (`chat-page.tsx`). The presence wrapper does not change the
					 * conditions,
					 * and while exiting it remains a layer outside the flow; the geometry of that slot belongs to the
					 * virtualizer.
					 *
					 * `initial={false}` is the only line that differs from the chat screen, and the reason is the data
					 * source. There, the line mounts after storage loading finishes. Here the snapshot is in memory, so
					 * for a
					 * draft with no start scene the line is present from the first render. Something already known must
					 * not
					 * fade in again alongside the screen arrival (`PageEnter`). Later enter and exit (first utterance,
					 * test
					 * reset) animate normally.
					 */}
					<AnimatePresence initial={false}>
						{conversationEmpty && (
							<m.p
								key="playtest-empty-conversation-hint"
								className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
								initial={{ opacity: 0, y: 2 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, transition: exitTransition }}
								transition={enterTransition}
							>
								{playtestEmptyConversationHint()}
							</m.p>
						)}
					</AnimatePresence>
				</div>

				{/*
				 * Same decision as the chat screen (`chat-page.tsx`): enter only, no exit animation. This line
				 * positions
				 * the input bar. If it animated out, the input bar would appear late after the failure clears
				 * (indefinitely
				 * in background tabs). It also contains a link and a button, so unmounting immediately doubles as
				 * protection against accidental presses.
				 */}
				<AnimatePresence>
					{recovery && (
						<m.div
							key="playtest-generation-error"
							/*
							 * The severity comes from the ladder (`recovery.tone`), the same rule as the chat screen. A
							 * turn that ended without a body has nothing broken, and putting that line on a red surface
							 * would make the author suspect our side rather than their own manuscript.
							 */
							role={recovery.tone === "failure" ? "alert" : "status"}
							className={`mb-2 flex shrink-0 items-center gap-3 rounded-r-lg border-l-2 py-2.5 pr-2 pl-3 text-sm ${
								recovery.tone === "failure"
									? "border-destructive/70 bg-destructive/8"
									: "border-border bg-muted/40"
							}`}
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							transition={enterTransition}
						>
							<span
								className={`min-w-0 flex-1 ${
									recovery.tone === "failure"
										? "text-destructive"
										: "text-muted-foreground"
								}`}
							>
								{recovery.message}
							</span>
							{/*
							 * The same table and the same component as the chat screen. `Continue generating` does not appear here because
							 * its
							 * condition is false (this session has no append), not because this screen removed that branch.
							 */}
							<GenerationRecoveryActionButton
								action={recovery.action}
								generating={generation.generating}
								onRetry={generation.regenerate}
							/>
						</m.div>
					)}
				</AnimatePresence>

				<ChatComposer
					disabled={false}
					generating={generation.generating}
					onSend={generation.send}
					onStop={generation.stop}
				/>

				{pending && (
					<PlaytestConfirmDialog
						title={confirmCopy.title}
						description={confirmCopy.description}
						confirmLabel={confirmCopy.confirmLabel}
						onClose={() => setPending(null)}
						onConfirm={runPending}
					/>
				)}
			</PageEnter>
		</PlaytestShell>
	);
}
