import { describe, expect, it } from "vitest";
import {
	CHAT_TRACKING_BLOCK_LABELS,
	CHAT_VISIBLE_TRACKING_BLOCK_KINDS,
	splitChatTrackingBlocks,
	visibleChatTrackingBlocks,
} from "./tracking-block.ts";

const wrap = (label: string, body: string): string =>
	`<details><summary>${label}</summary>\n${body}\n</details>`;

describe("splitting off tracking blocks", () => {
	it("a body without packs returns **as the same object**", () => {
		const text = "문을 열자 찬 바람이 들이쳤다.\n\n세나가 고개를 들었다.";
		const split = splitChatTrackingBlocks(text);
		expect(split.blocks).toEqual([]);
		/*
		 * Reference identity is the performance contract. The screen that draws hundreds of stored
		 * messages depends on it.
		 */
		expect(split.body).toBe(text);
	});

	it("splits the Logic block off the body", () => {
		const split = splitChatTrackingBlocks(
			`이야기 본문.\n\n${wrap("Logic", "[Turn] 3\n[Scan] Violation: | Bias:")}`,
		);
		expect(split.body).toBe("이야기 본문.");
		expect(split.blocks).toEqual([
			{ kind: "logic", content: "[Turn] 3\n[Scan] Violation: | Bias:" },
		]);
	});

	it("splits two blocks off in the order they appear", () => {
		const split = splitChatTrackingBlocks(
			`본문.\n\n${wrap("Logic", "L")}\n\n${wrap("Character Database", "C")}`,
		);
		expect(split.body).toBe("본문.");
		expect(split.blocks.map((block) => block.kind)).toEqual(["logic", "cast"]);
	});

	it("keeps both when there are two of the same kind", () => {
		const split = splitChatTrackingBlocks(
			`${wrap("Logic", "A")}\n본문\n${wrap("Logic", "B")}`,
		);
		expect(split.blocks.map((block) => block.content)).toEqual(["A", "B"]);
		expect(split.body).toBe("\n본문");
	});

	it("blocks with unknown names stay in the body", () => {
		const raw = `본문\n\n${wrap("Notes", "여기는 제작자의 글")}`;
		const split = splitChatTrackingBlocks(raw);
		expect(split.blocks).toEqual([]);
		expect(split.body).toBe(raw);
	});

	it("accepts tags mixed with whitespace and line breaks", () => {
		const split = splitChatTrackingBlocks(
			"본문\n<details>\n  <summary> Logic </summary>\n[Turn] 1\n</details>",
		);
		expect(split.blocks).toEqual([{ kind: "logic", content: "[Turn] 1" }]);
	});

	it("accepts opening tags with attributes and wobbly names", () => {
		for (const raw of [
			"본문\n<details open><summary>Logic</summary>L</details>",
			"본문\n<details><summary>logic</summary>L</details>",
			"본문\n<DETAILS><SUMMARY>LOGIC</SUMMARY>L</DETAILS>",
			"본문\n<details><summary>**Logic**</summary>L</details>",
			'본문\n<details><summary class="x">character  database</summary>L</details>',
		]) {
			const split = splitChatTrackingBlocks(raw);
			expect(split.body).toBe("본문");
			expect(split.blocks).toHaveLength(1);
		}
	});

	it("wobbly names outside the closed vocabulary stay", () => {
		const raw = "본문\n<details><summary>**Notes**</summary>L</details>";
		expect(splitChatTrackingBlocks(raw).body).toBe(raw);
	});

	describe("streaming", () => {
		it("hides the head of an unclosed block", () => {
			for (const tail of [
				"<",
				"<d",
				"<det",
				"<details>",
				"<details><summary>Logic</summary>\n[Turn] 3\n[Scan] ",
			]) {
				const split = splitChatTrackingBlocks(`본문이 흐른다.\n\n${tail}`, {
					streaming: true,
				});
				expect(split.body).toBe("본문이 흐른다.");
				expect(split.blocks).toEqual([]);
			}
		});

		it("splits completed blocks off while streaming too", () => {
			const split = splitChatTrackingBlocks(
				`본문\n\n${wrap("Logic", "L")}\n\n<details><summary>Char`,
				{ streaming: true },
			);
			expect(split.blocks).toEqual([{ kind: "logic", content: "L" }]);
			expect(split.body).toBe("본문");
		});

		it("does not hide the body after an already closed block", () => {
			const raw =
				"<details><summary>상태창</summary>HP 10</details>\n\n세라가 고개를 든다.";
			expect(splitChatTrackingBlocks(raw, { streaming: true }).body).toBe(raw);
			const tail = `${raw}\n\n<details><summary>Logic</summary>\n[Turn] 3`;
			expect(splitChatTrackingBlocks(tail, { streaming: true }).body).toBe(raw);
		});

		/**
		 * A tail that cannot become a token stays visible, the same trade-off as in parseChatContent.
		 */
		it("does not hide tails that cannot become blocks", () => {
			const split = splitChatTrackingBlocks("3 < 5 이므로", {
				streaming: true,
			});
			expect(split.body).toBe("3 < 5 이므로");
		});

		/**
		 * Text streams in one character per frame without making the screen jump. The body only grows
		 * monotonically and stops growing once a block opens.
		 */
		it("streaming one character at a time never moves the body backwards", () => {
			const full = `문을 열었다.\n\n${wrap("Logic", "[Turn] 1\n[Emo] 세나: 경계")}`;
			let previous = "";
			for (let at = 1; at <= full.length; at++) {
				const { body } = splitChatTrackingBlocks(full.slice(0, at), {
					streaming: true,
				});
				expect(body.length).toBeGreaterThanOrEqual(previous.length);
				previous = body;
			}
			expect(previous).toBe("문을 열었다.");
		});
	});

	it("the vocabulary is just the two names the pack bodies use", () => {
		expect([...CHAT_TRACKING_BLOCK_LABELS].sort()).toEqual([
			"Character Database",
			"Logic",
		]);
	});
});

