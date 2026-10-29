import { Directory, File, Paths } from "expo-file-system";
import type { DraftCoverFiles } from "./local-data/draft-cover-store.ts";

/**
 * The file slot for a draft's cover before publication. The only place that knows
 * `expo-file-system`.
 *
 * If screens held the file API directly, path rules would spread across the whole feature folder,
 * and one of them would start storing absolute paths (the code below is where that is prevented).
 * `image-picker.ts` does the same for the picker library.
 *
 * ## Why the document directory and not the cache
 *
 * The `uri` the picker returns usually lives in the app's **cache**, which the OS empties when
 * storage runs low. Drafts live for weeks. Holding a cache address means the cover silently
 * disappears in the meantime, and the user only knows "the cover I chose is gone". So the image is
 * **copied to the document directory** the moment it is chosen (`Paths.document`, which the OS does
 * not clear).
 *
 * ## ⚠️ Never store absolute paths
 *
 * An iOS app container's absolute path contains a UUID that changes per install. If that address
 * were written to SQLite, the row would **point at a missing file** after a reinstall or update,
 * even though the file exists. So what is stored is **a single file name**, and the address is
 * rebuilt from the current document directory on every read (`draftCoverUri`).
 *
 * ## What is not here
 *
 * **No normalization.** Nothing is resized or re-encoded. That rule lives in one server boundary
 * (`apps/api/src/lib/media/image.ts`); if the client did it too, two copies of the rule would
 * produce different images before and after publication. This file only **moves** bytes.
 *
 * **No reading function either.** Upload uses the **same path** as `readPickedImage`
 * (`fetch(file://…)` → `Blob`), a route this app already runs, so no second conversion is created.
 */

/**
 * The slot name is **different per member, and the name comes from outside**
 * (`viewerDraftCoverDirName`).
 *
 * It is not built here because of the deleting side. Account deletion and reset erase this slot
 * together with the database (`local-data/purge.ts`), so the name derivation must be **the same
 * function** in both. A copy here would, on the day one of them goes stale, leave unerased covers
 * on the device that nobody can find.
 */

/**
 * The extension is **a decoder hint, not a claim.**
 *
 * Authority for the format decision rests with the server, which reads the bytes; this value never
 * reaches that decision. It is attached anyway because the platform image loader picks a decoder by
 * extension, and without it a valid file appears blank on screen only.
 *
 * An unknown format is `bin`. Nothing is invented: a wrong extension is worse than none.
 */
const EXTENSION: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

/**
 * This draft's cover file name. **Determined by the draft id.**
 *
 * A random name is not used because of orphans. A draft whose cover changed three times would leave
 * three files, two of which no row points at, with no basis for deleting them. With the draft id as
 * the name, choosing again becomes an **overwrite**.
 */
export const draftCoverFileName = (
	draftId: string,
	mimeType: string | null,
): string => `${draftId}.${EXTENSION[mimeType ?? ""] ?? "bin"}`;

/**
 * Stored name → the address on **this** device right now.
 *
 * This function exists for the ⚠️ reason above: addresses are not stored; they are built on every
 * read.
 */
export const draftCoverUri = (dirName: string, fileName: string): string =>
	new File(Paths.document, dirName, fileName).uri;

/**
 * Moves the chosen image into the document directory. Returns the **name and size**.
 *
 * The size is read from **the copied file**, not from the picker. The picker's `fileSize` is
 * missing on some platforms (`PickedImage.byteSize` may be `null`), whereas the bytes now in our
 * slot can be counted directly; the pre-publication notice reads that count.
 *
 * **Overwriting is the normal path.** Choosing a cover again is exactly that, so an existing file
 * with the same name is deleted and copied again.
 */
export async function stageDraftCoverFile(
	dirName: string,
	draftId: string,
	source: { uri: string; mimeType: string | null },
): Promise<{ fileName: string; byteSize: number }> {
	const directory = new Directory(Paths.document, dirName);
	/** Creating is idempotent; callers do not decide whether to create only when missing. */
	directory.create({ intermediates: true, idempotent: true });

	const fileName = draftCoverFileName(draftId, source.mimeType);
	const destination = new File(directory, fileName);
	if (destination.exists) destination.delete();

	await new File(source.uri).copy(destination);
	return { fileName, byteSize: destination.size };
}

/**
 * Deletes this draft's cover file. **A missing file is still success.**
 *
 * Three call sites (cover removed, draft deleted, publication succeeded) all mean "this file must
 * not remain". Throwing on a missing file would give each of the three its own `try`, and one of
 * them would omit it and report the user's action as a failure.
 */
export function removeDraftCoverFile(dirName: string, fileName: string): void {
	const file = new File(Paths.document, dirName, fileName);
	if (file.exists) file.delete();
}

/**
 * Deletes the whole cover slot of that member. **Belongs to account deletion and reset.**
 *
 * It does not walk rows and delete files one by one, because of ordering: those two operations
 * **delete the database**. The database is the source of the file names, so deleting it first loses
 * the names, while deleting the files later leaves files behind if a run fails in between. With one
 * slot per member the order does not matter, since deleting the whole slot cannot reach another
 * member.
 *
 * Missing is success (a member who never chose a cover has no slot at all).
 */
export function removeDraftCoverDirectory(dirName: string): void {
	const directory = new Directory(Paths.document, dirName);
	if (directory.exists) directory.delete();
}

/**
 * The four functions above bundled into the shape of the `DraftCoverFiles` port: **the product
 * implementation.**
 *
 * The scope assembly receives this value by injection because of the test graph: if the repository
 * imported this file directly, `expo-file-system` would enter that graph, and its config has no
 * polyfills (`vitest.config.ts`). The SQLite driver and Keychain have the same shape for the same
 * reason.
 */
export const expoDraftCoverFiles: DraftCoverFiles = {
	uri: draftCoverUri,
	stage: stageDraftCoverFile,
	remove: removeDraftCoverFile,
	/**
	 * The last resort when the row is lost: scans **known extensions only**. Because the name is
	 * determined by the draft id, this guess cannot reach someone else's file.
	 */
	candidates: (draftId) =>
		[...Object.keys(EXTENSION), ""].map((mime) =>
			draftCoverFileName(draftId, mime || null),
		),
};

/**
 * The **bytes** of the staged cover, in the shape the SDK accepts (Blob).
 *
 * It is the **same path** as `readPickedImage` (`fetch(file://…)` → `Blob`; in RN that single call
 * is the local-file-to-Blob conversion). The reason this lives here rather than in the screen is
 * the same: `fetch` in feature code is blocked by the static scan (path rules and sessions would
 * spread out; `lib/boundaries.test.ts`), and this `fetch` reads **a file on this device**, not the
 * network.
 *
 * The Blob's `type` is overridden with the stored format. The type RN's file `fetch` attaches is
 * guessed from the extension, so for a file staged without a known extension (`bin`) that value is
 * empty or wrong.
 */
export async function readStagedDraftCover(staged: {
	uri: string;
	mime: string | null;
}): Promise<Blob> {
	const response = await fetch(staged.uri);
	const blob = await response.blob();
	if (staged.mime && blob.type !== staged.mime)
		return blob.slice(0, blob.size, staged.mime);
	return blob;
}
