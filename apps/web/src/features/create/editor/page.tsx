import type { StoryDraft } from "@rowcat/authoring";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import type { Orientation } from "@rowcat/domain";
import { isAdultEligible } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { LayoutGroup } from "motion/react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { StartPlaytestButton } from "#/features/playtest/start-playtest-button.tsx";
import { RuntimeSection } from "#/features/runtime-studio/runtime-section.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { draftTitleLabel, orientationLabel } from "#/lib/i18n/vocab.ts";
import {
	useDraftLore,
	useDraftSceneImages,
	useDraftStartScenes,
	useLocalDraft,
} from "#/lib/local-authoring/hooks.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { DraftCoverField } from "../cover/field.tsx";
import { DraftEditorShell } from "../create-shell.tsx";
import { DraftEditorSkeleton } from "../create-skeleton.tsx";
import { PublishPanel } from "../publishing/publish-panel.tsx";
import { autosaveIndicatorView } from "./autosave-indicator.ts";
import {
	EditorSection,
	EditorSectionSkeleton,
	SwitchField,
	TextAreaField,
	TextField,
} from "./fields.tsx";
import { DraftLeaveGuard } from "./leave-guard.tsx";
import { DraftPreviewSection } from "./preview-section.tsx";
import { DraftRecoveryNotice } from "./recovery-notice.tsx";
import { LoreList, loreSection } from "./sections/lore-list.tsx";
import { PromptSection } from "./sections/prompt-section.tsx";
import {
	SceneImageList,
	sceneImageSection,
} from "./sections/scene-image-list.tsx";
import {
	StartSceneList,
	startSceneSection,
} from "./sections/start-scene-list.tsx";
import { TagInput } from "./tag-input.tsx";
import { useDraftActions } from "./use-actions.ts";
import {
	type DraftAutosave,
	useAutosaveState,
	useDraftAutosave,
} from "./use-autosave.ts";

/**
 * The draft editor.
 *
 * The state splits into four: scope still opening, draft loading, not found, and ready. Folding
 * them into one would make `Draft not found` flash for a few tens of milliseconds after sign-in, or
 * leave someone who opened a missing draft looking at a placeholder that never ends (a mistake
 * already made once on the chat screen).
 *
 * The legacy seven-step wizard is not reproduced. Its structure came from the screen size of that
 * era, not from the data model. What matters here is what is stored durably and where, not how many
 * steps there are. Stacking the sections vertically ends in a single scroll on narrow screens and
 * shows which sections are empty at a glance.
 */

const orientationOptions = (): { value: string; label: string }[] => [
	{ value: "none", label: translator("create")("page.orientationUnset") },
	{ value: "female", label: orientationLabel("female") },
	{ value: "male", label: orientationLabel("male") },
	{ value: "all", label: orientationLabel("all") },
];

/**
 * The save indicator. Only this text subscribes to save state, so a save re-renders these few
 * characters and not the whole editor, which would otherwise re-render three times per save
 * (pending, saving, saved).
 *
 * The state is shown as it is. Hiding `Saving` would leave the user unable to tell where their text
 * is, and a failure would go unnoticed. On failure a retry control appears next to the label, but
 * only when status is error and changes are still pending: with nothing pending there is nothing to
 * retry, and a button that does nothing looks broken. The retry calls the existing flush(), so the
 * states follow the usual path.
 *
 * What is drawn, announced and offered is decided by a pure function in autosave-indicator.ts. This
 * component only maps that result to markup, since restating the conditions here would move the
 * accessibility contract somewhere it cannot be tested without rendering.
 */
function AutosaveIndicator({ autosave }: { autosave: DraftAutosave }) {
	const { t } = useTranslation(["create", "common"]);
	const { label, announce, retryable } = autosaveIndicatorView(
		useAutosaveState(autosave),
	);

	return (
		<span className="flex items-center gap-2">
			{/*
			 * The wrapper is not a live region. This text changes several times per second while typing, so
			 * announcing the whole wrapper would make pending, saving and saved constant noise and drown out a
			 * failure. Only the failed text carries its own role="alert", so the failure is spoken at the
			 * moment a
			 * sighted user sees the red text and the retry button.
			 *
			 * The two branches get different keys on purpose. Changing only an attribute on the same node is
			 * not
			 * read as a new alert, so a second failure would be silent. With separate keys the alert node is
			 * removed and re-added, so each failure in a repeated error, saving, error cycle is announced
			 * again.
			 */}
			{announce ? (
				<span key="failure" role="alert" className="text-xs text-destructive">
					{label}
				</span>
			) : (
				<span key="status" className="text-xs text-muted-foreground">
					{label}
				</span>
			)}
			{retryable ? (
				<Button
					size="sm"
					variant="outline"
					className="h-6 px-2 text-xs"
					onClick={() => void autosave.flush()}
				>
					{t("common:actions.retry")}
				</Button>
			) : null}
		</span>
	);
}

