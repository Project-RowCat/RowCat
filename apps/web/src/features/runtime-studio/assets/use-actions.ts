import type {
	AuthoringStore,
	DraftRuntimeAsset,
	NewRuntimeAssetMedia,
} from "@rowcat/authoring";
import type {
	RuntimeAudioAssetDto,
	RuntimeImageAssetDto,
} from "@rowcat/contracts";
import { useCallback, useMemo } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import { showErrorToast } from "#/lib/toast.ts";
import { runtimeActionFailure } from "../runtime-copy.ts";

/**
 * Four operations on managed assets: upload, rename, replace, and remove.
 * - Upload is split by kind (uploadImage, uploadAudio) rather than taking a kind argument, so a
 *   mismatched kind cannot be written. The SDK and server already expose two routes.
 * - bind and replace take an already classified upload, so they need no kind argument.
 * - These skip the autosave queue. Each is one explicit action and must be recorded immediately,
 *   or a reload right after an upload would lose it.
 * - Upload runs before the record is written, so a failed upload leaves no empty item, and a
 *   failed replace keeps the old media.
 * - Replace never overwrites media. It uploads new media and moves the binding, because
 *   overwriting would change published works without republishing.
 * - Remove unbinds the name in this draft only. There is no server delete, since published
 *   snapshots may still reference the bytes.
 */

/**
 * What an upload produced, with the creating route recorded in the value. This discriminated union
 * is why bind and replace take no kind argument: the kind is a fact that already happened, not the
 * caller's choice.
 */
export type RuntimeUploadedAsset =
	| { kind: "image"; asset: RuntimeImageAssetDto }
	| { kind: "audio"; asset: RuntimeAudioAssetDto };

export interface RuntimeAssetActions {
	/**
	 * Uploads one image. Creates no record. Failures are thrown, and the screen chooses the message.
	 */
	uploadImage: (file: Blob) => Promise<RuntimeUploadedAsset>;
	/** Uploads one audio file. It goes to a different address than images (see the file header). */
	uploadAudio: (file: Blob) => Promise<RuntimeUploadedAsset>;
	/**
	 * Binds an uploaded asset to a logical name. The caller validates the name
	 * (`planRuntimeAssetName`). Validating here would duplicate the rule, and this hook has no way to
	 * explain why a name was rejected.
	 */
	bind: (
		name: string,
		uploaded: RuntimeUploadedAsset,
	) => Promise<DraftRuntimeAsset | null>;
	/**
	 * Renames only. Returns whether it succeeded, so the caller can decide whether to close the input.
	 */
	rename: (assetId: string, name: string) => Promise<boolean>;
	/**
	 * Replaces only the asset. The name stays, and identity and metadata move together. The kind never
	 * changes: putting audio where an image was is remove plus add, not replace, and the file picker
	 * already enforces this. Allowing a silent kind change would turn a name that `<Image>` draws into
	 * audio, and the project would learn of it only at the next playback.
	 */
	replace: (
		assetId: string,
		uploaded: RuntimeUploadedAsset,
	) => Promise<boolean>;
	remove: (assetId: string) => Promise<boolean>;
}

/**
 * Converts an upload result into the shape the authoring record accepts. This is the only place
 * that creates nullable fields.
 */
const authoringInput = (
	uploaded: RuntimeUploadedAsset,
): NewRuntimeAssetMedia =>
	uploaded.kind === "audio"
		? {
				kind: "audio",
				assetId: uploaded.asset.mediaId,
				mime: uploaded.asset.mime,
				durationMs: uploaded.asset.durationMs,
			}
		: {
				kind: "image",
				assetId: uploaded.asset.mediaId,
				mime: uploaded.asset.mime,
				width: uploaded.asset.width,
				height: uploaded.asset.height,
			};

/** Fields a replacement moves. The opposite kind's fields are cleared explicitly. */
const replacementPatch = (uploaded: RuntimeUploadedAsset) =>
	uploaded.kind === "audio"
		? {
				assetId: uploaded.asset.mediaId,
				mime: uploaded.asset.mime,
				width: null,
				height: null,
				durationMs: uploaded.asset.durationMs,
			}
		: {
				assetId: uploaded.asset.mediaId,
				mime: uploaded.asset.mime,
				width: uploaded.asset.width,
				height: uploaded.asset.height,
				durationMs: null,
			};

export function useRuntimeAssetActions(draftId: string): RuntimeAssetActions {
	const { store } = useAuthoringScope();

	/**
	 * Storage failures use a toast because they have no place inside the form, the same decision as
	 * useRuntimeActions. Upload failures do not use this path. Their causes are user-fixable (format,
	 * size, resolution), so the message must stay inside the asset dialog, which does not close. See
	 * docs/design/FAILURE-FEEDBACK.md.
	 */
	const run = useCallback(
		async <T>(
			action: (store: AuthoringStore) => Promise<T>,
		): Promise<T | null> => {
			if (!store) return null;
			try {
				return await action(store);
			} catch (error) {
				console.error("[runtime] an image action failed", error);
				showErrorToast(runtimeActionFailure());
				return null;
			}
		},
		[store],
	);

	return useMemo(
		() => ({
			uploadImage: async (file: Blob) => ({
				kind: "image",
				asset: await getRowCatClient().me.uploadRuntimeImage(file),
			}),
			uploadAudio: async (file: Blob) => ({
				kind: "audio",
				asset: await getRowCatClient().me.uploadRuntimeAudio(file),
			}),
			bind: async (name: string, uploaded: RuntimeUploadedAsset) =>
				run((target) =>
					target.createRuntimeAsset(draftId, {
						path: name,
						...authoringInput(uploaded),
					}),
				),
			rename: async (assetId: string, name: string) =>
				(await run(async (target) => {
					await target.updateRuntimeAsset(assetId, { path: name });
					return true;
				})) ?? false,
			replace: async (assetId: string, uploaded: RuntimeUploadedAsset) =>
				(await run(async (target) => {
					/**
					 * Metadata moves in one patch. Moving only `assetId` and leaving the old dimensions would make
					 * the list show wrong values until the asset is opened. Clearing the opposite axis explicitly
					 * with `null` is a new rule here, since an omitted field would be left untouched and keep its
					 * old value.
					 */
					await target.updateRuntimeAsset(assetId, replacementPatch(uploaded));
					return true;
				})) ?? false,
			remove: async (assetId: string) =>
				(await run(async (target) => {
					await target.deleteRuntimeAsset(assetId);
					return true;
				})) ?? false,
		}),
		[draftId, run],
	);
}
