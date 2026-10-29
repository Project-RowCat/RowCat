import { describe, expect, it } from "vitest";
import {
	CHAT_REPLY_SUGGESTION_COUNT,
	CHAT_REPLY_SUGGESTION_MAX_LENGTH,
	type ReplySuggestionMessage,
} from "./reply-suggestion.ts";
import {
	buildReplySuggestionRequest,
	parseReplySuggestions,
} from "./reply-suggestion-prompt.ts";

const line = (
	role: "user" | "assistant",
	content: string,
	speaker = "",
): ReplySuggestionMessage => ({ role, speaker, content });

const build = (
	overrides: Partial<Parameters<typeof buildReplySuggestionRequest>[0]> = {},
) =>
	buildReplySuggestionRequest({
		persona: { name: "지훈", description: "말수가 적은 사람." },
		messages: [line("assistant", "비가 그쳤다.")],
		allAges: true,
		...overrides,
	});

const json = (value: unknown): string => JSON.stringify(value);

describe("buildReplySuggestionRequest", () => {
	/**
	 * Guards the no-tools rule in buildReplySuggestionRequest. See the rationale there.
	 */
	it("carries no tools", () => {
		expect(build().tools).toEqual([]);
	});

	it("carries only the role and the recent conversation", () => {
		const body = build().messages[0]?.content ?? "";
		expect(body).toContain("# 내 역할");
		expect(body).toContain("지훈");
		expect(body).toContain("말수가 적은 사람.");
		expect(body).toContain("# 최근 대화");
		expect(body).toContain("비가 그쳤다.");
	});

	it("does not invent a name without a role", () => {
		const body = build({ persona: null }).messages[0]?.content ?? "";
		expect(body).toContain("작품이 정하지 않았습니다");
		expect(body).not.toContain("이름:");
	});

	it("keeps the user turn's speaker as is, `me` when absent", () => {
		const body =
			build({
				messages: [line("user", "여기 있을게.", "지훈"), line("user", "…")],
			}).messages[0]?.content ?? "";
		expect(body).toContain("지훈: 여기 있을게.");
		expect(body).toContain("나: …");
	});

	/**
	 * Tracking blocks and situation-image tokens are not body text. In this short-window request they
	 * would take most of the budget and say nothing about what to say next.
	 */
	it("strips tracking blocks and scene image tokens", () => {
		const body =
			build({
				messages: [
					line(
						"assistant",
						"문이 열렸다.\n[img:night]\n<details><summary>Logic</summary>\n표 내용\n</details>",
					),
				],
			}).messages[0]?.content ?? "";
		expect(body).toContain("문이 열렸다.");
		expect(body).not.toContain("Logic");
		expect(body).not.toContain("표 내용");
		expect(body).not.toContain("[img:night]");
	});

	it("a row whose body was entirely a tracking block does not leave only the speaker", () => {
		const body =
			build({
				messages: [
					line(
						"assistant",
						"<details><summary>Character Database</summary>표</details>",
					),
					line("assistant", "비가 그쳤다."),
				],
			}).messages[0]?.content ?? "";
		expect(body).not.toMatch(/^이야기:\s*$/m);
	});

	/**
	 * Rating follows the room, unlike maintenance. This is the easiest decision in the slice to
	 * reverse, so the value is pinned here.
	 */
	it("takes the rating from the room as is", () => {
		expect(build({ allAges: true }).context?.requestedMode).toBe("all-ages");
		expect(build({ allAges: false }).context?.requestedMode).toBe("adult");
	});

	it("buys no reasoning and is not a continuation: distinguishes omitted from removed", () => {
		const request = build();
		expect(request.reasoningEffort).toBeNull();
		expect(request.continuation).toBe(false);
	});

	/**
	 * This request is not a roleplay turn. Creator settings would make the model start acting out the
	 * scene, and one utility call would cost as much as a chat turn.
	 */
	it("carries no story settings, lore, memories, summary or narration pack", () => {
		const body = build().messages[0]?.content ?? "";
		for (const heading of ["# 세계관", "# 로어", "# 장기 기억", "# 이전 요약"])
			expect(body).not.toContain(heading);
	});

	it("stands the boundary once more after the data", () => {
		const body = build().messages[0]?.content ?? "";
		expect(body.trimEnd().endsWith("JSON 하나로 출력하세요.")).toBe(true);
	});
});

