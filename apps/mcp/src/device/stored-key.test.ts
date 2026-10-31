import { bytesToB64 } from "@rowcat/sync/codec";
import { generateDek } from "@rowcat/sync/crypto";
import { deriveAuthKey, proveKeyring } from "@rowcat/sync/keyring";
import { describe, expect, test } from "vitest";
import { verifyStoredDek } from "./device.ts";

/**
 * After a sync reset the account has a new key and the config file still holds the old one under
 * the same member. The server is the judge of which key opens the keyring, exactly as on the web's
 * start; this fake plays it with the same proof.
 */

const OWNER = "member-a";

const server = (current: Uint8Array | null) => ({
	getKeyring: async () => ({ keyring: current === null ? null : "keyring-v2" }),
	verifyKeyring: async (input: { keyring: string; proof: string }) =>
		current !== null &&
		input.proof === proveKeyring(deriveAuthKey(current, OWNER), input.keyring),
});

describe("the stored key against the account's current keyring", () => {
	const before = generateDek();
	const after = generateDek();

	test("a key from before the reset no longer opens it", async () => {
		expect(
			await verifyStoredDek(server(after), OWNER, bytesToB64(before)),
		).toBe("invalid");
	});

	test("the current key does", async () => {
		expect(await verifyStoredDek(server(after), OWNER, bytesToB64(after))).toBe(
			"valid",
		);
	});

	test("an account whose sync was turned off has nothing for any key to open", async () => {
		expect(await verifyStoredDek(server(null), OWNER, bytesToB64(after))).toBe(
			"invalid",
		);
	});

	test("a value that is not a key opens nothing, and asking about it does not throw", async () => {
		expect(await verifyStoredDek(server(after), OWNER, "%%% not base64")).toBe(
			"invalid",
		);
	});

	test("a failure to ask is not an answer", async () => {
		const offline = {
			getKeyring: async () => {
				throw new Error("ECONNREFUSED");
			},
			verifyKeyring: async () => true,
		};
		expect(await verifyStoredDek(offline, OWNER, bytesToB64(after))).toBe(
			"unknown",
		);
	});
});
