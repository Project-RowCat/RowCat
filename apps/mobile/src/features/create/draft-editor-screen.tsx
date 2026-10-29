import type { StoryDraft, StoryDraftPatch } from "@rowcat/authoring";
import { draftDisplayTitle } from "@rowcat/authoring";
import { space } from "@rowcat/design";
import {
	AlertDialog,
	AppBar,
	Button,
	EmptyState,
	ErrorState,
	KeyboardLayout,
	Notice,
	Screen,
	Spinner,
	screenPadding,
	Text,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import {
	useDraftLore,
	useDraftSceneImages,
	useDraftStartScenes,
	useLocalDraft,
} from "../../lib/local-data/use-drafts.ts";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import { LeaveGuard } from "../../lib/navigation/leave-guard.tsx";
import { resolveAppPhase } from "../../lib/session-state.ts";
import { useStartPlaytest } from "../playtest/use-start-playtest.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { BasicsSection } from "./basics-section.tsx";
import {
	CREATE_GUEST,
	CREATE_STORAGE_ERROR,
	CREATE_UNAVAILABLE,
	DISMISS_LABEL,
} from "./create-copy.ts";
import { resolveDraftEditorState } from "./create-home-state.ts";
import { DraftCoverField } from "./draft-cover-field.tsx";
import { DRAFT_LEAVE_COPY, shouldBlockLeave } from "./draft-leave.ts";
import { applyOverlay, reconcileOverlay } from "./draft-overlay.ts";
import { DraftPreviewSection } from "./draft-preview-section.tsx";
import { DraftRecoveryNotice } from "./draft-recovery-notice.tsx";
import {
	AUTOSAVE_LABEL,
	AUTOSAVE_RETRY_LABEL,
	EDITOR_BACK_LABEL,
	EDITOR_MISSING,
	SECTION,
} from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";
import { LoreSection } from "./lore-section.tsx";
import { PromptSectionBody } from "./prompt-section.tsx";
import { toPublishVisibility } from "./publish-copy.ts";
import { PublishSection } from "./publish-section.tsx";
import { SceneImageSection } from "./scene-image-section.tsx";
import { StartSceneSection } from "./start-scene-section.tsx";
import { useDraftActions } from "./use-draft-actions.ts";
import {
	type DraftAutosave,
	useAutosaveState,
	useDraftAutosave,
} from "./use-draft-autosave.ts";
import { useSceneImageUpload } from "./use-scene-image-upload.ts";

/**
 * Draft editor. A real screen, not a dialog or sheet.
 *
 * The address must be able to point here for concrete reasons: the workspace list pushes into it,
 * the published works' `Edit draft` opens the same address, and publishing leaves for the work detail.
 * None of these can be a layer.
 *
 * ## A missing draft is not an error
 *
 * It was deleted, was created on another device and has not arrived yet, or is a hand-edited deep
 * link. All three are normal; the screen says so and offers the way back to `/create`. **It does
 * not create an empty draft**, since a wrong address would then create a document the user never
 * wrote.
 *
 * ## The screen leads and the record follows
 *
 * The owner of input values is the overlay (`draft-overlay.ts`), and a stored record is ignored
 * until the value we emitted comes back. Otherwise a save arriving every 500ms would move the
 * cursor to the end and erase keystrokes typed meanwhile, which breaks Hangul composition in
 * particular.
 *
 * **The overlay lives only at the draft root.** Children (lore, scenes, scene images) each hold
 * their own input, and the owner of that value is still the store. Editing a child re-renders the
 * parent record, but that card's value comes from its own record, so the same reversal does not
 * happen.
 *
 * ## No save button
 *
 * The save model is autosave alone (`use-draft-autosave.ts`), and the quiet text under the header
 * states its status. A manual retry opens only after a failure. Typing extra characters to wake the
 * debounce is a trick, not an operation, and only those who know can use it.
 */
export function DraftEditorScreen({ draftId }: { draftId: string }) {
	const router = useRouter();
	const { session } = useMobileIdentity();
	const localScope = useMobileLocalScope();

	const record = useLocalDraft(draftId);
	const lore = useDraftLore(draftId);
	const scenes = useDraftStartScenes(draftId);
	const images = useDraftSceneImages(draftId);

	const autosave = useDraftAutosave(draftId);
	const actions = useDraftActions(draftId);
	const upload = useSceneImageUpload(actions.addSceneImage);

	const phase = resolveAppPhase(session, localScope.status);
	const state = resolveDraftEditorState({
		phase,
		draft: { status: record.status, found: record.value !== null },
	});

	const leave = useLeaveGuard(autosave, () => router.back());
	/**
	 * Entry from the editor into the test. It receives the trigger and the failure notice together and
	 * places each one. The order (flush pending saves → store → assemble → ownership → navigate)
	 * belongs entirely to that hook.
	 */
	const playtest = useStartPlaytest(draftId, autosave);

	return (
		<Screen>
			{/**
			 * The drawer and back sit together. There are no global utilities: the header is narrow with back and the
			 * title alone, and the account menu has no place mid-edit (the chat screen leaves that group out for the same reason).
			 */}
			<AppBar
				navigation={<AppSidebarTrigger />}
				title={
					record.value ? draftDisplayTitle(record.value) : EDITOR_BACK_LABEL
				}
				onBack={leave.requestLeave}
				backLabel={EDITOR_BACK_LABEL}
			/>

			{/**
			 * The save status and one authoring aid share this row, as on the web editor header (draft-editor-page.tsx).
			 *
			 * `Story test` sits apart from the publish section on purpose. The test sends nothing to the server, and beside
			 * the publish button it would blur that fact and suggest a test must run before publishing, which this product
			 * does not require.
			 *
			 * Drawn only when the draft actually opened. A test button on a missing draft would do nothing when pressed,
			 * which looks the same as a broken control.
			 */}
			<View style={editor.toolbar}>
				<View style={editor.toolbarRow}>
					<AutosaveIndicator autosave={autosave} />
					{state.kind === "ready" ? playtest.trigger : null}
				</View>
				{state.kind === "ready" ? playtest.notice : null}
			</View>

			<EditorBody
				state={state}
				draft={record.value}
				lore={lore.value}
				scenes={scenes.value}
				images={images.value}
				autosave={autosave}
				actions={actions}
				upload={upload}
				onRetryScope={localScope.retry}
				onRetryRead={record.reload}
				onLeave={() => router.replace("/create")}
				onSignIn={() =>
					router.push({ pathname: "/login", params: { redirect: "/create" } })
				}
			/>

			<AlertDialog
				open={leave.confirming}
				title={DRAFT_LEAVE_COPY.title}
				description={DRAFT_LEAVE_COPY.description}
				confirmLabel={DRAFT_LEAVE_COPY.retry}
				cancelLabel={DRAFT_LEAVE_COPY.stay}
				busy={leave.retrying}
				onConfirm={() => void leave.retry()}
				onCancel={leave.stay}
			/>
			{/**
			 * The third path sits outside the dialog. `AlertDialog` takes two actions, so the discard path lives beneath
			 * it while it is open. After a save failure the person cannot be trapped in the editor.
			 */}
			{leave.confirming ? (
				<View style={editor.discard}>
					<Button
						label={DRAFT_LEAVE_COPY.discard}
						variant="ghost"
						onPress={leave.discard}
					/>
				</View>
			) : null}

			{/**
			 * Intercepts navigations the app does not own: hardware back, the iOS edge swipe, and moves made by the bottom
			 * row or the drawer (lib/navigation/leave-guard.tsx).
			 *
			 * It must be a leaf. Only this component subscribes to save status, so the `pending → saving → saved` cycle
			 * every 500ms does not re-render the editor tree (`AutosaveIndicator` below has the same shape).
			 */}
			<EditorLeaveGuard
				autosave={autosave}
				leaving={leave.leaving}
				onBlocked={leave.block}
			/>
		</Screen>
	);
}

/**
 * The leaf that blocks leaving. It draws nothing and alone subscribes to save status.
 *
 * The router wiring lives in the navigation layer (lib/navigation/leave-guard.tsx) and the decision
 * in a pure function (`shouldBlockLeave`). This component only connects the two, and being a leaf
 * is the whole of the isolation: if the editor body subscribed, every save would re-render the
 * whole tree, whose only result is this boolean.
 */
function EditorLeaveGuard({
	autosave,
	leaving,
	onBlocked,
}: {
	autosave: DraftAutosave;
	/** After deciding to leave, do not block; the reason for the latch is in the useLeaveGuard comment. */
	leaving: boolean;
	onBlocked: () => void;
}) {
	const snapshot = useAutosaveState(autosave);
	return (
		<LeaveGuard
			blocked={!leaving && shouldBlockLeave(snapshot)}
			onBlocked={onBlocked}
		/>
	);
}

/**
 * One line of save status. Only the component that draws this text subscribes.
 *
 * If the editor body subscribed, every save (`pending` → `saving` → `saved`) would re-render the
 * whole tree three times. Only failure takes `role="alert"`; the rest stays quiet. A value changing
 * several times a second while typing, placed in a live region, would bury the real failure in
 * noise.
 */
function AutosaveIndicator({ autosave }: { autosave: DraftAutosave }) {
	const snapshot = useAutosaveState(autosave);
	const label = AUTOSAVE_LABEL[snapshot.status];
	/**
	 * Keeps its space even with nothing to say. `Story test` stands at this row's right end, and returning
	 * `null` here would make that button shift with the save status.
	 */
	if (!label) return <View style={editor.autosave} />;

	const failed = snapshot.status === "error";
	return (
		<View style={editor.autosave}>
			<Text
				accessibilityRole={failed ? "alert" : undefined}
				variant="caption"
				tone={failed ? "destructive" : "muted-foreground"}
				style={editor.autosaveText}
			>
				{label}
			</Text>
			{/**
			 * With no pending change there is nothing to press. Offering the button from the label alone would leave a
			 * button that does nothing when pressed, which looks the same as a broken control.
			 */}
			{failed && snapshot.pending ? (
				<Button
					label={AUTOSAVE_RETRY_LABEL}
					variant="ghost"
					size="sm"
					onPress={() => void autosave.flush()}
				/>
			) : null}
		</View>
	);
}

function EditorBody({
	state,
	draft,
	lore,
	scenes,
	images,
	autosave,
	actions,
	upload,
	onRetryScope,
	onRetryRead,
	onLeave,
	onSignIn,
}: {
	state: ReturnType<typeof resolveDraftEditorState>;
	draft: StoryDraft | null;
	lore: ReturnType<typeof useDraftLore>["value"];
	scenes: ReturnType<typeof useDraftStartScenes>["value"];
	images: ReturnType<typeof useDraftSceneImages>["value"];
	autosave: DraftAutosave;
	actions: ReturnType<typeof useDraftActions>;
	upload: ReturnType<typeof useSceneImageUpload>;
	onRetryScope: () => void;
	onRetryRead: () => void;
	onLeave: () => void;
	onSignIn: () => void;
}) {
	/**
	 * The value the screen draws: the overlay laid over the stored record.
	 *
	 * The overlay covers the stored value (reversing the order would bring back the keystroke just
	 * typed). Keys the record has caught up with are dropped during render; doing it in an effect
	 * would lag a frame, and an edit from another device would not show in that frame.
	 */
	const [overlay, setOverlay] = useState<Partial<StoryDraft>>({});
	if (draft) {
		const next = reconcileOverlay(overlay, draft);
		if (next !== overlay) setOverlay(next);
	}

	const view = useMemo(
		() => (draft ? applyOverlay(draft, overlay) : null),
		[draft, overlay],
	);

	const patch = useCallback(
		(fields: StoryDraftPatch) => {
			setOverlay((previous) => ({ ...previous, ...fields }));
			autosave.patchDraft(fields);
		},
		[autosave],
	);

	if (state.kind === "booting" || state.kind === "loading")
		return (
			<View style={editor.center}>
				<Spinner />
			</View>
		);

	if (state.kind === "guest")
		return (
			<View style={editor.center}>
				<EmptyState
					icon="create"
					title={CREATE_GUEST.title}
					description={CREATE_GUEST.description}
					actionLabel={CREATE_GUEST.action}
					onAction={onSignIn}
				/>
			</View>
		);

	if (state.kind === "unavailable")
		return (
			<View style={editor.center}>
				<Notice message={CREATE_UNAVAILABLE} />
			</View>
		);

	if (state.kind === "storage-error" || state.kind === "read-error")
		return (
			<View style={editor.center}>
				<ErrorState
					message={CREATE_STORAGE_ERROR.message}
					actionLabel={CREATE_STORAGE_ERROR.action}
					onAction={state.kind === "storage-error" ? onRetryScope : onRetryRead}
				/>
			</View>
		);

	if (state.kind === "missing" || !view)
		return (
			<View style={editor.center}>
				<EmptyState
					icon="missing"
					title={EDITOR_MISSING.title}
					description={EDITOR_MISSING.description}
					actionLabel={EDITOR_MISSING.action}
					/** The web's `Back to drafts` link is `outline` (see draft-editor-page.tsx). */
					actionVariant="outline"
					onAction={onLeave}
				/>
			</View>
		);

	/**
	 * The body arrived. The header and save-status row stay outside (lib/motion/page-enter.tsx).
	 *
	 * On this app PageEnter marks content resolving, not a route (the native stack transition already
	 * marks arrival; see docs/motion/ARCHITECTURE.md). It is absent from the placeholder, guest, error
	 * and missing-draft branches, which are all "not yet there" states; animating their arrival would
	 * add a second wait.
	 *
	 * It must sit inside the keyboard layer. Outside it, the element pushed up by the keyboard would
	 * be an animating box, and KeyboardAvoidingView, which measures that frame, would read the
	 * intermediate height during the arrival transition.
	 */
	return (
		<KeyboardLayout>
			<PageEnter style={editor.fill}>
				<ScrollView
					contentContainerStyle={editor.content}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
				>
					{/**
					 * The recovery notice for a kept edit stands above the sections.
					 *
					 * A vanished value may belong to any group (a title or a prompt), so inside one section a copy from
					 * another group would appear in the wrong place. Passing the stored record is also deliberate: the
					 * overlay is unsaved input, so comparing the kept copy against it would make "current content" differ
					 * from the store's value.
					 */}
					<DraftRecoveryNotice draft={draft ?? view} />

					<BasicsSection draft={view} onPatch={patch} />

					{/**
					 * The cover sits **after basic info and before the preview**. It forms the card together with the values
					 * above it, and the preview directly below shows the result, so how the picked image crops is answered
					 * right there.
					 */}
					<DraftCoverField draft={view} />

					{/**
					 * The preview stands right after basic info. How the values above look as a card should be answered in
					 * place; below the prompt, the picture would sit past values that never reach the card (the web places it here too).
					 */}
					<DraftPreviewSection draft={view} />

					<EditorSection
						title={SECTION.prompt.title}
						description={SECTION.prompt.description}
					>
						{/*
						 * On a draft with the runtime on, this field becomes guidance instead of an editor. It stays closed until
						 * the project is read (see `PromptSectionBody` in prompt-section.tsx). The three sections below pass
						 * through the same decision. The value's owner is still autosave.
						 */}
						<PromptSectionBody
							draftId={view.id}
							value={view.prompt}
							onChange={(prompt) => patch({ prompt })}
						/>
					</EditorSection>

					{actions.failure ? (
						<Notice
							message={actions.failure}
							tone="destructive"
							actionLabel={DISMISS_LABEL}
							onAction={actions.dismissFailure}
						/>
					) : null}

					{/*
					 * The three sections below and the prompt above become guidance instead of editors while the runtime is on.
					 * All four are read only when playback stands up a conversation room, and runtime playback creates none.
					 * Subscription and judgment pass through one place the four sections share (`runtime-lock.tsx`). This app has
					 * no runtime authoring screen, but these records still arrive through sync.
					 */}
					<LoreSection
						draftId={view.id}
						entries={lore}
						onPatch={autosave.patchLore}
						onAdd={() => void actions.addLore()}
						onRemove={(id) => void actions.removeLore(id)}
						onReorder={(ids) => void actions.moveLore(ids)}
					/>

					<StartSceneSection
						draftId={view.id}
						scenes={scenes}
						defaultStartSceneId={view.defaultStartSceneId}
						onPatch={autosave.patchStartScene}
						onAdd={() => void actions.addStartScene()}
						onRemove={(id) => void actions.removeStartScene(id)}
						onReorder={(ids) => void actions.moveStartScene(ids)}
						onSetDefault={(id) => void actions.setDefaultStartScene(id)}
					/>

					<SceneImageSection
						draftId={view.id}
						images={images}
						onPatch={autosave.patchSceneImage}
						onRemove={(id) => void actions.removeSceneImage(id)}
						upload={upload}
					/>

					<PublishSection
						draftId={view.id}
						visibility={toPublishVisibility(view.visibility)}
						onVisibility={(visibility) => patch({ visibility })}
						flushAutosave={autosave.flush}
					/>
				</ScrollView>
			</PageEnter>
		</KeyboardLayout>
	);
}

/**
 * Intercepts leaving. The decision is a pure function; the interception belongs to the navigation
 * layer.
 *
 * The decision lives in `shouldBlockLeave` (draft-leave.ts) and the router wiring in
 * lib/navigation/leave-guard.tsx. What remains here is the state that connects them and the three
 * outcomes (`Try again`, `Leave without saving`, `Stay on this screen`).
 *
 * ## ⚠︎ The covered scope grew, and the boundary is still honest
 *
 * ```text
 * back in the header          blocked  (requestLeave in this hook)
 * Android hardware back       blocked  ← newly covered
 * iOS edge swipe              blocked  ← newly covered (the gesture is disabled)
 * bottom row or drawer        blocked  ← newly covered
 * ──────────────────────────────────────────────
 * OS suspends or kills the app  NOT blocked — the app cannot observe it
 * ```
 *
 * For a while this comment said hardware back could not be blocked, because the presentation policy
 * bans BackHandler. That conclusion was wrong: the tool was wrong, not the goal. BackHandler knows
 * only Android back and does not see the iOS swipe or navigation the router starts. The router
 * treats all three as one event, and that is where this app blocks them.
 *
 * The last line stands. The remaining defence on that path is the flush on unmount or background,
 * which is best effort rather than a guarantee (see the header of use-draft-autosave.ts).
 *
 * ## Does not trap
 *
 * The condition to block is **only when both hold** (the save failed, and pending changes remain).
 * When it turns false, the next attempt passes through. That is why `Leave without saving` leaves **after
 * emptying** the queue: once empty, the decision is false and any route out works from then on.
 * Leaving without emptying would let the unmount's final flush revive an edit the person chose to
 * discard.
 */
function useLeaveGuard(
	autosave: DraftAutosave,
	leave: () => void,
): {
	confirming: boolean;
	retrying: boolean;
	/** Whether a departure is in progress; the interception is released while this is true. */
	leaving: boolean;
	requestLeave: () => void;
	/** Tells the person about a navigation the router blocked; the decision is already made. */
	block: () => void;
	retry: () => Promise<void>;
	discard: () => void;
	stay: () => void;
} {
	const [confirming, setConfirming] = useState(false);
	const [retrying, setRetrying] = useState(false);
	/**
	 * **We decided to leave**, and that fact must commit **before** the interception does.
	 *
	 * This latch is the least visible rule in this hook. If `leave()` is called right after `discard`
	 * empties the queue, the router still holds the previous render's decision (`usePreventRemove`
	 * reads the value at render time). That navigation would be blocked again and reopen the dialog
	 * just closed, so `Leave without saving` would look dead.
	 *
	 * So the state rises first and the navigation runs from an effect. In that commit the leaf
	 * (`EditorLeaveGuard`) redraws with `blocked: false`, so the interception is already released when
	 * the effect runs.
	 *
	 * It is not reverted. Re-locking after deciding to leave would trap the person in the editor if
	 * the navigation arrived a frame late; this layer's promise is only "does not trap".
	 */
	const [leaving, setLeaving] = useState(false);

	/**
	 * Looks at **the facts now**, not the value carried by the render. Judging by a subscribed value
	 * would make this hook re-render the editor on every save, whose only result is this judgment.
	 */
	const blocked = useCallback(
		() => shouldBlockLeave(autosave.state.get()),
		[autosave],
	);

	const requestLeave = useCallback(() => {
		if (blocked()) setConfirming(true);
		else leave();
	}, [blocked, leave]);

	/**
	 * Called after the router has already blocked — **it does not decide again.**
	 *
	 * This is why it is kept apart from `requestLeave`. That one asks *may we leave* and opens the
	 * dialog otherwise; arriving here already means "blocked" (the router calls this only when
	 * `blocked` is true). Folding them into one function would let a save succeed within one tick, so
	 * neither the dialog opens nor the navigation happens, and Back looks dead.
	 */
	const block = useCallback(() => setConfirming(true), []);

	/**
	 * The **effect** leaves after the latch rises (see the `leaving` comment above). Calling it
	 * directly from the handler would hit the previous render's interception.
	 *
	 * **The dependency is the latch alone, by rule.** A function the caller passes may be recreated on
	 * every render (`() => router.back()`), and if it were a dependency, every render while the latch
	 * is up would send the navigation again, unwinding the stack several layers below the editor. So
	 * the function travels in a ref and the effect watches one fact.
	 */
	const leaveRef = useRef(leave);
	leaveRef.current = leave;
	useEffect(() => {
		if (leaving) leaveRef.current();
	}, [leaving]);

	const retry = useCallback(async () => {
		setRetrying(true);
		const settled = await autosave.flush();
		setRetrying(false);
		if (!settled) return;
		setConfirming(false);
		setLeaving(true);
	}, [autosave]);

	/**
	 * **Empties the queue of edits chosen to be discarded.** Leaving without emptying would have the
	 * unmount's final flush write them again, and a successful write would revive the edits the person
	 * chose to discard.
	 */
	const discard = useCallback(() => {
		autosave.discard();
		setConfirming(false);
		setLeaving(true);
	}, [autosave]);

	const stay = useCallback(() => setConfirming(false), []);

	return {
		confirming,
		retrying,
		leaving,
		requestLeave,
		block,
		retry,
		discard,
		stay,
	};
}

const editor = StyleSheet.create({
	/**
	 * The wrapping box must take part in layout: a `ScrollView` has `flexGrow: 1` itself but only gets
	 * the remaining height from a parent that does (PageEnter has no default style).
	 */
	fill: { flex: 1 },
	content: {
		gap: space.xl,
		padding: screenPadding,
		paddingBottom: space["3xl"],
	},
	center: { paddingHorizontal: screenPadding, paddingTop: space.xl },
	/**
	 * The save status and the test action share **one row**. The rule is that the status shrinks, not
	 * the action: if `Story test` leaves the screen, the action is as good as missing.
	 */
	toolbar: {
		gap: space.xs,
		paddingHorizontal: screenPadding,
		paddingVertical: space.xs,
	},
	toolbarRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.sm,
		justifyContent: "space-between",
	},
	autosave: {
		alignItems: "center",
		flex: 1,
		flexDirection: "row",
		gap: space.sm,
		minWidth: 0,
	},
	autosaveText: { flex: 1, minWidth: 0 },
	discard: { alignItems: "center", paddingBottom: space.md },
});
