import { useLocation } from "@tanstack/react-router";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Return location for the settings workspace. It exists only when settings were opened from a
 * conversation.
 *
 * - Before this, leaving a conversation to change settings left the sidebar as the only way back.
 *   The entry points (the AI settings link in the room settings dialog, the same link in a failure
 *   notice, the header gear) all led into the workspace, and getting back meant finding the room in
 *   the list again.
 * - Not a modal. Settings is a workspace with its own navigation list, and category switches are
 *   routes (settings/route.tsx). A modal would strand that list and the URL, and refresh, back, and
 *   link sharing would each need separate handling. Instead the origin travels in the address, and
 *   an explicit return control appears.
 * - The carried value is narrow: only conversation paths (/chat/...), with no query or fragment.
 *   This blocks open redirects by construction, the same reason sign-in's `?redirect=` has this
 *   shape.
 */

/**
 * Paths that can be returned to. Both conversation rooms and runtime playback live under this
 * prefix.
 */
const RETURN_PREFIX = "/chat/";

/**
 * No legitimate link is longer. Room ids are hyphen-free UUIDs and runtime playback uses a single
 * work id, so anything longer was not produced by this app.
 */
const RETURN_MAX_LENGTH = 200;

/** The only search parameter the settings workspace accepts. */
export interface SettingsSearch {
	/** Path of the conversation to return to. Absent means there is nowhere to return to. */
	from?: string;
}

/**
 * Whether a value can be used as a return location. The address bar is user-editable, so the value
 * must be validated. Unknown values are dropped silently: a mistyped character should not turn the
 * settings screen into an error, because the user would read that as settings not opening. The
 * creation workspace's `?view=` makes the same choice.
 */
export function settingsReturnPath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	if (value.length > RETURN_MAX_LENGTH) return null;
	if (!value.startsWith(RETURN_PREFIX)) return null;
	/*
	 * Query strings, fragments, whitespace, and control characters are not part of a return path. `//`
	 * is rejected anywhere, since it starts a protocol-relative URL.
	 */
	if (/[?#\s]/.test(value)) return null;
	if (value.includes("//")) return null;
	return value;
}

/** Validator the route calls. Unknown keys are dropped, since this screen reads only one value. */
export function validateSettingsSearch(
	search: Record<string, unknown>,
): SettingsSearch {
	const from = settingsReturnPath(search.from);
	return from ? { from } : {};
}

/**
 * Search to attach when navigating to settings from the current location. Outside a conversation it
 * is empty. Someone who arrives from a work test or the gallery should not be offered 'back to
 * conversation', which would send them to a place they have never seen.
 */
export function settingsReturnSearch(pathname: string): SettingsSearch {
	return settingsReturnPath(pathname) ? { from: pathname } : {};
}

/**
 * Label of the return control, defined once so that both navigation containers use the same
 * wording.
 */
export const settingsReturnLabel = (): string =>
	translator("settings")("nav.return");

/**
 * Hook for the links. The rule that builds the value lives in the pure function above; this hook
 * only reads the current path and passes it on. Several links enter settings. If each read
 * `location` itself, one would be missed, and only that link would lose its way back.
 */
export function useSettingsReturnSearch(): SettingsSearch {
	const pathname = useLocation({ select: (location) => location.pathname });
	return settingsReturnSearch(pathname);
}
