import { space } from "@rowcat/design";
import { storyQueryOptions } from "@rowcat/query";
import {
	runtimeConversationPresenceAllowed,
	runtimePlayStartDue,
	runtimePlayStartSessionKey,
	runtimeSaveDurabilityAtRisk,
} from "@rowcat/runtime-persistence";
import { NativeRuntimeSurface } from "@rowcat/runtime-renderer-native";
import {
	AlertDialog,
	AppBar,
	Button,
	CenteredArea,
	DropdownMenu,
	KeyboardLayout,
	MenuItem,
	MenuSeparator,
	Screen,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useRuntimeConversationScope } from "../../lib/local-data/scope.tsx";
import { describeNativeRuntimeHost } from "../../lib/runtime-native/host-bridge.ts";
import { NativeRuntimeHostView } from "../../lib/runtime-native/runtime-host-view.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { RuntimeGenerationSettingsDialog } from "./runtime-generation-settings-dialog.tsx";
import {
	RUNTIME_PLAYBACK_ACTIONS_LABEL,
	RUNTIME_PLAYER_AI_COPY,
	RUNTIME_PLAYER_COPY,
} from "./runtime-player-copy.ts";
import {
	RuntimeCreatorErrorNotice,
	RuntimeSaveNotice,
} from "./runtime-player-notices.tsx";
import { useNativeRuntimeAssetResolver } from "./use-asset-resolver.ts";
import { useNativeRuntimeAudio } from "./use-runtime-audio.ts";
import { useRuntimePlayer } from "./use-runtime-player.ts";

/**
 * Creator runtime playback (native): where a published runtime runs inside RowCat's
 * conversation-screen conventions.
 *
 * ```text
 * AppBar                  drawer trigger · back · story title · overflow ⋯   ← same place as the chat room
 * hidden runtime WebView  QuickJS/WASM · reconciler                           ← 1×1, draws nothing
 * NativeRuntimeSurface    host tree → React Native components                 ← the creator's screen
 * save failure line       only when present                                   ← outside the creator's canvas
 * ```
 *
 * ## Same place as the chat room, but different
 *
 * This screen sits at `/chat/runtime/[storyId]` and uses the **same outer conventions** as the chat
 * room (`/chat/[roomId]`): `Screen`, an `AppBar` where the drawer trigger and back stand together,
 * and `KeyboardLayout`, which measures the keyboard. Someone opening a story should not feel they
 * have left RowCat for another tool. `ChatScreen` is not mounted, though: the room, messages,
 * search, actions, and composer it owns all belong to `ChatRoom`, and a runtime playthrough is not
 * a room. In particular the **composer is not drawn**. If the creator draws a `TextInput`, the
 * renderer owns it; if our composer stood beneath it, a runtime that built a messenger would have
 * two input boxes.
 *
 * The right side of the header also differs. The chat room shows `Find` and `Conversation settings` directly, while
 * here one overflow `⋯` holds three items (`Story info`, `Generation settings`, `Reset play`). The reason is width; the
 * comment on `AppBar` below works out the arithmetic. Search, memory, persona, characters, and
 * rename are room vocabulary and appear on neither side: if present they would be buttons that do
 * nothing. **`Generation settings` has a different name from `Conversation settings` for this reason too.** The only things
 * configurable here are the two generation axes, so reusing the same word would make someone who
 * opened it assume the rest were missing.
 *
 * ## The WebView is not the UI
 *
 * The WebView on this screen is a **hidden execution realm** and draws no pixels. The creator's UI
 * is realized by React Native after the patch bundle is applied to the host tree. A shortcut such
 * as `<WebView source={{ html: creatorApp }} />` was rejected in Phase 5B, and a static scan
 * enforces that absence.
 *
 * ## The trusted shell sits outside creator content
 *
 * Back, the story title, reset, the save failure notice, and the AI notice all belong to `AppBar`
 * and to our rows beneath it. If the creator drew them, those sentences would become the creator's,
 * and then back navigation and the billing notice would become values the creator decides.
 *
 * ## This screen does not create a room; the library row is created
 *
 * `ChatStore` and `createRoom` are absent. Progress is kept in SQLite by `RuntimePlayerPersistence`
 * (the same record the old `/stories/[id]/play` wrote; identity is story id plus default slot, so
 * moving the address does not erase progress) and crosses to other devices through sync.
 *
 * The recent-conversations drawer and `/chats` show this playthrough as **its own library row**
 * (`runtime.conversation`, not `ChatRoom`). The row appears under one condition: the playback
 * response the server returned after judging entitlement is `runtime`
 * (`runtimeConversationPresenceAllowed`; the web calls the same function). Neither the VM starting
 * nor the save state committing is a condition; this write goes through a **different port**
 * outside the playback lifecycle.
 */
