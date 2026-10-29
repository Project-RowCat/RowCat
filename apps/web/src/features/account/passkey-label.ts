import { PASSKEY_NAME_LENGTH } from "@rowcat/contracts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Passkey label check: one rule, three consumers. The input in the registration dialog, the input
 * in the rename dialog, and how the list draws an empty label all use it. Counting separately in
 * each component means one day only one gets fixed, and the form lets through a value the server
 * rejects.
 *
 * No password-style rules (character mix, minimum complexity). This value does one thing: it tells
 * rows apart in the list.
 */

export type PasskeyLabelCheck =
	| { ok: true; name: string }
	| { ok: false; reason: "empty" | "too_long" };

/**
 * Trims surrounding whitespace only. Emoji and names with inner spaces are values the user chose.
 *
 * Length is counted as **string length, not code points**, because that is how the contract
 * measures it (`z.string().max()`). If the two measures diverged, a name close to the limit that
 * contains emoji would pass the form and come back as a 400.
 */
export function checkPasskeyLabel(input: string): PasskeyLabelCheck {
	const name = input.trim();
	if (name.length < PASSKEY_NAME_LENGTH.min)
		return { ok: false, reason: "empty" };
	if (name.length > PASSKEY_NAME_LENGTH.max)
		return { ok: false, reason: "too_long" };
	return { ok: true, name };
}

/** Validation failure to sentence. The screen does not restate the conditions. */
export function passkeyLabelMessage(
	reason: Exclude<PasskeyLabelCheck, { ok: true }>["reason"],
): string {
	switch (reason) {
		case "empty":
			return translator("account")("passkeyLabel.pleaseEnterAPasskeyName");
		case "too_long":
			return translator("account")("passkeyLabel.tooLong", {
				max: PASSKEY_NAME_LENGTH.max,
			});
	}
}

/**
 * Name to draw in the list. **Do not invent a device name.**
 *
 * With no label it shows only `Passkey`. The authenticator model identifier (AAGUID) could produce a
 * label such as "iCloud Keychain", but on platforms that protect privacy that value is all zeros,
 * and the list is not authoritative. **A wrong label is worse than none**: the user mistakes their
 * own device for someone else's and deletes a working credential. This is the same judgment as the
 * active-session list, which does not parse the User-Agent.
 */
export const passkeyDisplayName = (name: string | null): string =>
	name?.trim() || translator("account")("passkeyLabel.passkey");

export { PASSKEY_NAME_LENGTH };
