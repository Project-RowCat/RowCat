import type { RuntimeRootDiagnostic } from "@rowcat/runtime-host/session";
import type { RuntimeWireValue } from "@rowcat/runtime-host/wire";
import { deferredTranslator } from "#/lib/i18n/current.ts";

const tr = deferredTranslator("runtimePreview");

/**
 * The studio console is a bounded list. The creator's `while (true) console.log(…)` is stopped by
 * the VM budget, but thousands of lines can cross before that, and a loop inside an effect reruns
 * on every commit. If the list only grew, studio memory would belong to that code. So the oldest
 * lines are dropped and the dropped count is carried along; dropping silently would leave 'why is
 * the first line missing' unanswerable.
 *
 * Arguments are already JSON values (the VM prelude serialized them and the host checked them
 * again). This module only folds them into readable text and never calls methods on creator
 * objects, which never entered this realm.
 *
 * Diagnostics (`runtime_duplicate_key` and so on) live in the same list. They are kept out of
 * Problems, which shows Monaco's compile diagnostics: those are code problems, while these are
 * execution events.
 */

export const RUNTIME_CONSOLE_LIMIT = 500;

export type RuntimePreviewConsoleKind = "log" | "warn" | "error" | "diagnostic";

export interface RuntimePreviewConsoleEntry {
	id: number;
	kind: RuntimePreviewConsoleKind;
	text: string;
	/** Diagnostic code. Not present on plain log lines. */
	code: string | null;
	component: string | null;
}

export interface RuntimePreviewConsole {
	entries: RuntimePreviewConsoleEntry[];
	dropped: number;
	nextId: number;
}

export const emptyRuntimePreviewConsole = (): RuntimePreviewConsole => ({
	entries: [],
	dropped: 0,
	nextId: 1,
});

export function appendConsoleEntry(
	console: RuntimePreviewConsole,
	entry: Omit<RuntimePreviewConsoleEntry, "id">,
	limit: number = RUNTIME_CONSOLE_LIMIT,
): RuntimePreviewConsole {
	const entries = [...console.entries, { ...entry, id: console.nextId }];
	const overflow = Math.max(0, entries.length - limit);
	return {
		entries: overflow > 0 ? entries.slice(overflow) : entries,
		dropped: console.dropped + overflow,
		nextId: console.nextId + 1,
	};
}

export const diagnosticConsoleEntry = (
	diagnostic: RuntimeRootDiagnostic,
): Omit<RuntimePreviewConsoleEntry, "id"> => ({
	kind: "diagnostic",
	text: diagnostic.message,
	code: diagnostic.code,
	component: diagnostic.component,
});

/** Maximum characters per line. Anything beyond it is replaced by `…`. */
const MAX_LINE = 2_000;
const MAX_STRING = 200;
const MAX_ENTRIES = 20;
const MAX_DEPTH = 4;

function formatValue(value: RuntimeWireValue, depth: number): string {
	if (value === null) return "null";
	switch (typeof value) {
		case "string":
			return JSON.stringify(
				value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value,
			);
		case "number":
		case "boolean":
			return String(value);
		default:
			break;
	}
	if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[…]" : "{…}";
	if (Array.isArray(value)) {
		const shown = value
			.slice(0, MAX_ENTRIES)
			.map((entry) => formatValue(entry, depth + 1));
		if (value.length > MAX_ENTRIES)
			shown.push(tr("format.moreShort", { count: value.length - MAX_ENTRIES }));
		return `[${shown.join(", ")}]`;
	}
	const record = value as { readonly [key: string]: RuntimeWireValue };
	const keys = Object.keys(record);
	const shown = keys
		.slice(0, MAX_ENTRIES)
		.map(
			(key) =>
				`${key}: ${formatValue(record[key] as RuntimeWireValue, depth + 1)}`,
		);
	if (keys.length > MAX_ENTRIES)
		shown.push(tr("format.moreShort", { count: keys.length - MAX_ENTRIES }));
	return `{${shown.join(", ")}}`;
}

/**
 * Example: `console.log('count', 3, { a: 1 })` prints `count 3 {a: 1}`. Only a top-level string is
 * printed without quotes, following the browser console convention. Strings nested below the top
 * level keep their quotes so they can be told apart from numbers and booleans.
 */
export function formatConsoleArgs(args: readonly RuntimeWireValue[]): string {
	const line = args
		.map((arg) => (typeof arg === "string" ? arg : formatValue(arg, 0)))
		.join(" ");
	return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
}
