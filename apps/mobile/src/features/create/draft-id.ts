/**
 * Draft id from the address, as a pure function because this app's tests do not render React
 * (vitest.config.ts). Same role as the chat screen's readRoomIdParam. expo-router params can be
 * arrays. Empty or whitespace-only values are not ids; "not found" must be said only after actually
 * looking.
 */
export function readDraftIdParam(
	raw: string | string[] | undefined,
): string | null {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
