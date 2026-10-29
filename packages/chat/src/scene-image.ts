import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";

/**
 * Scene images: token syntax, the automatic attachment rule, and splitting a message body into text
 * and image pieces. Drawing the images is left to each app.
 *
 * - Lives in the pure package because four consumers must produce identical results: the web and
 *   mobile chat screens, and the generation-finalize paths of both apps. Rules kept per app would
 *   show an image on one device and not on another.
 * - Builds no URLs. The module knows only the assetId string; the SDK builds GET /v2/media/:id.
 *   Letting this package know the origin would mean injecting it, which becomes a second transport
 *   configuration.
 * - Carries no bytes. The legacy path stored data URLs in the room record, which made it several
 *   megabytes.
 * - Does not touch the prompt. No block tells the model which trigger words exist: that would
 *   change context assembly (the determinism guarantee in context.ts) and push creator-chosen words
 *   into the model's sentences. A token the model writes itself is respected; if it writes none,
 *   automatic attachment (below) answers.
 */

/**
 * A complete token. The trigger pattern (`CHAT_SCENE_TRIGGER_PATTERN`) forbids `]` and newlines in
 * triggers; this regex is its counterpart. Reading one line at a time means a stray bracket cannot
 * swallow two paragraphs.
 */
const TOKEN_SOURCE = String.raw`\[img:([^\]\n\r]+)\]`;

/**
 * Each scan creates its own RegExp. A `g`-flag regex carries `lastIndex` as state, so with one
 * shared module-level instance, the position left by one call would make the next call skip the
 * first token. That failure depends on the input, so it appears and disappears and is hard to
 * reproduce.
 */
const scanner = (): RegExp => new RegExp(TOKEN_SOURCE, "g");

/** The existence check does not need the `g` flag. With no state, sharing one instance is safe. */
const TOKEN_TEST = new RegExp(TOKEN_SOURCE);

/**
 * An unfinished token, which only means something at the end of the text. It matches `[`, `[i`,
 * `[im`, `[img`, `[img:` and `[img:nig`. Streaming hides this tail; that is why the constant exists
 * (see `parseChatContent`).
 */
const PARTIAL_TOKEN = /\[(?:i(?:m(?:g(?::[^\]\n\r]*)?)?)?)?$/;

/**
 * Builds a token from a trigger. The side that attaches tokens and the side that renders them both
 * use this one function, so the format cannot drift.
 */
export const sceneImageToken = (trigger: string): string =>
	`[img:${trigger.trim()}]`;

/**
 * The lookup key for a trigger: trimmed and lowercased. Case is ignored because the same word
 * appears in two places, the trigger the creator typed and the same word in the model's text. The
 * model often capitalizes it at the start of a sentence while the creator writes it in lowercase in
 * the list. If the two keys differed, automatic attachment would never match.
 */
export const sceneTriggerKey = (trigger: string): string =>
	trigger.trim().toLowerCase();

/**
 * Maps each trigger to a scene image; the first one wins. Duplicate triggers can exist because the
 * contract is a list, not a set. The editor and publish validation block them, but snapshots
 * already stored and hand-built payloads skip that check. Picking arbitrarily would let the same
 * room draw different images on different devices; keeping the first in list order makes every
 * device agree.
 */
export function indexSceneImages(
	images: readonly ChatSeedSceneImageDto[],
): Map<string, ChatSeedSceneImageDto> {
	const byTrigger = new Map<string, ChatSeedSceneImageDto>();
	for (const image of images) {
		const key = sceneTriggerKey(image.trigger);
		if (!key || !image.assetId) continue;
		if (!byTrigger.has(key)) byTrigger.set(key, image);
	}
	return byTrigger;
}

/**
 * Converts one token into an image, or returns null. The screen must handle null quietly: deleted
 * assets, mistyped triggers, and text copied from another work all arrive here, and none of them is
 * a reason to stop the conversation.
 */
export function resolveSceneImage(
	images: readonly ChatSeedSceneImageDto[],
	trigger: string,
): ChatSeedSceneImageDto | null {
	return indexSceneImages(images).get(sceneTriggerKey(trigger)) ?? null;
}