export function DraftEditorPage() {
	const { t } = useTranslation(["create", "common"]);
	const { draftId } = useParams({ from: "/(app)/create/$draftId" });
	const state = useLocalDraft(draftId);

	/**
	 * The placeholder matches the one the route renders, so moving from the server render (and the
	 * Suspense that waits for the bundle) to this does not change the screen. Two hand-copied
	 * placeholders with the same geometry would drift apart silently.
	 */
	if (state.status === "loading")
		return (
			<DraftEditorShell>
				<DraftEditorSkeleton />
			</DraftEditorShell>
		);

	if (state.status === "missing")
		return (
			<DraftEditorShell>
				<PageEnter className="rounded-lg border p-6 text-center">
					<p className="text-sm font-medium">{t("page.thisDraftIsnTIn")}</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("page.ifYouMadeItIn")}
					</p>
					{/*
					 * Kept even though the shell already has a `Drafts` link. That link is small text above the body and
					 * easy to miss, while here the only useful next action is leaving, so the exit must be prominent.
					 */}
					<Button
						variant="outline"
						className="mt-4"
						render={<Link to="/create" />}
					>
						{t("page.backToDrafts")}
					</Button>
				</PageEnter>
			</DraftEditorShell>
		);

	return <DraftEditor draft={state.draft} />;
}

