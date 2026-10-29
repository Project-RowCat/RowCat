import { PASSKEY_NAME_LENGTH } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	checkPasskeyLabel,
	passkeyDisplayName,
	passkeyLabelMessage,
} from "./passkey-label.ts";

describe("checkPasskeyLabel", () => {
	it("blocks empty and whitespace-only values", () => {
		expect(checkPasskeyLabel("")).toEqual({ ok: false, reason: "empty" });
		expect(checkPasskeyLabel("   ")).toEqual({ ok: false, reason: "empty" });
	});

	/** Only surrounding whitespace is trimmed; emoji and names with inner spaces are the user's choice. */
	it("trims only leading and trailing whitespace", () => {
		expect(checkPasskeyLabel("  Home laptop  ")).toEqual({
			ok: true,
			name: "Home laptop",
		});
		expect(checkPasskeyLabel("My phone 🔑")).toEqual({
			ok: true,
			name: "My phone 🔑",
		});
	});

	/**
	 * Length is string length, not code points, because the contract measures it that way; if the two
	 * diverged, a name with emoji near the cap would come back as a 400.
	 */
	it("counts the limit on the same axis as the contract", () => {
		const max = "a".repeat(PASSKEY_NAME_LENGTH.max);
		expect(checkPasskeyLabel(max).ok).toBe(true);
		expect(checkPasskeyLabel(`${max}a`)).toEqual({
			ok: false,
			reason: "too_long",
		});

		/** A surrogate pair takes two units (same as the contract's `z.string().max()`). */
		const emoji = "🔑".repeat(PASSKEY_NAME_LENGTH.max / 2 + 1);
		expect(emoji.length).toBeGreaterThan(PASSKEY_NAME_LENGTH.max);
		expect(checkPasskeyLabel(emoji).ok).toBe(false);
	});

	it("each reason has a sentence", () => {
		expect(passkeyLabelMessage("empty")).toBeTruthy();
		expect(passkeyLabelMessage("too_long")).toContain(
			String(PASSKEY_NAME_LENGTH.max),
		);
	});
});

describe("passkeyDisplayName", () => {
	it("draws the name as is when there is one", () => {
		expect(passkeyDisplayName("Home laptop")).toBe("Home laptop");
	});

	/**
	 * No device name is invented. Without a label it is one neutral word, never a brand name derived
	 * from the authenticator model; deleting on a wrong label cannot be undone.
	 */
	it("with no name it is one neutral word", () => {
		expect(passkeyDisplayName(null)).toBe("Passkey");
		expect(passkeyDisplayName("")).toBe("Passkey");
		expect(passkeyDisplayName("   ")).toBe("Passkey");
	});

	it("doesn't invent device names", () => {
		expect(passkeyDisplayName(null)).not.toMatch(
			/iPhone|MacBook|Android|Windows|Keychain|Chrome|security key/i,
		);
	});
});
