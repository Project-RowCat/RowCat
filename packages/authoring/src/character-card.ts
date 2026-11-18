import { STORY_COVER_LIMITS } from "@rowcat/contracts/story-cover";
import {
	type ArchivedMedia,
	parseStoryArchiveManifest,
	STORY_ARCHIVE_FORMAT,
	STORY_ARCHIVE_LIMITS,
	STORY_ARCHIVE_VERSION,
	type StoryArchiveManifest,
} from "./story-archive.ts";

/**
 * A character card from another product, folded into a story archive manifest
 * (docs/oss/STORY-ARCHIVE.md §7). This is the "separate converter" that document asked for: the
 * archive schema takes no outside field, and the card's vocabulary stops here.
 *
 * Accepted: the community card formats — V1 (flat fields), V2 (`spec: "chara_card_v2"`) and V3
 * (`spec: "chara_card_v3"`) — as a JSON file, or embedded in a PNG's `tEXt` chunk (`ccv3`, then
 * `chara`), base64. CHARX (a zip of card and assets) is not read; its assets are URIs into the zip
 * that would each need a role here, and a card without them still opens from the PNG or JSON.
 *
 * The output is an ordinary manifest that goes through **the same gate** an archive does
 * (`parseStoryArchiveManifest`), so a card can never make a draft an archive could not. From there
 * on the import is the archive's: upload nothing (a card has no scene images or runtime), write a
 * new draft, keep the cover on the device.
 *
 * What maps where, and why:
 *
 * | Card | Draft |
 * | --- | --- |
 * | `name` | title, and the name `{{char}}` becomes (V3 `nickname` wins for the latter) |
 * | `description` · `personality` · `scenario` · `mes_example` | the body, as sections |
 * | `system_prompt` · `post_history_instructions` | the body, first and last |
 * | `first_mes` · `alternate_greetings` | start scenes, in that order; the first is the default |
 * | `character_book.entries` | lore (enabled entries with content) |
 * | `creator_notes` | description — the card format's text for people, not the model |
 * | `tags` | tags |
 * | the PNG itself | the cover, with its text chunks removed |
 *
 * - **`{{char}}` is replaced by the name here.** A v2 work has no cast of its own, so on this
 *   platform `{{char}}` resolves only from characters added to a room (`@rowcat/chat`'s
 *   placeholder.ts) — left in, it would reach the model raw. `{{user}}` stays: the conversation
 *   resolves it from the persona, which is what the card meant. V1's `<BOT>` and `<USER>` fold into
 *   the same two.
 * - **The body is one text.** The draft has no personality or scenario field on purpose
 *   (model.ts, `prompt`), so the card's fields become headed sections the creator can rewrite.
 * - **The PNG's text chunks are dropped from the cover.** They hold the whole card. The cover stays
 *   on this device until publication and the server re-encodes it then, but a cover is shown to
 *   everyone and the prompt may be protected — the bytes should not carry it at any point.
 * - **Nothing is inferred about rating.** `adult` is `false`, visibility `private`, protection off,
 *   as a new draft is. Publishing asks again on this instance.
 * - **Dropped:** `creator`, `character_version`, `extensions`, `group_only_greetings` (group chat
 *   only), V3 `assets`, and a lore entry's secondary keys, selective logic, regex flag and depth.
 *   The first are not the work; the rest have no rule here to run them, and carrying a field nothing
 *   reads would make a creator believe it works.
 *
 * Pure: bytes and values in, a manifest out. No hashing — the app hashes the cover and passes it in,
 * as it does for an archive's media.
 */

export type CharacterCardIssueCode =
	/** Not a character card: no card fields, or a PNG with no card in it. */
	| "not_card"
	/** It is a card, but broken: bad PNG chunks, bad base64, bad UTF-8, bad JSON, or over a limit. */
	| "invalid"
	/** Larger than one import may be. */
	| "too_large";

export interface CharacterCardIssue {
	code: CharacterCardIssueCode;
	/** For a developer or a bug report. Not screen copy. */
	detail?: string;
}