describe("parseReplySuggestions", () => {
	it("strips code fences and one line before and after", () => {
		expect(
			parseReplySuggestions(
				'아래와 같습니다:\n```json\n{"suggestions":["가","나","다"]}\n```',
			),
		).toEqual(["가", "나", "다"]);
	});

	it("`null` when malformed: stands nothing on screen", () => {
		expect(parseReplySuggestions("추천 세 개를 드릴게요")).toBeNull();
		expect(parseReplySuggestions("{ not json ")).toBeNull();
		expect(parseReplySuggestions(json({ suggestions: "가" }))).toBeNull();
	});

	it("refuses wholesale with unknown keys", () => {
		expect(
			parseReplySuggestions(json({ suggestions: ["가"], note: "무시" })),
		).toBeNull();
	});

	it("stands only up to the requested count", () => {
		expect(
			parseReplySuggestions(json({ suggestions: ["가", "나", "다", "라"] })),
		).toHaveLength(CHAT_REPLY_SUGGESTION_COUNT);
	});

	it("stands as many as there are when short: does not throw away a whole paid call", () => {
		expect(parseReplySuggestions(json({ suggestions: ["가", "나"] }))).toEqual([
			"가",
			"나",
		]);
	});

	it("`null` when none remain", () => {
		expect(
			parseReplySuggestions(json({ suggestions: ["", "   "] })),
		).toBeNull();
		expect(parseReplySuggestions(json({ suggestions: [] }))).toBeNull();
	});

	/**
	 * The speaker is stored separately as `speaker`. If the name stayed in the body, the room history
	 * would show `Jihoon: Jihoon: …`.
	 */
	it("strips the speaker prefix at the start of a line", () => {
		expect(
			parseReplySuggestions(json({ suggestions: ["지훈: 여기 있을게."] })),
		).toEqual(["여기 있을게."]);
	});

	it("leaves colons inside the body alone", () => {
		expect(
			parseReplySuggestions(
				json({ suggestions: ["3시 30분에 보자고 했잖아."] }),
			),
		).toEqual(["3시 30분에 보자고 했잖아."]);
		expect(
			parseReplySuggestions(
				json({
					suggestions: [
						"어제 네가 한 말이 계속 맴돌아서 잠을 못 잤다고 말하려다 참았다: 지금은 아니야.",
					],
				}),
			),
		).toEqual([
			"어제 네가 한 말이 계속 맴돌아서 잠을 못 잤다고 말하려다 참았다: 지금은 아니야.",
		]);
	});

	/**
	 * A short colon at the start of a sentence is not a name. Reading a whitespace-containing chunk as
	 * a name would cut the start of the suggestion before it reaches the input box.
	 */
	it("a head holding whitespace or asterisks does not read as a name", () => {
		for (const text of [
			"하나만 물어볼게요: 어디 가는 거예요?",
			"*조용히 고개를 저으며* 말한다: 아니, 괜찮아.",
			"*끄덕이며*: 알았어.",
		])
			expect(parseReplySuggestions(json({ suggestions: [text] }))).toEqual([
				text,
			]);
	});

	it("strips one layer of wrapping quotes while keeping inner quotes", () => {
		expect(parseReplySuggestions(json({ suggestions: ['"가자."'] }))).toEqual([
			"가자.",
		]);
		expect(
			parseReplySuggestions(json({ suggestions: ['그가 "가자"고 했다.'] })),
		).toEqual(['그가 "가자"고 했다.']);
	});

	it("does not stand the same sentence twice: that is one fewer choice", () => {
		expect(
			parseReplySuggestions(json({ suggestions: ["가자.", "가자.", "남자."] })),
		).toEqual(["가자.", "남자."]);
	});

	/**
	 * Roleplay dialogue is in double quotes, so the model often leaves them unescaped inside a JSON
	 * string. Each such case discarded a paid call and showed an unexplained failure.
	 */
	it("repairs unescaped dialogue quotes inside strings", () => {
		expect(
			parseReplySuggestions(
				'{"suggestions":["*손을 내밀며* "같이 가자."","그가 "왜?"라고 묻자 고개를 젓는다.","*물러선다*"]}',
			),
		).toEqual([
			'*손을 내밀며* "같이 가자."',
			'그가 "왜?"라고 묻자 고개를 젓는다.',
			"*물러선다*",
		]);
	});

	it("repairs raw line breaks inside strings and trailing commas", () => {
		expect(
			parseReplySuggestions('{"suggestions":["가자.\n지금.","나",],}'),
		).toEqual(["가자.\n지금.", "나"]);
	});

	it("does not read braces in a trailing explanation as the object's end", () => {
		expect(
			parseReplySuggestions(
				'{"suggestions":["가","나"]}\n참고: 형식은 {suggestions} 입니다.',
			),
		).toEqual(["가", "나"]);
	});

	it("repair does not touch valid JSON: escaped quotes stay", () => {
		expect(
			parseReplySuggestions(json({ suggestions: ['그가 "가자"고 했다.'] })),
		).toEqual(['그가 "가자"고 했다.']);
	});

	it("still `null` when repair does not yield an object", () => {
		expect(parseReplySuggestions('{"suggestions":["가", "나"')).toBeNull();
		expect(parseReplySuggestions('["가","나"]')).toBeNull();
	});

	/**
	 * Over-length suggestions are dropped rather than cut. A cut sentence would land in the input box
	 * mid-sentence, and the user could not tell whether the model or the app truncated it.
	 */
	it("drops sentences over the cap rather than truncating", () => {
		const long = "가".repeat(CHAT_REPLY_SUGGESTION_MAX_LENGTH + 1);
		expect(parseReplySuggestions(json({ suggestions: [long, "나"] }))).toEqual([
			"나",
		]);
	});
});
