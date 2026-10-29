/**
 * Removes the tracking blocks that story packs append to every response, before the body goes to
 * markdown.
 *
 * - All 24 packs tell the model to append one or two fold blocks per response. The model keeps
 *   its own state there and reads it back on the next turn.
 * - `Logic` is the pack's internal judgment. `Character Database` is character state that readers
 *   see.
 * - Stripping and drawing are separate decisions. Every block is stripped; only the kinds in
 *   `CHAT_VISIBLE_TRACKING_BLOCK_KINDS` are drawn.
 * - Markdown cannot handle this. `@rowcat/markdown` folds raw HTML as text and must stay strict,
 *   since loosening it would widen the safety check for all authored text. Blocks are therefore
 *   removed before markdown, the same route as situation-image tokens, and each app draws them.
 * - The vocabulary is closed to the two pack names, so an author's own `<details>` stays in the
 *   body. `keys.test.ts` in `@rowcat/prompt-packs` checks that the summary names across the pack
 *   bodies are exactly these two (in a build that carries bodies; the public release ships none).
 * - Block contents are not parsed; they pass through verbatim. Stored messages are not modified:
 *   copy, search, and edit use the original text, and this function runs only on the render path.
 */

/**
 * Closed vocabulary. Two apps have tables typed as `Record` over this type, so adding a value here
 * breaks compilation in both.
 */
export const CHAT_TRACKING_BLOCK_KINDS = ["logic", "cast"] as const;
export type ChatTrackingBlockKind = (typeof CHAT_TRACKING_BLOCK_KINDS)[number];

/**
 * Maps the names the pack body uses to this vocabulary. It also keeps the pack's English names off
 * the screen: `Logic` and `Character Database` are words from the original work. User-facing copy
 * belongs to each app.
 */
const SUMMARY_LABELS: Record<string, ChatTrackingBlockKind> = {
	Logic: "logic",
	"Character Database": "cast",
};

/** Used by the check that confirms these names still appear in the pack body. */
export const CHAT_TRACKING_BLOCK_LABELS: readonly string[] =
	Object.keys(SUMMARY_LABELS);

/**
 * Normalizes a model-written name for comparison: folds case, removes emphasis markers wrapping the
 * whole name (`**Logic**`, `_Logic_`), and collapses inner whitespace. The pack spells names
 * exactly, but the model varies them. A missed variant shows the whole block as text, and only in
 * some responses of a conversation. Folding changes the shape only. After folding, the name must
 * still equal one of the two names, so the vocabulary stays closed.
 */
const foldLabel = (label: string): string =>
	label
		.trim()
		.replace(/^([*_]{1,3})([\s\S]*?)\1$/, "$2")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();

const FOLDED_LABELS: ReadonlyMap<string, ChatTrackingBlockKind> = new Map(
	Object.entries(SUMMARY_LABELS).map(([label, kind]) => [
		foldLabel(label),
		kind,
	]),
);

export interface ChatTrackingBlock {
	kind: ChatTrackingBlockKind;
	/** Text inside the block, verbatim. Only leading and trailing whitespace is trimmed. */
	content: string;
}

export interface ChatTrackingSplit {
	/** Body with the blocks removed. This is what goes to markdown. */
	body: string;
	/**
	 * Removed blocks, in order of appearance. A response can contain the same kind twice, since the
	 * model redraws tables. The parser does not keep only the last one: that would claim to know which
	 * is newest, and it cannot know that. Choosing the last one is the screen's decision.
	 */
	blocks: readonly ChatTrackingBlock[];
}

/**
 * Opening tag. The pack specifies `<details><summary>X</summary>` on one line, but the model adds
 * newlines and spaces freely, so the regex accepts generous whitespace. Case varies too, and
 * attributes appear (`<details open>`). Attributes are accepted only to recognize the tag; their
 * values are not read.
 */
const BLOCK =
	/<details\b[^>]*>\s*<summary\b[^>]*>\s*([^<]*?)\s*<\/summary>([\s\S]*?)<\/details\s*>/gi;

/** Cheap check for whether any closing tag exists, to decide if splitting is worth trying. */
const CLOSE_TAG = /<\/details\s*>/i;

/**
 * Head of a block that is still open while streaming. It works like the rule that hides partial `[`
 * or `[im` tokens before they finish (`parseChatContent`), but the tail is much longer: internal
 * state streams in for dozens of lines after an open `<details>`. If not hidden, all of it vanishes
 * when the response ends, so text appears and then disappears.
 */
const OPEN_TAIL =
	/<(?:d(?:e(?:t(?:a(?:i(?:l(?:s)?)?)?)?)?)?)?$|<details\b(?:(?!<\/details\s*>)[\s\S])*$/i;

export interface SplitChatTrackingBlocksOptions {
	/** Whether text is still streaming. When true, the head of an unclosed block is hidden. */
	streaming?: boolean;
}

