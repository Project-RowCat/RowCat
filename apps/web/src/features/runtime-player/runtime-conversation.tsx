import { STORY_RUNTIME_CAPABILITIES } from "@rowcat/contracts";
import { storyPlaybackQueryOptions, storyQueryOptions } from "@rowcat/query";
import {
	runtimePlayStartDue,
	runtimePlayStartSessionKey,
	runtimeSaveDurabilityAtRisk,
} from "@rowcat/runtime-persistence";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ConversationViewport } from "#/features/conversation/conversation-viewport.tsx";
import { RuntimeAudioActivation } from "#/features/runtime-audio/runtime-audio-activation.tsx";
import { useRuntimePreviewGeneration } from "#/features/runtime-preview/runtime-preview-generation.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { useRuntimeConversationScope } from "#/lib/local-runtime-save/conversation-scope.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { resolveWebRuntimeAsset } from "#/lib/runtime-assets/web-asset-resolver.ts";
import type { PlayerFailure } from "./protocol.ts";
import {
	RUNTIME_CANVAS_COLUMN,
	RUNTIME_CANVAS_FRAME,
} from "./runtime-canvas.ts";
import {
	publishRuntimeChatControls,
	useRuntimeChatResetRequests,
} from "./runtime-chat-controls.ts";
import { shouldTouchRuntimeConversation } from "./runtime-conversation-presence.ts";
import {
	RUNTIME_PLAYER_AI_COPY,
	RUNTIME_PLAYER_COPY,
} from "./runtime-player-copy.ts";
import {
	RuntimeCreatorErrorNotice,
	RuntimePlayerProgress,
	RuntimeSaveNotice,
} from "./runtime-player-notices.tsx";
import { showsRuntimeSurface } from "./runtime-player-state.ts";
import { RuntimePlayerSurface } from "./runtime-player-surface.tsx";
import { useRuntimePlayer } from "./use-runtime-player.ts";

/**
 * Playback surface for a published runtime, shown inside the RowCat conversation canvas.
 * - Flow: a playback response that passed the eligibility gate with kind runtime shows the AI
 *   notice (only for stories that use generation; the text is trusted, not creator content). Then
 *   it allows or denies, then useRuntimePlayer runs: worker (QuickJS), web renderer, canvas box.
 * - Same column, header slot and sidebar section as the chat room (ConversationViewport), but no
 *   ChatPage branching, MessageList or ChatComposer. A second input under the creator's canvas
 *   would give the runtime two text inputs (§15).
 * - Creates no room (§3). Progress is saved state (RuntimePlayerPersistence, the same record the
 *   old `/stories/:id/play` used), keyed by storyId plus the default slot, so earlier progress
 *   still opens. A room would sit in lists, search and sync and do nothing.
 * - A chat story is not started here. A `chat` response shows only a pointer, because that path
 *   has its own steps (role choice, room creation, navigation).
 * - The library row is written when a verified runtime response arrives, through
 *   RuntimeConversationStore.touch. It is not written on address open, VM start or save commit, and
 *   it uses its own port rather than the playback lifecycle (sessionHydrated, save coordinator).
 * - Reset: the `Reset play` trigger and confirmation live in the header's context slot (where the
 *   chat room's `Conversation settings` sits), and the request arrives through a narrow bridge
 *   (runtime-chat-controls.ts). This screen decides whether reset is offered and calls
 *   lifecycle.resetPlaythrough, the single serialized transition. No second reset path exists.
 */
/**
 * Empty asset table, used before a response arrives or for a chat story. Being a module constant
 * keeps its identity stable across renders.
 */
const EMPTY: readonly { path: string; assetId: string }[] = [];

