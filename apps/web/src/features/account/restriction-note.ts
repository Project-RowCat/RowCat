import type { Viewer } from "@rowcat/domain";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Says why a restricted account is locked. Appeals, sanction history and support contacts do not
 * belong here: they are the trust and safety slice's job, and a button added now would have nowhere
 * to go. What this can honestly do is state the status, since a silently locked input reads as a
 * malfunction.
 */
export function restrictionNote(
	status: Viewer["status"],
	/**
	 * Which field is locked. Each pair is a whole sentence in the dictionary rather than a field name
	 * spliced into one sentence: the Korean object particle depends on the word's last syllable, and
	 * a spliced sentence gets it wrong for some fields.
	 */
	target: "nickname" | "bio" | "pinned",
): string {
	return status === "banned"
		? translator("account")(`restriction.banned.${target}`)
		: translator("account")(`restriction.suspended.${target}`);
}
