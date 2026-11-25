/**
 * Progress rules: the block that protects the user's part in the story. They are not safety text and
 * no deployment switch removes them; the platform guards that once sat around them were deleted
 * (`docs/chat/PROMPT-PROTECTION.md`).
 */

/**
 * Progress rules: these protect the user's agency, not safety. Without them, the model writes the
 * user's lines, feelings, and consent, and the character the user plays disappears. Do not add
 * narration format markers (name labels, quotes, action markup) here; a forced format would fix
 * every room to one style. Style belongs to the character card, the world, and the progression
 * guide.
 *
 * This block is split into three parts. The narration pack's `assisted` and `auto` scopes exist so
 * the AI writes the user's character, which directly contradicts the first part. Sending
 * contradictory instructions makes the model waver, and the symptom is not an error but 'works
 * sometimes', which nobody can reproduce.
 *
 * - AGENCY: the user's character belongs to the user. Dropped only when the pack writes it.
 * - CONSENT: do not assume unstated consent. Never dropped, in any scope.
 * - CRAFT: character presence, consistency, and room to act. Independent of scope.
 *
 * The middle part must not be removed together with AGENCY. In the original, both rules sat on one
 * line ('do not over-interpret' and 'do not assume consent'). Dropping that whole line in autoplay
 * plus adult mode would leave nothing stopping the AI from writing the user's sexual consent.
 * Narrating for the user and consenting for the user are different acts.
 */
const ROLEPLAY_AGENCY = [
	"- 절대로 유저(상대역)의 대사·속마음·행동을 대신 묘사하지 마세요.",
	"- 유저의 입력은 적힌 그대로만 해석하세요. 짧은 입력을 확대해석해 유저가 하지 않은 행동·선택·발언을 기정사실로 삼지 마세요.",
	"- 입력이 모호하면 그 모호함을 유지한 채 다른 인물의 반응으로 이어가고, 필요하면 유저가 직접 정하도록 여지를 남기세요.",
];

/**
 * The two lines that replace the three AGENCY lines when the pack writes the user's character.
 * Deleting the lines is not enough. The pack's body decides how narration is written, but it does
 * not say the model may settle critical choices the user has not yet made (starting or ending a
 * relationship, leaving, betrayal, killing, irreversible decisions). Without a boundary, the model
 * would settle these for the user to advance the story. That takes ownership of the story, which is
 * more than narrating for the user.
 */
const ROLEPLAY_AGENCY_DELEGATED = [
	"- 유저(상대역)의 행동·대사·심리는 위 서술 지침이 정한 범위 안에서 대신 서술하세요.",
	"- 다만 유저가 아직 정하지 않은 중대한 선택(관계의 시작·단절, 이탈, 배신, 살해, 되돌릴 수 없는 결정)은 단정하지 말고, 그 갈림길에서는 유저가 고를 여지를 남기세요.",
];

/**
 * A line that stands in every scope; it belongs to neither branch above. It stays as-is in
 * conversations with delegated narration too. That is the entire reason for the split.
 */
const ROLEPLAY_CONSENT =
	"- 유저가 말하지 않은 의도·감정·**동의**를 넘겨짚지 마세요. 특히 신체 접촉·성적 상황에서 유저의 동의는 유저의 입력에만 있습니다.";

const ROLEPLAY_CRAFT = [
	"- 한 응답에는 현재 상황에서 자연스럽게 반응할 인물만 등장시키세요. 모든 인물이 매 턴 말할 필요는 없습니다.",
	"- 각 인물의 성격·말투·관계를 일관되게 유지하세요.",
	"- 유저가 이어서 반응할 여지를 남기세요.",
];

/**
 * Progress rules for this conversation.
 *
 * The argument is a boolean on purpose. A NarrationScope would make this file know the narration
 * pack's vocabulary, so adding a scope would mean editing safety text. The one question answered
 * here is whether the AI writes the user's character right now. That decision is made in
 * narration.ts (narrationWritesUser), and the value is true only when the pack is actually
 * included.
 */
export const roleplayRules = (writesUser: boolean): string =>
	[
		"# 진행 규칙",
		...(writesUser ? ROLEPLAY_AGENCY_DELEGATED : ROLEPLAY_AGENCY),
		ROLEPLAY_CONSENT,
		...ROLEPLAY_CRAFT,
	].join("\n");

/**
 * Default progress rules, for conversations without delegated narration.
 *
 * Not byte-for-byte the same as before this axis existed. The original second item put 'do not
 * over-interpret' and 'do not assume consent' on one line. That line had to be split once a scope
 * existed that removes the first half, since consent must hold in every scope. The split added one
 * sentence on the consent side, naming the source of consent in physical contact or sexual
 * situations.
 *
 * For conversations without delegated narration, the only effect is a slightly stronger rule. The
 * prompt prefix changes once, so existing rooms rewrite their cache once on the next turn. It stays
 * a constant because most call sites use this value directly.
 */
export const ROLEPLAY_RULES = roleplayRules(false);