export function RuntimeConversation({ storyId }: { storyId: string }) {
	const client = getRowCatClient();

	/**
	 * The title comes from the story detail query, because the playback response carries no title. If
	 * that query fails, playback is not blocked: an entitled user should not be stopped by a missing
	 * title line.
	 */
	const storyQuery = useQuery(storyQueryOptions(client, storyId));
	const story = storyQuery.data;
	const playback = useQuery(storyPlaybackQueryOptions(client, storyId));

	/**
	 * AI consent lasts only for this playthrough (§74). It is not stored as a standing approval: the
	 * choice is tied to billing, so one tap must not authorize every runtime work for this user.
	 */
	const [aiAllowed, setAiAllowed] = useState<boolean | null>(null);

	const usesGeneration =
		playback.data?.kind === "runtime" &&
		playback.data.capabilities.includes(STORY_RUNTIME_CAPABILITIES[0]);
	/**
	 * Works that do not use generation never show the notice. The value must settle at `false` rather
	 * than null: the generation capability is still granted, so `useGeneration()` returns
	 * `runtime_generation_unavailable` instead of being absent.
	 */
	const generationAllowed = usesGeneration ? aiAllowed : false;

	/**
	 * The trusted generation adapter is the same one the preview uses (§77). Target resolution,
	 * managed billing, BYO routing, transport and error sanitizing all come from the functions chat
	 * already uses, so no second AI stack exists. It is not chat's `useChatGeneration`, which is a
	 * turn that stores a `ChatMessage`. Runtime generation only returns text to creator code (§24).
	 */
	const adapter = useRuntimePreviewGeneration({
		storyId,
		/** Until the playback response arrives nothing runs, so `false` there is never read for a real request. */
		adult: playback.data?.kind === "runtime" ? playback.data.adult : false,
	});

	const player = useRuntimePlayer({
		storyId,
		artifact:
			playback.data?.kind === "runtime" ? playback.data.artifact : undefined,
		/** Do not start a session before the playback response exists; `null` means waiting. */
		generationAllowed: playback.data === undefined ? null : generationAllowed,
		adapter,
		resolveAsset: resolveWebRuntimeAsset,
		/**
		 * The asset name table comes from the same response as the artifact, and is not fetched
		 * separately. Two reasons: a separate endpoint would expose the asset list without playback
		 * entitlement, and if the two values came from different publishes, new code would draw old
		 * assets.
		 */
		managedAssets:
			playback.data?.kind === "runtime" ? playback.data.managedAssets : EMPTY,
	});

	const { state, save } = player;
	const surfaceVisible = showsRuntimeSurface(state);

	/**
	 * Publishes to the header which controls may be offered now, and withdraws them on leave. Reset is
	 * offered only while the creator's screen is drawn. Generation settings only require that the work
	 * uses generation, including while the notice is showing, because the model must be selectable
	 * before the user allows AI.
	 */
	useEffect(() => {
		publishRuntimeChatControls(storyId, {
			resetAvailable: surfaceVisible,
			generationSettingsAvailable: usesGeneration,
		});
		return () => publishRuntimeChatControls(storyId, null);
	}, [storyId, surfaceVisible, usesGeneration]);
	useRuntimeChatResetRequests(storyId, () => {
		if (surfaceVisible) player.resetPlaythrough();
	});

	/**
	 * Library row, conditioned on a verified playback response (see the file header). The title comes
	 * from the detail query. It is `null` when that query failed, so the store keeps the title it
	 * already knows. If the title arrives late, the row is written once more. The identity is the
	 * same, so no second row is created.
	 */
	const library = useRuntimeConversationScope();
	const storyTitle = story?.title ?? null;
	const presence = shouldTouchRuntimeConversation({
		playback: playback.data,
		storyResolved: storyTitle !== null || storyQuery.isError,
	});
	useEffect(() => {
		const store = library.store;
		if (store === null || !presence) return;
		if (!library.ownsStore(store)) return;
		void store
			.touch({ storyId, title: storyTitle, now: new Date().toISOString() })
			.catch(() => {
				/** A failed library write must not stop the playthrough of a user who is already entitled. */
			});
	}, [library, presence, storyId, storyTitle]);

	/**
	 * Reports the play-start metric once, after the session is actually running. The playback response
	 * arriving, the library row being created and the VM booting all happen earlier
	 * (`runtimePlayStartDue`). The key is the library row id, so it happens once per account, and the
	 * server deduplicates on it. Restarts and remounts therefore add no second row. Failures are
	 * swallowed: a metric must not make a running session show an error.
	 */
	const playStartReported = useRef(false);
	useEffect(() => {
		if (
			!runtimePlayStartDue({
				running: state.status === "running",
				reported: playStartReported.current,
			})
		)
			return;
		playStartReported.current = true;
		void client.stories
			.recordPlayStart(storyId, {
				sessionKey: runtimePlayStartSessionKey(storyId),
				kind: "runtime",
			})
			.catch(() => {});
	}, [client, state.status, storyId]);

	const title = story?.title ?? RUNTIME_PLAYER_COPY.viewportTitle;

	if (playback.isError)
		return (
			<Frame title={title}>
				<Unavailable storyId={storyId} />
			</Frame>
		);

	if (playback.data === undefined)
		return (
			<Frame title={title}>
				<Centered>
					<RuntimePlayerProgress label={RUNTIME_PLAYER_COPY.loading} />
				</Centered>
			</Frame>
		);

	if (playback.data.kind === "chat")
		return (
			<Frame title={title}>
				<Unavailable storyId={storyId} />
			</Frame>
		);

	if (usesGeneration && aiAllowed === null)
		return (
			<Frame title={title}>
				<div className="flex flex-1 items-center justify-center p-6">
					<div className="flex max-w-md flex-col gap-3">
						<p className="font-medium">{RUNTIME_PLAYER_AI_COPY.title}</p>
						<p className="text-sm text-muted-foreground">
							{RUNTIME_PLAYER_AI_COPY.body}
						</p>
						<p className="text-xs text-muted-foreground">
							{RUNTIME_PLAYER_AI_COPY.note}
						</p>
						<div className="flex flex-wrap gap-2 pt-1">
							<Button onClick={() => setAiAllowed(true)}>
								{RUNTIME_PLAYER_AI_COPY.allow}
							</Button>
							<Button variant="outline" onClick={() => setAiAllowed(false)}>
								{RUNTIME_PLAYER_AI_COPY.deny}
							</Button>
						</div>
					</div>
				</div>
			</Frame>
		);

	return (
		<Frame
			title={title}
			footer={
				<>
					{/*
					 * A creator-code failure does not clear the screen (§132). The previous tree still matches the
					 * host,
					 * so it stays, and only a notice and a restart control are added below it.
					 */}
					{state.status === "creator-error" && (
						<RuntimeCreatorErrorNotice onRestart={player.restart} />
					)}
					{/*
					 * A save failure is not a runtime failure (§64). The work keeps running, and this only states
					 * honestly that progress is not yet durable. State is not rolled back.
					 * The notice sits outside the canvas, so creator UI cannot cover it (§52).
					 */}
					{runtimeSaveDurabilityAtRisk(save) && (
						<RuntimeSaveNotice onRetry={player.retrySave} />
					)}
				</>
			}
		>
			<RuntimePlayerSurface
				attach={player.attachSurface}
				hidden={!surfaceVisible}
			/>
			{/*
			 * Shown only when autoplay is blocked. It is a trusted control outside the creator's work (§52).
			 * Creator code cannot create or remove it. Browsers unlock playback only when it starts
			 * synchronously
			 * inside a user gesture, and a creator `onPress` round-trips through the VM, so the gesture is gone
			 * by then.
			 */}
			{surfaceVisible && (
				<RuntimeAudioActivation
					required={player.audioActivationRequired}
					onActivate={player.activateAudio}
				/>
			)}
			{!surfaceVisible && (
				<div className="absolute inset-0 flex items-center justify-center p-6 text-center">
					<StatusMessage
						status={state.status}
						failure={state.failure}
						onRetry={player.restart}
					/>
				</div>
			)}
		</Frame>
	);
}

