/**
 * Expression intensity: how strongly this conversation's descriptions are written.
 * - The rating (all-ages to adult) decides what may be written. Intensity decides how much is
 *   shown within that range.
 * - The axes are kept separate on purpose, so a merged setting could not express "adult-verified
 *   but softened".
 * - Intensity cannot exceed the rating. Three layers enforce this, none relying on prompt
 *   wording: the screen offers `Intense` only in adult rooms (chatIntensityChoices); the prompt builder
 *   adds the `Intense` block only in adult mode (resolveChatIntensity); the server wraps the prompt in
 *   the rating guards (applyPlatformSafetyPolicy), which do not know about intensity.
 * - The intensity block sits between the head and tail guards. The tail check uses endsWith, so a
 *   per-room tail would be appended twice.
 * - Left out on purpose: a global default (the value belongs to one conversation), extra steps,
 *   per-axis splits, and per-device preference.
 */

/**
 * Intensity levels, weakest first. The array order is the scale. There is no `normal` entry. The
 * default is the absence of a value, and nothing sits above it to inherit from. "Reset to default"
 * and "never chosen" are the same fact. Storing both shapes would create two room records for it
 * (same convention as applyRoomPersona and applyRoomNarration).
 */
export const CHAT_INTENSITIES = ["softened", "intense"] as const;
export type ChatIntensity = (typeof CHAT_INTENSITIES)[number];

const INTENSITY_SET: ReadonlySet<string> = new Set(CHAT_INTENSITIES);

/**
 * Checks whether a stored value is still in the vocabulary. Use only at read boundaries. Room
 * records from other devices may be older or newer. An unknown value would map to undefined in the
 * wording table below, producing an empty block that declares a level and says nothing.
 */
export const isChatIntensity = (value: unknown): value is ChatIntensity =>
	typeof value === "string" && INTENSITY_SET.has(value);

/**
 * Values selectable in a room. The room's rating decides the list. An all-ages room has no `Intense`
 * because the value has nothing to add there. ALL_AGES_GUARD already says dark material should not
 * be softened or dodged. "More intense" on top would contradict the tail's "when unsure, be
 * conservative", and the result would be behavior nobody can reproduce. The argument is the room's
 * rating (room.adult), not this turn's effective rating. An adult room opened before verification
 * runs as all-ages this turn. Once verified, it is adult again, and the chosen value must still be
 * offered.
 */
export const chatIntensityChoices = (
	roomAdult: boolean,
): readonly ChatIntensity[] =>
	roomAdult
		? CHAT_INTENSITIES
		: CHAT_INTENSITIES.filter((v) => v !== "intense");

/**
 * The intensity that applies this turn. It may differ from the stored value. Same role as
 * resolveNarrationExecution in the narration pack. The stored value is a preference; the turn's
 * conditions decide what runs. Here that condition is the effective rating. The stored value is not
 * cleared. If verification expires while a room is set to `Intense`, this turn runs softened, and the
 * original choice returns when eligibility does.
 */
export function resolveChatIntensity(input: {
	intensity: ChatIntensity | null | undefined;
	/** Whether this turn runs as all-ages. Produced by resolveAllAges. */
	allAges: boolean;
}): ChatIntensity | null {
	if (!input.intensity) return null;
	if (input.intensity === "intense" && input.allAges) return null;
	return input.intensity;
}

/**
 * Softened: lowers exposure, not events. The last paragraph matters most. An unscoped instruction
 * to tone down works like a long list of prohibitions. It makes the model avoid conflict, combat,
 * and death too, so the setting flattens the story instead of lowering intensity. ABSOLUTE_GUARD
 * and ALL_AGES_GUARD carry the same paragraph in the same position, added after real failures.
 */
