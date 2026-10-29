import type { PublicationIssue } from "@rowcat/authoring";
import type { StoryRuntimeDiagnosticDto } from "@rowcat/contracts";
import type { StoryVisibility } from "@rowcat/domain";
import { applyStoryCover, publishStoryMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Spinner } from "@rowcat/ui-web/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { memo, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";
import { visibilityLabel } from "#/lib/i18n/vocab.ts";
import { useDraftCoverScope } from "#/lib/local-authoring/draft-cover-hooks.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { EditorSection } from "../editor/fields.tsx";
import type { DraftAutosave } from "../editor/use-autosave.ts";
import { type PublishFailureReason, publishDraft } from "./publish-draft.ts";
import {
	PUBLISH_VISIBILITIES,
	type PublishVisibility,
	publishButtonLabel,
	publishVisibilityHint,
	toPublishVisibility,
} from "./visibility.ts";

/**
 * The publish action, the only one on this screen that sends to the server. The component owns
 * intent and display: save the latest values, show progress, map failures to copy. `publishDraft`
 * owns the order. Visibility offers two choices (`Public`, `Private`). Choosing was removed while public
 * publishing was under a temporary policy, since showing options that cannot be used reveals the
 * block only after a press. It returned when the policy ended. `Archived` is not offered here. It changes
 * the state of an already published work, not the destination of a publish, so it lives on the row.
 * No copy implies review, such as `review requested` or `awaiting approval`. There is no pre-review, so such copy is false
 * and would make the creator leave believing the work is not yet live. The chosen value is saved on
 * the draft as the next publish default. The server always makes the final decision.
 */

const failureMessage = (reason: PublishFailureReason): string => {
	const t = translator("create");
	switch (reason) {
		/**
		 * This screen cannot produce the request (only a hand-built client can), so the copy has one job:
		 * say that retrying will not help.
		 */
		case "archived_unavailable":
			return t("publishPanel.failure.archived_unavailable");
		/**
		 * The target is archived, so the user has a concrete next step, and the copy points to exactly
		 * where to fix it. Folding it into `please try again in a moment` would repeat the same rejection on every
		 * retry.
		 */
		case "story_archived":
			return t("publishPanel.failure.story_archived");
		case "adult_not_permitted":
			return t("publishPanel.failure.adult_not_permitted");
		case "origin_mismatch":
			return t("publishPanel.failure.origin_mismatch");
		/**
		 * Retrying will not fix this. The referenced image is missing on the server or belongs to another
		 * account. Re-selecting the image is the only action the user can take.
		 */
		case "scene_image_invalid":
			return t("publishPanel.failure.scene_image_invalid");
		/**
		 * Retrying will not fix this. Diagnostics come from the server and are listed below. The copy only
		 * points to where the fix belongs.
		 */
		case "runtime_invalid":
			return t("publishPanel.failure.runtime_invalid");
		/**
		 * Points to the asset list, not the code. The server does not name the failing asset, since that
		 * would act as a media-existence probe. The copy says only to review the whole list. No retry is
		 * suggested, because retrying will not fix it.
		 */
		case "runtime_asset_invalid":
			return t("publishPanel.failure.runtime_asset_invalid");
		/**
		 * Restrictions do not clear by waiting. Reasons and appeals live on the account screen. `GET
		 * /v2/me/moderation` is the source of truth. Rendering reasons here would let the same fact
		 * diverge in two places, so the copy only gives the path there.
		 */
		case "restricted":
			return t("publishPanel.failure.restricted");
		case "storage":
		case "unknown":
			return t("publishPanel.failure.generic");
	}
};

/**
 * Options. Labels come from `visibilityLabel` and values from `PUBLISH_VISIBILITIES`, the
 * values publishing can produce. Copying either into this file would leave this screen with old
 * wording when the vocabulary changes.
 */
const visibilityOptions = () =>
	PUBLISH_VISIBILITIES.map((value) => ({
		value,
		label: visibilityLabel(value),
	}));

/**
 * Takes only the draft id and publish markers, not the draft object. Publish re-reads from the
 * store (`publishDraft`), so the fields are not needed here. Passing the object would re-render
 * this section on every keystroke. `memo` only filters when props change rarely.
 */
