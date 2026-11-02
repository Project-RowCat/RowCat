import type {
	ManagedGenerationBlocker,
	ManagedGenerationBudgetDto,
} from "@rowcat/contracts";
import { formatCount, formatDuration } from "#/lib/format.ts";

/**
 * What the managed-generation card says, as values. Kept out of the component so each sentence can
 * be checked without rendering, and so "unknown" can never be drawn as "0" by a component that
 * reached for `?? 0`.
 *
 * The rule the whole card follows: `null` usage means the counter store could not be read, and the
 * ceilings are fail-closed — every managed request is being refused right now. The card says that,
 * rather than showing a full budget.
 */

/** One sentence per gate, naming the next step. The closed list makes a new blocker a compile error here. */
export const BLOCKER_SENTENCE: Record<ManagedGenerationBlocker, string> = {
	unconfigured:
		"No operator key (OPENROUTER_API_KEY is empty): managed generation does not exist in this deployment.",
	switched_off: "The chat feature switch is off below.",
	store_unavailable:
		"The counter store cannot be read, so every managed request is refused until it answers.",
	slots_full:
		"Every concurrent slot is taken; new requests get “try again in a moment”.",
	budget_exhausted:
		"Today's token budget is spent; members are sent to connect their own key until the window resets.",
};

export interface ManagedGenerationBudgetView {
	readonly rows: readonly { label: string; value: string }[];
	readonly blockers: readonly string[];
	/** True when nothing refuses a managed request now. */
	readonly open: boolean;
}

const unknown = "Unknown — the counter store did not answer";

export function managedGenerationBudgetView(
	budget: ManagedGenerationBudgetDto,
): ManagedGenerationBudgetView {
	const tokens = budget.dailyTokens;
	const tokensValue =
		tokens.used === null
			? unknown
			: `${formatCount(tokens.used)} of ${formatCount(tokens.limit)} (${formatCount(
					Math.max(0, tokens.limit - tokens.used),
				)} left)`;
	const resets =
		tokens.used === null
			? null
			: tokens.resetsInMs === null
				? "No window open — nothing spent yet"
				: `In ${formatDuration(Math.ceil(tokens.resetsInMs / 1000))}`;

	return {
		rows: [
			{
				label: "Operator key",
				value: budget.configured ? "Configured" : "Not configured",
			},
			{
				label: "Who may use it",
				value:
					budget.access === "everyone"
						? "Every signed-in member"
						: "Listed members, staff and admin",
			},
			{ label: "Tokens in this window", value: tokensValue },
			...(resets ? [{ label: "Window resets", value: resets }] : []),
			{
				label: "Streams open now",
				value:
					budget.concurrency.active === null
						? unknown
						: `${formatCount(budget.concurrency.active)} of ${formatCount(budget.concurrency.limit)}`,
			},
			{
				label: "Largest single call",
				value: `${formatCount(budget.requestTokenLimit)} tokens (estimated input + output cap)`,
			},
			{
				label: "Per member",
				value: `${formatCount(budget.perMember.perMinute)} / min · ${formatCount(budget.perMember.perDay)} / 24 h`,
			},
			{
				label: "Counted by",
				value:
					budget.store === "redis"
						? "Redis — shared by every replica"
						: "This process only (no REDIS_URL) — each replica counts its own",
			},
		],
		blockers: budget.blockers.map((blocker) => BLOCKER_SENTENCE[blocker]),
		open: budget.blockers.length === 0,
	};
}
