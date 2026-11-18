import { describe, expect, it } from "vitest";
import {
	CHARACTER_CARD_DEFAULT_LABELS,
	characterCardToManifest,
	readCharacterCardJson,
	readCharacterCardPng,
} from "./character-card.ts";
import {
	type ArchivedMedia,
	planStoryArchiveDraft,
	storyArchiveMediaPath,
	storyArchiveUploads,
} from "./story-archive.ts";

const NOW = "2026-11-18T00:00:00.000Z";
const utf8 = (value: string) => new TextEncoder().encode(value);
const base64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

/** A minimal PNG: signature, IHDR, the given text chunks, IDAT, IEND. CRCs are zero — the reader does not check them. */
function png(texts: Array<[keyword: string, text: string]>): Uint8Array {
	const chunk = (type: string, data: Uint8Array) => {
		const out = new Uint8Array(12 + data.length);
		new DataView(out.buffer).setUint32(0, data.length);
		out.set(utf8(type), 4);
		out.set(data, 8);
		return out;
	};
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", new Uint8Array(13).fill(1)),
		...texts.map(([keyword, text]) =>
			chunk("tEXt", utf8(`${keyword}\u0000${text}`)),
		),
		chunk("IDAT", new Uint8Array([9, 9, 9])),
		chunk("IEND", new Uint8Array(0)),
	];
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const v2 = (data: Record<string, unknown>) => ({
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: { name: "Sena", ...data },
});

const convert = (card: unknown, cover: ArchivedMedia | null = null) =>
	characterCardToManifest(card, { cover, convertedAt: NOW });

describe("readCharacterCardPng", () => {
	it("reads the base64 card and returns the image without text chunks", () => {
		const card = v2({ description: "세나는 사서다." });
		const file = png([
			["Comment", "hello"],
			["chara", base64(JSON.stringify(card))],
		]);
		const read = readCharacterCardPng(file);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.value.card).toEqual(card);
		expect(read.value.image).toEqual(png([]));
	});

	it("prefers ccv3 over chara", () => {
		const read = readCharacterCardPng(
			png([
				["chara", base64(JSON.stringify(v2({ name: "Old" })))],
				[
					"ccv3",
					base64(
						JSON.stringify({
							spec: "chara_card_v3",
							spec_version: "3.0",
							data: { name: "New" },
						}),
					),
				],
			]),
		);
		expect(
			read.ok && (read.value.card as { data: { name: string } }).data.name,
		).toBe("New");
	});

	it("falls back to chara when ccv3 does not decode", () => {
		const read = readCharacterCardPng(
			png([
				["ccv3", "%%%"],
				["chara", base64(JSON.stringify(v2({})))],
			]),
		);
		expect(read.ok).toBe(true);
	});

	it("says a plain PNG is not a card, and broken bytes are invalid", () => {
		expect(readCharacterCardPng(png([]))).toMatchObject({
			ok: false,
			issue: { code: "not_card" },
		});
		expect(readCharacterCardPng(utf8("{}"))).toMatchObject({
			ok: false,
			issue: { code: "not_card" },
		});
		expect(readCharacterCardPng(png([["chara", "not base64!"]]))).toMatchObject(
			{
				ok: false,
				issue: { code: "invalid" },
			},
		);
		const truncated = png([["chara", base64("{}")]]).subarray(0, 40);
		expect(readCharacterCardPng(truncated)).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});
	});
});

describe("readCharacterCardJson", () => {
	it("reads UTF-8 JSON with or without a byte-order mark", () => {
		const text = JSON.stringify(v2({ name: "세나" }));
		expect(readCharacterCardJson(utf8(text))).toEqual({
			ok: true,
			value: v2({ name: "세나" }),
		});
		expect(readCharacterCardJson(utf8(`﻿${text}`)).ok).toBe(true);
		expect(readCharacterCardJson(utf8("nope")).ok).toBe(false);
		expect(readCharacterCardJson(new Uint8Array([0xc0, 0x80])).ok).toBe(false);
	});
});

