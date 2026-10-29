import type { ChatSeedSceneImageDto } from "@rowcat/contracts/chat";
import {
	CHAT_SCENE_IMAGE_LIMITS,
	CHAT_SEED_VERSION,
	StoryChatSeedDto,
} from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	finalizeWithSceneImage,
	hasSceneImageToken,
	matchSceneImage,
	parseChatContent,
	resolveSceneImage,
	sceneImageToken,
	sceneTriggerKey,
} from "./scene-image.ts";

const image = (trigger: string, assetId = `asset-${trigger}`) =>
	({ trigger, assetId }) satisfies ChatSeedSceneImageDto;

const IMAGES = [image("dark-hallway"), image("night")];

describe("trigger key", () => {
	it("trims whitespace and folds to lowercase so the model's capitals match", () => {
		expect(sceneTriggerKey("  Night ")).toBe("night");
	});

	it("the token is built from the trimmed trigger", () => {
		expect(sceneImageToken(" night ")).toBe("[img:night]");
	});
});

describe("resolveSceneImage", () => {
	it("finds case-insensitively", () => {
		expect(resolveSceneImage(IMAGES, "NIGHT")?.assetId).toBe("asset-night");
	});

	it("an unknown trigger is null: does not throw", () => {
		expect(resolveSceneImage(IMAGES, "noon")).toBeNull();
	});

	it("an entry with an empty reference is the same as none", () => {
		expect(resolveSceneImage([image("night", "")], "night")).toBeNull();
	});

	it("among duplicate triggers **the first** wins: it must be deterministic", () => {
		const dupes = [image("night", "first"), image("Night", "second")];
		expect(resolveSceneImage(dupes, "night")?.assetId).toBe("first");
		expect(resolveSceneImage(dupes, "NIGHT")?.assetId).toBe("first");
	});
});

describe("matchSceneImage", () => {
	it("picks the trigger that appears in the body", () => {
		expect(
			matchSceneImage("복도가 어둡다. dark-hallway.", IMAGES)?.assetId,
		).toBe("asset-dark-hallway");
	});

	it("ignores case", () => {
		expect(matchSceneImage("The Night falls.", IMAGES)?.assetId).toBe(
			"asset-night",
		);
	});

	it("when several match it is the one **appearing first**", () => {
		const text = "night이 오고, 그 뒤에 dark-hallway가 보인다.";
		expect(matchSceneImage(text, IMAGES)?.assetId).toBe("asset-night");
	});

	it("starting at the same position folds by list order", () => {
		const nested = [image("hall"), image("hallway")];
		expect(matchSceneImage("hallway를 지난다", nested)?.assetId).toBe(
			"asset-hall",
		);
	});

	it("null when nothing matches", () => {
		expect(matchSceneImage("아무 일도 없었다.", IMAGES)).toBeNull();
	});

	it("null when the list is empty", () => {
		expect(matchSceneImage("night", [])).toBeNull();
	});
});

describe("finalizeWithSceneImage", () => {
	it("appends one token line when a trigger matches", () => {
		const out = finalizeWithSceneImage("문이 열린다. night.", IMAGES);
		expect(out).toBe("문이 열린다. night.\n\n[img:night]");
	});

	it("leaves an existing token alone: does not append a duplicate", () => {
		const written = "문이 열린다.\n\n[img:dark-hallway]\n\nnight이 온다.";
		expect(finalizeWithSceneImage(written, IMAGES)).toBe(written);
	});

	it("respects a token for an unknown trigger too: does not append another beside it", () => {
		const written = "night.\n\n[img:unknown]";
		expect(finalizeWithSceneImage(written, IMAGES)).toBe(written);
	});

	it("not one character changes when nothing matches", () => {
		const plain = "아무 일도 없었다.";
		expect(finalizeWithSceneImage(plain, IMAGES)).toBe(plain);
	});

	it("not one character changes for a story without scene images", () => {
		const plain = "night이 온다.";
		expect(finalizeWithSceneImage(plain, [])).toBe(plain);
	});

	it("leaves an empty response alone: there is nothing to attach to", () => {
		expect(finalizeWithSceneImage("   ", IMAGES)).toBe("   ");
	});

	it("folds trailing whitespace before appending: blank lines do not pile up", () => {
		expect(finalizeWithSceneImage("night.\n\n\n", IMAGES)).toBe(
			"night.\n\n[img:night]",
		);
	});

	it("duplicate triggers still settle on one result", () => {
		const dupes = [image("night", "first"), image("night", "second")];
		expect(finalizeWithSceneImage("night", dupes)).toBe("night\n\n[img:night]");
	});

	it("running twice gives the same: a rerun adds no images", () => {
		const once = finalizeWithSceneImage("night", IMAGES);
		expect(finalizeWithSceneImage(once, IMAGES)).toBe(once);
	});
});

describe("hasSceneImageToken", () => {
	it("only a complete token is true", () => {
		expect(hasSceneImageToken("a [img:night] b")).toBe(true);
		expect(hasSceneImageToken("a [img:night b")).toBe(false);
		expect(hasSceneImageToken("a [img:] b")).toBe(false);
	});

	it("asking many times gives the same answer: no shared regex state", () => {
		expect(hasSceneImageToken("[img:night]")).toBe(true);
		expect(hasSceneImageToken("[img:night]")).toBe(true);
	});
});

