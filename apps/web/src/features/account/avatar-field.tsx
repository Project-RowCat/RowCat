import { MEDIA_ACCEPT } from "@rowcat/contracts";
import { canInteract, type Viewer } from "@rowcat/domain";
import {
	deleteAvatarMutationOptions,
	publicProfileQueryOptions,
	uploadAvatarMutationOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import { AvatarCropDialog } from "./avatar-crop-dialog.tsx";
import {
	avatarErrorMessage,
	avatarInputHint,
	avatarIssueMessage,
	avatarIssueOpensCrop,
	checkAvatarFile,
} from "./avatar-file.ts";

/**
 * The profile photo field.
 *
 * ## The current value is read from the public profile lookup
 *
 * Same decision as the bio field (`BioField`). `/me` is the hottest read: the root SSR, the head
 * and the auth guard hit it on every request, so putting this one screen's value there would make
 * every route's HTML carry it. It also keeps a single source of truth: **the photo I see and the
 * photo others see come from the same response**, so they cannot diverge.
 *
 * ## The preview is not product state
 *
 * Choosing a file draws it immediately from an object URL. That value is **this component's
 * temporary state**; only the server response promotes anything to the profile photo. The server's
 * normalized result (a 512px square WebP) looks different from the original, and caching the
 * preview as if it were the final image would change the picture on the next refresh.
 *
 * So a failed upload **discards the preview**. Keeping it would show a new photo while the server
 * still has the old one, and the person would believe their profile had changed.
 *
 * Revoking the object URL is also a rule (the `useEffect` cleanup). Without it, the memory held by
 * the document grows across several picks.
 *
 * ## An oversized photo goes to cropping, not rejection
 *
 * Previously a file over 2MB ended at "choose a smaller file", and the only way to follow that
 * advice was outside this app. Now a crop dialog opens right there (`AvatarCropDialog`). The branch
 * is decided by a pure function rather than restated here (`avatarIssueOpensCrop`). **Photos within
 * the limit do not open that dialog**: attaching a confirmation step to every chosen photo is a
 * cost this slice never asked for.
 *
 * ## No drag and drop
 *
 * Vocabulary matches the other fields on this screen (nickname, bio): label, control and save.
 * Making only this one a drop zone would add a second interaction model to the account screen. The
 * cover management dialog does not have one either.
 */
export function AvatarField({ viewer }: { viewer: Viewer }) {
	const { t } = useTranslation(["account", "common"]);
	const queryClient = useQueryClient();
	const client = getRowCatClient();
	const fieldId = useId();
	const errorId = `${fieldId}-error`;
	const hintId = `${fieldId}-hint`;
	const noteId = `${fieldId}-note`;

	/**
	 * The trigger that opens the file picker. The `<input type="file">` is hidden and opened by a
	 * button because its default look differs per browser and would not match our button vocabulary.
	 * Accessibility is unchanged: the button is a real button and the input has a label.
	 */
	const inputRef = useRef<HTMLInputElement>(null);

	const profile = useQuery(publicProfileQueryOptions(client, viewer.id));
	const savedUrl = profile.data?.avatarUrl ?? null;

	const [preview, setPreview] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	/**
	 * The object URL's lifetime is tied to the preview value. It is released when the value changes or
	 * the component unmounts. Releasing only in the upload success callback would leak on the failure
	 * and cancel paths, which happen more often.
	 */
	useEffect(() => {
		if (!preview) return;
		return () => URL.revokeObjectURL(preview);
	}, [preview]);

	const uploadPolicy = uploadAvatarMutationOptions(
		client,
		queryClient,
		viewer.id,
	);
	const upload = useMutation({
		...uploadPolicy,
		onError: (...args) => {
			uploadPolicy.onError?.(...args);
			/**
			 * On failure the preview is discarded: the screen must not show a photo the server does not
			 * have. The old photo (or the default avatar) returns immediately.
			 */
			setPreview(null);
			setError(avatarErrorMessage(args[0]));
		},
		onSuccess: (...args) => {
			uploadPolicy.onSuccess?.(...args);
			/**
			 * Clear the preview: the field now draws the **address the server confirmed** (exactly what
			 * others see). A new address carries a new media id, so the browser fetches it on its own.
			 */
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

	const pending = upload.isPending || remove.isPending;
	const restricted = !canInteract(viewer);
	/**
	 * Editing does not open until the lookup finishes. Otherwise a person holding a photo could see
	 * the empty field and press `Delete`, and that action really deletes it.
	 */
	const editable = !restricted && profile.isSuccess && !pending;

	/**
	 * File waiting to be cropped. **Not a preview**: while this value exists the field still shows the
	 * current photo, and cancelling means nothing happened.
	 */
	const [cropFile, setCropFile] = useState<File | null>(null);

	const pick = (file: File) => {
		const issue = checkAvatarFile(file);
		if (issue && avatarIssueOpensCrop(issue)) {
			/**
			 * Crop instead of reject. The previous failure message is cleared because this dialog opens to
			 * **fix** that failure; leaving it would show the old error behind the dialog.
			 */
			setError(null);
			setCropFile(file);
			return;
		}
		if (issue) {
			setError(avatarIssueMessage(issue));
			return;
		}
		setError(null);
		setPreview(URL.createObjectURL(file));
		upload.mutate(file);
	};

	/**
	 * The cropped result **takes the same place as the chosen file**: the preview is set and uploaded
	 * at once.
	 *
	 * The point is that the preview is built from the cropped bytes, not the original. Showing the
	 * original would make the picture on screen differ from the one being uploaded, and that
	 * difference would only surface after the server answers.
	 */
	const confirmCrop = (image: Blob) => {
		setCropFile(null);
		setError(null);
		setPreview(URL.createObjectURL(image));
		upload.mutate(image);
	};

	const shownUrl = preview ?? savedUrl;

	return (
		<div className="flex flex-col gap-1.5">
			{/*
			 * The label points at the file input. Even though the input is invisible, it needs a name so a
			 * screen reader can say what is being chosen.
			 */}
			<label className="font-medium text-sm" htmlFor={fieldId}>
				{t("avatarField.profilePhoto")}
			</label>

			<div className="flex items-center gap-4">
				<AvatarPreview
					url={shownUrl}
					nickname={viewer.nickname}
					pending={pending}
				/>

				<div className="flex flex-col gap-2">
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!editable}
							onClick={() => inputRef.current?.click()}
						>
							{upload.isPending
								? t("avatarField.uploading")
								: shownUrl
									? t("avatarField.changePhoto")
									: t("avatarField.uploadPhoto")}
						</Button>
						{/*
						 * No delete button at all when there is no photo. A disabled button would mean "usable
						 * later", whereas here having nothing to delete is the normal state.
						 */}
						{savedUrl && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={!editable}
								onClick={() => remove.mutate()}
							>
								{remove.isPending
									? t("avatarField.removing")
									: t("avatarField.delete")}
							</Button>
						)}
					</div>
					<p id={hintId} className="text-muted-foreground text-xs">
						{avatarInputHint()}
					</p>
				</div>
			</div>

			{/*
			 * A real file input. It is `hidden`, not `sr-only`, because the label and button already provide an
			 * accessible path. Leaving an invisible element that takes focus in the tab order would make keyboard
			 * users stop at a stop where nothing happens.
			 */}
			<input
				ref={inputRef}
				id={fieldId}
				type="file"
				accept={MEDIA_ACCEPT}
				hidden
				aria-describedby={error ? errorId : restricted ? noteId : hintId}
				onChange={(event) => {
					const file = event.target.files?.[0];
					/**
					 * Clearing the value matters. Choosing the same file again does not fire `change` at all (the
					 * value is unchanged), and retrying the same file after a failure is a very common action.
					 */
					event.target.value = "";
					if (file) pick(file);
				}}
			/>

			{/*
			 * Only **one** message stands in this slot at a time (action failure, load failure, restriction notice).
			 * The three exclude each other, and `mode="wait"` draws exactly that: overlapping them would let the next
			 * sentence stand alongside while the failure exits, making the section two lines taller for 120ms.
			 *
			 * The rhythm comes from `feedback.ts`. This field is the **last flow child** of its container, so the
			 * exit delays nothing else.
			 */}
			<AnimatePresence initial={false} mode="wait">
				{error ? (
					// Not signalled by color alone: the sentence states the failure, and assistive tech hears it
					// through the role.
					<m.p
						key={`action:${error}`}
						id={errorId}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-destructive text-sm"
					>
						{error}
					</m.p>
				) : profile.isError ? (
					/*
					 * The lookup failed. Do not leave the empty field looking editable; state the fact. Someone
					 * who holds a photo and pressed delete here would really delete it.
					 */
					<m.p
						key="load"
						id={errorId}
						role="alert"
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-destructive text-sm"
					>
						{t("avatarField.couldnTLoadTheProfile")}
					</m.p>
				) : restricted ? (
					<m.p
						key="restricted"
						id={noteId}
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-muted-foreground text-sm"
					>
						{viewer.status === "banned"
							? t("avatarField.thisAccountIsBannedSo")
							: t("avatarField.thisAccountIsSuspendedSo")}
					</m.p>
				) : null}
			</AnimatePresence>

			{/*
			 * Shown only for a photo over the limit. While open, this field changes nothing: cancelling means
			 * nothing happened, so the old photo and copy remain as they are.
			 */}
			{cropFile && (
				<AvatarCropDialog
					file={cropFile}
					onCancel={() => setCropFile(null)}
					onConfirm={confirmCrop}
				/>
			)}
		</div>
	);
}

/**
 * The current photo (or the default avatar): one image.
 *
 * **No fake media is stored for the default avatar.** That would stack the same bytes once per
 * member, and calling an external avatar service (Gravatar and the like) is worse: a host we do not
 * control would see the viewer's IP and email hash. The initial of the name is enough, and it is
 * the same fallback the public profile screen already uses.
 */
function AvatarPreview({
	url,
	nickname,
	pending,
}: {
	url: string | null;
	nickname: string;
	pending: boolean;
}) {
	const { t } = useTranslation(["account", "common"]);
	/**
	 * The size is fixed, so arriving images do not shift the layout. This is why the screen does not
	 * need the contract's `width` and `height` (it is a fixed box inside a circular mask).
	 *
	 * The fixity is also a condition for the transition here to hold. The two pictures that swap stand
	 * on the **same cell of the grid** (`AnimatedIconSwap` uses the same geometry), so the box does
	 * not move a pixel and the buttons beside it do not shake.
	 */
	const dimmed = pending ? "opacity-60" : "";

	return (
		<div
			className={`grid size-20 shrink-0 overflow-hidden rounded-full border bg-muted transition-opacity ${dimmed}`}
		>
			{/*
			 * **The photo itself is the result.** No sentence such as "photo saved" goes beside it: the changed picture
			 * already says so, and a sentence on top would state the same fact twice.
			 *
			 * ## What identifies the picture
			 *
			 * `stateKey` is whether a picture **exists**, not its address. With the address as the key, the preview
			 * during an upload (an object URL) and the address the server confirms are different values, so the
			 * transition would run once in between too. The incoming picture is still downloading, so for a moment an
			 * **empty circle** stands where the outgoing preview was, and then the photo pops in. Now both are the same
			 * `img` element, so the browser just swaps the address and nothing visible happens.
			 *
			 * So the transition runs in three places: the first upload (initial → photo), removing (photo → initial),
			 * and a failed upload that discards the preview for someone who had no photo (photo → initial). In all
			 * three, one thing disappears and another appears.
			 *
			 * ## The preview does not look confirmed
			 *
			 * The whole box dims while uploading (`pending`), and that dimming stays until the server answers. The
			 * transition sits on top of that, so the preview arriving does not promote it to success. The rule that the
			 * preview is never cached as the confirmed value is stated in this file's header.
			 */}
			<AnimatePresence initial={false} presenceAffectsLayout={false}>
				<m.span
					key={url ? "image" : "initial"}
					className="col-start-1 row-start-1 inline-grid size-20 place-items-center"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0, transition: exitTransition }}
					transition={enterTransition}
				>
					{url ? (
						<img
							src={url}
							/*
							 * Not decoration: it says whose photo this is. The file name is not used because it never
							 * reaches the server in the first place, and person names or local folder conventions often
							 * end up in it.
							 */
							alt={
								nickname
									? t("avatarField.photoAlt", { name: nickname })
									: t("avatarField.myPhotoAlt")
							}
							className="size-20 object-cover"
							width={80}
							height={80}
						/>
					) : (
						/*
						 * The initial is decoration: the button next to it already says `Upload photo`, so reading this box
						 * aloud would say the same thing twice.
						 */
						<span
							aria-hidden="true"
							className="font-semibold text-muted-foreground text-xl"
						>
							{nickname.trim().slice(0, 1) || "?"}
						</span>
					)}
				</m.span>
			</AnimatePresence>
		</div>
	);
}