/** Grant list before the session stands and after it dies. Its identity is fixed, so the resolver is not rebuilt. */
const EMPTY: readonly string[] = [];
/** Logical-name table before the session stands and after it dies. A module constant, so no new array is created per render. */
const EMPTY_BINDINGS: readonly { path: string; assetId: string }[] = [];

export function RuntimeChatScreen({ storyId }: { storyId: string }) {
	const router = useRouter();
	/**
	 * The title comes from the catalog: the playback response carries no title, and no room is
	 * invented to get one. A failure does not block playback. A player who earned access must not be
	 * stopped by a title line; the field being briefly empty is the correct state, and it is not
	 * labelled `Conversations`.
	 */
	const story = useQuery(storyQueryOptions(getRowCatClient(), storyId));
	/**
	 * AI permission lives **only for this playthrough**. It does not persist silently: one press must
	 * not become permission across all of this person's runtime stories.
	 */
	const [aiAllowed, setAiAllowed] = useState<boolean | null>(null);
	const [confirmingReset, setConfirmingReset] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const player = useRuntimePlayer({ storyId, aiDecision: aiAllowed });
	/**
	 * The grant list belongs to the **running session**: there is none before it stands or after it
	 * dies.
	 *
	 * It is read from the `native` state because the value comes from the bridge's `started`. When the
	 * generation changes, that state returns to `starting` and the list empties by itself. If the
	 * screen re-read the artifact, a value that never passed validation would become the resolver's
	 * basis.
	 */
	const { resolveAsset, resolveAudio } = useNativeRuntimeAssetResolver(
		player.native.status === "running" ? player.native.remoteAssets : EMPTY,
		/**
		 * The logical-name table also belongs to the **running session**.
		 *
		 * Its source is the playback response, not the bridge (the authority is there), but it passes the
		 * same gate to prevent leaks between stories. On a path into another story, if the table were
		 * still alive before the session stands, the last picture of the old tree would be drawn with the
		 * new story's table.
		 */
		player.native.status === "running" ? player.managedAssets : EMPTY_BINDINGS,
	);

	/**
	 * Library row: one playback response whose entitlement was confirmed is the condition (see
	 * header). The title comes from the catalog; if that lookup failed it is `null`, so the title the
	 * store already knows is kept.
	 */
	/**
	 * Sound is **not drawn**, so it lives outside the surface component. The session's tree store is
	 * this deck's identity, so when the story changes or the session restarts, the previous story's
	 * sound ends right there, before the new deck stands.
	 */
	useNativeRuntimeAudio(
		player.session?.store ?? null,
		resolveAudio,
		(handler) => player.session?.dispatchEvent(handler, undefined),
	);

	const library = useRuntimeConversationScope();
	const storyTitle = story.data?.title ?? null;
	const presence = runtimeConversationPresenceAllowed({
		playbackKind: player.playbackKind,
		storyResolved: storyTitle !== null || story.isError,
	});
	useEffect(() => {
		const store = library.store;
		if (store === null || !presence) return;
		if (!library.ownsStore(store)) return;
		void store
			.touch({ storyId, title: storyTitle, now: new Date().toISOString() })
			.catch(() => {
				/** A library-row failure must not stop playback for someone who earned access. */
			});
	}, [library, presence, storyId, storyTitle]);

	/**
	 * Play start: reported once, after the session actually runs (same place and rule as the web,
	 * `runtimePlayStartDue`). The key is the library row's id, so it happens once per account; the
	 * server deduplicates on that key. Failures are swallowed.
	 */
	const playStartReported = useRef(false);
	useEffect(() => {
		if (
			!runtimePlayStartDue({
				running: player.status === "running",
				reported: playStartReported.current,
			})
		)
			return;
		playStartReported.current = true;
		void getRowCatClient()
			.stories.recordPlayStart(storyId, {
				sessionKey: runtimePlayStartSessionKey(storyId),
				kind: "runtime",
			})
			.catch(() => {});
	}, [player.status, storyId]);

	const descriptor = describeNativeRuntimeHost();
	/**
	 * Back belongs to the navigation stack: this screen's product parent is the conversation list, and
	 * that route is held by the drawer's `Conversations`. Creator code cannot choose an outside destination.
	 */
	const back = () => router.back();

	/** This story needs the notice, and the person has not answered yet. */
	const needsDisclosure = player.usesGeneration && aiAllowed === null;
	const running = player.status === "running" && player.session !== null;

	return (
		<Screen>
			{/**
			 * Header: **same left as the chat room, different right.** The drawer trigger and back stand together, and the
			 * rule that the title shrinks first belongs to `AppBar`.
			 *
			 * ## The right side is one overflow menu — deliberately different from the chat room
			 *
			 * ```text
			 * chat room   [search 🔍] [chat settings ☰]    two actions · four targets · title 88pt
			 * here        [⋯]                              three actions · three targets · title 132pt
			 * ```
			 *
			 * The chat room header deliberately has no overflow menu, and that reason still holds: search and settings are
			 * two actions of different kinds, so showing both is better, and they fit in the 320pt budget. The reason does
			 * not hold here, for a numeric reason: this screen has **three** actions (story info, generation settings, reset
			 * playthrough), and expanding all three makes five targets, leaving 48pt for the title. `AppBar` records that
			 * budget as a value (320pt · four targets → title 88pt), and **the title is this screen's only identity.**
			 *
			 * So what differs is the answer, not the rule. The chat room forbids "all of the room's actions passing through one
			 * menu and becoming a second door alongside settings". There is no second door here: this menu is the only one.
			 *
			 * ## Each row has its own condition, and the difference is intended
			 *
			 * ```text
			 * story info          always                       a sibling screen you visit briefly to see the story
			 * generation settings this story uses generation   stands even before the session starts
			 * reset playthrough   the session is running       does not recommend destruction on a screen that could not start
			 * ```
			 *
			 * The second row does not use the session as its condition because of the AI notice: the person must be able to
			 * choose the model **before** agreeing, and the notice's "current AI settings" is exactly that setting (the web's
			 * `runtime-chat-controls.ts` has the same two axes). A row that does not apply is **not drawn**. This app's rule is
			 * not to draw a disabled row for an action that would do nothing when pressed.
			 */}
			<AppBar
				navigation={<AppSidebarTrigger />}
				title={story.data?.title ?? " "}
				onBack={back}
				actions={
					<DropdownMenu label={RUNTIME_PLAYBACK_ACTIONS_LABEL}>
						{/*
						 * **Navigation comes first.** On the web's pill this action is also first: an action of a different kind
						 * (it leaves this screen) stands above the operations. It is not back because this screen's product parent
						 * is the conversation list: for someone who came in through the drawer's recent conversations, back would
						 * not go to the story detail.
						 */}
						<MenuItem
							icon="story-detail"
							label={RUNTIME_PLAYER_COPY.storyDetail}
							onSelect={() =>
								router.push({
									pathname: "/stories/[storyId]",
									params: { storyId },
								})
							}
						/>
						{player.usesGeneration ? (
							<MenuItem
								icon="runtime-settings"
								label={RUNTIME_PLAYER_COPY.generationSettings}
								onSelect={() => setSettingsOpen(true)}
							/>
						) : null}
						{/*
						 * The irreversible action stands **below the separator**; the message row's menu has the same shape
						 * (`Edit | Regenerate | Report | ─── | Delete from here`). The separator folds together with that row so a
						 * separator alone is never left behind.
						 */}
						{running ? (
							<>
								<MenuSeparator />
								<MenuItem
									icon="retry"
									label={RUNTIME_PLAYER_COPY.resetPlaythrough}
									destructive
									onSelect={() => setConfirmingReset(true)}
								/>
							</>
						) : null}
					</DropdownMenu>
				}
			/>
			{/**
			 * Generation settings: **does not stop playback.** The session keeps running, and values chosen here apply
			 * from the next generation request (the store is re-read per request). If opening the dialog interrupted
			 * play, progress would vanish in the middle of a scene the creator built.
			 */}
			<RuntimeGenerationSettingsDialog
				storyId={storyId}
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
			/>
			{/*
			 * Hidden execution realm: it must be attached before the session stands so the bridge is ready. It takes
			 * no space on screen.
			 */}
			{player.session !== null && (
				<NativeRuntimeHostView
					descriptor={descriptor}
					transport={player.session.transport}
				/>
			)}

			{/**
			 * The keyboard is measured **for the creator's `TextInput`**. It is the same layer the chat room uses for its
			 * own composer: when an input inside the creator's tree gets focus, the canvas shifts only by the amount of
			 * overlap. Input semantics are not reinvented; the existing input bridge is used as-is.
			 */}
			<KeyboardLayout>
				{needsDisclosure ? (
					<CenteredArea>
						<View style={styles.disclosure}>
							<Text weight="medium">{RUNTIME_PLAYER_AI_COPY.title}</Text>
							<Text variant="body" tone="muted-foreground">
								{RUNTIME_PLAYER_AI_COPY.body}
							</Text>
							<Text variant="caption" tone="muted-foreground">
								{RUNTIME_PLAYER_AI_COPY.note}
							</Text>
							<Button
								label={RUNTIME_PLAYER_AI_COPY.allow}
								fullWidth
								onPress={() => setAiAllowed(true)}
							/>
							<Button
								label={RUNTIME_PLAYER_AI_COPY.deny}
								variant="outline"
								fullWidth
								onPress={() => setAiAllowed(false)}
							/>
						</View>
					</CenteredArea>
				) : running && player.session !== null ? (
					<View style={styles.surface}>
						<NativeRuntimeSurface
							store={player.session.store}
							dispatchEvent={(handlerId, payload) =>
								player.session?.dispatchEvent(handlerId, payload ?? undefined)
							}
							/**
							 * The resolver belongs to this screen (`use-asset-resolver.ts`). Only remote references
							 * become RowCat's proxy source; logical paths are still placeholders. No path places a
							 * creator's address in `uri`.
							 */
							resolveAsset={resolveAsset}
							/**
							 * Where scroll and focus commands reach the real view. The deck's owner is the session, so a
							 * pending command survives even if this screen remounts.
							 */
							controls={player.session.controls}
							style={styles.surfaceInner}
						/>
					</View>
				) : (
					<CenteredArea>
						{/*
						 * The three preparing states (loading, checking saves, starting) show a spinner along with the sentence. With
						 * only the sentence the screen **looks the same as a frozen one**: while the VM starts and saves are read,
						 * nothing is drawn on the canvas, and that stillness looks identical to a failed screen. The web shows the same
						 * indicator for the same three states, and it also does not invent a progress figure (no step knows how much
						 * time remains).
						 */}
						{runtimePlayerPreparing(player.status) ? (
							<Spinner
								label={statusMessage(player.status, descriptor.bridge)}
							/>
						) : (
							<Text variant="body" tone="muted-foreground">
								{statusMessage(player.status, descriptor.bridge)}
							</Text>
						)}
						{player.status === "failed" && (
							<Button
								label={RUNTIME_PLAYER_COPY.retry}
								variant="outline"
								onPress={player.restart}
							/>
						)}
						{player.status === "unavailable" && (
							<Button
								label={RUNTIME_PLAYER_COPY.storyDetailLink}
								variant="outline"
								onPress={() =>
									router.push(`/stories/${encodeURIComponent(storyId)}`)
								}
							/>
						)}
					</CenteredArea>
				)}

				{/*
				 * A failure in creator code **does not clear the screen.** The previous tree still matches the host, so it stays,
				 * and only the notice and restart are placed beneath it. This is the same decision as the web's line. For a while
				 * this fact was not drawn anywhere on native, and a screen where creator code threw stayed frozen as if nothing
				 * had happened.
				 */}
				{player.native.status === "running" &&
					player.native.rootError !== null && (
						<RuntimeCreatorErrorNotice onRestart={player.restart} />
					)}

				{/*
				 * A save failure is **not a runtime failure.** The story keeps running; this line only states honestly that
				 * progress is not yet durable. It stands outside the canvas, so the creator's screen cannot cover it.
				 */}
				{runtimeSaveDurabilityAtRisk(player.save) && (
					<RuntimeSaveNotice onRetry={player.retrySave} />
				)}
			</KeyboardLayout>

			{/*
			 * The action is irreversible, so it asks for confirmation. The copy states **what remains first**: reset erases
			 * only this playthrough's progress, and long progress remains. The operation itself is one serialized transition
			 * from Phase 7 (`lifecycle.resetPlaythrough`).
			 */}
			<AlertDialog
				open={confirmingReset}
				title={RUNTIME_PLAYER_COPY.resetTitle}
				description={RUNTIME_PLAYER_COPY.resetDescription}
				confirmLabel={RUNTIME_PLAYER_COPY.resetConfirm}
				cancelLabel={RUNTIME_PLAYER_COPY.cancel}
				onCancel={() => setConfirmingReset(false)}
				onConfirm={() => {
					setConfirmingReset(false);
					player.resetPlaythrough();
				}}
			/>
		</Screen>
	);
}

/**
 * Is this **preparing**? One condition that decides whether the spinner stands.
 *
 * This function's only job is to exclude `failed` and `unavailable`: those two show their next step
 * as a button, and a spinner beside it would say something is still in progress.
 */
const runtimePlayerPreparing = (status: string): boolean =>
	status === "loading" || status === "syncing" || status === "starting";

function statusMessage(status: string, bridge: string): string {
	if (status === "syncing") return RUNTIME_PLAYER_COPY.syncing;
	if (status === "unavailable") return RUNTIME_PLAYER_COPY.unavailable;
	/** The API version is mismatched. This branch offers no restart, since the same failure would come back. */
	if (status === "incompatible") return RUNTIME_PLAYER_COPY.incompatible;
	if (status === "failed")
		return bridge === "unavailable"
			? RUNTIME_PLAYER_COPY.bridgeUnavailable
			: RUNTIME_PLAYER_COPY.failed;
	return RUNTIME_PLAYER_COPY.starting;
}

const styles = StyleSheet.create({
	disclosure: { gap: space.sm, paddingHorizontal: space.lg },
	surface: { flex: 1, minHeight: 0 },
	surfaceInner: { flex: 1 },
});
