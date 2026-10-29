import type { ChatSeedLoreDto } from "@rowcat/contracts/chat";
import { selectLore } from "./lore.ts";
import type { ChatTool } from "./tool.ts";

/**
 * This repository's first tool: the model looks up this story's setting material itself.
 *
 * Until now, lore enters the prompt only when a keyword appears in the conversation text. The gap
 * this fills: an entry keyed as `lord` does not fire when the user asks 'who rules this village?', so
 * the model answers without material that is in the room. That failure is silent. It shows up as
 * invented setting, not as an empty answer.
 *
 * There is no second selector. The handler calls the same `selectLore` the assembler calls, because
 * two selectors would give two answers to one question.
 *
 * The creator's words do not enter the prompt. The declaration is one general description line, not
 * a key list. A key list would mix the creator's words into the model's sentences and lengthen
 * every turn's prompt. This is the same decision as the situation-image feature, which does not
 * tell the model the trigger list.
 *
 * Not here: storage, transport, and React (lore lives in the room record, so the tool is pure);
 * removing entries already injected (the function does not know what the assembler chose this turn,
 * and the cost is duplicated tokens, which is cheaper than the wiring that would be needed); and
 * writes (search changes nothing).
 */

/** The name the model calls. It has the shape all three providers accept without conversion. */
export const CHAT_LORE_TOOL_NAME = "lore_search";

/**
 * The upper limit on entries returned at once. The character cap is applied separately by result
 * assembly (`CHAT_MAX_TOOL_RESULT_CHARS`), but alone it lets one long entry push out the others.
 * Cutting by entry count first makes the cut land on an entry boundary, so the model reads fewer
 * half-cut settings as fact.
 */
export const CHAT_LORE_TOOL_MAX_ENTRIES = 4;

/**
 * Keeps only the entries that are eligible for search. Two kinds are removed. Always-injected
 * entries (`constant`) are already in the prompt and would waste a round trip. Non-constant entries
 * with no keys can never match under the contract, so search cannot find them either.
 */
const searchable = (
	lore: readonly ChatSeedLoreDto[],
): readonly ChatSeedLoreDto[] =>
	lore.filter((entry) => !entry.constant && entry.keys.length > 0);

/**
 * This room's lore search tool, or `null` when there is nothing to find. Returning `null` rather
 * than an empty registration is the point. A room with no lore sends a request with no declaration
 * at all, byte for byte what it was before this axis existed, so cost attaches only to
 * conversations where the tool has real work.
 */
export function chatLoreTool(
	lore: readonly ChatSeedLoreDto[],
): ChatTool | null {
	const entries = searchable(lore);
	if (entries.length === 0) return null;

	return {
		declaration: {
			name: CHAT_LORE_TOOL_NAME,
			description:
				"이 이야기의 설정 자료를 찾습니다. 인물·장소·사건·물건의 이름이나 그와 관련된 낱말을 넣으세요. 지금 대화에 자동으로 딸려오지 않은 자료까지 닿습니다.",
			parameters: [
				{
					name: "query",
					type: "string",
					description: "찾을 이름이나 낱말",
					required: true,
					choices: [],
				},
			],
		},
		run: async (args) => {
			const query = typeof args.query === "string" ? args.query : "";
			/**
			 * This is the same selector the assembler uses. The query takes the place of the conversation
			 * text, and the matching rules (substring, case-insensitive, priority) are identical.
			 */
			return selectLore([...entries], query)
				.slice(0, CHAT_LORE_TOOL_MAX_ENTRIES)
				.map((entry) => entry.content.trim())
				.filter((content) => content.length > 0)
				.join("\n\n");
		},
	};
}