/**
 * Frame for the canvas: vertical column, entrance animation, creator box, and the trusted line
 * below.
 * - The entrance (`PageEnter`) is the same layer as the chat room and inherits the shell column
 *   (`flex min-h-0 flex-1 flex-col`). No animation is applied inside the box, because a
 *   height-changing effect would alter the value the creator's `ScrollView` measures.
 * - The creator owns scrolling. The box is `overflow-hidden` and the shell is held to the screen
 *   height, so neither the window nor the box scrolls; only a `ScrollView` inside the creator tree
 *   does (§18).
 * - No virtualized list wraps it, because a runtime is not a message list (§16).
 */
function Frame({
	title,
	footer,
	children,
}: {
	title: string;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<ConversationViewport title={title}>
			<PageEnter className="flex min-h-0 flex-1 flex-col">
				<div className={RUNTIME_CANVAS_COLUMN}>
					<div className={RUNTIME_CANVAS_FRAME}>{children}</div>
					{footer}
				</div>
			</PageEnter>
		</ConversationViewport>
	);
}

const Centered = ({ children }: { children: ReactNode }) => (
	<div className="flex flex-1 items-center justify-center p-6">{children}</div>
);

/**
 * Shown when no playback response was received, because the user is not entitled or the server
 * refused. No artifact bytes arrive and no creator code runs (§44, §79). Entitlement is not
 * re-checked here. The story detail page renders the read and adult-gate answers from the server
 * projection, and this screen only links there. Reasons are not split out, because that would turn
 * this message into a probe for what the server chose to hide. The server refusal already made that
 * judgment.
 */
