import {
	attachmentLength,
	CHAT_ATTACHMENT_CONTENT_MAX_LENGTH,
	CHAT_ATTACHMENT_MAX_PER_ROOM,
	CHAT_ATTACHMENT_ROOM_MAX_LENGTH,
	ChatAttachmentContentError,
	ChatAttachmentLimitError,
} from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Copy for attached files. The rules live in `attachment.ts` in `@rowcat/chat`; this file only turns
 * their answers into sentences, so the composer's paperclip and the settings pane — the two doors that
 * attach files — cannot word the same refusal two ways.
 */

const number = (value: number): string => value.toLocaleString();

/** The settings home's line: how many files and how much text rides every turn. */
export function attachmentRowSummary(
	attachments: readonly { content: string }[],
): string {
	const t = translator("chat");
	if (attachments.length === 0) return t("attachments.summary.none");
	return t("attachments.summary.some", {
		count: attachments.length,
		chars: number(attachmentsLength(attachments)),
	});
}

export const attachmentsLength = (
	attachments: readonly { content: string }[],
): number => attachments.reduce((sum, a) => sum + attachmentLength(a), 0);

/** The pane's usage line, against the room cap. */
export function attachmentUsage(
	attachments: readonly { content: string }[],
): string {
	return translator("chat")("attachments.usage", {
		used: number(attachmentsLength(attachments)),
		total: number(CHAT_ATTACHMENT_ROOM_MAX_LENGTH),
	});
}

/** One file's length, as the caps count it. */
export const attachmentLengthLabel = (attachment: {
	content: string;
}): string =>
	translator("chat")("attachments.length", {
		count: number(attachmentLength(attachment)),
	});

/** What the pane says about which files fit. */
export const attachmentSupportedNote = (): string =>
	translator("chat")("attachments.supported", {
		perFile: number(CHAT_ATTACHMENT_CONTENT_MAX_LENGTH),
		total: number(CHAT_ATTACHMENT_ROOM_MAX_LENGTH),
	});

/**
 * What a failed attach says, naming the file. Every rule refusal has its own sentence because each
 * one tells the person something different to do (pick a text file, re-save as UTF-8, split the file,
 * remove another one). Anything else is "try again".
 */
export function attachmentFailureMessage(
	name: string,
	failure: unknown,
): string {
	const t = translator("chat");
	if (failure instanceof ChatAttachmentLimitError)
		return failure.kind === "count"
			? t("attachments.limitCount", { max: CHAT_ATTACHMENT_MAX_PER_ROOM })
			: t("attachments.limitTotal", {
					name,
					max: number(CHAT_ATTACHMENT_ROOM_MAX_LENGTH),
				});
	if (failure instanceof ChatAttachmentContentError) {
		switch (failure.reason) {
			case "unsupported":
				return t("attachments.unsupported", { name });
			case "binary":
				return t("attachments.binary", { name });
			case "empty":
				return t("attachments.empty_file", { name });
			case "too_long":
				return t("attachments.tooLong", {
					name,
					max: number(CHAT_ATTACHMENT_CONTENT_MAX_LENGTH),
				});
		}
	}
	return t("attachments.failed", { name });
}
