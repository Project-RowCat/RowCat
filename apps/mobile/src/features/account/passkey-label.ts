import { PASSKEY_NAME_LENGTH } from "@rowcat/contracts";

/**
 * Passkey label: a display name, not a secret. Same rules as web `passkey-label.ts`.
 *
 * It is a pure function because the rename input and the list's empty-label drawing must see the
 * same rule; counted separately in components, fixing one would let the server reject what the form
 * passed. The constants come from the contract (`PASSKEY_NAME_LENGTH`), so this app does not go
 * stale when it changes.
 */

export type PasskeyLabelCheck =
	| { ok: true; name: string }
	| { ok: false; reason: "empty" | "too_long" };

/**
 * Trims surrounding whitespace only; emoji and names with inner spaces are the user's choice.
 *
 * Length is string length, not code points, because the contract measures it that way
 * (`z.string().max()`); if the two diverged, a name with emoji near the cap would pass the form and
 * come back as a 400.
 */
export function checkPasskeyLabel(input: string): PasskeyLabelCheck {
	const name = input.trim();
	if (name.length < PASSKEY_NAME_LENGTH.min)
		return { ok: false, reason: "empty" };
	if (name.length > PASSKEY_NAME_LENGTH.max)
		return { ok: false, reason: "too_long" };
	return { ok: true, name };
}

/** Maps a validation failure to a sentence so screens do not rewrite the conditions. */
export function passkeyLabelMessage(
	reason: Exclude<PasskeyLabelCheck, { ok: true }>["reason"],
): string {
	switch (reason) {
		case "empty":
			return "Please enter a passkey name.";
		case "too_long":
			return `Passkey names must be at most ${PASSKEY_NAME_LENGTH.max} characters.`;
	}
}

/**
 * The name drawn in the list; no device name is invented.
 *
 * Without a label it says only `Passkey`. The authenticator model id (AAGUID) could yield labels like
 * "iCloud Keychain" or "iPhone", but it is all zeros on privacy-preserving platforms and the list is not
 * authoritative. A wrong label is worse than none: the user mistakes their own device for someone
 * else's and deletes a good credential (same judgment as the session list not parsing User-Agent).
 * The value is not in the contract anyway.
 */
export const passkeyDisplayName = (name: string | null): string =>
	name?.trim() || "Passkey";

export { PASSKEY_NAME_LENGTH };