/**
 * Strips tracking blocks from the body. With no blocks, the input comes back unchanged.
 *
 * The last sentence is this function's performance contract. Most conversations have no pack, so
 * the common case is one regex pass, and the screen rendering hundreds of stored messages must
 * absorb that cost. Reference identity is kept: when nothing matches, `body` is the same string
 * object that was passed in.
 */
export function splitChatTrackingBlocks(
	content: string,
	options?: SplitChatTrackingBlocksOptions,
): ChatTrackingSplit {
	const blocks: ChatTrackingBlock[] = [];
	let body = content;

	if (CLOSE_TAG.test(content)) {
		const kept: string[] = [];
		let cursor = 0;
		BLOCK.lastIndex = 0;
		let match = BLOCK.exec(content);
		while (match) {
			const kind = FOLDED_LABELS.get(foldLabel(match[1] ?? ""));
			if (kind) {
				kept.push(content.slice(cursor, match.index));
				blocks.push({ kind, content: (match[2] ?? "").trim() });
				cursor = match.index + match[0].length;
			}
			match = BLOCK.exec(content);
		}
		if (blocks.length) {
			kept.push(content.slice(cursor));
			body = kept.join("");
		}
	}

	/*
	 * Only the unfinished block at the tail is hidden. A `<details` in the middle of the body is left
	 * alone: that text has already streamed past, and hiding it would hide the sentences after it.
	 *
	 * 'Unfinished' means no closing tag follows (the second branch of `OPEN_TAIL`). The regex once
	 * read everything from the first `<details` to the end as the tail, so a response starting with a
	 * closed block, such as the author-requested status panel, lost its whole body. The same rule
	 * judges saved outcomes (`resolveGenerationOutcome`), so that response read as empty and was
	 * discarded.
	 */
	if (options?.streaming) body = body.replace(OPEN_TAIL, "");

	/*
	 * Where a block stood, a blank line remains. Passed through as is, web markdown renders an empty
	 * paragraph and mobile draws a blank line, adding a gap to the end of every message in a pack
	 * conversation. So trailing whitespace is trimmed when blocks were removed or while streaming.
	 */
	return {
		body: blocks.length || options?.streaming ? body.trimEnd() : body,
		blocks,
	};
}

/**
 * Kinds drawn on screen: a narrower set than the kinds stripped (`CHAT_TRACKING_BLOCK_KINDS`).
 * Stripping keeps the body readable, so it applies to every pack block. Drawing hands a value to
 * the reader and needs more justification.
 *
 * - `cast` (character state) is drawn, but only for users who opted in via `castTracking`. The
 *   character card is an axis users choose knowingly: it lengthens the prompt and the response (see
 *   `NARRATION_CAST_DESCRIPTION`).
 * - `logic` (the pack's internal judgment) is not drawn. It has no off switch, so it would reach
 *   everyone who uses a pack. The repo made the same call for rotation summaries, which are
 *   internal state no screen draws (`docs/chat/MEMORY.md`).
 * - Logic also carries the pack's self-harm safety verdict line (`[Err] Violation: High risk of
 *   self-harm …`), which someone in that state would read under their own conversation.
 *
 * Stripping still applies: leaving the block in the body would show raw tags and state, and saved
 * source is unchanged.
 *
 * Before adding a kind, settle the axis first: which setting enables it, whether that setting
 * belongs to the room or the device, and what it promises the user who turns it on.
 */
export const CHAT_VISIBLE_TRACKING_BLOCK_KINDS = ["cast"] as const;
export type ChatVisibleTrackingBlockKind =
	(typeof CHAT_VISIBLE_TRACKING_BLOCK_KINDS)[number];

/**
 * A block narrowed to the drawn kinds. The screen's copy table takes this vocabulary as a `Record`.
 */
export interface VisibleChatTrackingBlock extends ChatTrackingBlock {
	kind: ChatVisibleTrackingBlockKind;
}

const VISIBLE: ReadonlySet<string> = new Set(CHAT_VISIBLE_TRACKING_BLOCK_KINDS);

/**
 * Returns only the blocks that are drawn. Each app could write `filter(b => b.kind !== 'logic')`,
 * but that line can silently diverge: a commit that fixes one app passes compile and tests, and the
 * mismatch shows only when the two screens are compared side by side. With nothing to filter,
 * returns the same array object passed in, since most conversations have no pack and stored
 * messages pass through here.
 */
export function visibleChatTrackingBlocks(
	blocks: readonly ChatTrackingBlock[],
): readonly VisibleChatTrackingBlock[] {
	const visible = blocks.filter((block): block is VisibleChatTrackingBlock =>
		VISIBLE.has(block.kind),
	);
	return visible.length === blocks.length
		? (blocks as readonly VisibleChatTrackingBlock[])
		: visible;
}
