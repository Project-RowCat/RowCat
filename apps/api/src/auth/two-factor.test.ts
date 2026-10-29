import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../db/client.ts";
import { session, twoFactor, user } from "../db/schema.ts";
import { createTestMember, TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { apiGet, authPost, cookieFromResponse, jsonOf } from "../test/http.ts";
import {
	enforceTwoFactorPolicy,
	isFreshSession,
	TWO_FACTOR_FRESH_AGE_SECONDS,
} from "./two-factor-policy.ts";

/**
 * Two-factor enable → challenge → backup codes → disable on a real Postgres. The plugin's protocol
 * is not re-proven; this pins our door rules and the promises they keep:
 *
 * ```text
 * enabling finishes only after verification   an account that took the secret and quit is not challenged
 * no session during the challenge             the password alone leaves /me as a guest
 * existence hiding holds                      a wrong password answers the same with or without 2FA
 * backup codes are single-use
 * recent login is the threshold               enable/disable/regenerate are 403 on an old session
 * no trusted devices, no secret re-read       requests are refused
 * ```
 */

const EMAIL_PREFIX = "two-factor-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

/** Test-side authenticator implementing RFC 6238 — plays the user's phone, not product code. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const char of text.replace(/=+$/, "")) {
		const value = BASE32.indexOf(char.toUpperCase());
		if (value === -1) throw new Error(`not base32: ${char}`);
		buffer = (buffer << 5) | value;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}
	return Buffer.from(bytes);
}

/** `offsetSteps` picks the neighbouring time step. */
function authenticatorCode(totpURI: string, offsetSteps = 0): string {
	const secret = new URL(totpURI).searchParams.get("secret");
	if (!secret) throw new Error("the TOTP URI has no secret");
	const counter = Math.floor(Date.now() / 30_000) + offsetSteps;
	const message = Buffer.alloc(8);
	message.writeBigUInt64BE(BigInt(counter));
	const digest = createHmac("sha1", base32Decode(secret))
		.update(message)
		.digest();
	const offset = (digest[digest.length - 1] as number) & 0x0f;
	const value =
		(((digest[offset] as number) & 0x7f) << 24) |
		((digest[offset + 1] as number) << 16) |
		((digest[offset + 2] as number) << 8) |
		(digest[offset + 3] as number);
	return String(value % 1_000_000).padStart(6, "0");
}

/** A code guaranteed invalid now: avoids the ±1-step acceptance window. */
function wrongCode(totpURI: string): string {
	const valid = new Set(
		[-1, 0, 1].map((step) => authenticatorCode(totpURI, step)),
	);
	for (let candidate = 0; ; candidate += 1) {
		const code = String(candidate).padStart(6, "0");
		if (!valid.has(code)) return code;
	}
}

interface Enrolled {
	cookie: string;
	email: string;
	authUserId: string;
	totpURI: string;
	backupCodes: string[];
}

const accountOf = async (cookie: string) =>
	jsonOf<{ twoFactorEnabled: boolean }>(await apiGet("/me/account", cookie));

/** An account enabled and verified with its first code. Verification rotates the session cookie, so the new one is returned. */
async function enrolled(): Promise<Enrolled> {
	const member = await createTestMember(EMAIL_PREFIX);
	const enable = await authPost(
		"/two-factor/enable",
		{ password: TEST_PASSWORD },
		member.cookie,
	);
	expect(enable.status).toBe(200);
	const body = await jsonOf<{ totpURI: string; backupCodes: string[] }>(enable);
	const verify = await authPost(
		"/two-factor/verify-totp",
		{ code: authenticatorCode(body.totpURI) },
		member.cookie,
	);
	expect(verify.status).toBe(200);
	return {
		cookie: cookieFromResponse(verify),
		email: member.email,
		authUserId: member.authUserId,
		totpURI: body.totpURI,
		backupCodes: body.backupCodes,
	};
}

const signIn = (email: string, password = TEST_PASSWORD) =>
	authPost("/sign-in/email", { email, password });

/** Backdates the session to just over a day old — someone who stayed signed in. */
const ageSessions = (authUserId: string) =>
	db
		.update(session)
		.set({
			createdAt: new Date(
				Date.now() - (TWO_FACTOR_FRESH_AGE_SECONDS + 60) * 1000,
			),
		})
		.where(eq(session.userId, authUserId));

const viewerOf = async (cookie: string) =>
	jsonOf<{ id: string } | null>(await apiGet("/me", cookie));

describe.skipIf(!databaseReady)("Enable", () => {
	test("a wrong password creates nothing", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		const response = await authPost(
			"/two-factor/enable",
			{ password: "not-the-password" },
			member.cookie,
		);
		expect(response.status).toBe(400);
		const rows = await db
			.select()
			.from(twoFactor)
			.where(eq(twoFactor.userId, member.authUserId));
		expect(rows).toEqual([]);
	});

	test("ten backup codes and the authenticator URI come out together — the secret is stored encrypted", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		const response = await authPost(
			"/two-factor/enable",
			{ password: TEST_PASSWORD },
			member.cookie,
		);
		const body = await jsonOf<{ totpURI: string; backupCodes: string[] }>(
			response,
		);
		expect(body.backupCodes).toHaveLength(10);
		expect(new Set(body.backupCodes).size).toBe(10);
		expect(body.totpURI.startsWith("otpauth://totp/RowCat:")).toBe(true);

		const [row] = await db
			.select()
			.from(twoFactor)
			.where(eq(twoFactor.userId, member.authUserId));
		const secret = new URL(body.totpURI).searchParams.get("secret") ?? "";
		/** Neither the secret nor the backup codes are stored in plaintext. */
		expect(row?.secret).not.toContain(secret);
		expect(row?.secret).not.toBe(base32Decode(secret).toString("utf8"));
		for (const code of body.backupCodes)
			expect(row?.backupCodes).not.toContain(code);
	});

	/**
	 * Not enabled until verified: someone who took the secret and closed the window would otherwise be
	 * asked for a code they never registered and be locked out.
	 */
	test("it stays off and sign-in is not challenged until the first code is right", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		await authPost(
			"/two-factor/enable",
			{ password: TEST_PASSWORD },
			member.cookie,
		);
		expect((await accountOf(member.cookie)).twoFactorEnabled).toBe(false);

		const again = await signIn(member.email);
		expect(again.status).toBe(200);
		expect(await jsonOf<Record<string, unknown>>(again)).not.toHaveProperty(
			"twoFactorRedirect",
		);
	});

	test("a wrong first code does not turn it on", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		const enable = await authPost(
			"/two-factor/enable",
			{ password: TEST_PASSWORD },
			member.cookie,
		);
		const { totpURI } = await jsonOf<{ totpURI: string }>(enable);
		const wrong = await authPost(
			"/two-factor/verify-totp",
			{ code: wrongCode(totpURI) },
			member.cookie,
		);
		expect(wrong.status).toBe(401);
		expect((await accountOf(member.cookie)).twoFactorEnabled).toBe(false);
	});

	test("a right first code turns it on", async () => {
		const account = await enrolled();
		expect((await accountOf(account.cookie)).twoFactorEnabled).toBe(true);
	});
});

