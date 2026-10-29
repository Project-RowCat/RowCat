import type { ChatMessage, ConversationDisplayMessage } from "@rowcat/chat";
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
import { space } from "@rowcat/design";
import {
	AppBar,
	Button,
	CenteredArea,
	ComposerArea,
	ErrorState,
	Icon,
	IconButton,
	KeyboardLayout,
	Notice,
	Screen,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import {
	useChatScope,
	useGenerationScope,
	useMobileLocalScope,
} from "../../lib/local-data/scope.tsx";
import { useLocalCharacters } from "../../lib/local-data/use-characters.ts";
import { resolveAppPhase } from "../../lib/session-state.ts";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { chatPersonaKey, createChatConversation } from "./chat-conversation.ts";
import { chatGutter } from "./chat-rhythm.ts";
import { ChatSearchPanel } from "./chat-search.tsx";
import { type ChatScreenState, resolveChatScreenState } from "./chat-state.ts";
import { Composer, type ComposerHandle } from "./composer.tsx";
import { generationRecovery } from "./generation/error.ts";
import { useChatGeneration } from "./generation/use-generation.ts";
import { useMemoryMaintenance } from "./memory/use-maintenance.ts";
import { MessageActionBar } from "./messages/action-bar.tsx";
import { MessageList, toDisplayMessage } from "./messages/list.tsx";
import { useMessageActions } from "./messages/use-actions.tsx";
import { useRoomManagement } from "./room/use-management.tsx";
import { useChatRoom } from "./room/use-room.ts";
import { ROOM_SETTINGS_TRIGGER_LABEL } from "./room-settings/view.ts";
import { ReplySuggestionPanel } from "./suggestion/panel.tsx";
import { useReplySuggestion } from "./suggestion/use-reply-suggestion.ts";

/**
 * Chat screen, the first place in this app to draw local-first data. Unlike the public screens
 * (discovery, story detail), it cannot wait-free draw: the data lives only in the per-member
 * database, so no conversation exists until identity is settled and that file is open. A pure
 * function owns that decision (`resolveChatScreenState`); stacking conditions in the component
 * cannot be checked without rendering and a mistake shows another account's conversation for a
 * frame.
 *
 * The screen is locked to the viewport and every edge has an owner:
 *
 * ```text
 * top        Screen(edges: top)
 * left/right Screen(edges: left, right)
 * bottom     ComposerArea; safe padding only when no keyboard
 * keyboard   KeyboardLayout(KeyboardAvoidingView); measures its own frame and pushes only the overlap
 * ```
 *
 * This screen once dropped `bottom` from `Screen`'s `edges` with nobody receiving it, so the
 * composer and send button sat over the home indicator.
 *
 * Only one surface is open at a time: room management, message actions and search each own their
 * state as a single value, so stacking two is not representable. Containers differ:
 *
 * ```text
 * room settings   Dialog          opened directly by the header's ☰; docks to the bottom on narrow screens
 * message row ⋯   DropdownMenu    anchored to its trigger, opens forms and confirmations
 * find            a surface replacing the canvas
 * ```
 *
 * There is no overflow `⋯` in the header: it once held every room action, and web now has the same
 * two direct buttons. Reviving it would put a "manage menu" and "settings" 20pt apart for the same
 * room; a static scan locks that (`lib/presentation-policy.test.ts`). Search is not a layer because
 * its results jump to history behind it, which is incoherent from a layer covering that list. The
 * decision table is in `docs/design/ARCHITECTURE.md`.
 *
 * The product parent of this screen is the conversation list (`/chats`). Entry is either the story
 * detail's `Start conversation` (new room) or a list row (existing room); exit goes back to the list, for a
 * deleted room and for an unknown room address alike. No second conversation screen appeared: the
 * route takes one room id, so the list just pushes `/chat/<id>`.
 */
export function ChatScreen({ roomId }: { roomId: string }) {
	const router = useRouter();
	const { session } = useMobileIdentity();
	const localScope = useMobileLocalScope();
	const { store, viewerId } = useChatScope();
	// Where this room's generation override is read. The adapter gets a reference, not a subscription,
	// so which settings a request used never depends on render timing.
	const { store: preferences } = useGenerationScope();

	// Wakes maintenance. Not part of the session identity: the ownership token is `token` below, so
	// changing this does not cut an in-flight generation.
	const maintain = useMemoryMaintenance({ roomId, store, viewerId });

	const room = useChatRoom(store, roomId);
	const state = resolveChatScreenState({
		phase: resolveAppPhase(session, localScope.status),
		lookup: room.lookup,
	});

	const loaded = state.kind === "room" ? state.room : null;

	// Execution identity: the store paired with the effective persona, a new object only when either
	// changes (same as web's `use-chat-generation.ts`). Changing the persona stops an in-flight
	// response from being saved, since it was built with the old persona's settings.
	const personaKey = chatPersonaKey(loaded);
	const token = useMemo(() => ({ store, personaKey }), [store, personaKey]);

	// The session object is not rebuilt per render. The ownership token is `token`, not this object,
	// so a room-record update re-running this memo does not cut an in-flight generation; without that
	// split, one user turn raising the room's activity time would orphan the generation just started.
	const conversation = useMemo(
		() =>
			loaded && store
				? createChatConversation({
						room: loaded,
						store,
						token,
						preferences,
						maintain,
					})
				: null,
		// The preference store is a dependency too: it goes from `null` to an instance when the scope
		// opens. Omitted, the adapter built on first render holds `null` forever and a stored room
		// override is never read in that session, silently. Changing this object's identity is safe
		// because ownership is `token`, which changes with it.
		[loaded, store, token, preferences, maintain],
	);

	const generation = useChatGeneration(conversation, viewerId);

	if (state.kind !== "room")
		return (
			<Screen>
				<AppBar
					navigation={<AppSidebarTrigger />}
					title="Conversations"
					onBack={() => router.back()}
				/>
				<CenteredArea>
					<Unavailable
						state={state}
						onRetry={room.reload}
						onLibrary={() => router.replace("/chats")}
						onDiscover={() => router.replace("/")}
						onSignIn={() =>
							router.push({
								pathname: "/login",
								params: { redirect: `/chat/${encodeURIComponent(roomId)}` },
							})
						}
					/>
				</CenteredArea>
			</Screen>
		);

	return (
		<LoadedChat
			room={state.room}
			view={room}
			generation={generation}
			onLeave={() => router.replace("/chats")}
			onBack={() => router.back()}
		/>
	);
}

/**
 * Screen for when the room exists; hooks that need the room record start here. Split because they
 * cannot be called conditionally above. A bonus: the no-room screen holds no room management,
 * message action or search state at all.
 */
function LoadedChat({
	room,
	view,
	generation,
	onLeave,
	onBack,
}: {
	room: NonNullable<ReturnType<typeof useChatRoom>["lookup"]["room"]>;
	view: ReturnType<typeof useChatRoom>;
	generation: ReturnType<typeof useChatGeneration>;
	/** The room is gone; return to this screen's product parent (the conversation list). */
	onLeave: () => void;
	onBack: () => void;
}) {
	const router = useRouter();
	const [searching, setSearching] = useState(false);
	// Message chosen in search; cleared by the list after it jumps to the row.
	const [revealId, setRevealId] = useState<string | null>(null);
	const { store, viewerId } = useChatScope();

	const management = useRoomManagement({
		// Leave after deletion with `replace`, not `back`: going back must not return to the address of
		// the room just deleted, which now draws "Conversation not found". The destination is the conversation
		// list (it was discovery while this app had no list), matching web: someone who deletes a room
		// usually opens another conversation next, not a story.
		onDeleted: onLeave,
	});

	const messageActions = useMessageActions({
		messages: view.messages,
		rewriteHistory: generation.rewriteHistory,
	});

	// Characters added to this room, read here for one reason: `{{char}}`. This subscription once
	// belonged to the settings dialog alone, on the grounds of not opening a subscription the chat
	// screen would not use. That premise changed: v2 stories' seed characters are always empty, so
	// this list is the only source of `{{char}}`, and the assembler already reads the same list
	// (`loadCharacters` in `chat-conversation.ts`). Not reading it here would split the name the model
	// received from the text drawn, silently.
	const { value: characters } = useLocalCharacters(room.id);

	// What `{{char}}` and `{{user}}` are: same function and input as the assembler.
	const names = useMemo(
		() =>
			chatPlaceholderNames(room.seed, effectiveChatPersona(room), characters),
		[room, characters],
	);

	const opening = useMemo(
		/*
		 * The opening is not a stored message: it derives from the room seed and is not planted in
		 * SQLite, since it would gain dirty flags, revisions and tombstones, ride the next push, and
		 * appear twice in system prompt and history (`opening.ts` in `@rowcat/chat`). The seed is fixed
		 * after acquisition but the persona is not, so the dependency is the room; a stable list key
		 * keeps the virtualizer's measured heights.
		 *
		 * `{{user}}` in the opening uses the conversation's effective persona; without it the story's
		 * suggested name would appear only in the first line. `{{char}}` comes from this room's character
		 * list; without it only the first line would show the placeholder.
		 */
		() => openingMessage(room.seed, effectiveChatPersona(room), characters),
		[room, characters],
	);

	// Builds the per-row actions. The list gets a node-building function rather than an action bundle
	// because policy belongs to the screen; if the list knew the bundle it would learn the edit,
	// report and tail-delete rules and branch on conversation kind. The stored record is looked up
	// again because the list draws a narrowed display value without the axes actions need
	// (`createdAt`, `role`, sync metadata); it is picked from the subscribed array, not invented.
	const renderActions = useCallback(
		(display: ConversationDisplayMessage) => {
			const align = display.role === "user" ? "end" : "start";
			// The opening gets copy only; the other four need a stored record (rule: `@rowcat/chat`'s
			// `conversationRowActions`). With no overflow menu the row shows copy alone, not an inert
			// trigger.
			if (isOpeningMessage(display.id))
				return <MessageActionBar message={display} align={align} menu={null} />;
			const message = view.messages.find(
				(candidate: ChatMessage) => candidate.id === display.id,
			);
			if (!message) return null;
			return (
				<MessageActionBar
					message={display}
					align={align}
					/* The menu lives in the row: an anchored menu measures its trigger so one screen cannot own it, and it is cheap (only the trigger draws while closed; portal and content mount on open). */
					menu={messageActions.renderMenu(message, align)}
				/>
			);
		},
		[view.messages, messageActions.renderMenu],
	);

	// Narrows stored rows to the five axes the list reads. If the list did this itself, a
	// non-persisted conversation (story test) would have to invent sync metadata to stand in it;
	// narrowing at the call site leaves nothing to invent (web's `MessageList` has the same shape).
	const rows = useMemo(
		() => view.messages.map(toDisplayMessage),
		[view.messages],
	);

	const reveal = useCallback(
		(input: { messageId: string; window: number }) => {
			// Widen the window, then mark the target. The list jumps after the row exists
			// (`message-list.tsx`), so the order need not be enforced here.
			view.ensureWindow(input.window);
			setRevealId(input.messageId);
		},
		[view.ensureWindow],
	);

	// Rows the availability decision sees, in display order including the opening. The list gets the
	// opening separately (an inverted `FlatList` quirk), but this decision asks what the last row is;
	// in an untouched room it is the opening, when suggestions are most useful. Web's `rows` is the
	// same array.
	const suggestionRows = useMemo(
		() => (opening ? [opening, ...view.messages] : view.messages),
		[opening, view.messages],
	);
	// Reply suggestions belong to this turn and are not stored. Passing the turn identity is the
	// point: without it the three sentences survive the conversation moving on, and after sending one
	// and getting a reply a turn-old suggestion stands again, plausible and error-free
	// (`replySuggestionTurnKey`).
	const suggestion = useReplySuggestion({
		room,
		characters,
		store,
		viewerId,
		turnKey: replySuggestionTurnKey(suggestionRows),
	});
	// Whether the composer is empty: only that fact rises, not the value. With this axis in the
	// suggestion button's condition, "fill erases what was typed" is not representable
	// (`canSuggestReply`); the value is not lifted to avoid input lag.
	const [composerEmpty, setComposerEmpty] = useState(true);
	// Channel for filling the picked sentence. It does not send; that is the person's action.
	const composerRef = useRef<ComposerHandle>(null);

	// Bottom scroll gesture: continue for a cut response, next scene for a complete one. Choosing
	// which, and counting one gesture once, use the same pure functions as web (`scrollAdvanceAction`,
	// `trackScrollAdvance`). `canContinue` is true because this app's conversations always support
	// appending (story test passes no gesture to this list). It sits above the search early return
	// because it is a hook.
	const scrollAdvanceRef = useRef(initialScrollAdvanceState);
	const advanceAction = scrollAdvanceAction({
		messages: view.messages,
		canContinue: true,
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

	if (searching)
		return (
			<Screen edges={["top", "left", "right"]}>
				<ChatSearchPanel
					store={store}
					roomId={room.id}
					onClose={() => setSearching(false)}
					onReveal={reveal}
				/>
			</Screen>
		);

	// Continuation target: exists when the last message's tail is open (cut by the output cap, or
	// saved without a normal ending). Same function as web (`continuationTarget`). It is not folded by
	// failure, since a just-cut response is exactly the one with something to continue; the recovery
	// table below turns it into the failure line's button and the neutral notice stands only without a
	// failure, so two sentences never share the spot.
	const continueTarget = generation.generating
		? null
		: continuationTarget(view.messages);
	// The failure line and the one action available from it. The pure module decides and story test
	// calls the same function (`generationRecovery` in `generation-error.ts`). The screen does not
	// stack `if`s because the branches multiplied (continue, retry, AI settings each attach to a
	// different failure), and two screens writing their own would diverge reproducibly on one side
	// only.
	const recovery = generationRecovery({
		error: generation.error,
		unanswered: generation.unanswered,
		continuable: continueTarget !== null,
		stopped: generation.stopped,
	});
	// Whether anything stands in this slot; named failure but the neutral notice counts too. The two
	// consumers below do not care: the continue row cannot stand with that notice (one saved character
	// means not unanswered), and suggestions stand only when the last row is the assistant's, while a
	// body-less turn ends on my own just-sent message.
	const failure = recovery?.message ?? null;
	// Maps one action to a real operation. Navigation is the screen's and the decision the pure
	// module's, so only this table remains; no branch is invented (a `null` action draws no button).
	const runRecovery = (): void => {
		if (!recovery?.action) return;
		if (recovery.action.kind === "continue") {
			if (continueTarget) generation.continueGeneration(continueTarget.id);
		} else if (recovery.action.kind === "retry") generation.regenerate();
		else router.push("/settings/ai");
	};

	return (
		<Screen edges={["top", "left", "right"]}>
			{/**
			 * Header: the same two actions as web (`apps/web/src/features/chat/chat-header-context.tsx`).
			 *
			 * ```text
			 * web     title ......  [find 🔍]  [room settings ☰]
			 * here    ‹ title ....  [find 🔍]  [room settings ☰]
			 * ```
			 *
			 * This slot once held a single overflow `⋯` carrying every room action; web has no such
			 * menu. Find and settings differ in character (settings edit the room's values, find scans
			 * its content), so both show, and search is not folded into a settings row. The extra back
			 * button is a native fact (web's sidebar does that job). At 320pt all three keep 44pt and
			 * the title shrinks first; `AppBar` owns the rule that actions never leave the screen.
			 */}
			<AppBar
				/* Drawer and back stand together and answer a different question than the two actions on the right. On the narrowest device this is the tightest row in the app (four targets plus the title), and the title always shrinks (`AppBar`'s `title`). Neither `Find` nor `Conversation settings` folds into an overflow menu; that menu was removed on purpose. */
				navigation={<AppSidebarTrigger />}
				title={room.title}
				onBack={onBack}
				actions={
					<>
						{/* The label does not name the conversation: the title is right beside it and there is one trigger, so naming it would read twice for non-visual users. Web uses the same sentence. */}
						<IconButton
							icon="search"
							label="Find in conversation"
							onPress={() => setSearching(true)}
						/>
						{/* Sliders, matching web's `SlidersHorizontal`. A gear is avoided because it means app-wide settings, and the day that screen exists two identical icons would sit side by side. */}
						<IconButton
							icon="room-settings"
							label={ROOM_SETTINGS_TRIGGER_LABEL}
							onPress={() => management.requestSettings(room)}
						/>
					</>
				}
			/>
			<KeyboardLayout>
				<MessageList
					opening={opening}
					messages={rows}
					streamingText={generation.streamingText}
					generating={generation.generating}
					/* Scene images are the room's value, straight from its snapshot; this screen draws only after the room is open (`chat-state.ts`), so absence need not be handled. */
					sceneImages={room.seed.sceneImages}
					/* Names are the room's value too and go down the same way; they change only the drawn text, never the stored body (`MessageBody`). */
					names={names}
					hasOlder={view.hasOlder}
					onLoadOlder={view.loadOlder}
					renderActions={renderActions}
					revealId={revealId}
					onRevealed={() => setRevealId(null)}
					onScrollGesture={handleScrollGesture}
				/>

				{/**
				 * The failure stands right above the composer. As a bubble in the list it would read as
				 * part of the conversation and scroll away. `Regenerate` needs two things: an unanswered
				 * turn (`unanswered`, only when the user utterance was actually saved) and a failure
				 * that pressing again can fix (`canRetryGeneration`).
				 */}
				{recovery ? (
					<View style={chat.failure}>
						{/* Severity is the ladder's (`recovery.tone`). The red surface is for something broken, and a body-less turn broke nothing; the same surface would read as a fault. The neutral surface matches the `Continue generating` row below (both say "the last turn ended this way"). */}
						<Notice
							{...(recovery.tone === "failure"
								? ({ tone: "destructive" } as const)
								: {})}
							message={recovery.message}
							actionLabel={recovery.action?.label}
							onAction={recovery.action ? runRecovery : undefined}
						/>
					</View>
				) : null}

				{/**
				 * Notice and continue for a cut response. It stands in the failure's slot (right above
				 * the composer) but is not an error: what arrived is saved and the only fact is that it
				 * can continue, hence the neutral color. It uses web's banner decision
				 * (`continuationTarget`), and one more downward gesture at the bottom is the second
				 * trigger of the same action (`scrollAdvanceAction`, same function as web). When a failure
				 * stands this row folds and the action becomes the failure line's button
				 * (`generationRecovery`). The sentence forks on a reason the shared decision returns;
				 * re-reading the record here would make the two apps name the same response differently.
				 */}
				{continueTarget && !failure ? (
					<View style={chat.failure}>
						<Notice
							message={
								continueTarget.reason === "truncated"
									? "The reply was cut off at the length limit."
									: "The reply was cut off midway."
							}
							actionLabel="Continue generating"
							onAction={() => generation.continueGeneration(continueTarget.id)}
						/>
					</View>
				) : null}

				{/**
				 * Reply suggestions, the fourth layer in the same slot as failure and continue. One pure
				 * predicate decides when it stands (`canSuggestReply`, called by web too); it folds for
				 * both a cut response and a failure notice, so two sentences cannot sit side by side.
				 */}
				{canSuggestReply({
					generating: generation.generating,
					composerEmpty,
					failed: failure !== null,
					rows: suggestionRows,
				}) ? (
					<ReplySuggestionPanel
						state={suggestion.state}
						onRequest={suggestion.request}
						/* The picked sentence goes to the composer and the list is dismissed: once filled the field is no longer empty, the condition vanishes, and the remaining list would be options that no longer apply. */
						onPick={(text) => {
							composerRef.current?.fill(text);
							suggestion.dismiss();
						}}
						onDismiss={suggestion.dismiss}
						/* Navigation is the screen's: the pure table answers only the kind of destination, and this line maps it to a path, like `runRecovery` for conversation failures. */
						onRecover={() => router.push("/settings/ai")}
					/>
				) : null}

				{/* Owner of the bottom edge; the composer inside knows nothing about the device. */}
				<ComposerArea>
					<Composer
						ref={composerRef}
						disabled={!store}
						generating={generation.generating}
						onSend={generation.send}
						onStop={generation.stop}
						onEmptyChange={setComposerEmpty}
					/>
				</ComposerArea>
			</KeyboardLayout>

			{/* One open surface each. Each holds its state as a single value, so they never stack; switching from settings to memory, rename or delete changes the same value, so a window on a window is not representable. */}
			{management.surfaces}
			{messageActions.surfaces}
		</Screen>
	);
}

/**
 * When the conversation cannot be drawn. A missing room and someone else's are not told apart: both
 * mean "not on this device for this account", which is true. Telling them apart would need a server
 * endpoint, and one would become a tool for confirming another person's room id.
 */
function Unavailable({
	state,
	onRetry,
	onLibrary,
	onDiscover,
	onSignIn,
}: {
	/** Only the no-room cells arrive; the caller already split them and the type holds that. */
	state: Exclude<ChatScreenState, { kind: "room" }>;
	onRetry: () => void;
	onLibrary: () => void;
	onDiscover: () => void;
	onSignIn: () => void;
}) {
	if (state.kind === "booting" || state.kind === "loading") return <Spinner />;

	if (state.kind === "guest")
		return (
			<Notice
				message="Conversations are stored on the signed-in member's device. Sign in to continue."
				actionLabel="Sign in"
				onAction={onSignIn}
			/>
		);

	if (state.kind === "unavailable")
		return (
			<Notice message="Couldn't check your session. It continues automatically once connected." />
		);

	if (state.kind === "storage-error")
		return (
			<ErrorState
				message="Couldn't open this device's conversation storage."
				actionLabel="Try again"
				onAction={onRetry}
			/>
		);

	return (
		/* Web's `chat-page.tsx` stands `MessageCircleOff` in this spot. */
		<View style={chat.missing}>
			<Icon name="chat-missing" size="2xl" tone="muted-foreground" />
			<Text accessibilityRole="alert" variant="title">
				Conversation not found.
			</Text>
			<Text variant="label" tone="muted-foreground">
				It isn't on this device, or it isn't a conversation of the current
				account.
			</Text>
			{/* The way out is the conversation list, same hierarchy as web. Only `Back to Discover` stood here while the app had no list. Now that the product parent exists: for someone opening another account's link the gallery does not answer where their conversations are, so discovery stays as the secondary action. */}
			<View style={chat.missingActions}>
				<Button
					label="Back to conversations"
					icon="chats"
					onPress={onLibrary}
				/>
				<Button
					label="Back to Discover"
					variant="outline"
					icon="discover"
					onPress={onDiscover}
				/>
			</View>
		</View>
	);
}

const chat = StyleSheet.create({
	// Same horizontal axis as the list and composer (`chat-rhythm.ts`).
	failure: { paddingBottom: space.xs, paddingHorizontal: chatGutter },
	// 10 is off the scale: the distance between a sentence and the buttons under it (this screen
	// only).
	missing: { alignItems: "flex-start", gap: 10 },
	// The two buttons sit side by side; stacked, the secondary action would look as large as the
	// primary one, and both labels fit on one line even at 320pt.
	missingActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
