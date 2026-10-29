import { space } from "@rowcat/design";
import { canInteract, type Viewer } from "@rowcat/domain";
import {
	deleteAvatarMutationOptions,
	publicProfileQueryOptions,
	uploadAvatarMutationOptions,
} from "@rowcat/query";
import { Avatar, Button, Text } from "@rowcat/ui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import {
	type CroppedImage,
	type CropSourceImage,
	measureImage,
} from "../../lib/image-crop.ts";
import {
	pickImageFromLibrary,
	readPickedImage,
} from "../../lib/image-picker.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import { restrictionNote } from "./account-copy.ts";
import { AvatarCropDialog } from "./avatar-crop-dialog.tsx";
import {
	AVATAR_CROP_FAILED,
	AVATAR_INPUT_HINT,
	AVATAR_READ_FAILED,
	avatarErrorMessage,
	avatarIssueMessage,
	avatarIssueOpensCrop,
	checkPickedAvatar,
} from "./avatar-file.ts";

/**
 * Profile photo field; native counterpart of web `avatar-field.tsx`.
 *
 * - The current value comes from the public profile query, as with the bio. `/me` is the hottest
 *   read in the app and does not carry this screen's values, and the source of truth stays single:
 *   the photo I see and the one others see come from the same response.
 * - The preview is not product state: the local uri is this component's temporary state and never
 *   enters the query cache; only the server response is promoted to the profile photo (what the
 *   server normalized differs from the original). A failed upload therefore drops the preview;
 *   keeping it would draw a new photo while the server holds the old one and the person leaves
 *   believing their profile changed.
 * - An over-limit photo goes to cropping rather than rejection (`AvatarCropDialog`). The fork is
 *   decided by the pure `avatarIssueOpensCrop`, same name and rule as web; photos within the limit
 *   never open it.
 * - Cancelling the system picker is the normal path and leaves no indication; drawing it as an
 *   error makes users doubt their device (`lib/image-picker.ts`).
 * - Cache updates for upload and delete (own public profile + my comment lines) belong to
 *   `@rowcat/query`; this adds only screen concerns (preview, copy). No `?cacheBust=` addresses;
 *   success returns a new address for the new media id.
 */
