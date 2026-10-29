import type { ChatSeedLoreDto } from "@rowcat/contracts/chat";

/**
 * Lore selection: one algorithm, two views.
 * - selectLore returns the entries injected into the scene. selectLoreTraced returns the same run
 *   plus the reason for each entry.
 * - There is one implementation on purpose. A second copy of the rules could show an entry as
 *   matched in the inspector yet absent from the prompt. Authors would then give up fixing their
 *   lore, and no error would ever surface it.
 * - The decision list costs a small object per entry per turn. That is negligible next to
 *   building the prompt string, and it means the two results cannot diverge.
 * - Seed entries have no id. Names like lore:3 are positions valid only within one snapshot. The
 *   prefix and index say so, so the same number must not be read as the same entry across
 *   snapshots.
 */

/**
 * Why an entry was or was not injected. no-keys and no-key-match are kept apart on purpose.
 * - no-keys: the entry can never match (it has no keys and is not constant).
 * - no-key-match: the entry did not match this scene. Authors fix these two cases differently.
 */
export const CHAT_LORE_DECISION_REASONS = [
	"constant",
	"key-match",
	"no-key-match",
	"no-keys",
	"empty-content",
] as const;
export type ChatLoreDecisionReason =
	(typeof CHAT_LORE_DECISION_REASONS)[number];

/** One verdict per lore entry. This is the full decision list, not just the active entries. */
export interface ChatLoreDecision {
	/** Name valid only within this snapshot (for example lore:3). Seed data has no id. */
	id: string;
	/** Position in the seed array, which is the order the author wrote the entries in. */
	index: number;
	/**
	 * The entry's trigger keys. The screen shows these instead of a name, since seed data has no
	 * title.
	 */
	keys: readonly string[];
	position: ChatSeedLoreDto["position"];
	order: number;
	active: boolean;
	reason: ChatLoreDecisionReason;
	/**
	 * Matched key. Present only for key-match. When several keys match, this is the first one.
	 * Matching stops at the first hit (Array.prototype.some). Collecting all matches would need a
	 * second pass every turn with no effect on the prompt.
	 */
	matchedKey: string | null;
	/**
	 * Approximate size of the entry in the prompt, in characters. The header and separators are
	 * excluded.
	 */
	contentLength: number;
	/**
	 * Injected text. Present only when the entry is active; inactive text is not in the prompt at all.
	 */
	content: string | null;
	/** Position in the injection order after sorting. null when inactive. */
	injectedIndex: number | null;
}

export interface ChatLoreSelection {
	/** Entries to inject, in sorted order. */
	selected: ChatSeedLoreDto[];
	/** Decision list in seed-array order. Includes both active and inactive entries. */
	decisions: ChatLoreDecision[];
}

interface Verdict {
	active: boolean;
	reason: ChatLoreDecisionReason;
	matchedKey: string | null;
}

/**
 * One verdict. This is the whole rule. An entry is active if it is constant, or if one of its keys
 * partially matches recent chat or the current input. Not ported on purpose: legacy and/or/not
 * logic, group exclusion, recursive triggers, and vector similarity. No UI exists to fill those
 * fields, so no work could populate them. Implementing unused rules now would lock them in
 * unverified.
 */
function verdictFor(entry: ChatSeedLoreDto, haystack: string): Verdict {
	if (!entry.content.trim())
		return { active: false, reason: "empty-content", matchedKey: null };
	if (entry.constant)
		return { active: true, reason: "constant", matchedKey: null };
	let hasKey = false;
	for (const key of entry.keys) {
		const needle = key.trim().toLowerCase();
		if (needle.length === 0) continue;
		hasKey = true;
		if (haystack.includes(needle))
			return { active: true, reason: "key-match", matchedKey: key };
	}
	return {
		active: false,
		reason: hasKey ? "no-key-match" : "no-keys",
		matchedKey: null,
	};
}

/**
 * Selects the lore for the current scene and reports why each entry was chosen. Sorted by order,
 * descending. Ties keep their original order (stable sort), so the author's sequence is not
 * reversed arbitrarily.
 */
export function selectLoreTraced(
	lore: readonly ChatSeedLoreDto[],
	scanText: string,
): ChatLoreSelection {
	const haystack = scanText.toLowerCase();
	const verdicts = lore.map((entry) => ({
		entry,
		verdict: verdictFor(entry, haystack),
	}));

	const selected = verdicts
		.map((row, index) => ({ ...row, index }))
		.filter((row) => row.verdict.active)
		.sort((a, b) => b.entry.order - a.entry.order || a.index - b.index);

	/**
	 * Maps each sorted position back to its original seed index. The decision list keeps authoring
	 * order.
	 */
	const injected = new Map<number, number>();
	selected.forEach((row, position) => {
		injected.set(row.index, position);
	});

	const decisions: ChatLoreDecision[] = verdicts.map(
		({ entry, verdict }, index) => ({
			id: `lore:${index}`,
			index,
			keys: entry.keys,
			position: entry.position,
			order: entry.order,
			active: verdict.active,
			reason: verdict.reason,
			matchedKey: verdict.matchedKey,
			contentLength: entry.content.trim().length,
			content: verdict.active ? entry.content.trim() : null,
			injectedIndex: injected.get(index) ?? null,
		}),
	);

	return { selected: selected.map((row) => row.entry), decisions };
}

/**
 * Selects lore for the scene. This is the untraced view of selectLoreTraced. Not implemented
 * separately. Because both views share one code path, turning tracing on or off cannot change the
 * selection.
 */
export function selectLore(
	lore: ChatSeedLoreDto[],
	scanText: string,
): ChatSeedLoreDto[] {
	return selectLoreTraced(lore, scanText).selected;
}
