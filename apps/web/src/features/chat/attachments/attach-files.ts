import {
	CHAT_ATTACHMENT_EXTENSIONS,
	CHAT_ATTACHMENT_FILE_MAX_BYTES,
	type ChatAttachment,
	ChatAttachmentContentError,
	ChatAttachmentLimitError,
	type ChatStore,
	isChatAttachmentFile,
} from "@rowcat/chat";
import { attachmentFailureMessage } from "./attachment-copy.ts";

/**
 * Reading a picked file into an attachment, and attaching several. The browser half of
 * `attachment.ts`: this side has the File API, the rules stay in the pure package.
 *
 * Not held here: which files fit the room (the store decides in its writing transaction), and where
 * a failure is shown (each door decides — the settings pane inline, the composer as a toast).
 */

/** The picker hint. A hint only: drag and drop and "All files" bypass it, so the rule re-checks. */
export const ATTACHMENT_ACCEPT = CHAT_ATTACHMENT_EXTENSIONS.map(
	(ext) => `.${ext}`,
)
	.concat("text/*")
	.join(",");

/** The minimal shape read from a `File`, so the rule is testable without a DOM. */
export interface AttachmentSourceFile {
	name: string;
	type: string;
	size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * The file's name and text, or a `ChatAttachmentContentError`. Three gates, cheapest first: the
 * kind (extension or `text/*`), the byte bound (a file that cannot fit the per-file cap is never
 * read into memory), and a **strict** UTF-8 decode — a lossy decode would turn a CP949 or binary
 * file into a page of U+FFFD that the model would then read on every turn.
 */
export async function readAttachmentFile(
	file: AttachmentSourceFile,
): Promise<{ name: string; content: string }> {
	if (!isChatAttachmentFile(file))
		throw new ChatAttachmentContentError("unsupported");
	if (file.size > CHAT_ATTACHMENT_FILE_MAX_BYTES)
		throw new ChatAttachmentContentError("too_long");
	const bytes = await file.arrayBuffer();
	let content: string;
	try {
		content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new ChatAttachmentContentError("binary");
	}
	return { name: file.name, content };
}

export interface AttachFilesResult {
	attached: ChatAttachment[];
	/** One sentence per refused file, naming it. */
	failures: string[];
}

/**
 * Attaches files one by one, in the order picked. One at a time, not all at once: the room's caps are
 * checked against what is already attached, so the third file must see the first two. A refusal does
 * not stop the rest — a too-long file in a batch of five should not cost the other four.
 */
export async function attachFiles(
	store: Pick<ChatStore, "createAttachment">,
	roomId: string,
	files: readonly AttachmentSourceFile[],
): Promise<AttachFilesResult> {
	const attached: ChatAttachment[] = [];
	const failures: string[] = [];
	for (const file of files) {
		try {
			const { name, content } = await readAttachmentFile(file);
			attached.push(await store.createAttachment({ roomId, name, content }));
		} catch (failure) {
			if (
				!(failure instanceof ChatAttachmentContentError) &&
				!(failure instanceof ChatAttachmentLimitError)
			)
				console.error("[chat] couldn't attach the file", failure);
			failures.push(attachmentFailureMessage(file.name, failure));
		}
	}
	return { attached, failures };
}