export function AvatarField({ viewer }: { viewer: Viewer }) {
	const queryClient = useQueryClient();
	const client = getRowCatClient();

	const profile = useQuery(publicProfileQueryOptions(client, viewer.id));
	const savedUrl = profile.data?.avatarUrl ?? null;

	const [preview, setPreview] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** Locks the window between pick, read and fire; the button's `disabled` applies only from the next render. */
	const [picking, setPicking] = useState(false);
	const pickingRef = useRef(false);

	const uploadPolicy = uploadAvatarMutationOptions(
		client,
		queryClient,
		viewer.id,
	);
	const upload = useMutation({
		/**
		 * Chain the policy's callbacks. Spreading over them would silently drop the public-profile and
		 * comment cache updates with no visible sign (same rule as web).
		 */
		...uploadPolicy,
		onError: (...args) => {
			uploadPolicy.onError?.(...args);
			/** On failure drop the preview; never draw a photo the server does not have. */
			setPreview(null);
			setError(avatarErrorMessage(args[0]));
		},
		onSuccess: (...args) => {
			uploadPolicy.onSuccess?.(...args);
			/** Release the preview; the field now draws the address the server settled (exactly what others see). */
			setPreview(null);
			setError(null);
		},
	});

	const removePolicy = deleteAvatarMutationOptions(
		client,
		queryClient,
		viewer.id,
	);
	const remove = useMutation({
		...removePolicy,
		onError: (...args) => {
			removePolicy.onError?.(...args);
			setError(avatarErrorMessage(args[0]));
		},
		onSuccess: (...args) => {
			removePolicy.onSuccess?.(...args);
			setError(null);
		},
	});

	const pending = upload.isPending || remove.isPending || picking;
	const restricted = !canInteract(viewer);
	/**
	 * Editing stays closed until the query finishes: someone who has a photo could see an empty field
	 * and press `Delete`, which really deletes (same rule as web).
	 */
	const editable = !restricted && profile.isSuccess && !pending;

	/**
	 * The image awaiting cropping. Not a preview: while set, the field still draws the current photo,
	 * and cancelling ends as if nothing happened.
	 */
	const [cropSource, setCropSource] = useState<CropSourceImage | null>(null);

	const pick = async () => {
		if (pickingRef.current) return;
		pickingRef.current = true;
		setPicking(true);
		try {
			const picked = await pickImageFromLibrary();
			/* Cancelled: nothing happened and nothing is said. */
			if (!picked) return;

			const issue = checkPickedAvatar(picked);
			if (issue && avatarIssueOpensCrop(issue)) {
				/**
				 * Crop instead of reject. The previous failure copy is cleared because this dialog opens to fix
				 * that failure; left in, it would stand behind the dialog.
				 *
				 * Use the size the picker reported: it equals the size `<Image>` draws, so the rectangle the
				 * screen computes cannot diverge from the visible picture. Measure directly only when unknown
				 * (never invent it).
				 */
				setError(null);
				try {
					const size =
						picked.width !== null && picked.height !== null
							? { width: picked.width, height: picked.height }
							: await measureImage(picked.uri);
					setCropSource({ uri: picked.uri, ...size });
				} catch {
					setError(AVATAR_CROP_FAILED);
				}
				return;
			}
			if (issue) {
				setError(avatarIssueMessage(issue));
				return;
			}
			setError(null);
			setPreview(picked.uri);

			let image: Blob;
			try {
				image = await readPickedImage(picked);
			} catch {
				/* An image whose bytes could not be read was never uploaded; drop the preview too. */
				setPreview(null);
				setError(AVATAR_READ_FAILED);
				return;
			}
			upload.mutate(image);
		} finally {
			pickingRef.current = false;
			setPicking(false);
		}
	};

	/**
	 * The cropped result stands where the chosen picture would: hang the preview and upload at once.
	 * The preview address must be the cropped file's; hanging the original would make the uploaded
	 * picture differ from the drawn one, visible only after the server answers.
	 */
	const confirmCrop = (image: CroppedImage) => {
		setCropSource(null);
		setError(null);
		setPreview(image.uri);
		upload.mutate(image.blob);
	};

	const shownUrl = preview ?? savedUrl;

	return (
		<View style={field.root}>
			<Text variant="caption" tone="muted-foreground">
				Profile photo
			</Text>

			<View style={field.row}>
				{/* Photo (or initial) is decoration: the button beside it already says "upload photo", and no
				    fake media is made for default avatars (same as web; the initial is the public
				    profile's existing fallback). */}
				<View style={pending ? field.dimmed : null}>
					<Avatar name={viewer.nickname} uri={shownUrl} size={64} />
				</View>

				<View style={field.controls}>
					<View style={field.buttons}>
						<Button
							label={shownUrl ? "Change photo" : "Upload photo"}
							variant="outline"
							size="sm"
							disabled={!editable}
							busy={picking || upload.isPending}
							onPress={() => void pick()}
						/>
						{/* No delete button without a photo: a disabled button reads as "usable later", but nothing
						    to delete is the normal state. The basis is the saved photo, not the preview (which
						    is still nothing). Deleting is not optimistic: the cache changes only after the
						    server confirms. */}
						{savedUrl ? (
							<Button
								label="Delete"
								variant="ghost"
								size="sm"
								disabled={!editable}
								busy={remove.isPending}
								onPress={() => remove.mutate()}
							/>
						) : null}
					</View>
					<Text variant="caption" tone="muted-foreground">
						{AVATAR_INPUT_HINT}
					</Text>
				</View>
			</View>

			{/* Only one thing stands in this slot at a time: action failure, query failure or the
			    restriction note. The answer attaches and detaches with the rhythm of
			    `lib/motion/feedback.tsx` (web uses `feedbackEnter`/`feedbackExit` in the same spot).
			    Only the failure branch is wrapped: the restriction note does not disappear, and
			    wrapping it too would make the sentence that was always there float up alone on first
			    arrival, which the user did not cause. This slot is the last in its box, so no sibling
			    below inherits its space (`feedback.tsx`). */}
			{error ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				</FeedbackLine>
			) : profile.isError ? (
				/* A query failure is not drawn as an empty field; pressing delete here would really delete. */
				<Text accessibilityRole="alert" variant="label" tone="destructive">
					Couldn't load the profile photo. Please try again in a moment.
				</Text>
			) : restricted && viewer.status !== "approved" ? (
				<Text variant="label" tone="muted-foreground">
					{restrictionNote(
						viewer.status === "banned" ? "banned" : "suspended",
						"your profile photo",
					)}
				</Text>
			) : null}

			{/* Only for over-limit photos. While open, this field changes nothing: cancelling means
			    nothing happened, so the old photo and copy stay. */}
			{cropSource ? (
				<AvatarCropDialog
					source={cropSource}
					onCancel={() => setCropSource(null)}
					onConfirm={confirmCrop}
				/>
			) : null}
		</View>
	);
}

const field = StyleSheet.create({
	root: { gap: space.sm },
	row: { alignItems: "center", flexDirection: "row", gap: space.md },
	controls: { flex: 1, gap: space.sm, minWidth: 0 },
	buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
	/** Dims while uploading so the preview does not look like confirmation (same signal as web). */
	dimmed: { opacity: 0.6 },
});
