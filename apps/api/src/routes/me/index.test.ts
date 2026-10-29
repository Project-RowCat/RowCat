import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { member } from "../../db/schema.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * `PATCH /v2/me/nickname` and `PATCH /v2/me/show-adult`: the gates of the two updates.
 *
 * The two routes deliberately use different gates:
 *
 * ```text
 * nickname     requireActiveViewer  rejected when suspended/blocked (a publicly shown name)
 * show-adult   requireViewer        allowed even then (it only reduces what the member sees)
 * ```
 *
 * The asymmetry looks like a mistake and someone will want to make it consistent. Aligning upward
 * leaves a suspended account unable to switch off adult content shown to itself; aligning downward
 * lets it publish a new name to public lists. Both sides are pinned here.
 *
 * Runs against real Postgres and the real Hono app: session-to-member wiring is under test, so
 * calling service functions alone would leave the fragile part outside.
 */

const EMAIL_PREFIX = "me-mutation-test-";

const signUp = (name = "Update test") =>
	createTestMember(EMAIL_PREFIX, { name });

const setMember = (memberId: string, patch: Record<string, unknown>) =>
	db.update(member).set(patch).where(eq(member.id, memberId));

const patch = (
	path: string,
	cookie: string | null,
	body: unknown,
): Promise<Response> =>
	Promise.resolve(
		app.request(`/v2/me/${path}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const setNickname = (cookie: string | null, nickname: unknown) =>
	patch("nickname", cookie, { nickname });

const setShowAdult = (cookie: string | null, showAdult: unknown) =>
	patch("show-adult", cookie, { showAdult });

interface ViewerBody {
	id: string;
	nickname: string;
	status: string;
	verified: boolean;
	adult: boolean;
	showAdult: boolean;
}

const readViewer = async (response: Response): Promise<ViewerBody> =>
	(await response.json()) as ViewerBody;

const readCode = async (response: Response): Promise<string | undefined> =>
	((await response.json()) as { code?: string }).code;

/** Does the DB give the same value on later reads; an implementation that skipped the write would pass on the response alone. */
const storedNickname = async (memberId: string): Promise<string | undefined> =>
	(
		await db
			.select({ nickname: member.nickname })
			.from(member)
			.where(eq(member.id, memberId))
	)[0]?.nickname;

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("PATCH /v2/me/nickname", () => {
	test("a guest gets 401", async () => {
		expect((await setNickname(null, "Cat")).status).toBe(401);
	});

	test("a normal member can change it and gets the confirmed viewer back", async () => {
		const alice = await signUp();

		const response = await setNickname(alice.cookie, "NightCat");
		expect(response.status).toBe(200);

		const viewer = await readViewer(response);
		expect(viewer.nickname).toBe("NightCat");
		// The response id is the member id: it corrects the optimistic update, so identity must match
		// too.
		expect(viewer.id).toBe(alice.memberId);
		expect(await storedNickname(alice.memberId)).toBe("NightCat");
	});

	test("the server trims leading and trailing spaces when storing and returns the trimmed value", async () => {
		const bob = await signUp();

		const viewer = await readViewer(
			await setNickname(bob.cookie, "  Margin  "),
		);
		expect(viewer.nickname).toBe("Margin");
		expect(await storedNickname(bob.memberId)).toBe("Margin");
	});

	test.each([
		["empty string", ""],
		["only spaces", "   "],
		["over 20 characters", "a".repeat(21)],
		["not a string", 42],
	])("%s is refused", async (_label, value) => {
		const carol = await signUp("OriginalName");

		const response = await setNickname(carol.cookie, value);
		expect(response.status).toBe(400);
		expect(await readCode(response)).toBe("invalid_input");
		// Also check the rejected request changed nothing.
		expect(await storedNickname(carol.memberId)).toBe("OriginalName");
	});

	test("20 characters is the boundary, so it passes", async () => {
		const dave = await signUp();
		const twenty = "a".repeat(20);
		expect(
			(await readViewer(await setNickname(dave.cookie, twenty))).nickname,
		).toBe(twenty);
	});

	/**
	 * Suspended/blocked accounts' nicknames are locked. The name goes out on the published works list,
	 * so a suspension would mean nothing if the public display name could still change.
	 */
	test.each([
		"suspended",
		"banned",
	])("a %s member is refused", async (status) => {
		const erin = await signUp("RestrictedAccount");
		await setMember(erin.memberId, { status });

		const response = await setNickname(erin.cookie, "NewName");
		expect(response.status).toBe(403);
		expect(await readCode(response)).toBe("account_restricted");
		expect(await storedNickname(erin.memberId)).toBe("RestrictedAccount");
	});
});

describe.skipIf(!databaseReady)("PATCH /v2/me/show-adult", () => {
	test("a guest gets 401", async () => {
		expect((await setShowAdult(null, true)).status).toBe(401);
	});

	test("can't turn it on without identity verification", async () => {
		const alice = await signUp();
		const response = await setShowAdult(alice.cookie, true);
		expect(response.status).toBe(400);
		expect(await readCode(response)).toBe("invalid_input");
	});

	/** Verified but a minor. Folding the two axes into one would pass here. */
	test("can't turn it on when verified but a minor", async () => {
		const bob = await signUp();
		await setMember(bob.memberId, { verified: true, adult: false });

		const response = await setShowAdult(bob.cookie, true);
		expect(response.status).toBe(400);
		expect(await readCode(response)).toBe("invalid_input");
	});

	/** Check the opposite direction too: adult alone without identity verification is not eligibility. */
	test("can't turn it on with only adult true and no identity verification", async () => {
		const carol = await signUp();
		await setMember(carol.memberId, { verified: false, adult: true });

		expect((await setShowAdult(carol.cookie, true)).status).toBe(400);
	});

	test("can turn it on when eligible", async () => {
		const dave = await signUp();
		await setMember(dave.memberId, { verified: true, adult: true });

		const viewer = await readViewer(await setShowAdult(dave.cookie, true));
		expect(viewer.showAdult).toBe(true);
		// The eligibility axes ride separately from the display axis; the screen picks its guidance text
		// from them.
		expect(viewer.verified).toBe(true);
		expect(viewer.adult).toBe(true);
	});

	test("turning it off is allowed without eligibility", async () => {
		const erin = await signUp();
		const viewer = await readViewer(await setShowAdult(erin.cookie, false));
		expect(viewer.showAdult).toBe(false);
	});

	/**
	 * Key assertion: suspended/blocked accounts must be able to switch off an adult display they
	 * already enabled. With `requireActiveViewer` here, a restricted user could not reduce adult
	 * content shown to themselves, the opposite of why the account was suspended.
	 */
	test.each([
		"suspended",
		"banned",
	])("a %s member can also turn off a display that is on", async (status) => {
		const frank = await signUp();
		await setMember(frank.memberId, {
			verified: true,
			adult: true,
			show_adult: true,
			status,
		});

		const response = await setShowAdult(frank.cookie, false);
		expect(response.status).toBe(200);
		const viewer = await readViewer(response);
		expect(viewer.showAdult).toBe(false);
		expect(viewer.status).toBe(status);
	});

	/** Turning on checks eligibility only; pin the actual policy so the screen never gets stricter than the server. */
	test("a suspended member can turn it on when eligible", async () => {
		const grace = await signUp();
		await setMember(grace.memberId, {
			verified: true,
			adult: true,
			status: "suspended",
		});

		expect(
			(await readViewer(await setShowAdult(grace.cookie, true))).showAdult,
		).toBe(true);
	});

	test("a non-boolean value is refused", async () => {
		const helen = await signUp();
		const response = await setShowAdult(helen.cookie, "yes");
		expect(response.status).toBe(400);
		expect(await readCode(response)).toBe("invalid_input");
	});
});