describe("characterCardToManifest", () => {
	it("folds a V2 card into a manifest the archive gate accepts", () => {
		const result = convert(
			v2({
				description: "{{char}} keeps the night shift.\r\nShe whispers.",
				personality: "Quiet, curious",
				scenario: "{{user}} visits <BOT> after midnight.",
				mes_example: "<START>\n{{user}}: Hi\n{{char}}: Shh.",
				system_prompt: "{{original}}\nStay in character as {{char}}.",
				post_history_instructions: "Keep replies short.",
				first_mes: "*{{char}} looks up.* Closed, {{user}}.",
				alternate_greetings: ["", "*A lamp flickers.*", 7],
				creator_notes: "A gentle mystery.",
				tags: ["mystery", " mystery ", "", "library", 3],
				creator: "someone",
				extensions: { anything: true },
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const manifest = result.value;
		expect(manifest.story).toEqual({
			title: "Sena",
			tagline: "",
			description: "A gentle mystery.",
			tags: ["mystery", "library"],
			orientation: null,
			adult: false,
			visibility: "private",
			promptProtected: false,
			prompt: [
				"## Instructions\n\nStay in character as Sena.",
				"## Sena\n\nSena keeps the night shift.\nShe whispers.",
				"## Personality\n\nQuiet, curious",
				"## Scenario\n\n{{user}} visits Sena after midnight.",
				"## Example dialogue\n\n<START>\n{{user}}: Hi\nSena: Shh.",
				"## Final instructions\n\nKeep replies short.",
			].join("\n\n"),
			defaultStartScene: 0,
		});
		expect(manifest.startScenes).toEqual([
			{ title: "Greeting 1", content: "*Sena looks up.* Closed, {{user}}." },
			{ title: "Greeting 2", content: "*A lamp flickers.*" },
		]);
		expect(manifest.source).toEqual({ origin: null });
		expect(manifest.exportedAt).toBe(NOW);
		expect(manifest.runtime).toBeNull();
		expect(manifest.sceneImages).toEqual([]);
		expect(storyArchiveUploads(manifest)).toEqual([]);
	});

	it("maps the character book to lore", () => {
		const result = convert(
			v2({
				character_book: {
					entries: [
						{
							keys: ["ink", "{{char}}'s pen", "ink"],
							content: "Ink remembers {{char}}.",
							enabled: true,
							insertion_order: 10,
							position: "before_char",
						},
						{
							keys: [],
							content: "The library never closes.",
							enabled: true,
							constant: true,
							insertion_order: 0,
						},
						{ keys: ["off"], content: "disabled", enabled: false },
						{ keys: ["empty"], content: "   ", enabled: true },
					],
				},
			}),
		);
		expect(result.ok && result.value.lore).toEqual([
			{
				keys: ["ink", "Sena's pen"],
				content: "Ink remembers Sena.",
				constant: false,
				position: "system_top",
				order: -10,
			},
			{
				keys: [],
				content: "The library never closes.",
				constant: true,
				position: "system_bottom",
				order: 0,
			},
		]);
	});

	it("reads V1 and V3 cards; V3's nickname is who {{char}} is", () => {
		const v1 = convert({
			name: "Sena",
			description: "<BOT> greets <USER>.",
			first_mes: "Hi",
		});
		expect(v1.ok && v1.value.story.prompt).toBe(
			"## Sena\n\nSena greets {{user}}.",
		);
		const v3 = convert({
			spec: "chara_card_v3",
			spec_version: "3.0",
			data: {
				name: "Sena Arden",
				nickname: "Sena",
				description: "{{char}} reads.",
				group_only_greetings: ["group only"],
				assets: [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }],
			},
		});
		expect(v3.ok && v3.value.story.title).toBe("Sena Arden");
		expect(v3.ok && v3.value.story.prompt).toBe("## Sena Arden\n\nSena reads.");
		expect(v3.ok && v3.value.startScenes).toEqual([]);
		expect(v3.ok && v3.value.story.defaultStartScene).toBeNull();
	});

	it("keeps placeholders when the card has no name, and a half brace as written", () => {
		const nameless = convert({
			spec: "chara_card_v2",
			data: { description: "{{char}} and <BOT>" },
		});
		expect(nameless.ok && nameless.value.story.prompt).toBe(
			"## Character\n\n{{char}} and {{char}}",
		);
		const half = convert(v2({ description: "{{char} {char} {{ CHAR }}" }));
		expect(half.ok && half.value.story.prompt).toBe(
			"## Sena\n\n{{char} Sena Sena",
		);
	});

	it("uses the labels it is given", () => {
		const result = characterCardToManifest(
			v2({ description: "d", first_mes: "hi" }),
			{
				cover: null,
				convertedAt: NOW,
				labels: {
					...CHARACTER_CARD_DEFAULT_LABELS,
					greeting: (index) => `첫 인사 ${index}`,
				},
			},
		);
		expect(result.ok && result.value.startScenes[0]?.title).toBe("첫 인사 1");
	});

	it("carries the cover and plans a draft from it", () => {
		const sha256 = "a".repeat(64);
		const path = storyArchiveMediaPath(sha256, "image/png") ?? "";
		const result = convert(v2({ first_mes: "hi" }), {
			path,
			mime: "image/png",
			bytes: 100,
			sha256,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.cover).toBe(path);
		const plan = planStoryArchiveDraft(result.value, () => undefined);
		expect(plan.ok && plan.value.cover).toBe(path);
		expect(plan.ok && plan.value.draft.visibility).toBe("private");
	});

	it("refuses what is not a card, and a card over the archive's limits", () => {
		expect(convert({ hello: "world" })).toMatchObject({
			ok: false,
			issue: { code: "not_card" },
		});
		expect(convert([])).toMatchObject({
			ok: false,
			issue: { code: "not_card" },
		});
		expect(convert({ spec: "chara_card_v2" })).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});
		const greetings = Array.from({ length: 300 }, (_, index) => `g${index}`);
		expect(convert(v2({ alternate_greetings: greetings }))).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});
	});
});
