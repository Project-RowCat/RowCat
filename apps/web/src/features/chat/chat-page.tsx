import {
	canSuggestReply,
	chatPlaceholderNames,
	continuationTarget,
	effectiveChatPersona,
	initialScrollAdvanceState,
	isOpeningMessage,
	openingMessage,
	replySuggestionTurnKey,
	scrollAdvanceAction,
	trackScrollAdvance,
} from "@rowcat/chat";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { getRouteApi, Link } from "@tanstack/react-router";
import { MessageCircleOff } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyMessageAction } from "#/features/conversation/copy-message-action.tsx";
import { generationRecovery } from "#/features/conversation/generation-error.ts";
import { GenerationRecoveryActionButton } from "#/features/conversation/generation-recovery-action.tsx";
import { translator } from "#/lib/i18n/current.ts";
import {
	useLocalCharacters,
	useLocalMessages,
	useLocalRoom,
} from "#/lib/local-chat/hooks.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import { CHAT_COLUMN, ChatColumn, ChatShell } from "./chat-shell.tsx";
import { ChatComposer, type ChatComposerHandle } from "./composer/composer.tsx";
import { MessageActionBar } from "./messages/action-bar.tsx";
import { MessageList } from "./messages/list.tsx";
import { useMessageActions } from "./messages/use-actions.tsx";
import { ChatSearchDialog } from "./search/dialog.tsx";
import { useChatSearch } from "./search/use-search.ts";
import { ReplySuggestionPanel } from "./suggestion/panel.tsx";
import { useReplySuggestion } from "./suggestion/use-reply-suggestion.ts";
import { useChatGeneration } from "./use-chat-generation.ts";

const route = getRouteApi("/(app)/chat/$roomId");

/**
 * One line for a room where nothing has been said yet. It appears **only when there is no opening
 * either**.
 *
 * **This is not onboarding copy for a general assistant chat.** In this product a room is created
 * with a snapshot of a work's playback, and most works have an opening scene, so the room's record
 * is never empty from the first line (`openingMessage`). This line appears only in rooms started
 * from a work with no opening scene and no candidates, where the screen really is empty. Someone
 * who just pressed `Start conversation` would read that as a failure.
 *
 * Why it is not drawn alongside the opening is position. The hint is a layer **over the list** (see
 * below): it takes no space in the flow but sits in the middle, so any text beneath it would be
 * overlapped.
 *
 * It promises less on purpose. It does not suggest what to ask, mention a character who is waiting,
 * or offer a suggested sentence. Either those are facts we cannot know (they differ per work), or
 * they are features outside this slice.
 */
const EMPTY_CONVERSATION_HINT = translator("chat")(
	"chatPage.theConversationStartsWhenYou",
);

/**
 * Conversation screen. **Drawn only in the browser.**
 *
 * This component does not pass through server rendering (the route wraps it in `ClientOnly`). Rooms
 * and messages live in IndexedDB, which exists only in the browser. The server can draw only the
 * skeleton, so that boundary sits in the route and this component assumes the data is present.
 *
 * This screen **never asks the server for the room.** Reloading does not send a request such as
 * `GET /rooms/:id`; there is no such endpoint and none will be added. The only request it sends is
 * the generation stream (`POST /v2/chat/generate`).
 */