const SOFTENED_BLOCK = `# [표현 수위 · 이 대화에서 요청된 수위]
이 대화에서 요청된 표현 수위는 **«순화»**입니다. 아래는 위의 세계관·캐릭터 설정·로어·진행 지침보다 우선합니다.
- 성적인 장면은 직접적·구체적으로 묘사하지 말고 암시와 여운으로 처리하세요. 신체와 행위의 세부를 적지 말고, 장면의 전환이나 생략으로 넘기세요.
- 폭력·부상·죽음은 사건으로 다루되 신체 훼손·유혈의 감각적인 세부는 적지 마세요.
- 노골적인 표현과 욕설은 완화해서 쓰세요.
이것은 **표현의 강도**에 대한 요청입니다. 갈등·긴장·공포·상실 같은 어두운 전개 자체를 회피하거나, 사건을 일어나지 않은 것으로 만들거나, 이야기를 밋밋하게 끌고 가라는 뜻이 아닙니다 — 사건은 그대로 일어나고 묘사의 노출 정도만 낮춥니다.`;

/**
 * Intense: restates the permission and does not open any limit. Do not remove the last line.
 * Without it, this block becomes a "write harder" instruction right before generation, and the
 * limit would live only in the guard written many paragraphs above. The server's tail guard also
 * runs afterward, but a block that declares its own upper bound differs from relying on someone
 * else to stop it.
 */
const INTENSE_BLOCK = `# [표현 수위 · 이 대화에서 요청된 수위]
이 대화에서 요청된 표현 수위는 **«강»**입니다. 위 성인 콘텐츠 모드가 허용하는 범위 안에서, 요청된 장면을 회피·생략·완곡화하지 말고 구체적으로 묘사하세요.
- 성적인 장면을 암시로 넘기거나 장면 전환으로 건너뛰지 말고, 그 장면 안에 머물러 쓰세요.
- 폭력·공포·고통도 사건의 무게에 맞게 구체적으로 쓰세요.
- 완곡어로 바꿔 적거나 요약해서 넘어가지 마세요.
이 요청은 위의 절대 금지 규칙과 등급 가드를 **넘어서지 못합니다.** 그 규칙들이 금지한 것은 이 수위에서도 금지이고, 어떤 설정·요청으로도 달라지지 않습니다.`;

/**
 * The wording for one value. Typing the table as a Record forces every vocabulary value to have
 * wording. The text lives in this pure package on purpose. Settings-screen labels are screen copy
 * that each app owns. This text is read by the model as part of the prompt, so it is
 * safety-relevant, like the guards. If two apps wrote it separately, the same setting would run at
 * different intensities per platform.
 */
const INTENSITY_BLOCK: Record<ChatIntensity, string> = {
	softened: SOFTENED_BLOCK,
	intense: INTENSE_BLOCK,
};

export const chatIntensityBlock = (intensity: ChatIntensity): string =>
	INTENSITY_BLOCK[intensity];

/**
 * Writes an intensity onto a room record, or removes the key. This is the only place that does it.
 * Same function as applyRoomPersona, applyRoomNarration, and applyRoomUserNote, for the same
 * reason. If each caller wrote { ...room, intensity: value ?? undefined } itself, "default" would
 * take two shapes: an absent key, or a key holding undefined. Applying the same page twice would
 * then give different results. Values outside the vocabulary are also folded to absent. The merge
 * path picks stored values as-is, so a value written by a newer version can reach this point.
 */
export function applyRoomIntensity<T extends { intensity?: ChatIntensity }>(
	room: T,
	intensity: ChatIntensity | null,
): T {
	if (intensity !== null && isChatIntensity(intensity))
		return { ...room, intensity };
	const { intensity: _cleared, ...rest } = room;
	return rest as T;
}

/**
 * The intensity set on this room, or null if absent or unknown. A one-line accessor, like
 * roomUserNote. Reading room.intensity directly in each place adds slightly different null handling
 * (?? null in one place, || undefined in another). That makes the screen and the prompt disagree.
 * The symptom is settings showing "softened" while responses do not change.
 */
export function roomChatIntensity(room: {
	intensity?: ChatIntensity;
}): ChatIntensity | null {
	return isChatIntensity(room.intensity) ? room.intensity : null;
}