export const PublishPanel = memo(function PublishPanel({
	draftId,
	publishedStoryId,
	visibility,
	autosave,
}: {
	draftId: string;
	publishedStoryId: string | null;
	/**
	 * Visibility saved on the draft. It is the requested value, not the published result. Only this
	 * value is passed, not the whole draft, for the same reason as `publishedStoryId`: avoid
	 * re-rendering on every keystroke.
	 */
	visibility: StoryVisibility;
	autosave: DraftAutosave;
}) {
	const { t } = useTranslation(["create", "common"]);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { ensureStore, ownsStore } = useAuthoringScope();
	/**
	 * The cover store is opened separately, not layered onto `AuthoringStore`. That port is a shared
	 * contract a later Expo client will fill. A staged cover is temporary. It is held on this web
	 * device only until publish (`lib/local-authoring/draft-cover.ts`).
	 */
	const { ensureStore: ensureCoverStore } = useDraftCoverScope();
	/**
	 * Network results and server cache policy belong to Query (`@rowcat/query`). Drafts never enter
	 * that cache; IndexedDB is their source of truth.
	 */
	const publishMutation = useMutation(
		publishStoryMutationOptions(getRowCatClient(), queryClient),
	);

	/** Synchronous lock against same-tick double clicks. `setState` is too late for this. */
	const publishingRef = useRef(false);
	/**
	 * Normalizes to a drawable value. The draft field can hold all three vocabulary values, and a
	 * transfer or another device can deliver `archived`. Drawing an empty selection would hide what
	 * the user is about to publish (`publish-visibility.ts`).
	 */
	const selected = toPublishVisibility(visibility);
	const visibilityId = useId();
	const visibilityHintId = `${visibilityId}-hint`;
	const issuesId = useId();
	const [pending, setPending] = useState(false);
	const [issues, setIssues] = useState<PublicationIssue[]>([]);
	const [failure, setFailure] = useState<PublishFailureReason | null>(null);
	/**
	 * Runtime diagnostics from the server, never invented. Without them only the generic message is
	 * drawn. Filling the list with guesses would send the creator to fix lines that do not exist.
	 */
	const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<
		StoryRuntimeDiagnosticDto[]
	>([]);

	const onPublish = async () => {
		if (publishingRef.current) return;
		setPending(true);
		setIssues([]);
		setFailure(null);
		setRuntimeDiagnostics([]);
		try {
			/**
			 * Flush pending autosave first. Publish re-reads the store, so text still inside the debounce
			 * window would be published without that last edit. If the flush fails, stop here. Continuing
			 * would publish a snapshot different from what the user sees, and the difference would surface
			 * only after success, leaving republishing as the only fix.
			 */
			if (!(await autosave.flush())) {
				setFailure("storage");
				return;
			}

			const outcome = await publishDraft({
				draftId,
				lock: publishingRef,
				ensureStore,
				stillOwnsStore: ownsStore,
				publish: (request) => publishMutation.mutateAsync(request),
				navigate: (storyId) =>
					navigate({ to: "/stories/$storyId", params: { storyId } }),
				/**
				 * Uploads the cover chosen in the editor to the new work. No request is made when there is no
				 * staged cover, so publishing without a cover stays one request. The only rule here: delete the
				 * device copy after success. On failure it stays, so the user can re-upload from `Manage cover`
				 * without losing the image. Errors propagate. `publishDraft` is the one place that swallows
				 * them; swallowing here too would log twice.
				 */
				uploadStagedCover: async (storyId) => {
					const store = await ensureCoverStore();
					if (!store) return;
					const staged = await store.get(draftId);
					if (!staged) return;
					const story = await getRowCatClient().stories.setCover(
						storyId,
						staged.blob,
					);
					/**
					 * Cache policy is not repeated here. The detail entry just seeded from the publish response
					 * still has `coverUrl` null, since the cover uploaded afterward. Skipping this update would
					 * show the arriving screen a work without its cover.
					 */
					applyStoryCover(queryClient, story);
					await store.remove(draftId);
				},
			});

			if (outcome.status === "invalid") setIssues(outcome.issues);
			if (outcome.status === "failed") {
				setFailure(outcome.reason);
				setRuntimeDiagnostics(outcome.runtime?.diagnostics ?? []);
			}
			/**
			 * `stale` shows no message. The user switched accounts during the publish, and the screen has
			 * already changed a lot. Showing `Couldn't publish` would add an error unrelated to what the user just
			 * did. Signing back in and pressing again lets server idempotency recover the work.
			 */
		} finally {
			setPending(false);
		}
	};

	return (
		<EditorSection
			title={t("publishPanel.publish")}
			description={t("publishPanel.uploadsToTheServerYou")}
			/**
			 * This section's structure changes only on publish: the issue list and failure copy appear and
			 * disappear. Those inputs set the section's height, so they form the layout dependency. The
			 * visibility hint swaps one line and changes no layout.
			 */
			layoutDependency={`${publishedStoryId ?? ""}|${issues.length}|${failure ?? ""}`}
		>
			{/*
			 * Visibility is saved on the draft, not held in component state. Component state would reset when
			 * the
			 * user leaves and returns, and the lost choice would show only in the publish button's label.
			 * Saving through the same autosave path as other fields also syncs it for free.
			 */}
			<div className="flex flex-col gap-1.5">
				{/* The label is bound to the trigger, so the accessible name comes from one source. */}
				<Label htmlFor={visibilityId}>{t("publishPanel.visibility")}</Label>
				<Select
					value={selected}
					items={visibilityOptions()}
					onValueChange={(next) => {
						if (next === null) return;
						const visibility = next as PublishVisibility;
						if (visibility !== selected) autosave.patchDraft({ visibility });
					}}
				>
					<SelectTrigger
						id={visibilityId}
						size="sm"
						aria-describedby={visibilityHintId}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{visibilityOptions().map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{/*
				 * Describes the result, not the name. `Public`/`Private` already say what was chosen.
				 * This line answers who can see the work after choosing. It does not imply review, since there is
				 * no
				 * pre-review.
				 */}
				{/*
				 * This sentence explains what the selected value means, so it is tied to the control.
				 * Placed beside the control alone, it would not be read when focus reaches the trigger.
				 */}
				<p id={visibilityHintId} className="text-xs text-muted-foreground">
					{publishVisibilityHint(selected)}
				</p>
			</div>
			{publishedStoryId && (
				<p className="text-sm text-muted-foreground">
					<Trans
						t={t}
						i18nKey="publishPanel.alreadyPublished"
						components={{
							link: (
								<Link
									to="/stories/$storyId"
									params={{ storyId: publishedStoryId }}
									className="font-medium text-foreground underline underline-offset-4"
								/>
							),
						}}
					/>
				</p>
			)}

			{issues.length > 0 && (
				/*
				 * The issue list appears only after a press, so it must be announced. It is the only place on
				 * this screen that says publishing is blocked (the button stays put), and the broken field is
				 * often off-screen above. Uses `alert`, not `status`, because it reports the rejection of the
				 * user's own action. It appears once per submit, so interrupting the reader is not noise. The
				 * server failure (`output`) is already a live region. The silent validation list was the gap.
				 */
				<div
					id={issuesId}
					role="alert"
					className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
				>
					<p className="mb-1.5 text-sm font-medium text-destructive">
						{t("publishPanel.someThingsNeedFixingBefore")}
					</p>
					{/* Says which field blocked publishing and why. A bare `Publish failed` cannot be acted on. */}
					<ul className="flex flex-col gap-1 text-sm text-muted-foreground">
						{issues.map((issue) => (
							<li key={`${issue.field}:${issue.code}`}>{issue.message}</li>
						))}
					</ul>
				</div>
			)}

			{failure && (
				<output className="text-sm text-destructive">
					{failureMessage(failure)}
				</output>
			)}
			{/*
			 * Runtime diagnostics, in the same shape as the studio's `Problems` (path, line, message).
			 *
			 * They are rendered here because publishing happens outside the studio. The server
			 * compiles, so code that passed the editor's markers can still be blocked here (policy
			 * checks, entry-point shape, module resolution). A bare `check the studio again` would leave
			 * the creator on a screen with no indication of what to fix.
			 */}
			{runtimeDiagnostics.length > 0 && (
				<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
					{runtimeDiagnostics.map((diagnostic) => (
						<li
							key={`${diagnostic.path ?? ""}:${diagnostic.line ?? 0}:${diagnostic.code}`}
						>
							<span className="font-mono">
								{diagnostic.path ?? t("publishPanel.runtime")}
								{diagnostic.line === undefined ? "" : `:${diagnostic.line}`}
							</span>{" "}
							{diagnostic.message}
						</li>
					))}
				</ul>
			)}

			<div>
				<Button
					size="lg"
					className="w-full sm:w-auto sm:px-6"
					/*
					 * Binds the blocking reason to the button. The list is read aloud once, when it appears. A
					 * creator who goes back to fix issues and returns has already passed that reading, so the same
					 * facts must be announced again when focus returns.
					 */
					aria-describedby={issues.length > 0 ? issuesId : undefined}
					disabled={pending}
					onClick={() => {
						void onPublish();
					}}
				>
					<AnimatedIconSwap stateKey={pending ? "pending" : "idle"}>
						{pending ? <Spinner /> : <Upload aria-hidden="true" />}
					</AnimatedIconSwap>
					{pending
						? t("publishPanel.publishing")
						: publishedStoryId
							? t("publishPanel.publishAgain")
							: publishButtonLabel(selected)}
				</Button>
			</div>
		</EditorSection>
	);
});
