import type { ChatSoftDelete, ChatStamp, ChatSyncMeta } from "./model.ts";
import { freshChatSyncMeta } from "./model.ts";

/**
 * Files the user attached to this conversation (`docs/chat/ATTACHMENTS.md`). An attachment is
 * reference material the model reads on **every** turn, not only the turn it was attached on.
 *
 * - The room's child record, like characters. Several per room, each with its own identity and
 *   revision, so two devices attaching a file each keep both, and removing one is not a room-level
 *   overwrite.
 * - Not part of a message. A file stitched into one user turn scrolls out of the history window
 *   (`chatHistoryWindow`) and the model forgets it — the exact failure this slice exists to fix.
 *   The record lives beside the conversation and the assembler places it in the system prompt every
 *   turn.
 * - Text only. The record stores the decoded text, not bytes: every provider (managed and BYO)
 *   accepts text, while images or PDFs would need a multimodal message contract, per-provider
 *   adapters and a blob store in sync. Decoding is the app's job (it has the file API); what counts
 *   as text and how much fits are rules, and live here.
 * - Never trimmed by a budget. A file the model silently stopped reading looks to the user like
 *   the model ignoring it. Storage rejects instead (per-file length, room total, count), so what the
 *   list shows is exactly what the model reads. The assembler still folds (`clampAttachmentsForPrompt`)
 *   because values also arrive through sync.
 * - Not editable in place. The user replaces a file by removing it and attaching the new one; a text
 *   editor for a 20,000-character document is a different screen, and nothing here needs one.
 *
 * Not included: images, PDFs, per-scene audience (an attachment is the room's reference, read by
 * whoever is present), a global file library, attaching from a work (creators already have lore).
 */

export interface ChatAttachment extends ChatSyncMeta, ChatSoftDelete {
	id: string;
	/** Parent room. Attachments are not shared across rooms. */
	roomId: string;
	/** File name as shown in the list and the prompt (`normalizeAttachmentName`). */
	name: string;
	/** The file's text (`normalizeAttachmentContent`), at most `CHAT_ATTACHMENT_CONTENT_MAX_LENGTH`. */
	content: string;
	/** ISO 8601. The sort axis for the list and the prompt. */
	createdAt: string;
	updatedAt: string;
}

/** File-name cap in code points. Longer names are shortened (keeping the extension), not rejected. */
export const CHAT_ATTACHMENT_NAME_MAX_LENGTH = 120;

/**
 * Per-file cap in code points. Every attachment rides every turn, so this is a prompt-size rule, not
 * a storage one: 20,000 characters is a long chapter or a setting document, several times a
 * character card (`CHAT_CHARACTER_PROMPT_MAX_LENGTH`), and still leaves the history window room.
 */
export const CHAT_ATTACHMENT_CONTENT_MAX_LENGTH = 20_000;

/**
 * Cap on the room's live attachments together, in code points. Without it, eight full files would
 * put 160,000 characters in front of every turn and push the conversation itself out of the
 * model's context; the symptom ('it forgets what we just said') would not point at the files.
 */
export const CHAT_ATTACHMENT_ROOM_MAX_LENGTH = 40_000;

/** Upper bound on live attachments per room; reaching it means the list is used as something else. */
export const CHAT_ATTACHMENT_MAX_PER_ROOM = 8;

/**
 * A byte bound the app checks **before** reading a file: a UTF-8 code point is at most four bytes,
 * so anything larger cannot fit the per-file cap. It keeps a 2 GB video from being read into memory
 * just to be told it is too long.
 */
export const CHAT_ATTACHMENT_FILE_MAX_BYTES =
	CHAT_ATTACHMENT_CONTENT_MAX_LENGTH * 4;

/**
 * Extensions accepted as text. A list, not a MIME check alone: browsers report `""` for `.md`,
 * `.yaml` and most source files, and `application/json` is text while `application/zip` is not.
 * The app passes this to the picker (`accept`) and the rule below re-checks it, since a picker hint
 * is not enforcement (drag and drop, "All files").
 */
