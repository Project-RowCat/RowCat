import type { Root } from "mdast";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type PluggableList, unified } from "unified";
import { normalizeChatMarkdown } from "./normalize.ts";
import { remarkChatSafety } from "./safety.ts";

/**
 * The one plugin list both platforms use (web passes it to react-markdown, mobile calls
 * `parseChatMarkdown`), so parser config cannot diverge.
 *
 * - `remark-breaks`: roleplay text breaks lines inside a paragraph; CommonMark would fold them to
 *   spaces. Line breaks are tree nodes so both renderers see the same fact.
 * - `remark-cjk-friendly`: under plain CommonMark a closing `**` after punctuation and before a
 *   letter does not close, which Korean particles hit constantly (`**"\uadf8\ub798"**\ub77c\uace0`). This changes how
 *   stored conversations render, but only in one direction — emphasis is gained, never lost
 *   (`parse.test.ts`). Its regexes use Unicode property escapes; an engine without them throws at
 *   load and the whole chat screen fails. Hermes accepts all four — re-check on engine changes.
 *   `parseOnly` because we never serialize. GFM strikethrough before a Korean particle is not covered.
 * - Safety runs last so GFM autolinks are checked too.
 */
export function chatRemarkPlugins(): PluggableList {
	// CJK after GFM: it overrides the emphasis rule.
	return [remarkGfm, remarkCjkFriendly, remarkBreaks, remarkChatSafety];
}

const processor = unified().use(remarkParse).use(chatRemarkPlugins());

/**
 * Source → folded mdast, for platforms without react-markdown. Callers memoize so only the
 * streaming line is re-parsed each frame.
 */
export function parseChatMarkdown(source: string): Root {
	const parsed = processor.parse(normalizeChatMarkdown(source));
	return processor.runSync(parsed) as Root;
}