export type CharacterCardResult<T> =
	| { ok: true; value: T }
	| { ok: false; issue: CharacterCardIssue };

const fail = (
	code: CharacterCardIssueCode,
	detail?: string,
): { ok: false; issue: CharacterCardIssue } => ({
	ok: false,
	issue: detail === undefined ? { code } : { code, detail },
});

export const CHARACTER_CARD_LIMITS = {
	/** A JSON card: the manifest it becomes is bounded by the same number. */
	jsonBytes: STORY_ARCHIVE_LIMITS.manifestBytes,
	/** A PNG card: the card text plus a still cover. */
	pngBytes: STORY_ARCHIVE_LIMITS.manifestBytes + STORY_COVER_LIMITS.maxBytes,
	/**
	 * The cover a card may bring. A PNG is a still image, so the still-image cap applies — the one the
	 * cover upload uses at publication. A larger image imports without a cover rather than as a draft
	 * that cannot publish.
	 */
	coverBytes: STORY_COVER_LIMITS.maxBytes,
} as const;

// ─── PNG ────────────────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);
/** Card keywords, preferred first. V3 writers also keep `chara` for older readers. */
const CARD_KEYWORDS = ["ccv3", "chara"] as const;

export function isPngBytes(bytes: Uint8Array): boolean {
	return (
		bytes.length >= PNG_SIGNATURE.length &&
		PNG_SIGNATURE.every((value, index) => bytes[index] === value)
	);
}

export interface CharacterCardPng {
	/** The card JSON, parsed but not yet checked — `characterCardToManifest` checks it. */
	card: unknown;
	/** The same PNG with every text chunk removed. */
	image: Uint8Array;
}

/**
 * Finds the card in a PNG and returns it with the image minus its text chunks. Chunks are walked by
 * their declared lengths, bounded by the buffer; a length past the end is a broken file, not a
 * reason to read further. CRCs are not checked — the server decodes the image again on publish.
 */
export function readCharacterCardPng(
	bytes: Uint8Array,
): CharacterCardResult<CharacterCardPng> {
	if (!isPngBytes(bytes)) return fail("not_card", "not a PNG");
	if (bytes.length > CHARACTER_CARD_LIMITS.pngBytes) {
		return fail("too_large", `${bytes.length} bytes`);
	}

	const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)];
	const texts = new Map<string, Uint8Array>();
	let offset = PNG_SIGNATURE.length;
	let ended = false;
	while (offset + 12 <= bytes.length) {
		const length =
			((bytes[offset] ?? 0) * 0x1000000 +
				((bytes[offset + 1] ?? 0) << 16) +
				((bytes[offset + 2] ?? 0) << 8) +
				(bytes[offset + 3] ?? 0)) >>>
			0;
		const end = offset + 12 + length;
		if (end > bytes.length) return fail("invalid", "PNG chunk past the end");
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		if (type === "tEXt") {
			const data = bytes.subarray(offset + 8, offset + 8 + length);
			const separator = data.indexOf(0);
			if (separator > 0) {
				const keyword = latin1(data.subarray(0, separator)).toLowerCase();
				if (!texts.has(keyword))
					texts.set(keyword, data.subarray(separator + 1));
			}
		}
		if (!TEXT_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end));
		offset = end;
		if (type === "IEND") {
			ended = true;
			break;
		}
	}
	if (!ended) return fail("invalid", "PNG has no IEND");

	let found = false;
	let card: unknown;
	for (const keyword of CARD_KEYWORDS) {
		const payload = texts.get(keyword);
		if (!payload) continue;
		found = true;
		const decoded = decodeCardPayload(payload);
		if (decoded !== undefined) {
			card = decoded;
			break;
		}
	}
	if (!found) return fail("not_card", "PNG has no card text");
	if (card === undefined) return fail("invalid", "card text is not JSON");
	return { ok: true, value: { card, image: concat(kept) } };
}

