import type {
	ChatToolFileFailure,
	ChatToolFileStrippedHeader,
	ChatToolImportChoice,
	ChatToolImportItem,
} from "@rowcat/chat";
import { translator } from "../../lib/i18n/instance.ts";

/**
 * The sentences of tool files: export notices, read failures and the import list's lines. The
 * rules (what a file holds, what each entry's status is, which choices it allows) are
 * `tool-file.ts` in `@rowcat/chat`; this file only words its answers.
 *
 * Pure for the reason of the other copy modules: this app's tests do not render screens, and the
 * failures here are silent ones (a newer file reported as "broken", an invalid entry drawn without
 * saying why it will not arrive).
 */

/** One sentence per failure. A newer file is never called broken: the fix is an update, not a new file. */
export function toolFileFailureMessage(reason: ChatToolFileFailure): string {
	const t = translator("tools");
	switch (reason) {
		case "not_tool_file":
			return t("copy.failureNotToolFile");
		case "newer_version":
			return t("copy.failureNewerVersion");
		case "too_large":
			return t("copy.failureTooLarge");
		case "invalid":
			return t("copy.failureInvalid");
	}
}

/**
 * Said after an export that left header values out, or `null` when none were. The names are listed
 * (`tool · header`) so the author knows exactly which keys the importer must bring.
 */
export function strippedHeadersNotice(
	stripped: readonly ChatToolFileStrippedHeader[],
): string | null {
	if (stripped.length === 0) return null;
	return translator("tools")("exportStripped", {
		headers: stripped
			.map((entry) => `${entry.tool} · ${entry.header}`)
			.join(", "),
	});
}

/** The name an import row shows. An invalid entry may have no readable name; its position stands in. */
export function importItemName(item: ChatToolImportItem): string {
	const t = translator("tools");
	if (item.entry.ok) return item.entry.tool.declaration.name;
	return (
		item.entry.name ??
		`${t("copy.unnamed")} · ${t("invalidAt", { position: item.entry.index + 1 })}`
	);
}

/** The status line under an import row. */
export function importStatusLine(item: ChatToolImportItem): string {
	const t = translator("tools");
	switch (item.status) {
		case "new":
			return t("copy.statusNew");
		case "name_taken":
			return t("copy.statusNameTaken");
		case "duplicate_in_file":
			return t("copy.statusDuplicate");
		case "invalid":
			return t("copy.statusInvalid");
	}
}

/**
 * Where an `http` entry will send, and which header values the importer must fill in: shown
 * **before** choosing, because turning such a tool on sends conversation-derived arguments to that
 * address. `[]` for every other kind.
 */
export function importReachLines(item: ChatToolImportItem): string[] {
	if (!item.entry.ok || item.entry.http === null) return [];
	const t = translator("tools");
	const { origin, headersToFill } = item.entry.http;
	return [
		t("httpReach", { origin }),
		...(headersToFill.length > 0
			? [t("headersToFill", { headers: headersToFill.join(", ") })]
			: []),
	];
}

export function importChoiceLabel(choice: ChatToolImportChoice): string {
	const t = translator("tools");
	switch (choice) {
		case "import":
			return t("copy.importChoiceImport");
		case "replace":
			return t("copy.importChoiceReplace");
		case "skip":
			return t("copy.importChoiceSkip");
	}
}
