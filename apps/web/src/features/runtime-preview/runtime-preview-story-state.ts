import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type {
	RuntimeStoryStateEntry,
	RuntimeStoryStateSnapshot,
} from "@rowcat/runtime-host/story-state";
import { deferredTranslator } from "#/lib/i18n/current.ts";

const tr = deferredTranslator("runtimePreview");

/**
 * The value behind the `State` panel: trusted studio UI reading JSON. It has already crossed the
 * wire twice (VM serialization, then host validation). This file only folds that JSON into readable
 * text; it never calls methods on creator objects. None of `toString`, `toJSON` or `inspect` ever
 * came from this realm.
 *
 * It does not use `JSON.stringify` as is, because of size. One entry can reach 64 KiB, and that
 * text would sit in the DOM and slow the studio in proportion to creator state size. Depth and
 * length are cut so only what is readable is drawn. Any cut is marked, since a silent cut would
 * make creators think that is all their state is.
 */

export interface StoryStateFormatLimits {
	/** Nesting beyond this depth is folded to `…`. The root is depth 0. */
	maxDepth: number;
	maxEntries: number;
	maxStringLength: number;
	maxTotalLength: number;
}

export const STORY_STATE_FORMAT_LIMITS: StoryStateFormatLimits = Object.freeze({
	maxDepth: 6,
	maxEntries: 40,
	maxStringLength: 200,
	maxTotalLength: 4_000,
});

type Json =
	| null
	| boolean
	| number
	| string
	| readonly Json[]
	| { readonly [key: string]: Json };

/**
 * Formats one value into a stable string, with object keys always sorted by name. Insertion order
 * would make the same logical state look different across commits (a migration may rewrite key
 * order), so creators would read an unchanged value as changed.
 */
export function formatStoryStateValue(
	value: unknown,
	limits: StoryStateFormatLimits = STORY_STATE_FORMAT_LIMITS,
): string {
	const text = render(value as Json, 0, limits);
	return text.length > limits.maxTotalLength
		? `${text.slice(0, limits.maxTotalLength)}… ${tr("format.truncated")}`
		: text;
}

function render(
	value: Json,
	depth: number,
	limits: StoryStateFormatLimits,
): string {
	if (value === null) return "null";
	if (typeof value === "boolean" || typeof value === "number")
		return String(value);
	if (typeof value === "string") {
		const clipped =
			value.length > limits.maxStringLength
				? `${value.slice(0, limits.maxStringLength)}…`
				: value;
		return JSON.stringify(clipped);
	}
	if (depth >= limits.maxDepth) return Array.isArray(value) ? "[…]" : "{…}";
	const indent = "  ".repeat(depth + 1);
	const closing = "  ".repeat(depth);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const shown = value.slice(0, limits.maxEntries);
		const lines = shown.map(
			(entry) => `${indent}${render(entry, depth + 1, limits)}`,
		);
		if (value.length > shown.length)
			lines.push(
				`${indent}${tr("format.more", { count: value.length - shown.length })}`,
			);
		return `[\n${lines.join(",\n")}\n${closing}]`;
	}
	const keys = Object.keys(value).sort();
	if (keys.length === 0) return "{}";
	const shown = keys.slice(0, limits.maxEntries);
	const lines = shown.map(
		(key) =>
			`${indent}${JSON.stringify(key)}: ${render(
				(value as { readonly [key: string]: Json })[key] as Json,
				depth + 1,
				limits,
			)}`,
	);
	if (keys.length > shown.length)
		lines.push(
			`${indent}${tr("format.more", { count: keys.length - shown.length })}`,
		);
	return `{\n${lines.join(",\n")}\n${closing}}`;
}

/**
 * One row on screen: key, version and text. The snapshot already arrives in key order, so rows are
 * not re-sorted.
 */
export interface StoryStateRow {
	key: string;
	version: number;
	text: string;
}

export function storyStateRows(
	snapshot: RuntimeStoryStateSnapshot | RuntimePersistentStateSnapshot,
	limits: StoryStateFormatLimits = STORY_STATE_FORMAT_LIMITS,
): StoryStateRow[] {
	return snapshot.entries.map((entry: RuntimeStoryStateEntry) => ({
		key: entry.key,
		version: entry.version,
		text: formatStoryStateValue(entry.value, limits),
	}));
}