/** Base64 of UTF-8 JSON, as the formats specify. A payload that is JSON already is read as such. */
function decodeCardPayload(payload: Uint8Array): unknown {
	const text = latin1(payload).trim();
	const raw = text.startsWith("{") ? payload : decodeBase64(text);
	if (!raw) return undefined;
	const json = decodeUtf8(raw);
	if (json === null) return undefined;
	return parseJson(json);
}

/**
 * Reads a JSON card file's text. A leading byte-order mark is dropped; anything that does not parse
 * is not a card.
 */
export function readCharacterCardJson(
	bytes: Uint8Array,
): CharacterCardResult<unknown> {
	if (bytes.length > CHARACTER_CARD_LIMITS.jsonBytes) {
		return fail("too_large", `${bytes.length} bytes`);
	}
	const text = decodeUtf8(bytes);
	if (text === null) return fail("not_card", "not UTF-8");
	const value = parseJson(text);
	return value === undefined
		? fail("not_card", "not JSON")
		: { ok: true, value };
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch {
		return undefined;
	}
}

// ─── Card → manifest ────────────────────────────────────────────────────────────────────────────

/**
 * The words the converter writes into the draft. They are the creator's to rewrite, so they are in
 * the creator's language: the app passes its translations, and these are the fallback.
 */
export interface CharacterCardLabels {
	instructions: string;
	/** Heading of the description section when the card has no name. */
	character: string;
	personality: string;
	scenario: string;
	examples: string;
	finalInstructions: string;
	/** Start scene title, numbered from 1. */
	greeting: (index: number) => string;
}

export const CHARACTER_CARD_DEFAULT_LABELS: CharacterCardLabels = {
	instructions: "Instructions",
	character: "Character",
	personality: "Personality",
	scenario: "Scenario",
	examples: "Example dialogue",
	finalInstructions: "Final instructions",
	greeting: (index) => `Greeting ${index}`,
};

export interface CharacterCardConversion {
	/** The cover, hashed by the app from `CharacterCardPng.image`. `null` for a JSON card or an oversized image. */
	cover: ArchivedMedia | null;
	/** Written as the manifest's `exportedAt`: when this file became an archive. */
	convertedAt: string;
	labels?: CharacterCardLabels;
}

interface CardFields {
	name: string;
	/** What `{{char}}` becomes. */
	speaker: string;
	description: string;
	personality: string;
	scenario: string;
	examples: string;
	systemPrompt: string;
	postHistory: string;
	greetings: string[];
	creatorNotes: string;
	tags: string[];
	lore: StoryArchiveManifest["lore"];
}

/**
 * Builds a story archive manifest from a card value. The result has passed the archive's own check,
 * so the importer treats it like any manifest.
 */
