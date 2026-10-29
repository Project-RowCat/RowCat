import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

/**
 * Simulates a deployment with the one-year re-verification switched on, in this file only. The
 * switch is fixed when `env.ts` loads, and enabling it by default would make every existing adult
 * test lose viewing as an "adult with no verification record" (a member seeded by columns alone).
 * No separate config file is needed: the value derives no other setting and only the viewer
 * projection reads it, and vitest loads modules per file.
 */
vi.mock("../../env.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../env.ts")>()),
	adultReverificationEnabled: true,
}));

import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { identity_verification, member } from "../../db/schema.ts";
import {
	type DevIdentityOutcome,
	resetDevIdentityOutcome,
	setDevIdentityOutcome,
} from "../../services/identity/provider.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * What this file catches, all of which look identical in a success response:
 *
 * 1. After one year only viewing closes; entitlement (`verified`, `adult`) and the display
 *    toggle stay.
 * 2. An adult with no record needs re-verification; an unknown verification time is not "still
 *    fresh".
 * 3. Verifying again lifts it; an already-adult member can repeat the procedure.
 * 4. A minor verification does not restart the clock, since it does not confirm "19 or older".
 */

const EMAIL_PREFIX = "adult-recheck-test-";
const DAY_MS = 24 * 60 * 60_000;

const databaseReady = await connectTestDatabase();

afterEach(() => {
	resetDevIdentityOutcome();
});

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

const headers = (cookie: string) => ({ Origin: WEB_ORIGIN, Cookie: cookie });

const post = (path: string, cookie: string): Promise<Response> =>
	Promise.resolve(
		app.request(path, { method: "POST", headers: headers(cookie) }),
	);

async function runVerification(
	cookie: string,
	outcome: DevIdentityOutcome = "adult",
): Promise<void> {
	setDevIdentityOutcome(outcome);
	expect((await post("/v2/me/adult-verification", cookie)).status).toBe(200);
	expect((await post("/v2/me/adult-verification/verify", cookie)).status).toBe(
		200,
	);
}

interface ViewerBody {
	verified: boolean;
	adult: boolean;
	showAdult: boolean;
	adultRecheckRequired: boolean;
}

const me = async (cookie: string): Promise<ViewerBody> =>
	(await (
		await app.request("/v2/me", { headers: headers(cookie) })
	).json()) as ViewerBody;

/** Gallery filtered to adult content; 403 when `canViewAdult` refuses. */
const adultGallery = (cookie: string) =>
	Promise.resolve(
		app.request("/v2/stories?rating=adult", { headers: headers(cookie) }),
	);

const setShowAdult = (cookie: string, showAdult: boolean) =>
	Promise.resolve(
		app.request("/v2/me/show-adult", {
			method: "PATCH",
			headers: { ...headers(cookie), "Content-Type": "application/json" },
			body: JSON.stringify({ showAdult }),
		}),
	);

/** Moves all of this member's verification records back N days: shifts the evidence instead of the clock. */
const backdate = (memberId: string, days: number) =>
	db
		.update(identity_verification)
		.set({ verified_at: new Date(Date.now() - days * DAY_MS) })
		.where(eq(identity_verification.member_id, memberId));

describe.skipIf(!databaseReady)(
	"yearly re-verification — a deployment with the switch on",
	() => {
		test("an adult who just verified is not due for re-verification and viewing opens", async () => {
			const person = await createTestMember(EMAIL_PREFIX);
			await runVerification(person.cookie, "adult");
			expect((await setShowAdult(person.cookie, true)).status).toBe(200);

			expect(await me(person.cookie)).toMatchObject({
				verified: true,
				adult: true,
				showAdult: true,
				adultRecheckRequired: false,
			});
			expect((await adultGallery(person.cookie)).status).toBe(200);
		});

		/**
		 * The most important check here: after one year viewing (`canViewAdult`) closes while entitlement
		 * (`isAdultVerified`) stays, proven by the display-setting request still passing (that route
		 * rejects on `isAdultVerified`).
		 */
		test("after more than a year, only viewing closes and eligibility stays", async () => {
			const person = await createTestMember(EMAIL_PREFIX);
			await runVerification(person.cookie, "adult");
			expect((await setShowAdult(person.cookie, true)).status).toBe(200);
			await backdate(person.memberId, 366);

			expect(await me(person.cookie)).toMatchObject({
				verified: true,
				adult: true,
				showAdult: true,
				adultRecheckRequired: true,
			});

			const blocked = await adultGallery(person.cookie);
			expect(blocked.status).toBe(403);
			/** Does not claim display was turned off: it is on, and turning it on does not lift the block. */
			expect((await blocked.json()) as { code: string }).toMatchObject({
				code: "adult_recheck_required",
			});

			/** Entitlement remains, so both turning it off and on again are allowed. */
			expect((await setShowAdult(person.cookie, false)).status).toBe(200);
			expect((await setShowAdult(person.cookie, true)).status).toBe(200);
		});

		test("verifying again clears the re-verification requirement and viewing opens", async () => {
			const person = await createTestMember(EMAIL_PREFIX);
			await runVerification(person.cookie, "adult");
			expect((await setShowAdult(person.cookie, true)).status).toBe(200);
			await backdate(person.memberId, 400);
			expect((await me(person.cookie)).adultRecheckRequired).toBe(true);

			/** An already-adult member can redo the procedure from the start; the route does not block it. */
			await runVerification(person.cookie, "adult");

			expect(await me(person.cookie)).toMatchObject({
				verified: true,
				adult: true,
				showAdult: true,
				adultRecheckRequired: false,
			});
			expect((await adultGallery(person.cookie)).status).toBe(200);
		});

		/**
		 * An adult with no record: members who gained entitlement before the attempt table existed (old
		 * data, seeds, operator corrections). An unknown verification time means re-verify.
		 */
		test("a member with only the eligibility columns on and no verification record is due for re-verification", async () => {
			const person = await createTestMember(EMAIL_PREFIX);
			await db
				.update(member)
				.set({ verified: true, adult: true, show_adult: true })
				.where(eq(member.id, person.memberId));

			expect((await me(person.cookie)).adultRecheckRequired).toBe(true);
			expect((await adultGallery(person.cookie)).status).toBe(403);
		});

		/**
		 * As a later minor verification does not roll back entitlement, it does not restart the deadline
		 * either: it does not re-confirm "19 or older".
		 */
		test("a minor verification does not renew the adult verification's deadline", async () => {
			const person = await createTestMember(EMAIL_PREFIX);
			await runVerification(person.cookie, "adult");
			await backdate(person.memberId, 366);
			await runVerification(person.cookie, "minor");

			expect(await me(person.cookie)).toMatchObject({
				verified: true,
				adult: true,
				adultRecheckRequired: true,
			});
		});

		/** No prompt for someone without entitlement; their task is the first verification. */
		test("re-verification is not required of unverified members or those under 19", async () => {
			const fresh = await createTestMember(EMAIL_PREFIX);
			expect((await me(fresh.cookie)).adultRecheckRequired).toBe(false);

			const minor = await createTestMember(EMAIL_PREFIX);
			await runVerification(minor.cookie, "minor");
			await backdate(minor.memberId, 400);
			expect((await me(minor.cookie)).adultRecheckRequired).toBe(false);
		});
	},
);