describe("parseChatContent", () => {
	it("no token means one piece: an ordinary message renders as is", () => {
		expect(parseChatContent("안녕하세요\n두 번째 줄")).toEqual([
			{ type: "text", text: "안녕하세요\n두 번째 줄" },
		]);
	});

	it("splits tokens into image pieces", () => {
		expect(parseChatContent("문이 열린다.\n\n[img:night]")).toEqual([
			{ type: "text", text: "문이 열린다.\n\n" },
			{ type: "image", trigger: "night" },
		]);
	});

	it("text before and after a middle token both remain", () => {
		expect(parseChatContent("앞 [img:night] 뒤")).toEqual([
			{ type: "text", text: "앞 " },
			{ type: "image", trigger: "night" },
			{ type: "text", text: " 뒤" },
		]);
	});

	it("several tokens give several pieces: the screen decides whether to draw", () => {
		expect(parseChatContent("[img:a][img:b]")).toEqual([
			{ type: "image", trigger: "a" },
			{ type: "image", trigger: "b" },
		]);
	});

	it("whitespace-only pieces are dropped: no empty paragraphs", () => {
		expect(parseChatContent("[img:night]\n\n")).toEqual([
			{ type: "image", trigger: "night" },
		]);
	});

	it("an unknown trigger is still an image piece: interpretation is the screen's", () => {
		expect(parseChatContent("[img:unknown]")).toEqual([
			{ type: "image", trigger: "unknown" },
		]);
	});

	it("trims the trigger's whitespace", () => {
		expect(parseChatContent("[img:  night  ]")).toEqual([
			{ type: "image", trigger: "night" },
		]);
	});

	it("a bracket spanning lines is not a token", () => {
		const text = "[img:\nnight]";
		expect(parseChatContent(text)).toEqual([{ type: "text", text }]);
	});

	describe("streaming", () => {
		const stream = (text: string) =>
			parseChatContent(text, { streaming: true });

		it("an unfinished token renders as neither text nor image", () => {
			for (const partial of ["[", "[i", "[im", "[img", "[img:", "[img:nig"]) {
				expect(stream(`문이 열린다. ${partial}`)).toEqual([
					{ type: "text", text: "문이 열린다. " },
				]);
			}
		});

		it("becomes an image the moment it closes: the raw text never shows in between", () => {
			expect(stream("문이 열린다. [img:night]")).toEqual([
				{ type: "text", text: "문이 열린다. " },
				{ type: "image", trigger: "night" },
			]);
		});

		it("a tail that can never become a token stays visible", () => {
			expect(stream("표는 [표")).toEqual([{ type: "text", text: "표는 [표" }]);
		});

		it("an earlier complete token is an image regardless of the tail", () => {
			expect(stream("[img:night] 그리고 [img")).toEqual([
				{ type: "image", trigger: "night" },
				{ type: "text", text: " 그리고 " },
			]);
		});

		it("after commit an unfinished tail stays as text: the original is not erased", () => {
			expect(parseChatContent("문이 열린다. [img:nig")).toEqual([
				{ type: "text", text: "문이 열린다. [img:nig" },
			]);
		});
	});
});

const seedInput = (sceneImages?: unknown) => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title: "밤의 도서관",
	adult: false,
	promptProtected: false,
	scenario: "책이 말을 거는 도서관.",
	...(sceneImages === undefined ? {} : { sceneImages }),
});

describe("scene images in StoryChatSeedDto", () => {
	it("takes references and triggers as is", () => {
		const seed = StoryChatSeedDto.parse(
			seedInput([{ trigger: "night", assetId: "media-1" }]),
		);
		expect(seed.sceneImages).toEqual([
			{ trigger: "night", assetId: "media-1" },
		]);
	});

	it("**silence means an empty array**: old snapshots already on devices still open", () => {
		expect(StoryChatSeedDto.parse(seedInput()).sceneImages).toEqual([]);
	});

	it("trims trigger whitespace: storage and matching see the same value", () => {
		const seed = StoryChatSeedDto.parse(
			seedInput([{ trigger: "  night  ", assetId: "media-1" }]),
		);
		expect(seed.sceneImages[0]?.trigger).toBe("night");
	});

	it("entries without a reference are not representable", () => {
		expect(
			StoryChatSeedDto.safeParse(seedInput([{ trigger: "night" }])).success,
		).toBe(false);
		expect(
			StoryChatSeedDto.safeParse(seedInput([{ trigger: "night", assetId: "" }]))
				.success,
		).toBe(false);
	});

	it("refuses an empty trigger: an image with no word to call it cannot be drawn", () => {
		expect(
			StoryChatSeedDto.safeParse(
				seedInput([{ trigger: "   ", assetId: "media-1" }]),
			).success,
		).toBe(false);
	});

	it("characters that break the token syntax cannot be triggers", () => {
		for (const trigger of ["ni]ght", "ni\nght"])
			expect(
				StoryChatSeedDto.safeParse(seedInput([{ trigger, assetId: "media-1" }]))
					.success,
				trigger,
			).toBe(false);
	});

	it("refuses triggers and lists over the cap", () => {
		const long = "가".repeat(CHAT_SCENE_IMAGE_LIMITS.trigger + 1);
		expect(
			StoryChatSeedDto.safeParse(
				seedInput([{ trigger: long, assetId: "media-1" }]),
			).success,
		).toBe(false);

		const many = Array.from(
			{ length: CHAT_SCENE_IMAGE_LIMITS.perStory + 1 },
			(_, i) => ({ trigger: `t${i}`, assetId: "media-1" }),
		);
		expect(StoryChatSeedDto.safeParse(seedInput(many)).success).toBe(false);
	});

	it("there is no slot for bytes: unknown keys drop", () => {
		const seed = StoryChatSeedDto.parse(
			seedInput([
				{ trigger: "night", assetId: "media-1", dataUrl: "data:image/png;.." },
			]),
		);
		expect(seed.sceneImages[0]).not.toHaveProperty("dataUrl");
	});
});