export function characterCardToManifest(
	input: unknown,
	options: CharacterCardConversion,
): CharacterCardResult<StoryArchiveManifest> {
	const read = readCardFields(input);
	if (!read.ok) return read;
	const card = read.value;
	const labels = options.labels ?? CHARACTER_CARD_DEFAULT_LABELS;

	const section = (heading: string, body: string) =>
		body.length === 0 ? "" : `## ${heading}\n\n${body}`;
	const prompt = [
		section(labels.instructions, card.systemPrompt),
		section(card.name || labels.character, card.description),
		section(labels.personality, card.personality),
		section(labels.scenario, card.scenario),
		section(labels.examples, card.examples),
		section(labels.finalInstructions, card.postHistory),
	]
		.filter((part) => part.length > 0)
		.join("\n\n");

	const startScenes = card.greetings.map((content, index) => ({
		title: labels.greeting(index + 1),
		content,
	}));

	const manifest: StoryArchiveManifest = {
		format: STORY_ARCHIVE_FORMAT,
		version: STORY_ARCHIVE_VERSION,
		exportedAt: options.convertedAt,
		source: { origin: null },
		story: {
			title: card.name,
			tagline: "",
			description: card.creatorNotes,
			tags: card.tags,
			orientation: null,
			adult: false,
			visibility: "private",
			promptProtected: false,
			prompt,
			defaultStartScene: startScenes.length > 0 ? 0 : null,
		},
		cover: options.cover?.path ?? null,
		lore: card.lore,
		startScenes,
		sceneImages: [],
		runtime: null,
		media: options.cover
			? [
					{
						path: options.cover.path,
						mime: options.cover.mime,
						bytes: options.cover.bytes,
						sha256: options.cover.sha256,
					},
				]
			: [],
	};

	const checked = parseStoryArchiveManifest(manifest);
	if (!checked.ok) {
		return fail(
			checked.issue.code === "too_large" ? "too_large" : "invalid",
			checked.issue.detail,
		);
	}
	return checked;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const V1_FIELDS = [
	"description",
	"personality",
	"scenario",
	"first_mes",
	"mes_example",
] as const;

/**
 * Cards in the wild are hand-edited and written by many tools, so a field of the wrong type reads as
 * absent rather than failing the card. What must hold is that it *is* a card: a V2/V3 `spec` with a
 * `data` object, or V1's flat name and fields.
 */
function readCardFields(input: unknown): CharacterCardResult<CardFields> {
	if (!isRecord(input)) return fail("not_card", "not an object");
	let data: Record<string, unknown>;
	if (typeof input.spec === "string" && input.spec.startsWith("chara_card_")) {
		if (!isRecord(input.data))
			return fail("invalid", `${input.spec} has no data`);
		data = input.data;
	} else if (
		typeof input.name === "string" &&
		V1_FIELDS.some((field) => typeof input[field] === "string")
	) {
		data = input;
	} else {
		return fail("not_card", "no card fields");
	}

	const name = text(data.name);
	const speaker = text(data.nickname) || name;
	const resolve = (value: string) => resolveNames(value, speaker);
	const field = (key: string) => resolve(text(data[key]));
	const instructions = (key: string) =>
		resolve(
			text(data[key])
				.replace(/\{\{\s*original\s*\}\}/gi, "")
				.trim(),
		);

	const greetings = [data.first_mes, ...list(data.alternate_greetings)]
		.map((value) => resolve(text(value)))
		.filter((value) => value.length > 0);

	const tags = [
		...new Set(
			list(data.tags)
				.map(text)
				.filter((tag) => tag.length > 0),
		),
	].slice(0, STORY_ARCHIVE_LIMITS.tags);

	return {
		ok: true,
		value: {
			name,
			speaker,
			description: field("description"),
			personality: field("personality"),
			scenario: field("scenario"),
			examples: field("mes_example"),
			systemPrompt: instructions("system_prompt"),
			postHistory: instructions("post_history_instructions"),
			greetings,
			creatorNotes: text(data.creator_notes),
			tags,
			lore: readLore(data.character_book, resolve),
		},
	};
}

/**
 * Lore from a card's book. Disabled entries and entries with no content are skipped — neither ever
 * reaches the model where the card came from. `before_char` sits above the body, everything else
 * below it. The card's `insertion_order` puts lower numbers higher; this platform's `order` puts
 * higher numbers first, so the sign flips.
 */
function readLore(
	book: unknown,
	resolve: (value: string) => string,
): StoryArchiveManifest["lore"] {
	if (!isRecord(book)) return [];
	const lore: StoryArchiveManifest["lore"] = [];
	for (const entry of list(book.entries)) {
		if (!isRecord(entry) || entry.enabled === false) continue;
		const content = resolve(text(entry.content));
		if (content.length === 0) continue;
		const keys = [
			...new Set(
				list(entry.keys)
					.map((key) => resolve(text(key)))
					.filter((key) => key.length > 0),
			),
		];
		const insertion =
			typeof entry.insertion_order === "number" &&
			Number.isFinite(entry.insertion_order)
				? Math.trunc(entry.insertion_order)
				: 0;
		lore.push({
			keys,
			content,
			constant: entry.constant === true,
			position:
				entry.position === "before_char" ? "system_top" : "system_bottom",
			order: Math.max(
				-Number.MAX_SAFE_INTEGER,
				Math.min(Number.MAX_SAFE_INTEGER, 0 - insertion),
			),
		});
	}
	return lore;
}

const text = (value: unknown): string =>
	typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * The same notation the conversation resolves — one or two braces, matched in count, any case,
 * inner whitespace — limited to `char`. Counting the braces in the callback keeps `{{char}` as it
 * is, as `@rowcat/chat` does; this package may not import that one.
 */
const CHAR_PLACEHOLDER = /(\{{1,2})\s*char\s*(\}{1,2})/gi;

function resolveNames(value: string, speaker: string): string {
	const withUser = value.replace(/<USER>/gi, "{{user}}");
	if (speaker.length === 0) return withUser.replace(/<BOT>/gi, "{{char}}");
	return withUser
		.replace(/<BOT>/gi, speaker)
		.replace(CHAR_PLACEHOLDER, (match, open: string, close: string) =>
			open.length === close.length ? speaker : match,
		);
}

// ─── Bytes ──────────────────────────────────────────────────────────────────────────────────────
// This package targets ES2022 with no DOM and runs on Hermes, so it decodes by hand.

function latin1(bytes: Uint8Array): string {
	let out = "";
	for (let start = 0; start < bytes.length; start += 8192) {
		out += String.fromCharCode(...bytes.subarray(start, start + 8192));
	}
	return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const BASE64 = (() => {
	const table = new Int16Array(128).fill(-1);
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	for (let index = 0; index < alphabet.length; index += 1) {
		table[alphabet.charCodeAt(index)] = index;
	}
	// The URL-safe alphabet, which some writers use.
	table["-".charCodeAt(0)] = 62;
	table["_".charCodeAt(0)] = 63;
	return table;
})();

/** Standard or URL-safe base64, whitespace ignored, padding optional. `null` on anything else. */
function decodeBase64(value: string): Uint8Array | null {
	const clean = value.replace(/\s+/g, "").replace(/=+$/, "");
	if (clean.length % 4 === 1) return null;
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let buffer = 0;
	let bits = 0;
	let written = 0;
	for (let index = 0; index < clean.length; index += 1) {
		const code = clean.charCodeAt(index);
		const digit = code < 128 ? (BASE64[code] ?? -1) : -1;
		if (digit < 0) return null;
		buffer = ((buffer << 6) | digit) & 0xffffff;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[written] = (buffer >> bits) & 0xff;
			written += 1;
		}
	}
	return out.subarray(0, written);
}

/** Strict UTF-8: overlong forms, surrogates and truncated sequences are `null`, not replacement characters. */
function decodeUtf8(bytes: Uint8Array): string | null {
	const parts: string[] = [];
	const codes: number[] = [];
	let index = 0;
	while (index < bytes.length) {
		const first = bytes[index] ?? 0;
		let point: number;
		let follow: number;
		let min: number;
		if (first < 0x80) {
			point = first;
			follow = 0;
			min = 0;
		} else if (first >= 0xc2 && first <= 0xdf) {
			point = first & 0x1f;
			follow = 1;
			min = 0x80;
		} else if (first >= 0xe0 && first <= 0xef) {
			point = first & 0x0f;
			follow = 2;
			min = 0x800;
		} else if (first >= 0xf0 && first <= 0xf4) {
			point = first & 0x07;
			follow = 3;
			min = 0x10000;
		} else {
			return null;
		}
		if (follow > 0 && index + follow >= bytes.length) return null;
		for (let step = 1; step <= follow; step += 1) {
			const next = bytes[index + step] ?? 0;
			if ((next & 0xc0) !== 0x80) return null;
			point = (point << 6) | (next & 0x3f);
		}
		if (
			point < min ||
			point > 0x10ffff ||
			(point >= 0xd800 && point <= 0xdfff)
		) {
			return null;
		}
		codes.push(point);
		index += follow + 1;
		if (codes.length >= 8192) {
			parts.push(String.fromCodePoint(...codes));
			codes.length = 0;
		}
	}
	parts.push(String.fromCodePoint(...codes));
	return parts.join("");
}
