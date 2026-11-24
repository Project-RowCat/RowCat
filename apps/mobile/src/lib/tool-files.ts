import { chatToolFileTooLarge } from "@rowcat/chat";
import { Directory, File, Paths } from "expo-file-system";
import { Platform, Share } from "react-native";

/**
 * The device side of tool files: picking one to import and handing one out. What a file holds and
 * how it is read are `tool-file.ts` in `@rowcat/chat`; this file only moves bytes.
 *
 * No new native dependency. Both directions use what the app already ships:
 * - `expo-file-system` (already a dependency for draft covers, `draft-cover-files.ts`) has the
 *   system document picker (`File.pickFileAsync`) and, on Android, the folder picker
 *   (`Directory.pickDirectoryAsync`) whose storage-access grant lets us create the file there.
 * - React Native's own `Share` opens the iOS share sheet with a file URL, where "Save to Files",
 *   AirDrop and mail all live. Android's `Share` carries text only, which would hand out a file's
 *   contents as a chat message instead of a file, so Android saves into a chosen folder instead.
 *
 * Kept out of the store and the pure modules: importing `expo-file-system` pulls a native module
 * into whatever graph loads it, and the SQLite tests load the store (`vitest.config.ts`).
 */

export type ToolFilePick =
	| { kind: "cancelled" }
	/** Refused by size before reading a byte (`chatToolFileTooLarge`). */
	| { kind: "too_large" }
	| { kind: "text"; text: string };

/**
 * Opens the system picker for one file and reads it as text. Any type is allowed: a
 * `.rowcat-tools.json` is often reported as `application/octet-stream`, and filtering by type would
 * grey out the very file the person was sent. Whether it is a tool file is `readChatToolFile`'s
 * question, which answers it in a sentence.
 */
export async function pickToolFile(): Promise<ToolFilePick> {
	const picked = await File.pickFileAsync({ mimeTypes: "*/*" });
	if (picked.canceled) return { kind: "cancelled" };
	const file = picked.result;
	if (chatToolFileTooLarge(file.size)) return { kind: "too_large" };
	return { kind: "text", text: await file.text() };
}

export type ToolFileExport = "done" | "cancelled";

/** A picker or share sheet closed by the person rejects on some platforms; that is not a failure. */
const isCancel = (error: unknown): boolean =>
	error instanceof Error && /cancel/i.test(error.message);

/**
 * Hands one file out. iOS: written to the cache directory, then offered through the share sheet.
 * Android: written into a folder the person picks. The cache copy is removed after the sheet
 * closes; it holds nothing secret (header values never enter a tool file) but it is not ours to keep.
 */
export async function exportToolFile(
	fileName: string,
	text: string,
): Promise<ToolFileExport> {
	try {
		if (Platform.OS === "android") {
			const folder = await Directory.pickDirectoryAsync();
			const file = folder.createFile(fileName, "application/json");
			file.write(text);
			return "done";
		}
		const file = new File(Paths.cache, fileName);
		if (file.exists) file.delete();
		file.create();
		file.write(text);
		try {
			const result = await Share.share({ url: file.uri, title: fileName });
			return result.action === Share.dismissedAction ? "cancelled" : "done";
		} finally {
			if (file.exists) file.delete();
		}
	} catch (error) {
		if (isCancel(error)) return "cancelled";
		throw error;
	}
}
