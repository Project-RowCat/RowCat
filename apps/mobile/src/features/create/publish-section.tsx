import type { PublicationIssue } from "@rowcat/authoring";
import { space } from "@rowcat/design";
import { publishStoryMutationOptions } from "@rowcat/query";
import {
	AlertDialog,
	Button,
	Notice,
	Select,
	SelectOption,
	Text,
} from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { readStagedDraftCover } from "../../lib/draft-cover-files.ts";
import {
	useAuthoringScope,
	useDraftCoverScope,
} from "../../lib/local-data/scope.tsx";
import { SECTION } from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";
import {
	PUBLISH_BUTTON_LABEL,
	PUBLISH_CONFIRM,
	PUBLISH_FLUSH_FAILED,
	PUBLISH_INVALID_HEADING,
	PUBLISH_PENDING_LABEL,
	PUBLISH_VISIBILITIES,
	PUBLISH_VISIBILITY_HINT,
	PUBLISH_VISIBILITY_LABEL,
	type PublishVisibility,
	publishFailureMessage,
} from "./publish-copy.ts";
import { publishDraft } from "./publish-draft.ts";

/**
 * Publish: the only write on this screen that goes to the server.
 *
 * The order is not in this component. `publishDraft` owns it (flush autosave → snapshot → assemble
 * and validate → ownership → server → ownership → record on the draft → ownership → navigate). This
 * component only turns the result into copy. Keeping an irreversible sequence in a component means
 * it cannot be checked without rendering, and one wrong step publishes the manuscript to another
 * account.
 *
 * ## The cache policy belongs to `@rowcat/query`
 *
 * The callbacks of `publishStoryMutationOptions` are not overridden. That policy already does four
 * things: fill the detail cell, invalidate the gallery, invalidate `Published`, and invalidate
 * analytics. Spreading `onSuccess` on top silently drops all four (the account screen chains the
 * policy's callbacks for the same reason).
 *
 * ## First publish and republish are not separated
 *
 * The server publish is idempotent per (member, draft), so a first and a later publish are one
 * request. If the screen judged "is this the first?", that judgment would be wrong after a
 * lost-response retry, and that is how duplicate works get created.
 *
 * ## Only two visibility choices
 *
 * `archived` is not a publish destination but a lifecycle transition of an already-published work,
 * and that operation belongs to the `Published` panel. Even if a draft holds that value (migration,
 * another device), the screen folds it to private: an empty selection would leave the user not
 * knowing what they are about to publish.
 */