describe.skipIf(!databaseReady)("sign-in challenge", () => {
	test("the password alone creates no session", async () => {
		const account = await enrolled();
		const challenge = await signIn(account.email);
		expect(challenge.status).toBe(200);
		expect(await jsonOf(challenge)).toEqual({
			twoFactorRedirect: true,
			twoFactorMethods: ["totp"],
		});
		/** The challenge cookie is not a session. */
		expect(await viewerOf(cookieFromResponse(challenge))).toBeNull();
	});

	/**
	 * Existence hiding holds: the challenge appears only after the password is correct, so a wrong
	 * password answers the same whether or not the account uses 2FA.
	 */
	test("the answer to a wrong password is the same with or without two-factor auth", async () => {
		const plain = await createTestMember(EMAIL_PREFIX);
		const guarded = await enrolled();
		const left = await signIn(plain.email, "wrong-password-entirely");
		const right = await signIn(guarded.email, "wrong-password-entirely");
		expect(right.status).toBe(left.status);
		expect((await jsonOf<{ code?: string }>(right)).code).toBe(
			(await jsonOf<{ code?: string }>(left)).code,
		);
	});

	test("the authenticator's code turns the challenge into a session", async () => {
		const account = await enrolled();
		const challenge = await signIn(account.email);
		const pending = cookieFromResponse(challenge);

		const wrong = await authPost(
			"/two-factor/verify-totp",
			{ code: wrongCode(account.totpURI) },
			pending,
		);
		expect(wrong.status).toBe(401);

		const right = await authPost(
			"/two-factor/verify-totp",
			{ code: authenticatorCode(account.totpURI) },
			pending,
		);
		expect(right.status).toBe(200);
		expect(await viewerOf(cookieFromResponse(right))).not.toBeNull();
	});

	test("a backup code works only once", async () => {
		const account = await enrolled();
		const [code] = account.backupCodes;

		const first = cookieFromResponse(await signIn(account.email));
		const used = await authPost(
			"/two-factor/verify-backup-code",
			{ code },
			first,
		);
		expect(used.status).toBe(200);
		expect(await viewerOf(cookieFromResponse(used))).not.toBeNull();

		const second = cookieFromResponse(await signIn(account.email));
		const reused = await authPost(
			"/two-factor/verify-backup-code",
			{ code },
			second,
		);
		expect(reused.status).not.toBe(200);
	});

	/** Refused rather than ignored, so the sender does not believe the device is trusted. */
	test("refuses a request for a trusted device", async () => {
		const account = await enrolled();
		const pending = cookieFromResponse(await signIn(account.email));
		const response = await authPost(
			"/two-factor/verify-totp",
			{ code: authenticatorCode(account.totpURI), trustDevice: true },
			pending,
		);
		expect(response.status).toBe(400);
		expect(await jsonOf<{ code?: string }>(response)).toMatchObject({
			code: "TRUST_DEVICE_UNSUPPORTED",
		});
	});
});

