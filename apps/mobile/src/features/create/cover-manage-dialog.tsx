import { space } from "@rowcat/design";
import type { CreatorWork } from "@rowcat/domain";
import {
	removeStoryCoverMutationOptions,
	setStoryCoverMutationOptions,
} from "@rowcat/query";
import { Button, Dialog, DialogActions, Notice, Text } from "@rowcat/ui-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import {
	type PickedImage,
	pickImageFromLibrary,
	readPickedImage,
} from "../../lib/image-picker.ts";
import { StoryCover } from "../story/story-cover.tsx";
import {
	COVER_INPUT_HINT,
	checkPickedCover,
	coverErrorMessage,
	coverIssueMessage,
} from "./cover-file.ts";

/**
 * Cover management: upload, replace and delete in one dialog (pair of the web
 * `cover-manage-dialog.tsx`).
 *
 * - One dialog because the user does one thing: decide this work's picture. Upload and replace
 *   are the same `PUT`, and delete must stay in the same context so what is being removed stays
 *   visible.
 * - Opens without a source draft: the cover belongs to the published work, not the draft. Tying
 *   it to `editableDraftId` would lock out creators who published from another device or deleted
 *   the draft. The web made the same call, which is why the action sits on the `Published` row.
 * - A picked image is not yet the cover. The picker's `file://` URI is a temporary value for a
 *   file on this device, while `work.coverUrl` is the server-normalized address (content hash
 *   included). So the temporary URI stays out of the query cache (it would mix a device-only value
 *   into server state), is not planted on the work object (other screens would read it as the
 *   cover), and is dropped after success.
 * - Failure never touches the current cover: the drawn cover always comes from `work.coverUrl`,
 *   so nothing derives from mutation failure state. The server keeps the same order (normalize
 *   before DB).
 * - Cancelling is not a failure: closing the picker returns `null` (`lib/image-picker.ts`) and
 *   nothing changes; drawing it as an error makes people doubt their device.
 */
export function CoverManageDialog({
	work,
	onClose,
}: {
	work: CreatorWork;
	onClose: () => void;
}) {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const [picked, setPicked] = useState<PickedImage | null>(null);
	// Facts known at pick time, reported before anything is sent.
	const [issue, setIssue] = useState<string | null>(null);

	const upload = useMutation(
		setStoryCoverMutationOptions(client, queryClient, work.id),
	);
	const remove = useMutation(
		removeStoryCoverMutationOptions(client, queryClient, work.id),
	);
	const busy = upload.isPending || remove.isPending;

	const choose = async (): Promise<void> => {
		setIssue(null);
		upload.reset();
		remove.reset();
		const next = await pickImageFromLibrary();
		// Closing without picking is a normal action; change nothing.
		if (!next) return;
		const problem = checkPickedCover(next);
		if (problem) {
			setPicked(null);
			setIssue(coverIssueMessage(problem));
			return;
		}
		setPicked(next);
	};

	const save = async (): Promise<void> => {
		if (!picked) return;
		const blob = await readPickedImage(picked);
		await upload.mutateAsync(blob).then(
			// The authoritative URL has arrived; do not keep the temporary value alongside it.
			() => setPicked(null),
			() => undefined,
		);
	};

	const failure =
		issue ??
		(upload.error ? coverErrorMessage(upload.error) : null) ??
		(remove.error ? coverErrorMessage(remove.error) : null);

	return (
		<Dialog
			title="Cover"
			description={`Sets the cover of ${work.title}.`}
			open
			onOpenChange={(next) => {
				if (!next && !busy) onClose();
			}}
			placement="adaptive"
			scroll
		>
			<View style={styles.root}>
				{/**
				 * Current cover, or a preview of the picked image if any. Both values share one slot so
				 * what changes into what is visible at a glance.
				 */}
				<View style={styles.preview}>
					<StoryCover
						uri={picked?.uri ?? work.coverUrl}
						title={work.title}
						style={{ aspectRatio: 3 / 4, borderRadius: 12 }}
						placeholderSize="xl"
					/>
				</View>

				<Text variant="caption" tone="muted-foreground">
					{COVER_INPUT_HINT}
				</Text>

				{failure ? <Notice tone="destructive" message={failure} /> : null}

				<DialogActions>
					<Button
						label={picked ? "Choose again" : "Choose image"}
						variant="outline"
						fullWidth
						disabled={busy}
						onPress={() => void choose()}
						style={styles.action}
					/>
					{/**
					 * `Upload`, not `Save`: this sends bytes to the server (the web uses the same word)
					 * rather than autosaving a draft, and the differing word expresses that.
					 */}
					<Button
						label={work.coverUrl ? "Replace cover" : "Upload cover"}
						fullWidth
						busy={upload.isPending}
						disabled={busy || picked === null}
						onPress={() => void save()}
						style={styles.action}
					/>
				</DialogActions>

				{/**
				 * Delete is drawn only when a cover exists: deleting nothing does nothing, and the picture
				 * already says there is no cover. No extra confirm dialog: it is reversible (upload again),
				 * and stacking a dialog on this surface blurs Android's back target.
				 */}
				{work.coverUrl ? (
					<Button
						label="Delete cover"
						variant="ghost"
						fullWidth
						busy={remove.isPending}
						disabled={busy}
						onPress={() => {
							setIssue(null);
							setPicked(null);
							remove.mutate();
						}}
					/>
				) : null}
			</View>
		</Dialog>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	// Visible on narrow screens without taking the whole dialog.
	preview: { alignSelf: "center", width: 180 },
	// Fills the line in a vertically stacked action row, standing in for the horizontal row's `flex:
	// 1`.
	action: { alignSelf: "stretch" },
});
