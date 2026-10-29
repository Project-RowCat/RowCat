/**
 * Who sees the report entry point. Two pure predicates.
 *
 * Not authorization: the server is the authority (`POST /v2/reports`), and loosening these
 * predicates opens no door. They only avoid drawing an obviously meaningless action. They are
 * centralized because there are three call sites (story detail, comment row, profile header); a
 * per-site check would eventually show a report to guests, who fill out the form before learning
 * they need to log in.
 *
 * ## Restricted accounts still see it
 *
 * `viewerAction` is deliberately not consulted. It gates outward interactions (likes, comments,
 * follows); reporting is not in that class, the same way blocking stays open under a `social.write`
 * restriction. The server decides whether a report is accepted (suspended accounts get
 * `account_restricted`); the screen only relays that message.
 */

/**
 * Whether the report action for a public target (work or profile) is drawn.
 *
 * ```text
 * viewerId === null     guest, or identity not yet confirmed — hidden
 * ownerId === viewerId  own content — hidden
 * ownerId === null      ownerless public work — shown (it can be reported)
 * ```
 *
 * Hiding it from guests is intentional. A report is a multi-step form (pick a reason, write
 * details), so bouncing to login midway loses what was typed. Hearts behave the other way because
 * they are a single tap. Unverified identity is folded into the guest case: opening the form for
 * someone who may not be a member just leads to a 401 after the form is filled.
 */
export function canReportTarget({
	viewerId,
	ownerId,
}: {
	/** Confirmed member id. Guest, booting and `/me` failure all map to `null`. */
	viewerId: string | null;
	/** Owner of the target. `null` for an ownerless public work. */
	ownerId: string | null;
}): boolean {
	if (!viewerId) return false;
	return ownerId !== viewerId;
}

/**
 * What the overflow on a comment row offers — **mutually exclusive** options.
 *
 * ```text
 * own comment           delete   no report item (no reason to report your own comment)
 * other + member        report   no delete item (it would 404: ownership is in the server predicate)
 * guest                 none     the trigger itself is not rendered
 * ```
 *
 * Rendering delete and report together is the easiest mistake here: it makes another person's
 * comment look deletable. The web row has the same exclusivity for the same reason.
 */
export type CommentRowAction = "delete" | "report" | null;

export function commentRowAction({
	own,
	viewerId,
}: {
	/** Computed by the caller against the viewer's member id (`isOwnComment`), not a nickname. */
	own: boolean;
	viewerId: string | null;
}): CommentRowAction {
	if (own) return "delete";
	/**
	 * Do not compare the author id again. `own` is already the answer; a second comparison here would
	 * make ownership decided in two places, against the rule that `@rowcat/domain` owns it.
	 */
	return viewerId ? "report" : null;
}