describe.skipIf(!databaseReady)("recent sign-in", () => {
	test("an old session cannot turn it on", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		await ageSessions(member.authUserId);
		const response = await authPost(
			"/two-factor/enable",
			{ password: TEST_PASSWORD },
			member.cookie,
		);
		expect(response.status).toBe(403);
		expect(await jsonOf<{ code?: string }>(response)).toMatchObject({
			code: "SESSION_NOT_FRESH",
		});
	});

	test("an old session can neither turn it off nor get new backup codes", async () => {
		const account = await enrolled();
		await ageSessions(account.authUserId);
		for (const path of [
			"/two-factor/disable",
			"/two-factor/generate-backup-codes",
		]) {
			const response = await authPost(
				path,
				{ password: TEST_PASSWORD },
				account.cookie,
			);
			expect(response.status, path).toBe(403);
		}
		expect((await accountOf(account.cookie)).twoFactorEnabled).toBe(true);
	});

	/** The secret leaves once, at enable; a session alone cannot clone the second factor. */
	test("the door that hands out the TOTP URI again is closed", async () => {
		const account = await enrolled();
		const response = await authPost(
			"/two-factor/get-totp-uri",
			{ password: TEST_PASSWORD },
			account.cookie,
		);
		expect(response.status).toBe(404);
	});
});

describe.skipIf(!databaseReady)("reissuing backup codes", () => {
	test("ten new ones come out and every old code is void", async () => {
		const account = await enrolled();
		const response = await authPost(
			"/two-factor/generate-backup-codes",
			{ password: TEST_PASSWORD },
			account.cookie,
		);
		expect(response.status).toBe(200);
		const { backupCodes } = await jsonOf<{ backupCodes: string[] }>(response);
		expect(backupCodes).toHaveLength(10);

		const pending = cookieFromResponse(await signIn(account.email));
		const stale = await authPost(
			"/two-factor/verify-backup-code",
			{ code: account.backupCodes[0] },
			pending,
		);
		expect(stale.status).not.toBe(200);
		const fresh = await authPost(
			"/two-factor/verify-backup-code",
			{ code: backupCodes[0] },
			pending,
		);
		expect(fresh.status).toBe(200);
	});
});

describe.skipIf(!databaseReady)("Disable", () => {
	test("a wrong password leaves it on", async () => {
		const account = await enrolled();
		const response = await authPost(
			"/two-factor/disable",
			{ password: "not-the-password" },
			account.cookie,
		);
		expect(response.status).toBe(400);
		expect((await accountOf(account.cookie)).twoFactorEnabled).toBe(true);
	});

	test("turning it off removes the secret and the next sign-in is not challenged", async () => {
		const account = await enrolled();
		const response = await authPost(
			"/two-factor/disable",
			{ password: TEST_PASSWORD },
			account.cookie,
		);
		expect(response.status).toBe(200);
		const cookie = cookieFromResponse(response);
		expect((await accountOf(cookie)).twoFactorEnabled).toBe(false);
		const rows = await db
			.select()
			.from(twoFactor)
			.where(eq(twoFactor.userId, account.authUserId));
		expect(rows).toEqual([]);

		const again = await signIn(account.email);
		expect(await jsonOf<Record<string, unknown>>(again)).not.toHaveProperty(
			"twoFactorRedirect",
		);
	});

	/** Why account deletion does not enumerate this table: the secret cascades with the auth user. */
	test("when the auth account goes, the secret goes too", async () => {
		const account = await enrolled();
		await db.delete(user).where(eq(user.id, account.authUserId));
		const rows = await db
			.select()
			.from(twoFactor)
			.where(eq(twoFactor.userId, account.authUserId));
		expect(rows).toEqual([]);
	});
});

describe("enforceTwoFactorPolicy", () => {
	test("paths outside two-factor auth pass through", async () => {
		await expect(
			enforceTwoFactorPolicy({ path: "/sign-in/email", body: {} }),
		).resolves.toBeUndefined();
	});

	test("refuses a trusted device on both verification paths", async () => {
		for (const path of [
			"/two-factor/verify-totp",
			"/two-factor/verify-backup-code",
		])
			await expect(
				enforceTwoFactorPolicy({ path, body: { trustDevice: true } }),
			).rejects.toMatchObject({ body: { code: "TRUST_DEVICE_UNSUPPORTED" } });
	});

	test("isFreshSession — 24 hours is the boundary", () => {
		const now = Date.parse("2026-10-03T12:00:00.000Z");
		const hours = (h: number) => new Date(now - h * 3_600_000);
		expect(isFreshSession(hours(23.9), now)).toBe(true);
		expect(isFreshSession(hours(24), now)).toBe(false);
		expect(isFreshSession("not-a-date", now)).toBe(false);
	});
});