describe("what to draw", () => {
	/**
	 * Progress records must be stripped from the body and must not be drawn. Stripping and drawing
	 * shows a panel nobody chose on every response. Leaving them in the body shows tags and internal
	 * state as raw text.
	 */
	it("the drawn vocabulary is the character card alone", () => {
		expect([...CHAT_VISIBLE_TRACKING_BLOCK_KINDS]).toEqual(["cast"]);
	});

	it("the progress log leaves the body but is not drawn", () => {
		const split = splitChatTrackingBlocks(
			`이야기 본문.\n\n${wrap("Logic", "[Turn] 3\n[Err] Violation: …")}`,
		);
		/* Stripping still applies. Leaving the blocks in would show their tags as text. */
		expect(split.body).toBe("이야기 본문.");
		expect(split.blocks).toHaveLength(1);
		expect(visibleChatTrackingBlocks(split.blocks)).toEqual([]);
	});

	it("character cards are drawn as is", () => {
		const split = splitChatTrackingBlocks(
			`본문.\n\n${wrap("Logic", "[Turn] 3")}\n${wrap("Character Database", "| 세나 | 경계 |")}`,
		);
		expect(visibleChatTrackingBlocks(split.blocks)).toEqual([
			{ kind: "cast", content: "| 세나 | 경계 |" },
		]);
	});

	/*
	 * Most conversations do not use a pack, and hundreds of stored messages pass through this path.
	 */
	it("returns **the same array object** when there is nothing to filter", () => {
		const blocks = [{ kind: "cast", content: "| 세나 |" }] as const;
		expect(visibleChatTrackingBlocks(blocks)).toBe(blocks);
		expect(visibleChatTrackingBlocks([])).toEqual([]);
	});
});
