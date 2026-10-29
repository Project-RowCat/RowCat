import { describe, expect, test } from "vitest";
import { passkeyApiErrorMessage } from "./passkey-error.ts";
import {
	checkPasskeyLabel,
	PASSKEY_NAME_LENGTH,
	passkeyDisplayName,
	passkeyLabelMessage,
} from "./passkey-label.ts";

/**
 * Passkey label: **a display name, not a secret.**
 *
 * The check is a pure function because three places must apply the same rule (the registration
 * dialog, the rename dialog, and the list). Checking separately inside each component would mean
 * one day the form lets through a value the server rejects after only one copy was fixed.
 */

describe("label check", () => {
	test("empty and whitespace-only values are rejected", () => {
		expect(checkPasskeyLabel("")).toEqual({ ok: false, reason: "empty" });
		expect(checkPasskeyLabel("   ")).toEqual({ ok: false, reason: "empty" });
	});

	test("returns the value with surrounding whitespace trimmed", () => {
		expect(checkPasskeyLabel("  MacBook  ")).toEqual({
			ok: true,
			name: "MacBook",
		});
	});

	/** The limit exists for the screen: a label that pushes the list around pushes the delete button off screen. */
	test("going past the limit is rejected", () => {
		expect(
			checkPasskeyLabel("\uAC00".repeat(PASSKEY_NAME_LENGTH.max)),
		).toMatchObject({
			ok: true,
		});
		expect(
			checkPasskeyLabel("\uAC00".repeat(PASSKEY_NAME_LENGTH.max + 1)),
		).toEqual({ ok: false, reason: "too_long" });
	});

	/**
	 * **No password-style rules.** This value only tells rows apart in the list. Emoji and names with
	 * inner spaces are values the user chose.
	 */
	test("emoji and inner spaces are allowed", () => {
		expect(checkPasskeyLabel("My MacBook 💻")).toEqual({
			ok: true,
			name: "My MacBook 💻",
		});
	});

	test("each reason has its own sentence", () => {
		expect(passkeyLabelMessage("empty")).not.toBe(
			passkeyLabelMessage("too_long"),
		);
	});
});

describe("display name", () => {
	/**
	 * **Do not invent a device name.**
	 *
	 * AAGUID can produce labels such as "iCloud Keychain", but on platforms that protect privacy that
	 * value is all zeros, and the list is not authoritative. Deleting based on a wrong label cannot be
	 * undone.
	 */
	test("without a label it is just `Passkey`", () => {
		expect(passkeyDisplayName(null)).toBe("Passkey");
		expect(passkeyDisplayName("  ")).toBe("Passkey");
	});

	test("a label is used as is", () => {
		expect(passkeyDisplayName("iPhone")).toBe("iPhone");
	});
});

describe("failure messages", () => {
	/**
	 * **Do not separate a missing passkey from someone else's.**
	 *
	 * The server returns the same code for both (existence hiding), and the screen uses the same
	 * sentence. To the user either case means the screen is stale.
	 */
	test("a missing passkey suggests refreshing", () => {
		const message = passkeyApiErrorMessage({
			name: "RowCatApiError",
			code: "passkey_not_found",
			status: 404,
			message: "",
		} as never);
		expect(message).not.toContain("another account");
		expect(message).not.toContain("permission");
	});

	/** When the server cannot be reached, tell the user to check the connection (these operations are reversible). */
	test("a transport failure says to check the connection", () => {
		expect(passkeyApiErrorMessage(new Error("boom"))).toContain("connection");
	});
});