function Unavailable({ storyId }: { storyId: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<p className="text-sm text-muted-foreground">
				{RUNTIME_PLAYER_COPY.unavailable}
			</p>
			<Link
				to="/stories/$storyId"
				params={{ storyId }}
				className={buttonVariants({ variant: "outline", size: "sm" })}
			>
				{RUNTIME_PLAYER_COPY.storyDetailLink}
			</Link>
		</div>
	);
}

/**
 * Status sentence. The four branches need different user actions (§131). Only `incompatible` omits
 * the restart suggestion. Restarting would rebuild the same artifact in the same app and fail the
 * same way, so the user needs a new app build.
 */
function StatusMessage({
	status,
	failure,
	onRetry,
}: {
	status: string;
	failure: PlayerFailure | null;
	onRetry: () => void;
}) {
	/**
	 * The three preparing states show a spinner beside the sentence. Text alone would look frozen:
	 * while the VM starts and the save is read, the canvas is blank, and that stillness looks the same
	 * as a failed screen. `loading` keeps using the `starting` sentence. The wait for the playback
	 * response happens before this component mounts (see `playback.data === undefined` above), so
	 * `loading` here means the artifact is already in hand and the session is about to start.
	 */
	if (status === "loading" || status === "starting")
		return <RuntimePlayerProgress label={RUNTIME_PLAYER_COPY.starting} />;
	if (status === "syncing")
		return <RuntimePlayerProgress label={RUNTIME_PLAYER_COPY.syncing} />;
	if (status === "incompatible")
		return (
			<p className="text-sm text-muted-foreground">
				{RUNTIME_PLAYER_COPY.incompatible}
			</p>
		);
	if (status === "unavailable")
		return (
			<p className="text-sm text-muted-foreground">
				{RUNTIME_PLAYER_COPY.unavailable}
			</p>
		);
	/**
	 * The transition is blocked because the previous save could not be flushed. Restart retries the
	 * same flush, and the `Save again` (save again) action in the save-failure line below continues the
	 * same transition. The sentence says this.
	 */
	const message =
		failure?.stage === "persistence"
			? RUNTIME_PLAYER_COPY.transitionBlocked
			: RUNTIME_PLAYER_COPY.failed;
	return (
		<div className="flex flex-col items-center gap-2">
			<p className="text-sm text-muted-foreground">{message}</p>
			<Button size="sm" variant="outline" onClick={onRetry}>
				{RUNTIME_PLAYER_COPY.retry}
			</Button>
		</div>
	);
}