function DraftEditor({ draft }: { draft: StoryDraft }) {
	const { t } = useTranslation(["create", "common"]);
	const orientationId = useId();
	const autosave = useDraftAutosave(draft.id);
	const actions = useDraftActions(draft.id);
	const lore = useDraftLore(draft.id);
	const startScenes = useDraftStartScenes(draft.id);
	const sceneImages = useDraftSceneImages(draft.id);

	/**
	 * Whether the viewer may turn on the adult flag. It is the same axis as the server's publication
	 * gate: requireAdultEligibility in apps/api/src/services/story/publication.ts applies the same
	 * isAdultVerified check. The client only blocks a value the server would reject anyway, and the
	 * final decision stays on the server, so loosening this line still leaves publication blocked. The
	 * route already guarantees a viewer (beforeLoad). If the viewer is missing, the check fails
	 * closed, because showing the switch on for a frame to an ineligible person is worse.
	 */
	const viewer = useQuery(viewerQueryOptions(getRowCatClient())).data ?? null;
	const adultEligible = isAdultEligible(viewer);

	return (
		<DraftEditorShell>
			{/*
			 * The reveal animation wraps only the outermost layer, never the editor body. Presence or key
			 * wrappers inside it would remount the editor whenever the route search value changes, losing a
			 * pending save and the caret position. The wrapper mounts only after the draft is ready (the
			 * placeholder ends first), so the motion plays once, on the switch from placeholder to editor.
			 */}
			<PageEnter>
				{/*
				 * The dialog that blocks leaving lives inside the editor. The hook's queue is tied to this
				 * component's lifetime, so this is also where it is known that the queue is about to disappear.
				 */}
				<DraftLeaveGuard autosave={autosave} />
				{/*
				 * The notice about a retained edit sits above the header. The lost value may belong to any group (a
				 * title or a prompt), and inside a specific section the notice would appear in the wrong place. It
				 * does not block editing: the notice is one line, and the dialog opens only on press. An overlay
				 * that
				 * took over when sync finishes would be an interruption rather than a notice.
				 */}
				<DraftRecoveryNotice draft={draft} />
				<header className="mb-5 flex flex-wrap items-center justify-between gap-3">
					{/*
					 * Back navigation is not in this line. The shell provides it as a named link above the body
					 * (DraftEditorShell). A back-arrow icon here would require guessing the destination, and its
					 * position
					 * would be taken from the draft title.
					 */}
					<div className="flex min-w-0 items-center gap-2">
						<h1 className="truncate text-xl font-black tracking-tight sm:text-2xl">
							{draftTitleLabel(draft)}
						</h1>
						{draft.publishedStoryId && (
							<Badge variant="secondary">{t("page.published")}</Badge>
						)}
					</div>
					{/*
					 * Writing-assist actions and the save indicator share this line. Publish is not here: it has its
					 * own
					 * section because it is the only action that sends anything to the server, so its position and
					 * weight
					 * differ. `Story test` sends nothing to the server. Placing it next to publish would blur that fact
					 * and make people wonder whether the test must run before publishing.
					 */}
					<div className="flex items-center gap-3">
						<AutosaveIndicator autosave={autosave} />
						<StartPlaytestButton draftId={draft.id} autosave={autosave} />
					</div>
				</header>

				{/*
				 * The sections form one group. Each section re-measures only when its own structure changes
				 * (layoutDependency), but when one grows, the sections below must flow too, and they cannot know it
				 * since their own structure is unchanged. The group shares the signal: if one wakes, all wake.
				 * Without it, adding a person moves only that section and the rest jump.
				 */}
				<LayoutGroup>
					<div className="flex flex-col gap-4">
						<EditorSection
							title={t("page.basics")}
							description={t("page.thisIsWhatShowsIn")}
							/**
							 * Chips appearing and disappearing is this section's only structural change, so the tag
							 * count is the layout dependency.
							 */
							layoutDependency={draft.tags.length}
						>
							{/*
							 * The cover is the first cell of this section because it is the first thing visible on a gallery
							 * card. If the section is meant to show the gallery-visible part, the cover belongs on the same
							 * screen, so the creator can judge how the card will look in one place.
							 */}
							<DraftCoverField draft={draft} />
							<TextField
								label={t("page.title")}
								value={draft.title}
								max={STORY_PUBLISH_LIMITS.title}
								placeholder={t("page.theNightLibrary")}
								onChange={(title) => autosave.patchDraft({ title })}
							/>
							<TextField
								label={t("page.oneLineIntro")}
								value={draft.tagline}
								max={STORY_PUBLISH_LIMITS.tagline}
								hint={t("page.sentAlongWhenAConversation")}
								onChange={(tagline) => autosave.patchDraft({ tagline })}
							/>
							<TextAreaField
								label={t("page.description")}
								value={draft.description}
								max={STORY_PUBLISH_LIMITS.description}
								onChange={(description) => autosave.patchDraft({ description })}
							/>
							<TagInput
								value={draft.tags}
								onChange={(tags) => autosave.patchDraft({ tags })}
							/>

							<div className="flex flex-col gap-1.5">
								{/*
								 * The label points to the trigger. This used to be an unpaired `<Label>`, with the name held
								 * separately in the trigger's aria-label. Two sources for the same word meant one got fixed and the
								 * other drifted, and clicking the visible text did nothing.
								 */}
								<Label htmlFor={orientationId}>{t("page.orientation")}</Label>
								<Select
									value={draft.orientation ?? "none"}
									items={orientationOptions()}
									onValueChange={(next) => {
										if (next === null) return;
										/**
										 * The domain uses null for unspecified. Select requires a string value, so the string
										 * form is used only at this point.
										 */
										const orientation =
											next === "none" ? null : (next as Orientation);
										if (orientation !== draft.orientation)
											autosave.patchDraft({ orientation });
									}}
								>
									<SelectTrigger id={orientationId} size="sm">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{orientationOptions().map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{/*
							 * Without eligibility the switch cannot be turned on. The server would reject the value at
							 * publication anyway, so allowing it would block only the publish button after the whole draft is
							 * written. A draft that is already on can still be turned off: if verification lapsed or it was
							 * turned on from another device, locking the switch would leave the draft permanently
							 * unpublishable,
							 * with no way to remove the adult label.
							 */}
							<SwitchField
								label={t("page.adult")}
								checked={draft.adult}
								disabled={!adultEligible && !draft.adult}
								hint={
									draft.adult && !adultEligible
										? t("page.withoutAdultVerificationThisCan")
										: t("page.onlyMembersWhoCompletedAdult2")
								}
								disabledReason={t("page.onlyMembersWhoCompletedAdult")}
								onChange={(adult) => autosave.patchDraft({ adult })}
							/>
							<SwitchField
								label={t("page.protectPrompt")}
								checked={draft.promptProtected}
								hint={t("page.marksTheCreativePromptAs")}
								onChange={(promptProtected) =>
									autosave.patchDraft({ promptProtected })
								}
							/>
						</EditorSection>

						{/*
						 * The preview comes directly after `Basics`. That section's description says
						 * `This is what shows in the gallery`, and the preview is the result of that sentence. Keeping the editing
						 * controls and their result far apart would make the link between them hard to see.
						 */}
						<DraftPreviewSection draft={draft} viewer={viewer} />

						<EditorSection
							title={t("page.prompt")}
							description={t("page.theFullStorySetupThe")}
							/**
							 * This section's structure does not change, so the dependency is fixed. A text box growing
							 * with its content is typing, not relayout. Passing its height as a signal would make the
							 * sections below slide down 0.5 seconds after typing stops. When siblings really move, this
							 * section still flows, through LayoutGroup.
							 */
							layoutDependency={false}
						>
							{/*
							 * This field has its own component for two reasons, both about the owner of the value rather than
							 * geometry. Two places draw the same body (inline and fullscreen), so the owner must sit one level
							 * higher. And if the limit lived in TextAreaField, the description, lore and scene bodies would
							 * inherit the prompt's geometry. This field has no character count: the body flows into the
							 * world-setting slot at publication (buildStoryPublication) with no limit there, and a count would
							 * read as a limit.
							 */}
							{/*
							 * On a draft with the runtime enabled, this field turns into a notice instead of an editor, and it
							 * does not open before the project is read (prompt-section.tsx). The owner of the value is still
							 * autosave.
							 */}
							<PromptSection
								draftId={draft.id}
								value={draft.prompt}
								placeholder={t("page.writeTheWorldCharactersCounterpart")}
								hint={t("page.thisTextIsSentAs")}
								onChange={(prompt) => autosave.patchDraft({ prompt })}
							/>
						</EditorSection>

						{/*
						 * Child lists show a placeholder until the first result arrives. An empty list would flash "no
						 * items
						 * yet" and read as if the just-created item were lost. When the runtime is enabled, these three
						 * lists
						 * and the prompt above show a notice instead of editing, because these four values are read only
						 * when
						 * a play creates a conversation room, and runtime play creates none. The decision goes through one
						 * shared point (runtime-lock.tsx), and the gate sits inside each list. Splitting it at the editor
						 * level
						 * would subscribe the whole editor to the runtime record and re-render everything on each change to
						 * that value.
						 */}
						{lore.loading ? (
							<EditorSectionSkeleton {...loreSection()} />
						) : (
							<LoreList
								draftId={draft.id}
								lore={lore.items}
								autosave={autosave}
								actions={actions}
							/>
						)}

						{startScenes.loading ? (
							<EditorSectionSkeleton {...startSceneSection()} />
						) : (
							<StartSceneList
								draftId={draft.id}
								scenes={startScenes.items}
								defaultStartSceneId={draft.defaultStartSceneId}
								autosave={autosave}
								actions={actions}
							/>
						)}

						{/*
						 * The situation images come after the start scene. The two above feed the prompt, while this one is
						 * drawn on screen. Authoring order matches the section order: decide what to write, then decide how
						 * it
						 * appears.
						 */}
						{sceneImages.loading ? (
							<EditorSectionSkeleton {...sceneImageSection()} />
						) : (
							<SceneImageList
								draftId={draft.id}
								images={sceneImages.items}
								autosave={autosave}
								actions={actions}
							/>
						)}

						{/*
						 * The runtime section sits just before publication. The sections above describe the work itself and
						 * this is an optional extension on top, so the order states that the work is complete without it.
						 * Publication stays last, because anything below it would make publication read as an intermediate
						 * step.
						 *
						 * Only the draft id is passed. This section reads the runtime record through its own subscription,
						 * and holding the whole draft would re-render it on every autosave write.
						 */}
						<RuntimeSection draftId={draft.id} />

						{/*
						 * Only the three values the section uses are passed, not the whole draft. Publishing reloads from
						 * storage anyway (publishDraft). Holding the draft object would re-render this layout-animated
						 * section on every autosave write, and re-measure its geometry each time.
						 */}
						<PublishPanel
							draftId={draft.id}
							publishedStoryId={draft.publishedStoryId}
							visibility={draft.visibility}
							autosave={autosave}
						/>
					</div>
				</LayoutGroup>
			</PageEnter>
		</DraftEditorShell>
	);
}
