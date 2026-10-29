import { useCallback, useRef, useState } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import {
	pickImageFromLibrary,
	readPickedImage,
} from "../../lib/image-picker.ts";
import {
	checkPickedSceneImage,
	SCENE_IMAGE_LOCAL_WRITE_FAILED,
	sceneImageErrorMessage,
	sceneImageIssueMessage,
} from "./scene-image-file.ts";

/**
 * Picks one scene image, **uploads it, and writes the reference into the draft.**
 *
 * ```text
 * pick from the library    cancelling is not a failure: nothing happens
 * pre-check                format, size, pixels. Unknown axes do not block (the server is final)
 * upload the bytes         POST /v2/me/scene-images → mediaId
 * write the reference      DraftSceneImage { trigger: "", assetId }
 * ```
 *
 * ## The draft holds **one reference**
 *
 * Not the bytes, not an address, not a local file URI. A `file://` written into the draft travels
 * through sync to other devices and becomes **a string that points at nothing**; freezing an
 * absolute address breaks every existing reference the day a deployment moves the API origin. The
 * rule that builds addresses belongs to `client.media.url` alone (`media.ts` in `@rowcat/sdk`).
 *
 * ## A local write failure after upload is not rolled back
 *
 * No API on this path deletes a server image, and even if one existed, another draft or an already
 * published snapshot may point at that media. Orphaned assets belong to the server's cleanup
 * policy. What this hook must do is **not create a fake reference**, and say the truth about it.
 *
 * ## Double press in the same tick
 *
 * A synchronous lock guards it. `setState` takes effect only at the next render, so two events in
 * the same tick both pass, and the picker opens twice or the same image uploads twice.
 */

export interface SceneImageUpload {
	/** Picks and uploads. Writing the reference is done by `addSceneImage`. */
	pick: () => Promise<void>;
	busy: boolean;
	failure: string | null;
	dismissFailure: () => void;
}

export function useSceneImageUpload(
	/** Writes the uploaded reference into the draft; returns whether it succeeded. */
	addSceneImage: (assetId: string) => Promise<boolean>,
): SceneImageUpload {
	const lock = useRef(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const dismissFailure = useCallback(() => setFailure(null), []);

	const pick = useCallback(async () => {
		if (lock.current) return;
		// Lock before the first await.
		lock.current = true;
		setBusy(true);
		try {
			const picked = await pickImageFromLibrary();
			/** Closing the picker without selecting is **normal use**, not an error. */
			if (!picked) return;

			const issue = checkPickedSceneImage(picked);
			if (issue) {
				setFailure(sceneImageIssueMessage(issue));
				return;
			}

			let assetId: string;
			try {
				const blob = await readPickedImage(picked);
				const asset = await getRowCatClient().me.uploadSceneImage(blob);
				assetId = asset.mediaId;
			} catch (error) {
				setFailure(sceneImageErrorMessage(error));
				return;
			}

			/**
			 * The upload reached the server. If this step fails, **no fake reference is created** and the
			 * user is told that fact; the header explains why nothing is rolled back.
			 */
			if (!(await addSceneImage(assetId))) {
				setFailure(SCENE_IMAGE_LOCAL_WRITE_FAILED);
				return;
			}
			setFailure(null);
		} finally {
			lock.current = false;
			setBusy(false);
		}
	}, [addSceneImage]);

	return { pick, busy, failure, dismissFailure };
}
