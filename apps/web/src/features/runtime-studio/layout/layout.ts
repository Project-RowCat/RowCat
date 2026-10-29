/**
 * Studio panel sizes are device preferences, not part of the work, so they are excluded from drafts
 * and sync. Otherwise a wide explorer set on a laptop would apply to the same draft on a phone, and
 * work data would start carrying screen dimensions that mean nothing in published snapshots or in
 * other devices' merges. LocalStorage is used here, unlike the per-member database used for the
 * auto-sync toggle, because that toggle's value is someone's choice. On a shared browser, one
 * user's off must not become the default for the next. Panel widths carry no such meaning, and the
 * theme preference already lives in the same place (lib/theme/provider.tsx). All reads and writes
 * are wrapped in try, because storage throws in private mode, when refused, and when full. A panel
 * width must never keep the studio from opening.
 */

const STORAGE_KEY = "rowcat.runtime.layout";

export interface RuntimeLayout {
	explorer: number;
	preview: number;
	panel: number;
}

/**
 * Per-panel minimum, maximum and default sizes. The minimums block an unrecoverable state: a
 * zero-width panel has no handle to grab, and a stored zero would reopen at zero after a refresh.
 */
export const RUNTIME_LAYOUT_LIMITS = {
	explorer: { min: 180, max: 420, initial: 248 },
	preview: { min: 260, max: 640, initial: 340 },
	panel: { min: 120, max: 520, initial: 196 },
} as const;

export type RuntimeLayoutKey = keyof typeof RUNTIME_LAYOUT_LIMITS;

export const RUNTIME_LAYOUT_KEYS = [
	"explorer",
	"preview",
	"panel",
] as const satisfies readonly RuntimeLayoutKey[];

export const RUNTIME_RESIZE_STEP = 16;

export const defaultRuntimeLayout = (): RuntimeLayout => ({
	explorer: RUNTIME_LAYOUT_LIMITS.explorer.initial,
	preview: RUNTIME_LAYOUT_LIMITS.preview.initial,
	panel: RUNTIME_LAYOUT_LIMITS.panel.initial,
});

export function clampRuntimeSize(key: RuntimeLayoutKey, value: number): number {
	const limits = RUNTIME_LAYOUT_LIMITS[key];
	if (!Number.isFinite(value)) return limits.initial;
	return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

/**
 * Converts a stored value into a usable layout. Unknown shapes are not rejected; they collapse to
 * defaults. The stored value may come from an older version or a devtools edit, and opening at the
 * default layout beats failing to open. The route search-param parser makes the same choice.
 */
export function parseRuntimeLayout(input: unknown): RuntimeLayout {
	const source =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	const read = (key: RuntimeLayoutKey): number =>
		clampRuntimeSize(
			key,
			typeof source[key] === "number"
				? (source[key] as number)
				: RUNTIME_LAYOUT_LIMITS[key].initial,
		);
	return {
		explorer: read("explorer"),
		preview: read("preview"),
		panel: read("panel"),
	};
}

export function readRuntimeLayout(): RuntimeLayout {
	if (typeof window === "undefined") return defaultRuntimeLayout();
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return parseRuntimeLayout(raw === null ? null : JSON.parse(raw));
	} catch {
		return defaultRuntimeLayout();
	}
}

export function writeRuntimeLayout(layout: RuntimeLayout): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
	} catch {
		// If saving fails, the layout still applies for the current session. A preference must not block
		// the screen.
	}
}