export function PublishSection({
	draftId,
	visibility,
	onVisibility,
	flushAutosave,
}: {
	draftId: string;
	/** Folded from the stored draft value (`toPublishVisibility`). */
	visibility: PublishVisibility;
	onVisibility: (visibility: PublishVisibility) => void;
	/** Writes pending autosave now. `false` means do not publish. */
	flushAutosave: () => Promise<boolean>;
}) {
	const router = useRouter();
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const { ensureStore, ownsStore } = useAuthoringScope();
	/**
	 * The cover store is opened separately, not added to the authoring store (`AuthoringStore`). That
	 * port is a shared contract that the web and this app both fill, while a staged cover is temporary
	 * storage this device holds only until publish (`lib/local-data/draft-cover-store.ts`).
	 */
	const { store: coverStore, ownsStore: ownsCoverStore } = useDraftCoverScope();
	const publishMutation = useMutation(
		publishStoryMutationOptions(client, queryClient),
	);

	const lock = useRef({ current: false });
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [issues, setIssues] = useState<PublicationIssue[]>([]);
	const [confirming, setConfirming] = useState(false);
	/** Without a confirm entry, publishing happens immediately (`PUBLISH_CONFIRM`). */
	const confirm = PUBLISH_CONFIRM[visibility];

	const run = useCallback(async () => {
		setBusy(true);
		setFailure(null);
		setIssues([]);
		const outcome = await publishDraft({
			draftId,
			lock: lock.current,
			flushAutosave,
			ensureStore,
			stillOwnsStore: ownsStore,
			/**
			 * The server write and its cache policy belong to the shared mutation. Calling
			 * `client.stories.publish` directly here would drop all four parts of that policy.
			 */
			publish: (request) => publishMutation.mutateAsync(request),
			/**
			 * Uploads the staged cover to the work. With nothing staged it makes no request, so a publish
			 * without a cover stays one request.
			 *
			 * Reading the bytes takes the same path as `readPickedImage`, and the conversion lives in the
			 * lib, not the screen (`readStagedDraftCover`). The static scan blocks `fetch` in feature code.
			 *
			 * The device copy is deleted only after success. On failure it must remain, so the picked image
			 * is not lost and can be uploaded again from `Manage cover`.
			 */
			uploadStagedCover: async (storyId) => {
				const store = coverStore;
				if (!store || !ownsCoverStore(store)) return false;
				const staged = await store.get(draftId);
				if (!staged) return true;
				await client.stories.setCover(
					storyId,
					await readStagedDraftCover(staged),
				);
				await store.clear(draftId);
				return true;
			},
			navigate: async (storyId) => {
				router.replace(`/stories/${encodeURIComponent(storyId)}`);
			},
		});
		setBusy(false);
		setConfirming(false);

		switch (outcome.status) {
			case "published":
			case "busy":
			/**
			 * **The account changed; this is not an error.** Nothing is wrong with the draft or the server;
			 * it is the result of the user's own action (switching accounts). Drawing it as `Couldn't publish`
			 * would make a sound manuscript look suspect.
			 */
			case "stale":
				return;
			case "unsaved":
				setFailure(PUBLISH_FLUSH_FAILED);
				return;
			case "invalid":
				setIssues(outcome.issues);
				return;
			case "failed":
				setFailure(publishFailureMessage(outcome.reason));
				return;
		}
	}, [
		draftId,
		flushAutosave,
		ensureStore,
		ownsStore,
		publishMutation,
		router,
		client,
		coverStore,
		ownsCoverStore,
	]);

	return (
		<EditorSection title={SECTION.publish.title}>
			{/**
			 * Visibility is a value picked from a trigger, the same vessel as the web's form (`apps/web`'s `publish-panel.tsx`).
			 *
			 * ⚠️ This was once an expanded radio list, on the grounds that the choices must be read before pressing.
			 * That concern is about where the explanation sits, not the vessel. The web shows one trigger and writes
			 * the chosen value's explanation as one line below it. This screen does the same, so nothing goes unread,
			 * and the screen does not grow with the number of choices.
			 */}
			<Select
				label={SECTION.publish.title}
				value={PUBLISH_VISIBILITY_LABEL[visibility]}
			>
				{PUBLISH_VISIBILITIES.map((value) => (
					<SelectOption
						key={value}
						label={PUBLISH_VISIBILITY_LABEL[value]}
						selected={value === visibility}
						onSelect={() => onVisibility(value)}
					/>
				))}
			</Select>
			{/** The chosen value's explanation, in the same place as the web's `visibilityHintId` paragraph. */}
			<Text variant="caption" tone="muted-foreground">
				{PUBLISH_VISIBILITY_HINT[visibility]}
			</Text>

			{issues.length > 0 ? (
				<View style={publish.issues}>
					<Text variant="label" weight="semibold" tone="destructive">
						{PUBLISH_INVALID_HEADING}
					</Text>
					{issues.map((issue) => (
						<Text
							key={`${issue.field}:${issue.code}`}
							variant="caption"
							tone="destructive"
						>
							{issue.message}
						</Text>
					))}
				</View>
			) : null}

			{failure ? <Notice message={failure} tone="destructive" /> : null}

			<Button
				label={busy ? PUBLISH_PENDING_LABEL : PUBLISH_BUTTON_LABEL[visibility]}
				busy={busy}
				fullWidth
				onPress={() => {
					/**
					 * Only publishes that become reachable from outside require confirmation; the pure table
					 * `PUBLISH_CONFIRM` decides which. Writing `=== "public"` here would let a new state pass
					 * without confirmation silently when the vocabulary grows.
					 */
					if (confirm) setConfirming(true);
					else void run();
				}}
			/>

			{confirm ? (
				<AlertDialog
					open={confirming}
					title={confirm.title}
					description={confirm.description}
					confirmLabel={confirm.confirmLabel}
					busy={busy}
					onConfirm={() => void run()}
					onCancel={() => setConfirming(false)}
				/>
			) : null}
		</EditorSection>
	);
}

const publish = StyleSheet.create({
	issues: { gap: space.px },
});