export const CHAT_ATTACHMENT_EXTENSIONS = [
	"txt",
	"md",
	"markdown",
	"json",
	"jsonl",
	"csv",
	"tsv",
	"yaml",
	"yml",
	"toml",
	"xml",
	"html",
	"htm",
	"css",
	"log",
	"ini",
	"cfg",
	"conf",
	"srt",
	"vtt",
	"js",
	"jsx",
	"ts",
	"tsx",
	"mjs",
	"cjs",
	"py",
	"rb",
	"go",
	"rs",
	"java",
	"kt",
	"swift",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"php",
	"lua",
	"sh",
	"sql",
] as const;

const EXTENSION_SET: ReadonlySet<string> = new Set(CHAT_ATTACHMENT_EXTENSIONS);

const extensionOf = (name: string): string => {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * Whether a picked file is one this feature reads: a known text extension, or any `text/*` type
 * (a `.txt` saved without an extension still reports `text/plain`). The content check below is the
 * real gate — a renamed binary passes here and fails there.
 */
export function isChatAttachmentFile(file: {
	name: string;
	type?: string;
}): boolean {
	if (EXTENSION_SET.has(extensionOf(file.name))) return true;
	return (file.type ?? "").toLowerCase().startsWith("text/");
}

export type ChatAttachmentIssue =
	| "empty"
	| "too_long"
	| "binary"
	| "unsupported";

/**
 * The one representation of a file name: the base name only (a path the browser or a drag handed
 * over is not the user's name for it), control characters removed, whitespace collapsed, shortened
 * to the cap with its extension kept. Shortened rather than rejected: the user did not type it, and
 * refusing a file over its name would be a rule nobody could act on.
 */
export function normalizeAttachmentName(input: string): string {
	const base = input.split(/[\\/]/).pop() ?? "";
	const name = base
		.replace(/[\p{Cc}\p{Cf}]+/gu, "")
		.replace(/\s+/g, " ")
		.trim();
	const points = [...name];
	if (points.length <= CHAT_ATTACHMENT_NAME_MAX_LENGTH) return name;
	const ext = extensionOf(name);
	const tail = ext && ext.length < 16 ? `.${ext}` : "";
	const keep = CHAT_ATTACHMENT_NAME_MAX_LENGTH - [...tail].length - 1;
	return `${points.slice(0, keep).join("").trim()}…${tail}`;
}

/**
 * The one representation of a file's text: byte-order mark dropped, line endings folded to `\n`
 * (a Windows file and the same file from macOS must be the same record), leading blank lines and
 * trailing whitespace removed. The first line's indentation stays — it is meaningful in code.
 */
export function normalizeAttachmentContent(input: string): string {
	return input
		.replace(/^﻿/, "")
		.replace(/\r\n?/g, "\n")
		.replace(/^(?:[ \t]*\n)+/, "")
		.trimEnd();
}

/**
 * Checks whether decoded text can be stored. NUL is the binary signal: a text file never contains
 * it, and many binary formats are valid enough UTF-8 to pass a decoder. Non-UTF-8 text (an old
 * CP949 file) is the app's decoder to refuse — it decodes strictly, because a lossy decode fills the
 * text with U+FFFD and would send the model a page of question marks every turn. U+FFFD itself is
 * not refused here: a real UTF-8 file may contain it.
 */
export function checkAttachmentContent(
	input: string,
):
	| { ok: true; content: string }
	| { ok: false; reason: Exclude<ChatAttachmentIssue, "unsupported"> } {
	const content = normalizeAttachmentContent(input);
	if (content.length === 0) return { ok: false, reason: "empty" };
	if (content.includes("\u0000")) return { ok: false, reason: "binary" };
	if ([...content].length > CHAT_ATTACHMENT_CONTENT_MAX_LENGTH)
		return { ok: false, reason: "too_long" };
	return { ok: true, content };
}

/** Length of an attachment as the caps count it (code points, not UTF-16 units). */
export const attachmentLength = (attachment: { content: string }): number =>
	[...attachment.content].length;

/**
 * A rejected file. Thrown by storage outside its transaction (as `ChatCharacterFieldError` is), so
 * the screen still knows why.
 */
export class ChatAttachmentContentError extends Error {
	readonly reason: ChatAttachmentIssue;
	constructor(reason: ChatAttachmentIssue) {
		super(`attachment rejected: ${reason}`);
		this.name = "ChatAttachmentContentError";
		this.reason = reason;
	}
}

/**
 * The room is full: too many files (`count`) or too much text together (`total`). The screen says
 * which, so the user knows whether removing a small file helps.
 */
export class ChatAttachmentLimitError extends Error {
	readonly kind: "count" | "total";
	constructor(kind: "count" | "total") {
		super(
			kind === "count"
				? `a conversation cannot hold more than ${CHAT_ATTACHMENT_MAX_PER_ROOM} attachments`
				: `a conversation's attachments cannot exceed ${CHAT_ATTACHMENT_ROOM_MAX_LENGTH} characters`,
		);
		this.name = "ChatAttachmentLimitError";
		this.kind = kind;
	}
}

/**
 * Whether one more file fits the room, given its live attachments. Both stores call it inside the
 * transaction that writes, and the screen calls it before reading, so the answer never differs.
 */
export function checkAttachmentRoom(
	live: readonly { content: string }[],
	next: { content: string },
): { ok: true } | { ok: false; kind: "count" | "total" } {
	if (live.length >= CHAT_ATTACHMENT_MAX_PER_ROOM)
		return { ok: false, kind: "count" };
	const total = live.reduce((sum, a) => sum + attachmentLength(a), 0);
	if (total + attachmentLength(next) > CHAT_ATTACHMENT_ROOM_MAX_LENGTH)
		return { ok: false, kind: "total" };
	return { ok: true };
}

export interface CreateAttachmentInput {
	roomId: string;
	name: string;
	content: string;
}

/**
 * The record for a new attachment. Throws `ChatAttachmentContentError` for a value no store may
 * hold; the room's limits are the store's to check, since only it sees the live siblings.
 */
export function createAttachmentRecord(
	input: CreateAttachmentInput,
	stamp: ChatStamp,
): ChatAttachment {
	const name = normalizeAttachmentName(input.name);
	if (!name) throw new ChatAttachmentContentError("unsupported");
	const checked = checkAttachmentContent(input.content);
	if (!checked.ok) throw new ChatAttachmentContentError(checked.reason);
	return {
		id: stamp.id,
		roomId: input.roomId,
		name,
		content: checked.content,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshChatSyncMeta(stamp.rev),
	};
}

/**
 * The list and the prompt share one order: attach order, ties broken by id. Not name order —
 * `localeCompare` can differ between devices, and a prompt assembled in two orders on two devices
 * splits the cache prefix (the same reason as `sortCharacters`).
 */
export const sortAttachments = <T extends { createdAt: string; id: string }>(
	attachments: readonly T[],
): T[] =>
	[...attachments].sort((a, b) => {
		if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});

/** The fields the assembler reads. */
export type ChatContextAttachment = Pick<ChatAttachment, "name" | "content">;

/**
 * The last defense before the prompt, in the order received: each file folded to the per-file cap,
 * then the room total. Storage never lets a room past either, but a value arriving through sync from
 * an old or buggy client is decoded as it is (rejecting it would drop the file on this device only).
 * Folding here keeps that worst case deterministic — two devices send the same prompt — and leaves
 * the stored original alone. Slices by code point so a surrogate pair is never split.
 */
export function clampAttachmentsForPrompt(
	attachments: readonly ChatContextAttachment[],
): ChatContextAttachment[] {
	let left = CHAT_ATTACHMENT_ROOM_MAX_LENGTH;
	const out: ChatContextAttachment[] = [];
	for (const attachment of attachments) {
		if (left <= 0) break;
		const content = normalizeAttachmentContent(attachment.content);
		if (!content) continue;
		const points = [...content];
		const take = Math.min(
			points.length,
			CHAT_ATTACHMENT_CONTENT_MAX_LENGTH,
			left,
		);
		left -= take;
		out.push({
			name: attachment.name,
			content:
				take === points.length ? content : points.slice(0, take).join(""),
		});
	}
	return out;
}
