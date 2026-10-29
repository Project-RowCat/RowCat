/**
 * Output policy for narration packs: a RowCat-owned block placed after the pack body.
 *
 * The pack body is original work that this repository never edits (it is replaced wholesale), so
 * two problems are handled at the injection boundary:
 * - Compact variants instruct a cast-status table even when the character card is off. Hiding it
 *   in the UI is too late, since the output tokens are already spent.
 * - The NARRATIVE NAVIGATOR tracking block is told to go at the top of every response. In the
 *   short length setting (768 tokens) it can use much of the cap, and the response is cut off
 *   before the body. Continuing generation redraws the table.
 *
 * Narrowing removes the cast-status instruction lines (stripCastTrackingLines). The policy is
 * appended after the body, so later, more specific instructions win. Narrowing can fail silently if
 * the pack wording changes; the app-level parity test
 * (apps/web/src/test/prompt-pack-parity.test.ts) checks the real bodies.
 *
 * Not handled here: parsing block contents (only whole lines are removed), numeric token budgets
 * (ordering and caps are stated in words), and locale branching (block names keep the pack's own
 * words, because they are the screen parser's trigger; see CHAT_TRACKING_BLOCK_LABELS).
 */

/**
 * The pack's vocabulary for the cast-status table, as a closed list. `Character Database` is the
 * summary name of the collapsible block, and so the screen parser's trigger. `RELATION DATABASE` is
 * the heading of the section that directs that block. `relation database(s)` is how prose refers to
 * it. All three are checked together, because twelve variants mix them. Checking only one would
 * leak in the variants that use the others. Deliberately not widened: broad words such as
 * `database` or `tracking` would also remove pack lines that describe the pack's own `Logic` block,
 * and that loss would hit conversations with the character card on too.
 */
const CAST_TRACKING_TERMS = [
	"character database",
	"relation database",
] as const;

const CAST_TRACKING_LINE = new RegExp(CAST_TRACKING_TERMS.join("|"), "i");

/**
 * The body with the lines that direct the cast-status table removed. The unit is the line, and that
 * is the whole function. Rewriting sentences or cutting clauses would be a claim about the body's
 * structure, and after an update nobody could explain what was cut. A line is a unit the pack
 * divided on itself, so it makes no such claim. If nothing matches, the same string object is
 * returned. The character-card-on conversation (`sim` variant) skips this function. Even if it
 * passed through, the value must not change; that is the contract.
 */
export function stripCastTrackingLines(body: string): string {
	if (!CAST_TRACKING_LINE.test(body)) return body;
	return body
		.split("\n")
		.filter((line) => !CAST_TRACKING_LINE.test(line))
		.join("\n");
}

/**
 * RowCat's policy, placed after the pack body. Four rules:
 * 1. The body comes first. The pack says to put the `Logic` block at the top, and that table
 *    takes the budget first.
 * 2. The tracking block is short. The internal status table is not written for the reader, so
 *    there is no reason to lengthen it.
 * 3. When the budget runs short, drop the tracking block. A response without the body is a
 *    failure; a response without tracking is normal.
 * 4. When the character card is off, there is no cast-status table.
 *
 * Rule 3 is the core. Without it, responses still draw the full table and get cut off in the body,
 * which reaches the user as an empty bubble.
 *
 * The block names are not translated into this repo's words on purpose. The model must follow the
 * pack's name, and that name is also the screen parser's trigger.
 */
export function narrationOutputPolicy(input: {
	castTracking: boolean;
}): string {
	const lines = [
		"# [출력 규약 · 서술 지침보다 우선]",
		"위 서술 지침의 출력 형식 중 아래와 충돌하는 부분은 아래를 따릅니다.",
		"- 이야기 본문을 **먼저** 씁니다. `Logic` 같은 추적 블록은 위 지침이 어디에 두라고 했든 **응답의 맨 끝**에 한 번만 붙입니다.",
		"- 추적 블록은 각 항목을 짧은 낱말·구로만 적습니다. 지난 응답과 달라지지 않은 항목은 다시 설명하지 않습니다.",
		"- 남은 분량이 부족하면 **추적 블록을 생략하고 본문을 끝맺습니다.** 본문 없이 추적 블록만 있는 응답은 응답이 아닙니다.",
	];
	/**
	 * Nothing is said when the card is on. The pack already directs the block. Adding 'draw it' here
	 * again would create the same instruction in two places, and one day only one of them would get
	 * fixed.
	 */
	if (!input.castTracking)
		lines.push(
			"- 인물 상태표(`Character Database` · `RELATION DATABASE` · 그에 준하는 인물별 상태·관계·호감도 표)는 **이 대화에서 사용하지 않습니다.** 어떤 형태로도 출력하지 마세요.",
		);
	return lines.join("\n");
}

/**
 * The pack body plus the policy becomes the narration block that is actually sent. Narrowing and
 * the policy are one function on purpose. Narrowing without the policy drops the ordering
 * instruction in three of the twelve variants. The policy without narrowing puts the body's
 * instruction and ours in direct conflict, and the model wavers. The symptom is not an error but
 * 'sometimes works, sometimes does not'. An empty body returns an empty string. A policy with no
 * pack to override would only add a paragraph trying to cover an instruction that does not exist.
 */
export function applyNarrationOutputPolicy(
	body: string,
	settings: { castTracking: boolean },
): string {
	if (!body.trim()) return body;
	const narrowed = settings.castTracking ? body : stripCastTrackingLines(body);
	return `${narrowed.trimEnd()}\n\n${narrationOutputPolicy(settings)}`;
}