export function hasSceneImageToken(text: string): boolean {
	return TOKEN_TEST.test(text);
}

/**
 * Returns the single scene image that applies to a response, or null. Matching is a
 * case-insensitive substring match, the same predicate as lore selection. If several triggers
 * match, the one whose trigger appears first in the text wins, with list order breaking ties.
 * Position is used because it is what the user reads first; list order alone would let a word
 * mentioned at the end of a paragraph override the scene the whole paragraph describes. Only one
 * image is chosen, since attaching several would turn one response into a gallery.
 */
export function matchSceneImage(
	text: string,
	images: readonly ChatSeedSceneImageDto[],
): ChatSeedSceneImageDto | null {
	const haystack = text.toLowerCase();
	let best: { image: ChatSeedSceneImageDto; at: number; order: number } | null =
		null;
	let order = 0;
	for (const image of indexSceneImages(images).values()) {
		const at = haystack.indexOf(sceneTriggerKey(image.trigger));
		const index = order++;
		if (at < 0) continue;
		if (!best || at < best.at || (at === best.at && index < best.order))
			best = { image, at, order: index };
	}
	return best?.image ?? null;
}

/**
 * Attaches a scene image to a finalized response, and only when there is a reason to. A response
 * that already contains a token is left as is, since the model chose the position. A response with
 * no matching trigger is also left as is, so no scene is invented. Otherwise one token line is
 * appended at the end: the end is the scene's result, and inserting it between paragraphs would
 * require knowing which sentence is the scene. The first case deliberately does not validate the
 * token, so the model's intent is respected even for an unknown trigger; the renderer quietly drops
 * tokens it cannot draw.
 */
export function finalizeWithSceneImage(
	text: string,
	images: readonly ChatSeedSceneImageDto[],
): string {
	if (!text.trim()) return text;
	if (hasSceneImageToken(text)) return text;
	const matched = matchSceneImage(text, images);
	if (!matched) return text;
	return `${text.replace(/\s+$/, "")}\n\n${sceneImageToken(matched.trigger)}`;
}

/**
 * A piece of a message body: either text or an image. An image piece carries only the trigger.
 * Address and size are deliberately absent; the room snapshot and the SDK-aware screen fill them
 * in. If the parser knew them, web and mobile could not share it.
 */
export type ChatContentNode =
	| { type: "text"; text: string }
	| { type: "image"; trigger: string };

export interface ParseChatContentOptions {
	/**
	 * Whether the text is still streaming. When true, an unfinished token at the end of the text is
	 * hidden. Without this, `[`, `[im` or `[img:nig` would appear on screen one after another before
	 * turning into an image, which leaks syntax rather than text. The cost is one frame of delay
	 * before a bracket shows, which is accepted. Tails that can never become a token, such as `[x`,
	 * still show.
	 */
	streaming?: boolean;
}

/**
 * Splits a body into pieces; with no tokens there is exactly one piece. This is a performance
 * contract: most conversations have no scene images, so for them the work is one regex pass and one
 * array. Markdown is not parsed here, since each app decides how to draw text (web uses Markdown,
 * mobile plain text). Whitespace-only pieces are dropped, because a token on its own line would
 * otherwise leave empty paragraphs on web and blank lines on mobile.
 */
export function parseChatContent(
	content: string,
	options?: ParseChatContentOptions,
): ChatContentNode[] {
	const nodes: ChatContentNode[] = [];
	const push = (text: string): void => {
		if (text.trim()) nodes.push({ type: "text", text });
	};

	let cursor = 0;
	const token = scanner();
	let match = token.exec(content);
	while (match) {
		push(content.slice(cursor, match.index));
		nodes.push({ type: "image", trigger: (match[1] as string).trim() });
		cursor = match.index + match[0].length;
		match = token.exec(content);
	}

	const tail = content.slice(cursor);
	push(options?.streaming ? tail.replace(PARTIAL_TOKEN, "") : tail);
	return nodes;
}
