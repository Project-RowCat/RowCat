import {
	CAPABILITY_LABEL,
	type MyAppealDto,
	type MyModerationStatusDto,
} from "@rowcat/contracts";

/**
 * The rule that decides **what the `Restrictions` (usage restrictions) section draws**, separated into a
 * pure function.
 *
 * The decision has the same values as the one inside the web's `account-moderation-section.tsx`. It
 * lives in its own file on this app because of tests: this app's tests do not render screens, so if
 * collection, visibility and appeal-eligibility decisions sit inside a component, the only way to
 * check them is by hand.
 *
 * ## Three categories fold into one list
 *
 * `accountActions`, `restrictions` and `hiddenStories` are the server's axes, not the user's. To
 * the user they are all "restrictions applied to my account". Drawing three separate lists would
 * make a sanctioned person search three sections for their status.
 *
 * ## What this file does not invent
 *
 * - **Public reason.** Passed through as-is when empty. That slot is one the operator did not
 *   fill, and filling it would put words the operator never wrote on screen.
 * - **Expiry.** Items without `expiresAt` (account actions, story hiding, indefinite
 *   restrictions) stay null. The screen renders them as `Until lifted`.
 * - **Appeal eligibility.** The authority is the `appealableActionIds` the server answers, and
 *   only that. Recomputing it here from action kind, expiry or appeal count would eventually
 *   diverge from the server, and the side that diverged would draw a button that returns 400 when
 *   pressed.
 */

/** One row folding account actions, capability restrictions and story hiding; to the user they are all the same kind of restriction. */
export interface RestrictionItem {
	/** Opaque reference that the appeal points at; not drawn as on-screen text. */
	actionId: string;
	subject: string;
	publicReason: string;
	createdAt: string;
	expiresAt: string | null;
}

/**
 * Maps the server's three categories to the user's one list.
 *
 * The title's source is the contract (`CAPABILITY_LABEL`). Writing capability names here would
 * leave this app stuck with old labels whenever the vocabulary grows. Internal action kinds (values
 * such as `suspend_member`) go out only as product labels and never appear raw in on-screen text.
 */
export function collectRestrictionItems(
	status: MyModerationStatusDto,
): RestrictionItem[] {
	return [
		...status.accountActions.map((row) => ({
			actionId: row.actionId,
			subject:
				row.kind === "ban_member" ? "Account banned" : "Account suspended",
			publicReason: row.publicReason,
			createdAt: row.createdAt,
			expiresAt: null,
		})),
		...status.restrictions.map((row) => ({
			actionId: row.actionId,
			subject: `${CAPABILITY_LABEL[row.capability]} restricted`,
			publicReason: row.publicReason,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt,
		})),
		...status.hiddenStories.map((row) => ({
			actionId: row.actionId,
			subject: "Story hidden",
			publicReason: row.publicReason,
			createdAt: row.createdAt,
			expiresAt: null,
		})),
	];
}

export interface AccountModerationView {
	items: RestrictionItem[];
	/**
	 * Appeals that have finished; `open` ones are not here. An in-progress appeal is drawn beside its
	 * own restriction row, and listing it in the history too would state the same fact in two places.
	 */
	resolvedAppeals: MyAppealDto[];
	openAppealActionIds: ReadonlySet<string>;
	appealableActionIds: ReadonlySet<string>;
}

/**
 * State → what the section draws. **null means there is no section at all.**
 *
 * It matters that past appeals are part of the visibility condition. When an appeal is accepted the
 * restriction disappears, and if only active restrictions were considered the whole section would
 * vanish at that moment, leaving the user **no way to see what happened to their appeal**: a screen
 * that announces the sanction but never says how it was lifted.
 *
 * Conversely, with neither restrictions nor past appeals it draws nothing. An always-on badge such
 * as "all features available" is decoration, not information; and when a sanction does apply, the
 * same spot would only differ in color.
 */
export function accountModerationView(
	status: MyModerationStatusDto,
): AccountModerationView | null {
	const items = collectRestrictionItems(status);
	const resolvedAppeals = status.appeals.filter((row) => row.status !== "open");
	if (!items.length && !resolvedAppeals.length) return null;

	return {
		items,
		resolvedAppeals,
		openAppealActionIds: new Set(
			status.appeals
				.filter((row) => row.status === "open")
				.map((row) => row.actionId),
		),
		appealableActionIds: new Set(status.appealableActionIds),
	};
}

/**
 * The cell below a restriction row, one of three:
 * - `open`: an appeal was filed and is under review, so there is no second button.
 * - `appealable`: the server will accept an appeal for this action, so show the `Appeal` button.
 * - `unavailable`: the action will not be appealed, shown as a sentence rather than a disabled
 *   button.
 *
 * Ordering is the rule. An open appeal is checked before the appealable list, so even if the two
 * server axes briefly disagree between invalidations, no second button appears over an appeal
 * already filed.
 */
export type AppealSlot = "open" | "appealable" | "unavailable";

export function appealSlotFor(
	actionId: string,
	view: Pick<
		AccountModerationView,
		"openAppealActionIds" | "appealableActionIds"
	>,
): AppealSlot {
	if (view.openAppealActionIds.has(actionId)) return "open";
	if (view.appealableActionIds.has(actionId)) return "appealable";
	return "unavailable";
}