export function ChatPage() {
	const { t } = useTranslation(["chat", "common"]);
	const { roomId } = route.useParams();
	const roomState = useLocalRoom(roomId);
	const room = roomState.room;
	const { messages, loading, hasMore, loadOlder, ensureWindow } =
		useLocalMessages(roomId);
	/**
	 * The characters added to this room. The screen reads this list for one reason: `{{char}}`.
	 *
	 * The prompt side already reads the same list at the generation boundary (`loadCharacters` in
	 * `use-chat-generation.ts`). If this screen did not subscribe, **the name the model read and the
	 * text the screen draws would diverge**: the assembler substitutes the character's name when
	 * sending, while the screen would keep the placeholder as-is. That mismatch raises no error.
	 *
	 * The storage layer sorts (`sortCharacters`). Sorting again here could make the first character in
	 * the prompt a different person from the one `{{char}}` refers to.
	 */
	const { items: characters } = useLocalCharacters(roomId);
	/**
	 * What `{{char}}` and `{{user}}` resolve to — **the same function and the same input as the
	 * assembler.**
	 *
	 * Undefined until the room has opened. Until then the body draws the placeholder as-is and
	 * switches to the name the moment the room arrives. That is better than drawing an invented name
	 * for one frame.
	 */
	const names = useMemo(
		() =>
			room
				? chatPlaceholderNames(
						room.seed,
						effectiveChatPersona(room),
						characters,
					)
				: undefined,
		[room, characters],
	);
	const generation = useChatGeneration(room);
	/**
	 * The screen owns message actions, not each row.
	 *
	 * Attaching a dialog to every row would mount 500 dialogs inside the DOM that the virtual scroller
	 * measures for a 500-message room. Here only one opens, and the rows draw only the trigger.
	 *
	 * Passing `rewriteHistory` is the key to this wiring. If an action called the storage layer
	 * directly, two things would be lost: cutting an in-flight generation, and making that generation
	 * **unable to save even if it runs to the end**. A late response would then land in the spot that
	 * was just deleted.
	 */
	const actions = useMessageActions({
		messages,
		rewriteHistory: generation.rewriteHistory,
	});
	const search = useChatSearch({
		roomId,
		enabled: room !== null,
		messages,
		hasMore,
		loadOlder,
		ensureWindow,
	});

	/**
	 * The opening that stands at the top of the history — **it is not a stored message.**
	 *
	 * It is derived from the room's seed, so it stays separate from `messages`. Mixing them would let
	 * actions, search and tail deletion all treat this line as a record, and one of them would
	 * inevitably flow to storage. That is why `rows` below adds it in front **only when drawing**.
	 *
	 * The seed does not change after acquisition (it is an immutable field of the room), so this value
	 * is rebuilt only when the room changes. The list key must stay stable so the virtualizer does not
	 * lose the heights it has measured.
	 */
	const opening = useMemo(
		/*
		 * `{{user}}` in the introduction is also substituted with **this conversation's effective role**.
		 * If it were not passed, the name the work proposed would be used, and a conversation started
		 * with the name the person picked would show its first line with a different name. The screen
		 * would still raise no error.
		 *
		 * `{{char}}`'s name comes from **this room's character list** (a v2 work's seed characters are
		 * always empty). The assembler makes the same substitution from the same list, so without passing
		 * it the screen's first line alone would keep showing the placeholder.
		 */
		() =>
			room
				? openingMessage(room.seed, effectiveChatPersona(room), characters)
				: null,
		[room, characters],
	);

	/**
	 * The lines the list actually draws — the opening plus the stored messages.
	 *
	 * The opening is **always first**. Loading earlier history with `Load earlier messages` extends the list
	 * upward, and the opening still stays above it, which is correct: nothing earlier than it exists
	 * in that room.
	 */
	const rows = useMemo(
		() => (opening ? [opening, ...messages] : messages),
		[opening, messages],
	);

	/**
	 * Why actions must look up the stored record again.
	 *
	 * The list hands over a narrowed display value (`ConversationDisplayMessage`), which lacks the
	 * axes that editing and tail deletion need (`createdAt`, sync metadata). Instead of **inventing**
	 * them, pick from the array currently subscribed to. The mobile equivalent does the same.
	 *
	 * The index exists because this lookup runs **for every row drawn**. Virtualization keeps that to
	 * about twenty rows at a time, but in a history expanded upward the array grows to hundreds of
	 * lines.
	 */
	const stored = useMemo(
		() => new Map(messages.map((message) => [message.id, message])),
		[messages],
	);

	/**
	 * The target for continuing generation. It exists **when the last message's tail is open** (cut at
	 * the output limit, or saved without seeing the normal end).
	 *
	 * The rule lives in the shared function (`continuationTarget`). Whether the session supports
	 * continuation is answered by the hook (`canContinue` — the story test returns false). The target
	 * is picked from the **stored list**: the opening is not a record and is never in this array.
	 */
	const continueTarget = generation.canContinue
		? continuationTarget(messages)
		: null;

	/**
	 * The failure line and **the one thing the person can do about it**. The order is held by a pure
	 * function (`generationRecovery`). While this screen stacked `if` checks, the story test and the
	 * reply suggestion panel each carried a copy of the same ladder, and when a fourth branch was
	 * added only this screen had it.
	 */
	const recovery = generationRecovery({
		error: generation.error,
		unanswered: generation.unanswered,
		continuable: continueTarget !== null,
		stopped: generation.stopped,
	});

	/**
	 * Reply suggestions — **for this turn only, and never stored.**
	 *
	 * Passing the turn's identity is the key to this wiring. Without it the three sentences would
	 * survive after the conversation moved on: after sending one and getting a reply, **a proposal
	 * from one turn earlier** would reappear. That sentence raises no error and looks plausible
	 * (`replySuggestionTurnKey`).
	 */
	const suggestion = useReplySuggestion(
		room,
		characters,
		replySuggestionTurnKey(rows),
	);
	/**
	 * Whether the input is empty. **Only that single fact comes up, not the value.**
	 *
	 * Once this axis enters the suggestion button's condition, "filling erases the text being written"
	 * becomes unrepresentable (`canSuggestReply`). The value itself is not raised because of input
	 * latency: if this screen re-rendered on every keystroke, the virtualized list beneath it would
	 * re-render too.
	 */
	const [composerEmpty, setComposerEmpty] = useState(true);
	/** The channel for filling in a chosen sentence. **It does not send** — that action belongs to the person. */
	const composerRef = useRef<ChatComposerHandle>(null);

	/**
	 * The bottom scroll gesture: on a cut response, **continue generation**; on a finished response,
	 * **the next scene**.
	 *
	 * Which one to pick, and counting one gesture as one action, are done by a pure function
	 * (`scroll-advance.ts`; mobile calls the same function). Here we only pass the clock and the
	 * current conditions. The state is not read in render, so it is a ref.
	 */
	const scrollAdvanceRef = useRef(initialScrollAdvanceState);
	const advanceAction = scrollAdvanceAction({
		messages,
		canContinue: generation.canContinue,
	});
	const handleScrollGesture = useCallback(
		(gesture: { downward: boolean; atBottom: boolean }) => {
			const result = trackScrollAdvance(scrollAdvanceRef.current, {
				now: Date.now(),
				downward: gesture.downward,
				atBottom: gesture.atBottom,
				action: advanceAction,
				generating: generation.generating,
			});
			scrollAdvanceRef.current = result.state;
			if (result.trigger?.kind === "continue")
				generation.continueGeneration(result.trigger.messageId);
			else if (result.trigger?.kind === "advance") generation.advance();
		},
		[
			advanceAction,
			generation.generating,
			generation.continueGeneration,
			generation.advance,
		],
	);

	/**
	 * The room was not found — it is not in this viewer's local storage. The server is not asked:
	 * rooms never live on the server, and implying there is a place to ask would misdescribe the
	 * architecture. It is either a room from another account or one never created on this device.
	 */
	if (roomState.status === "missing")
		return (
			<ChatShell>
				<ChatColumn>
					<Empty className="my-8 border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<MessageCircleOff />
							</EmptyMedia>
							<EmptyTitle>{t("chatPage.conversationNotFound")}</EmptyTitle>
							<EmptyDescription>
								{t("chatPage.thisConversationIsnTIn")}
							</EmptyDescription>
						</EmptyHeader>
						{/*
						 * The way out is the **conversation list**, because that is this screen's product parent. A room
						 * is created from a work but outlives it (the source is not asked of the server), and someone who
						 * opens another account's link gets no answer from the gallery to "where is my conversation".
						 * Discovery stays below as a secondary action.
						 */}
						<EmptyContent>
							<Link
								to="/chats"
								className={buttonVariants({ variant: "default", size: "sm" })}
							>
								{t("chatPage.backToConversations")}
							</Link>
							<Link
								to="/"
								search={{}}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{t("chatPage.discoverStories")}
							</Link>
						</EmptyContent>
					</Empty>
				</ChatColumn>
			</ChatShell>
		);

	return (
		<ChatShell title={room?.title}>
			{/*
			 * The entrance is **one outer layer**, and it inherits the shell's vertical cell as-is
			 * (`flex min-h-0 flex-1 flex-col`). Removing the classes would make this div only as tall as its content,
			 * and the history cell would lose the screen height — scrolling would leak to the page.
			 *
			 * Nothing is attached to the inner virtualized list. Motion that changes height or layout alters the
			 * values the virtualizer measures, so the only things moving here are opacity and a 4px vertical shift
			 * (neither changes measured heights nor scrollTop).
			 */}
			<PageEnter className="flex min-h-0 flex-1 flex-col">
				{/*
				 * The empty-conversation line is layered **over the list**. In the flow it would shorten the list by
				 * its height, and the scroll coordinates would shift once when the first message arrives — the geometry
				 * of that cell belongs to the virtualizer. It is not pressable (`pointer-events-none`) and does not take
				 * focus. The story test uses the same shape.
				 */}
				<div className="relative flex min-h-0 flex-1 flex-col">
					<MessageList
						messages={rows}
						loading={loading}
						hasMore={hasMore}
						onLoadOlder={loadOlder}
						streamingText={generation.streamingText}
						generating={generation.generating}
						/*
						 * Scene images are **the room's value**. If the room has not opened yet the list is empty,
						 * and a token in the body draws nothing then (it appears as soon as the room arrives) — the
						 * point is not to draw the raw token text in the meantime.
						 */
						sceneImages={room?.seed.sceneImages}
						/*
						 * Names are also **the room's value**, passed down in the same place. What this value changes
						 * is only the text drawn, and the stored body does not move by a character (`ChatBody`).
						 */
						names={names}
						/*
						 * The action set is **this screen's policy**. The list only receives the nodes and draws them
						 * beneath each row — the story test, which uses the same list, supplies a single copy. If the
						 * scope is not yet open there is no trigger (the actions are not drawn at all).
						 *
						 * The opening also has a single copy, and that decision belongs to the shared rule
						 * (`conversationRowActions` in `@rowcat/chat`). The other four all require a stored record.
						 * The condition is not restated here.
						 */
						renderActions={
							actions
								? (row) => {
										const align = row.role === "user" ? "end" : "start";
										if (isOpeningMessage(row.id))
											return (
												<CopyMessageAction
													content={row.content}
													align={align}
												/>
											);
										const message = stored.get(row.id);
										if (!message) return null;
										return (
											<MessageActionBar
												message={message}
												actions={actions}
												align={align}
											/>
										);
									}
								: undefined
						}
						reveal={search.reveal}
						onRevealed={search.onRevealed}
						/*
						 * Pressing down once more at the bottom of a cut response starts continuing generation. The
						 * list reports only the gesture; the pure function above decides when that gesture becomes a
						 * paid action. The reason inertial scrolling does not turn into several requests is in that
						 * function's tests.
						 */
						onScrollGesture={handleScrollGesture}
						/*
						 * The width belongs to **the content**, not the scroll cell — so the scrollbar sits at the
						 * edge of the screen rather than beside the text (`CHAT_COLUMN` in `chat-shell.tsx`).
						 */
						columnClassName={CHAT_COLUMN}
					/>
					{/*
					 * **Separate loading from an empty room.** While `loading` is true the list is drawing its
					 * placeholder, and layering "the conversation is empty" on top would claim, for the few milliseconds
					 * spent reading storage, that the room has no history. It is not drawn during generation either —
					 * there is a real short window where the first utterance is being committed.
					 */}
					{/*
					 * Presence **does not change the condition**. The moment the first utterance commits, this line has
					 * already left the product state, and what this does is bridge the frame in which it disappears —
					 * neither the first message nor the waiting indicator waits for this exit.
					 *
					 * It stays **a layer outside the flow** while leaving (`absolute inset-0`). If it entered the flow,
					 * the list's height would change during the exit, and that cell's geometry belongs to the virtualizer.
					 * There is nothing to press or focus, so `pointer-events-none` alone is sufficient rather than
					 * `useExitGuard()` (the rule `feedback.ts` records — if there were a button or link inside, this
					 * rhythm would not apply).
					 */}
					<AnimatePresence>
						{roomState.status === "ready" &&
							!loading &&
							rows.length === 0 &&
							!generation.generating && (
								<m.p
									key="empty-conversation-hint"
									className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
									/*
									 * 2px. This is the shortest movement in the repository, half of a row's 4px. The sentence
									 * appears not because the person did something, but because **nothing exists yet**, so if
									 * it arrived prominently the empty conversation would start demanding attention.
									 *
									 * On exit there is no movement. At that moment the first utterance is arriving in this
									 * same spot, and two movements in opposite directions would blur what is coming in and
									 * what is going out (the same judgement as `rowExit`).
									 */
									initial={{ opacity: 0, y: 2 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, transition: exitTransition }}
									transition={enterTransition}
								>
									{EMPTY_CONVERSATION_HINT}
								</m.p>
							)}
					</AnimatePresence>
				</div>

				{/*
				 * The failure notice and retry. The user message is already saved, so nothing is rolled back — the
				 * person really sent that message, and regenerate only creates a new response for that turn.
				 *
				 * Its position **directly above the input** is the point. The failure is a reply to an action just
				 * taken, so a global toast would move the retry button far from its cause.
				 *
				 * `role="alert"` makes the failure reach someone who is not looking at the screen. Presence only softens
				 * the appearance; it does not delay the announcement.
				 *
				 * **It only enters.** This line claims the input's position, so if it had an exit, the input would stay
				 * pressed down by that height after the failure cleared and rise late — in a hidden tab that state would
				 * last indefinitely (the rule in `docs/motion/ARCHITECTURE.md` that a sentence which claims a position
				 * only enters). Its links and buttons also make immediate unmounting the press guard: there is no exit
				 * frame for `useExitGuard()` to protect.
				 */}
				<ChatColumn>
					{/*
					 * Notice that the response was cut, and continue generation. It sits in the same place as the failure
					 * notice (directly above the input) but **is not an error**: what was received is saved, and what is
					 * said here is only one fact, that "you can continue further". So the tone is neutral and it has no
					 * `role`.
					 *
					 * It folds while generating (once continuation is streaming, this notice answers a question already
					 * answered). If a failure notice is showing, that one comes first — two sentences in the same place
					 * would blur which one answers what just happened. In that case **continue generation does not
					 * disappear; it becomes the failure notice's button** (below) — what to do against a just-cut response
					 * is exactly that, so folding the notice and its action together would leave nothing to press that
					 * turn. It has no exit for the same reason as the failure notice (this line claims the input's position).
					 */}
					<AnimatePresence>
						{continueTarget !== null && !generation.generating && !recovery && (
							<m.div
								key="continue-generation"
								className="mb-2 flex shrink-0 items-center gap-3 rounded-r-lg border-l-2 border-border bg-muted/40 py-2.5 pr-2 pl-3 text-sm"
								initial={{ opacity: 0, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={enterTransition}
							>
								{/*
								 * **Says why it was cut.** The reason is returned together by the shared judgement
								 * (`continuationTarget`), and the stored record is not read again here — the place where two
								 * apps would end up calling the same response by different wording is exactly that re-read.
								 */}
								<span className="min-w-0 flex-1 text-muted-foreground">
									{continueTarget.reason === "truncated"
										? t("chatPage.theReplyWasCutOff")
										: t("chatPage.theReplyWasCutOff2")}{" "}
									{t("chatPage.scrollingDownAlsoContinuesGenerating")}
								</span>
								<Button
									size="sm"
									variant="outline"
									className="shrink-0"
									onClick={() =>
										generation.continueGeneration(continueTarget.id)
									}
								>
									{t("chatPage.continueGenerating")}
								</Button>
							</m.div>
						)}
					</AnimatePresence>

					<AnimatePresence>
						{recovery && (
							<m.div
								key="generation-error"
								/*
								 * **The ladder decides the severity** (`recovery.tone`). The red surface is for something
								 * that broke; a turn that ended without a body has nothing broken — if that line were drawn
								 * on the same surface, the person would read it as a fault.
								 *
								 * `role` follows the same axis. A failure must interrupt what the person was doing and be
								 * announced (`alert`), but a line stating the result of a generation they started only
								 * needs to reach them in order (`status`).
								 */
								role={recovery.tone === "failure" ? "alert" : "status"}
								/*
								 * A failure is **a note in the margin**, not a box that takes up the screen. A square
								 * border would make this line a bigger object than the conversation, while what it says is
								 * only "that one attempt did not work". A left accent and a faint wash are enough, and the
								 * position directly above the input says the rest.
								 *
								 * The neutral notice is **on the same surface as the `Continue generating` line directly above** — both
								 * say "the turn ended like this", and they never appear together (if even one character was
								 * saved, the turn is not unanswered).
								 */
								className={`mb-2 flex shrink-0 items-center gap-3 rounded-r-lg border-l-2 py-2.5 pr-2 pl-3 text-sm ${
									recovery.tone === "failure"
										? "border-destructive/70 bg-destructive/8"
										: "border-border bg-muted/40"
								}`}
								initial={{ opacity: 0, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={enterTransition}
							>
								{/*
								 * The text has its own sentence **only for bounded errors** (`generationFailureMessage`).
								 * There is no place for a provider's response body or a Dexie exception to mix in.
								 */}
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
								 * There is **one** action. A pure function decides what appears, and the shared component
								 * knows whether to draw it as a link or a button. Three screens used to carry the same table,
								 * and the two together removed that.
								 */}
								<GenerationRecoveryActionButton
									action={recovery.action}
									generating={generation.generating}
									onRetry={generation.regenerate}
									onContinue={
										continueTarget
											? () => generation.continueGeneration(continueTarget.id)
											: undefined
									}
								/>
							</m.div>
						)}
					</AnimatePresence>

					{/*
					 * Reply suggestions — the **fourth layer** in the same place as the failure notice and continue
					 * generation.
					 *
					 * A single pure predicate holds the condition for showing it (`canSuggestReply`), and mobile calls the
					 * same function. That predicate hides a cut response and a failure notice **together**, so two sentences
					 * never end up standing side by side here.
					 *
					 * It is not wrapped in presence. This layer claims the input's position, and with an exit, after a
					 * sentence is picked the input would stay pressed down by that height and rise late.
					 */}
					{canSuggestReply({
						generating: generation.generating,
						composerEmpty,
						failed: generation.error !== null,
						rows,
					}) && (
						<ReplySuggestionPanel
							state={suggestion.state}
							onRequest={suggestion.request}
							/*
							 * The picked sentence goes to the input, and the list is dismissed. Once it is filled, the
							 * input is no longer empty and the condition disappears, so until then the list would remain
							 * as a choice that can no longer be applied.
							 */
							onPick={(text) => {
								composerRef.current?.fill(text);
								suggestion.dismiss();
							}}
							onDismiss={suggestion.dismiss}
						/>
					)}

					<ChatComposer
						ref={composerRef}
						// No place to send yet while the room has not arrived or the scope is not open.
						disabled={roomState.status !== "ready"}
						generating={generation.generating}
						onSend={generation.send}
						onStop={generation.stop}
						onEmptyChange={setComposerEmpty}
					/>
				</ChatColumn>

				{/*
				 * Search dialog. **Drawn only when there is a room** — when the account switches and this room disappears
				 * from this device's database, the dialog must disappear with it, so the previous account's search term
				 * and results never remain on screen for even one frame.
				 */}
				{room && search.open && (
					<ChatSearchDialog
						roomId={roomId}
						focusToken={search.focusToken}
						onSelect={search.select}
						onClose={search.close}
					/>
				)}

				{/*
				 * One open dialog. Its place in the tree is just order; its actual placement is decided by the portal. It
				 * sits here so that it is visible at a glance that **this screen draws only one**.
				 */}
				{actions.dialogs}
			</PageEnter>
		</ChatShell>
	);
}
