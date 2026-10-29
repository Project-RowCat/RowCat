import { describe, expect, it } from "vitest";
import type { SearchableMessage } from "./search.ts";
import { searchMessages } from "./search.ts";

/**
 * Search speed measurement. This file exists so that performance claims are measured, not invented.
 * The linear scan (no search index library) is only a matter of taste until it is measured. The
 * test builds corpora of 100, 1,000 and 5,000 messages of realistic length and times one call per
 * typed keystroke.
 */

/**
 * Roleplay-like text in length and tone. No randomness is used, so every run uses the same corpus.
 */
const PARAGRAPHS = [
	"차가운 바람이 문틈으로 스며들었다. 그는 잠시 숨을 고르고, 어둠 속에서 흔들리는 등불을 바라보았다.",
	"He hesitated at the threshold, one hand resting on the cold iron handle, listening to the rain outside.",
	"멀리서 종소리가 울렸다. 세 번, 그리고 정적. 마을 사람들은 그 소리를 두려워했다.",
	"“정말 여기까지 온 거야?” 그녀가 물었다. 목소리에는 놀라움보다 체념이 짙게 배어 있었다.",
	"기록에 따르면 이 탑은 오래전 무너졌어야 했다. 그런데도 계단은 여전히 위로 이어져 있었다.",
	"The lantern guttered, throwing long shadows across the stone floor, and for a moment nothing moved.",
];

const body = (index: number): string => {
	const lines = Array.from(
		{ length: 4 },
		(_, line) => PARAGRAPHS[(index + line) % PARAGRAPHS.length],
	).join("\n\n");
	return `${lines}\n\n장면 ${index}`;
};

const corpus = (count: number): SearchableMessage[] =>
	Array.from({ length: count }, (_, index) => ({
		id: `m${index}`,
		role: index % 2 === 0 ? "user" : "assistant",
		speaker: index % 2 === 0 ? "지훈" : "",
		content: body(index),
		createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
		deletedAt: null,
	}));

/**
 * Runs the function several times and uses the median, since the first call includes JIT warm-up.
 */
function medianMs(run: () => void, times = 7): number {
	const samples: number[] = [];
	for (let attempt = 0; attempt < times; attempt += 1) {
		const started = performance.now();
		run();
		samples.push(performance.now() - started);
	}
	return samples.sort((a, b) => a - b)[Math.floor(times / 2)] as number;
}

/** 5,000 messages is several years of conversation. Larger rooms are not assumed. */
const SIZES = [100, 1_000, 5_000] as const;
/**
 * Upper bound for one keystroke. It is deliberately loose: a tight limit would fail at random on
 * heavily loaded CI machines.
 */
const BUDGET_MS = 400;

describe("search speed", () => {
	for (const size of SIZES) {
		it(`one search over ${size} entries fits the budget`, () => {
			const messages = corpus(size);
			const characters = messages.reduce(
				(total, message) => total + message.content.length,
				0,
			);

			// A rare query: it matches few messages, so almost the whole corpus is only scanned.
			const rare = medianMs(() => searchMessages(messages, "무너졌어야"));
			// A common single character: nearly every message matches, so a preview is built for almost
			// every one.
			const common = medianMs(() => searchMessages(messages, "그"));

			console.log(
				`[search] ${size}건(${characters.toLocaleString()}자) 드묾 ${rare.toFixed(1)}ms · 흔함 ${common.toFixed(1)}ms`,
			);

			expect(rare).toBeLessThan(BUDGET_MS);
			expect(common).toBeLessThan(BUDGET_MS);
		});
	}

	it("results really come out: it is not fast because it does nothing", () => {
		const messages = corpus(1_000);
		expect(searchMessages(messages, "무너졌어야").matched).toBeGreaterThan(100);
		expect(searchMessages(messages, "장면 999").results).toHaveLength(1);
	});
});
