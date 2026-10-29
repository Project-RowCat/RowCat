import type { ConversationDisplayMessage } from "@rowcat/chat";
import {
	chatPlaceholderNames,
	openingMessage,
	resolveEffectiveGeneration,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { generationModelsQueryOptions } from "@rowcat/query";
import {
	AlertDialog,
	AppBar,
	CenteredArea,
	ComposerArea,
	EmptyState,
	ErrorState,
	IconButton,
	KeyboardLayout,
	Notice,
	Screen,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { useProviderConnections } from "../../lib/local-data/use-provider-connections.ts";
import { resolveAppPhase } from "../../lib/session-state.ts";
import { useViewerCapability } from "../../lib/viewer-capability.ts";
import { chatGutter } from "../chat/chat-rhythm.ts";
import { Composer } from "../chat/composer.tsx";
import { generationRecovery } from "../chat/generation/error.ts";
import { useGlobalGenerationState } from "../chat/generation/use-room-generation.ts";
import { MessageActionBar } from "../chat/messages/action-bar.tsx";
import { MessageList } from "../chat/messages/list.tsx";
import { useConversationAuthoringMode } from "../create/runtime-lock.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { playtestConfigurationSummary } from "./playtest-configuration-summary.ts";
import {
	PLAYTEST_BACK_LABEL,
	PLAYTEST_DEBUGGER,
	PLAYTEST_DISCLOSURE,
	PLAYTEST_EMPTY_CONVERSATION_HINT,
	PLAYTEST_EMPTY_PROMPT_NOTE,
	PLAYTEST_ENTRY_LABEL,
	PLAYTEST_EPHEMERAL_NOTE,
	PLAYTEST_GUEST,
	PLAYTEST_MISSING,
	PLAYTEST_RELOAD_CONFIRM,
	PLAYTEST_RESET_CONFIRM,
	PLAYTEST_RUNTIME,
	PLAYTEST_SCENE_CONFIRM,
	PLAYTEST_SETTINGS_TRIGGER_LABEL,
	PLAYTEST_STORAGE_ERROR,
	PLAYTEST_UNAVAILABLE,
} from "./playtest-copy.ts";
import { PlaytestDebuggerDialog } from "./playtest-debugger-dialog.tsx";
import type { PlaytestState } from "./playtest-session.ts";
import { PlaytestSettingsDialog } from "./playtest-settings-dialog.tsx";
import { resolvePlaytestScreenState } from "./playtest-state.ts";
import { usePlaytest } from "./use-playtest.ts";
import { usePlaytestBootstrap } from "./use-playtest-bootstrap.ts";

/**
 * Playtest: **runs a draft without publishing it.**
 *
 * This is not the conversation screen. `ChatScreen` is not reused as a whole because it owns things
 * this screen does not have: local room lookup, message pagination, search inside a room, room
 * management, operations on saved messages, and the meaning of `/chat/:roomId`. This screen uses
 * the pieces below that level: the composer, the record list, the per-line copy action, and **the
 * same generation hook**.
 *
 * What this screen does not do is the boundary of the slice:
 *
 * ```text
 * does not publish        requests to the server are only the generation stream and the model catalog lookup
 * does not create rooms   ChatStore is never called (a static scan guards this)
 * does not save           the conversation lives only as long as this screen does
 * no view counts/metrics  this is not reading a work
 * ```
 *
 * ## What takes the largest area
 *
 * The conversation. Standing four condition controls above it would leave two lines of bubbles on a
 * 320pt device, and that layout says "settings are the body and the conversation sits below".
 *
 * ```text
 * AppBar                  drawer · back (to the editor) · title · test settings
 * condition summary line  readable as to what it is tested with, without opening a dialog
 * disclosure notice       **always standing**
 * (if the prompt is empty) one line
 * conversation            all the remaining height
 * failure notice          right above the composer
 * composer                pinned to the bottom
 * ```
 *
 * ## Confined to the screen height, and every edge has an owner
 *
 * It follows the same table as the conversation screen (`Screen`'s top, left and right;
 * `ComposerArea` at the bottom; `KeyboardLayout` for the keyboard). If this screen were laid out in
 * document flow (`ScrollScreen`), the list would have no height of its own, virtualization would
 * switch off entirely, and the composer would drift below the conversation.
 */
export function PlaytestScreen({ draftId }: { draftId: string }) {
	const router = useRouter();
	const { session } = useMobileIdentity();
	const localScope = useMobileLocalScope();
	const bootstrap = usePlaytestBootstrap(draftId);

	/**
	 * The execution model of this draft: **the same hook** that the draft editor's
	 * conversation-material rows pass through. This app has exactly one place for that subscription
	 * and judgment (`features/create/runtime-lock.tsx`). If this screen re-subscribed to the project
	 * and read `enabled` itself, a day would come when the locked rows and this screen gave different
	 * answers, and the mismatch would show up only as an empty conversation.
	 */
	const authoring = useConversationAuthoringMode(draftId);
	const state = resolvePlaytestScreenState({
		phase: resolveAppPhase(session, localScope.status),
		source: bootstrap.status,
		authoring,
	});

	/** Returns to the editor with **`replace`**, because this screen takes the editor's place. */
	const backToEditor = useCallback(() => {
		router.replace(`/create/${encodeURIComponent(draftId)}`);
	}, [router, draftId]);

	if (state.kind !== "ready" || !bootstrap.state)
		return (
			<Screen>
				{/**
				 * The draft's title is not known yet, because there is no snapshot. **Without making one up**, this
				 * only says what the screen is (`Story test`). An empty title would leave a row with just a back
				 * button, and you could not tell where it returns to.
				 */}
				<AppBar
					navigation={<AppSidebarTrigger />}
					title={PLAYTEST_ENTRY_LABEL}
					onBack={backToEditor}
					backLabel={PLAYTEST_BACK_LABEL}
				/>
				<CenteredArea>
					<Unavailable
						kind={state.kind === "ready" ? "loading" : state.kind}
						onRetryScope={localScope.retry}
						onLeave={() => router.replace("/create")}
						onSignIn={() =>
							router.push({
								pathname: "/login",
								params: { redirect: "/create" },
							})
						}
					/>
				</CenteredArea>
			</Screen>
		);

	/**
	 * Remounts on each draft id. The two drafts are different documents, so a conversation must not
	 * carry over. Putting that boundary in `key` means no effect has to clear state one piece at a
	 * time; that kind of code drops a line every time an axis is added.
	 */
	return (
		<LoadedPlaytest
			key={draftId}
			initial={bootstrap.state}
			viewerId={localScope.viewerId}
			onBack={backToEditor}
		/>
	);
}

/** The three operations that need confirmation. At most one dialog is open at a time. */
type PendingAction = "reset" | "reload" | { startSceneId: string | null };

function LoadedPlaytest({
	initial,
	viewerId,
	onBack,
}: {
	initial: PlaytestState;
	viewerId: string | null;
	onBack: () => void;
}) {
	const router = useRouter();
	const playtest = usePlaytest(initial, viewerId);
	const { generation, snapshot } = playtest;

	const [settingsOpen, setSettingsOpen] = useState(false);
	/**
	 * Whether the inspector is open: **screen state, not product state.**
	 *
	 * It has a **different trigger** from the settings dialog because the two answer different
	 * questions. Settings choose *how the next response is built*; the inspector reads *why the
	 * response that was just built came out that way*. Folding them into one would make someone who
	 * opened settings to change a condition walk through the record every time.
	 */
	const [debuggerOpen, setDebuggerOpen] = useState(false);
	const [pending, setPending] = useState<PendingAction | null>(null);
	const [reloading, setReloading] = useState(false);
	const [reloadFailed, setReloadFailed] = useState(false);

	const reloadLatest = useCallback(() => {
		setReloadFailed(false);
		setReloading(true);
		void playtest.reloadLatestDraft().then(
			(ok) => {
				setReloadFailed(!ok);
				setReloading(false);
			},
			() => {
				/**
				 * Even if it throws, the current test is unchanged: the controller finishes reading **before**
				 * it clears anything. All this does is say so.
				 */
				setReloadFailed(true);
				setReloading(false);
			},
		);
	}, [playtest.reloadLatestDraft]);

	/**
	 * Confirmation is required on one condition only: **is there something to discard?** If not a
	 * single message has been exchanged, no dialog opens. Attaching confirmation to every operation
	 * makes the dialog unread, and then it goes unread when it matters too.
	 *
	 * When confirmation is needed, **the settings dialog closes first.** If dialogs stack on the
	 * surface, the Android back gesture becomes unpredictable about which one it closes, and after
	 * confirmation what the user should see is the newly started conversation, not the settings (the
	 * memory panel confirms inline for the same reason).
	 */
	const confirmOrRun = (action: PendingAction, run: () => void) => {
		if (playtest.messages.length === 0) return run();
		setSettingsOpen(false);
		setPending(action);
	};

	const runPending = () => {
		const action = pending;
		setPending(null);
		if (action === "reset") return playtest.resetConversation();
		if (action === "reload") return reloadLatest();
		if (action) playtest.selectStartScene(action.startSceneId);
	};

	const confirmCopy =
		pending === "reset"
			? PLAYTEST_RESET_CONFIRM
			: pending === "reload"
				? PLAYTEST_RELOAD_CONFIRM
				: PLAYTEST_SCENE_CONFIRM;

	/**
	 * The opening that stands at the first line of the record, drawn from the **start scene chosen
	 * now**.
	 *
	 * It calls **the same function** as the conversation screen (`openingMessage`). Re-writing it
	 * would make the opening drawn in the test differ from the one drawn after publishing, and that
	 * difference would surface only after publishing.
	 */
	const opening = useMemo(() => openingMessage(snapshot.seed), [snapshot.seed]);

	/**
	 * What `{{char}}` and `{{user}}` resolve to: **the same function as the conversation screen.**
	 *
	 * This screen has no room, so there are no added characters (a playtest creates no records). The
	 * only remaining sources are the snapshot's character cards and the counterpart the work suggests.
	 */
	const names = useMemo(
		() => chatPlaceholderNames(snapshot.seed),
		[snapshot.seed],
	);

	/**
	 * The only action attached to a line is **copy**, whether it is the opening or a message
	 * exchanged.
	 *
	 * The other four actions on the conversation screen require either a storage transaction
	 * (`editUserMessage`, `deleteFromMessage`) or **an identity the server knows** (reporting), and
	 * this screen has neither. Nor are the missing actions drawn disabled; that would be a promise we
	 * cannot keep.
	 */
	const renderActions = useCallback(
		(row: ConversationDisplayMessage) => (
			<MessageActionBar
				message={row}
				align={row.role === "user" ? "end" : "start"}
				menu={null}
			/>
		),
		[],
	);

	/**
	 * One failure line and **the one action available for that failure**. It is the **same function**
	 * as the conversation screen's (`features/chat/generation/error.ts`). If each screen wrote its
	 * own, the five branches of provider failure would be drawn correctly on only one of them.
	 */
	const recovery = generationRecovery({
		error: generation.error,
		unanswered: generation.unanswered,
		/**
		 * **The playtest has no continuation.** Its session has no function that extends a committed
		 * message (`extendAssistantMessage`), so passing true here would stand a button that leads
		 * nowhere.
		 */
		continuable: false,
		stopped: generation.stopped,
	});
	const runRecovery = (): void => {
		if (!recovery?.action) return;
		if (recovery.action.kind === "retry") generation.regenerate();
		else router.push("/settings/ai");
	};

	/**
	 * A conversation in which nothing has been exchanged yet, and no response is in progress. Once the
	 * first token starts streaming, that spot is already a conversation. When an opening exists, this
	 * hint does not stand (the list already has text to read, and overlaying it would get in the way).
	 */
	const conversationEmpty =
		!opening &&
		playtest.messages.length === 0 &&
		!generation.generating &&
		generation.streamingText === "";

	return (
		<Screen edges={["top", "left", "right"]}>
			<AppBar
				navigation={<AppSidebarTrigger />}
				title={snapshot.title}
				onBack={onBack}
				backLabel={PLAYTEST_BACK_LABEL}
				actions={
					<>
						<IconButton
							icon="debugger"
							label={PLAYTEST_DEBUGGER.trigger}
							onPress={() => setDebuggerOpen(true)}
						/>
						<IconButton
							icon="playtest-settings"
							label={PLAYTEST_SETTINGS_TRIGGER_LABEL}
							onPress={() => setSettingsOpen(true)}
						/>
					</>
				}
			/>

			<ConditionSummary
				preference={playtest.preference}
				startSceneTitle={
					playtest.startSceneId === null
						? null
						: (snapshot.startScenes.find(
								(scene) => scene.id === playtest.startSceneId,
							)?.title ?? null)
				}
			/>

			{/**
			 * Notice about the publication boundary. It does not collapse and **always stands**: this is where a
			 * manuscript nobody has published yet goes out to an external provider, so showing it once is not
			 * enough. It does not raise a confirmation per message (that dialog would soon go unread), and it is
			 * not placed inside the settings dialog either. The creator should not have to open settings to learn
			 * where the manuscript goes.
			 */}
			<View style={playtestStyle.notes}>
				<Text variant="caption" tone="muted-foreground">
					{PLAYTEST_DISCLOSURE} {PLAYTEST_EPHEMERAL_NOTE}
				</Text>
				{/**
				 * It does not block when the prompt is empty: the playtest is an authoring tool, not a publication gate.
				 * It says why the result looks flat instead.
				 */}
				{snapshot.seed.scenario.trim() ? null : (
					<Text variant="caption" tone="muted-foreground">
						{PLAYTEST_EMPTY_PROMPT_NOTE}
					</Text>
				)}
			</View>

			<KeyboardLayout>
				<View style={playtestStyle.conversation}>
					<MessageList
						opening={opening}
						messages={playtest.messages}
						streamingText={generation.streamingText}
						generating={generation.generating}
						/**
						 * The test draws the **same picture**. The snapshot has gone through the same normalization
						 * as publication (`buildPlaytestSnapshot`), so the scenes seen here are the scenes seen after
						 * publishing. That fact is why this screen exists.
						 */
						sceneImages={snapshot.seed.sceneImages}
						names={names}
						/** Nothing older to load: this conversation started on this screen. */
						hasOlder={false}
						onLoadOlder={noop}
						renderActions={renderActions}
					/>
					{conversationEmpty ? (
						<View style={playtestStyle.hint} pointerEvents="none">
							<Text variant="label" tone="muted-foreground">
								{PLAYTEST_EMPTY_CONVERSATION_HINT}
							</Text>
						</View>
					) : null}
				</View>

				{recovery ? (
					<View style={playtestStyle.failure}>
						{/**
						 * Severity is decided by the ladder (`recovery.tone`), the same rule as the conversation screen. A turn
						 * that ended without a body is not broken, and drawing that line on a red surface would make the creator
						 * suspect a fault on our side rather than in their own manuscript.
						 */}
						<Notice
							{...(recovery.tone === "failure"
								? ({ tone: "destructive" } as const)
								: {})}
							message={recovery.message}
							/**
							 * There is **one** action. Some failures are not undone by pressing again (an insufficient
							 * balance must change, and a key the provider rejected must be replaced), so the branch is
							 * not written again here: the value the pure module returns is drawn as-is.
							 */
							actionLabel={recovery.action?.label}
							onAction={recovery.action ? runRecovery : undefined}
						/>
					</View>
				) : null}

				{/** The owner of the bottom edge. The composer inside does not know about the device. */}
				<ComposerArea>
					<Composer
						disabled={false}
						generating={generation.generating}
						onSend={generation.send}
						onStop={generation.stop}
					/>
				</ComposerArea>
			</KeyboardLayout>

			<PlaytestDebuggerDialog
				open={debuggerOpen}
				onOpenChange={setDebuggerOpen}
				state={playtest.debug}
			/>

			<PlaytestSettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				playtest={playtest}
				reloading={reloading}
				reloadFailed={reloadFailed}
				onSelectStartScene={(startSceneId) =>
					confirmOrRun({ startSceneId }, () =>
						playtest.selectStartScene(startSceneId),
					)
				}
				onReset={() => confirmOrRun("reset", playtest.resetConversation)}
				onReloadLatest={() => confirmOrRun("reload", reloadLatest)}
			/>

			<AlertDialog
				open={pending !== null}
				title={confirmCopy.title}
				description={confirmCopy.description}
				confirmLabel={confirmCopy.confirmLabel}
				destructive
				onConfirm={runPending}
				onCancel={() => setPending(null)}
			/>
		</Screen>
	);
}

/**
 * What the test is run with now: **readable without opening the dialog.**
 *
 * The summary is not computed here. Precedence resolution and availability decisions belong to pure
 * functions (`playtest-configuration-summary.ts` → `@rowcat/chat`); this component only collects
 * the values those functions ask for and draws the result.
 *
 * The two queries (catalog and account entitlement) are **the same ones** the settings dialog uses.
 * Identical keys merge, so no extra request is made, and the list the dialog will need is warmed up
 * while the summary draws.
 */
function ConditionSummary({
	preference,
	startSceneTitle,
}: {
	preference: ReturnType<typeof usePlaytest>["preference"];
	startSceneTitle: string | null;
}) {
	const global = useGlobalGenerationState();
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const capability = useViewerCapability();
	/**
	 * The providers this device has connected: the **same store** as the conversation screen and the
	 * generation runtime. If they diverged, the summary would say "usable" while sending is blocked.
	 */
	const connections = useProviderConnections();

	/**
	 * The playtest-only override is the **innermost layer**, so it goes into the resolver's `room`
	 * slot. That name comes from the only consumer so far and does not mean a store. Writing
	 * `preference.target ?? global…` here would create a second copy of the precedence rules.
	 */
	const effective = resolveEffectiveGeneration({
		global: global.global,
		room: preference,
	});

	const summary = playtestConfigurationSummary({
		loading:
			global.loading ||
			catalog.isPending ||
			capability.loading ||
			connections.loading,
		effective,
		models: catalog.data ?? [],
		catalogLoaded: catalog.isSuccess,
		connected: connections.providers,
		byoAllowed: capability.byo,
		startSceneTitle,
	});

	/** Does not draw a product default before the value arrives; the row does not stand at all. */
	if (summary.text === null) return null;

	return (
		<View style={playtestStyle.summary}>
			<Text
				variant="caption"
				tone="muted-foreground"
				style={playtestStyle.summaryText}
			>
				{summary.text}
			</Text>
			{/**
			 * The fact that the target cannot be used must remain even without opening the dialog. If the control
			 * moves one level deeper and this is hidden too, the user sends messages without knowing why the
			 * conversation is blocked (the same sentence as the conversation settings home).
			 */}
			{summary.blocked ? (
				<Text variant="caption" tone="destructive">
					Not available on this device
				</Text>
			) : null}
		</View>
	);
}

/**
 * When the test cannot be opened.
 *
 * **It does not distinguish a missing draft from someone else's draft.** Both mean "not in this
 * account on this device", which is the literal fact: the draft is not on the server, so there is
 * no way to find out which one it is.
 */
function Unavailable({
	kind,
	onRetryScope,
	onLeave,
	onSignIn,
}: {
	kind: Exclude<ReturnType<typeof resolvePlaytestScreenState>["kind"], "ready">;
	onRetryScope: () => void;
	onLeave: () => void;
	onSignIn: () => void;
}) {
	if (kind === "booting" || kind === "loading") return <Spinner />;

	if (kind === "guest")
		return (
			<EmptyState
				icon="create"
				title={PLAYTEST_GUEST.title}
				description={PLAYTEST_GUEST.description}
				actionLabel={PLAYTEST_GUEST.action}
				onAction={onSignIn}
			/>
		);

	if (kind === "unavailable") return <Notice message={PLAYTEST_UNAVAILABLE} />;

	/**
	 * A runtime draft: **this is not a failure.** That is why it is kept apart from the drafts that
	 * have no icon and no way out. The draft here is fine; only the place to test it differs.
	 */
	if (kind === "runtime")
		return (
			<EmptyState
				icon="create"
				title={PLAYTEST_RUNTIME.title}
				description={PLAYTEST_RUNTIME.description}
				actionLabel={PLAYTEST_RUNTIME.action}
				actionVariant="outline"
				onAction={onLeave}
			/>
		);

	if (kind === "storage-error")
		return (
			<ErrorState
				message={PLAYTEST_STORAGE_ERROR.message}
				actionLabel={PLAYTEST_STORAGE_ERROR.action}
				onAction={onRetryScope}
			/>
		);

	/**
	 * A missing draft is **not an error**. It was deleted, or the one made on another device has not
	 * arrived yet, or it is a hand-edited deep link. All three are normal, and the screen's job is to
	 * say so and give a way out. **It does not create an empty draft.**
	 */
	return (
		<EmptyState
			icon="missing"
			title={PLAYTEST_MISSING.title}
			description={PLAYTEST_MISSING.description}
			actionLabel={PLAYTEST_MISSING.action}
			/** The web's equivalent branch is `outline` (`playtest-page.tsx`). */
			actionVariant="outline"
			onAction={onLeave}
		/>
	);
}

const noop = () => {};

const playtestStyle = StyleSheet.create({
	/** Sits on the **same horizontal axis** as the list and the composer (`chat-rhythm.ts`). */
	notes: {
		gap: space.xs,
		paddingBottom: space.xs,
		paddingHorizontal: chatGutter,
	},
	summary: {
		gap: 2,
		paddingHorizontal: chatGutter,
		paddingVertical: space.xs,
	},
	summaryText: { flex: 1, minWidth: 0 },
	conversation: { flex: 1 },
	/**
	 * The line for an empty conversation is **overlaid on top of** the list. In the flow it would
	 * shorten the list by that much, and when the first message arrives the slot would disappear and
	 * shift the scroll coordinates once. The virtualizer owns this slot's geometry.
	 */
	hint: {
		alignItems: "center",
		bottom: 0,
		justifyContent: "center",
		left: 0,
		paddingHorizontal: space.xl,
		position: "absolute",
		right: 0,
		top: 0,
	},
	failure: { paddingBottom: space.xs, paddingHorizontal: chatGutter },
});
