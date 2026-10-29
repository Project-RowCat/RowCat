import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import { identity_verification, member, user } from "../../db/schema.ts";
import {
	type DevIdentityOutcome,
	resetDevIdentityOutcome,
	setDevIdentityOutcome,
} from "../../services/identity/provider.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Adult verification over real HTTP against real Postgres. Each item below is a defect that looks
 * identical in a success response, and some are irreversible:
 *
 * 1. The browser cannot create entitlement: the completion request has no slot for a result or
 *    identifier, and the server queries the authority only with the reference it stored.
 * 2. Someone else's verification never becomes mine: attempts are bound to the session's member,
 *    and a guardian-consent verification cannot be consumed here (different table).
 * 3. Verification success is not adulthood: an under-19 is a normal success and `adult` is
 *    false.
 * 4. The child restriction holds against direct calls; hiding a button is not authorization.
 * 5. Replay and races do not change state twice.
 * 6. No identity is stored: the row's whole column set is counted, since `not.toHaveProperty`
 *    would pass while leaking once a column is added.
 * 7. The display opt-in is not switched on as a side effect of verifying.
 *
 * The dev verifier answers three branches (adult, minor, failure) and only tests choose the branch
 * (`setDevIdentityOutcome` throws in production). Tests go through the same two endpoints as
 * production, so the path walked is the user's path.
 */

const EMAIL_PREFIX = "adult-verify-test-";

/** Keys the completion response actually returns, the viewer as is; adding one breaks this first. */
const VIEWER_KEYS = [
	"adult",
	"adultRecheckRequired",
	"ageStatus",
	"id",
	"membershipGate",
	"nickname",
	"role",
	"showAdult",
	"status",
	"verified",
];

/**
 * Columns an attempt row actually has. The authority provides name, contact, birth date, CI and DI,
 * and none may appear here. Counting the whole set matters because "no sensitive fields" would pass
 * while leaking once a column is added.
 */
const ATTEMPT_COLUMNS = [
	"adult",
	"consumed_at",
	"created_at",
	"expires_at",
	"id",
	"member_id",
	"provider",
	"provider_ref",
	"purpose",
	"requested_at",
	"status",
	"updated_at",
	"verified_at",
];

interface Person {
	cookie: string;
	memberId: string;
	email: string;
}

interface ViewerBody {
	id: string;
	verified: boolean;
	adult: boolean;
	showAdult: boolean;
	ageStatus: string;
}

const signUp = (name = "Adult eligibility test") =>
	createTestMember(EMAIL_PREFIX, { name });

const post = (
	path: string,
	cookie?: string | null,
	body?: unknown,
): Promise<Response> =>
	/** `app.request` can type as a synchronous response, so wrap it once. */
	Promise.resolve(
		app.request(path, {
			method: "POST",
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}),
	);

const begin = (cookie: string) => post("/v2/me/adult-verification", cookie);
const verify = (cookie: string, body?: unknown) =>
	post("/v2/me/adult-verification/verify", cookie, body);

/** N years ago from today: the shortest way to make a child (product timezone). */
const yearsAgo = (years: number): string => {
	const now = new Date(Date.now() + 9 * 60 * 60_000);
	return new Date(
		Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
	)
		.toISOString()
		.slice(0, 10);
};

const declareAge = (cookie: string, birthDate: string) =>
	post("/v2/me/membership/age", cookie, { birthDate });

/** Runs the whole procedure with the verifier's answer fixed, through the same two endpoints as production. */
async function runVerification(
	cookie: string,
	outcome: DevIdentityOutcome = "adult",
): Promise<Response> {
	setDevIdentityOutcome(outcome);
	const started = await begin(cookie);
	expect(started.status).toBe(200);
	const body = (await started.json()) as {
		handoff: { kind: string };
		expiresAt: string;
	};
	/** The dev verifier returns an address that comes straight back instead of opening a window. */
	expect(body.handoff.kind).toBe("redirect");
	expect(Object.keys(body).sort()).toEqual(["expiresAt", "handoff"]);
	return verify(cookie);
}

const memberRow = async (memberId: string) => {
	const [row] = await db
		.select({
			verified: member.verified,
			adult: member.adult,
			showAdult: member.show_adult,
		})
		.from(member)
		.where(eq(member.id, memberId))
		.limit(1);
	return row;
};

const databaseReady = await connectTestDatabase();

afterEach(() => {
	resetDevIdentityOutcome();
});

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("adult verification — the normal path", () => {
	test("completing verification turns on verified and adult while display stays off", async () => {
		const person = await signUp();
		const response = await runVerification(person.cookie, "adult");
		expect(response.status).toBe(200);

		const viewer = (await response.json()) as ViewerBody;
		expect(viewer.verified).toBe(true);
		expect(viewer.adult).toBe(true);
		/**
		 * Verification does not switch adult content on: gaining entitlement and choosing to view are
		 * different decisions, and a side effect would show screens the person never chose.
		 */
		expect(viewer.showAdult).toBe(false);

		expect(await memberRow(person.memberId)).toEqual({
			verified: true,
			adult: true,
			showAdult: false,
		});
	});

	/** The response is the confirmed viewer as is; the screen seats this value in its cache. */
	test("the completion response's key set matches the viewer's", async () => {
		const person = await signUp();
		const body = (await (
			await runVerification(person.cookie, "adult")
		).json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(VIEWER_KEYS);
	});

	/**
	 * Verification success is not adulthood. An under-19 is a normal success, and telling them it
	 * failed would make them suspect their device or carrier.
	 */
	test("under 19 turns on only verified, and adult stays off", async () => {
		const person = await signUp();
		const response = await runVerification(person.cookie, "minor");
		expect(response.status).toBe(200);

		const viewer = (await response.json()) as ViewerBody;
		expect(viewer.verified).toBe(true);
		expect(viewer.adult).toBe(false);
		expect(await memberRow(person.memberId)).toEqual({
			verified: true,
			adult: false,
			showAdult: false,
		});
	});

	/** Display can be turned on only after entitlement; the two operations really chain. */
	test("once eligible, the adult display can be turned on", async () => {
		const person = await signUp();
		const before = await app.request("/v2/me/show-adult", {
			method: "PATCH",
			headers: {
				Origin: WEB_ORIGIN,
				Cookie: person.cookie,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ showAdult: true }),
		});
		expect(before.status).toBe(400);

		await runVerification(person.cookie, "adult");

		const after = await app.request("/v2/me/show-adult", {
			method: "PATCH",
			headers: {
				Origin: WEB_ORIGIN,
				Cookie: person.cookie,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ showAdult: true }),
		});
		expect(after.status).toBe(200);
		expect((await after.json()) as ViewerBody).toMatchObject({
			showAdult: true,
		});
	});

	/** Gate is `requireViewer`: sanctioned members can still verify their own identity. */
	test("a suspended member can still verify identity", async () => {
		const person = await signUp();
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, person.memberId));
		expect((await runVerification(person.cookie, "adult")).status).toBe(200);
	});
});

describe.skipIf(!databaseReady)("adult verification — what is stored", () => {
	/**
	 * No identity remains. The authority gives name, contact, birth date, CI and DI, but this consumer
	 * has no retention basis (unlike guardian consent).
	 */
	test("the attempt row's column set has no identity", async () => {
		const person = await signUp();
		await runVerification(person.cookie, "adult");

		/**
		 * Reading with `select *` is the point: enumerating columns would never see columns added later,
		 * and the check would pass while leaking.
		 */
		const rows = await db.execute(
			sql`select * from identity_verification where member_id = ${person.memberId}`,
		);
		const row = rows.rows[0] as Record<string, unknown>;
		expect(row).toBeTruthy();
		expect(Object.keys(row).sort()).toEqual(ATTEMPT_COLUMNS);
		expect(row.purpose).toBe("adult_eligibility");
		expect(row.status).toBe("verified");
		expect(row.adult).toBe(true);
		expect(row.provider).toBe("dev");
		expect(row.consumed_at).toBeTruthy();
	});

	/** The authority's reference never leaves in the response; the browser has no reason to know it. */
	test("the verification authority's reference appears nowhere in the response", async () => {
		const person = await signUp();
		setDevIdentityOutcome("adult");
		const started = await begin(person.cookie);
		const startBody = await started.text();

		const [row] = await db
			.select({ ref: identity_verification.provider_ref })
			.from(identity_verification)
			.where(eq(identity_verification.member_id, person.memberId))
			.limit(1);
		expect(row?.ref).toBeTruthy();
		expect(startBody).not.toContain(row?.ref ?? "");

		const done = await verify(person.cookie);
		expect(await done.text()).not.toContain(row?.ref ?? "");
	});
});

describe.skipIf(!databaseReady)(
	"adult verification — refusals and races",
	() => {
		test("a guest gets 401", async () => {
			expect((await begin("")).status).toBe(401);
			expect((await verify("")).status).toBe(401);
		});

		/** A completion with no start has nothing to query. */
		test("submitting completion without starting is a 404", async () => {
			const person = await signUp();
			const response = await verify(person.cookie);
			expect(response.status).toBe(404);
			expect((await response.json()) as { code: string }).toMatchObject({
				code: "identity_verification_not_found",
			});
		});

		/**
		 * The client cannot state the result. Whatever the body carries, the server queries only with its
		 * stored reference; a settable value would be a claim, not evidence.
		 */
		test("the completion request's body is ignored", async () => {
			const person = await signUp();
			setDevIdentityOutcome("minor");
			await begin(person.cookie);

			const response = await verify(person.cookie, {
				verified: true,
				adult: true,
				identityVerificationId: "someone-elses-verification",
			});
			expect(response.status).toBe(200);
			/** The body was ignored, so it is what the verifier answered: `adult` is not switched on. */
			expect((await response.json()) as ViewerBody).toMatchObject({
				verified: true,
				adult: false,
			});
		});

		test("when the authority can't verify, the member state stays as is", async () => {
			const person = await signUp();
			const response = await runVerification(person.cookie, "failed");
			expect(response.status).toBe(400);
			expect((await response.json()) as { code: string }).toMatchObject({
				code: "identity_verification_provider_failed",
			});
			expect(await memberRow(person.memberId)).toEqual({
				verified: false,
				adult: false,
				showAdult: false,
			});
		});

		/** A failed attempt is closed; a second completion has nothing to query. */
		test("trying to complete a failed attempt again is a 409", async () => {
			const person = await signUp();
			await runVerification(person.cookie, "failed");
			const replay = await verify(person.cookie);
			expect(replay.status).toBe(409);
			expect((await replay.json()) as { code: string }).toMatchObject({
				code: "identity_verification_conflict",
			});
		});

		/**
		 * Replay is not an error. A retry from a browser that lost the response is the normal path, and
		 * asking again is the only way to find out.
		 */
		test("sending the same completion twice changes the state only once", async () => {
			const person = await signUp();
			expect((await runVerification(person.cookie, "adult")).status).toBe(200);

			const replay = await verify(person.cookie);
			expect(replay.status).toBe(200);
			expect((await replay.json()) as ViewerBody).toMatchObject({
				verified: true,
				adult: true,
			});

			const rows = await db
				.select({ id: identity_verification.id })
				.from(identity_verification)
				.where(
					and(
						eq(identity_verification.member_id, person.memberId),
						eq(identity_verification.status, "verified"),
					),
				);
			expect(rows).toHaveLength(1);
		});

		/** Expiry is decided by a predicate, not a status column. */
		test("an expired attempt is a 410", async () => {
			const person = await signUp();
			setDevIdentityOutcome("adult");
			await begin(person.cookie);
			await db
				.update(identity_verification)
				.set({ expires_at: new Date(Date.now() - 1000) })
				.where(eq(identity_verification.member_id, person.memberId));

			const response = await verify(person.cookie);
			expect(response.status).toBe(410);
			expect((await response.json()) as { code: string }).toMatchObject({
				code: "identity_verification_expired",
			});
		});

		/** One open attempt per member; the partial unique index is the final authority. */
		test("starting a new attempt replaces the previous one", async () => {
			const person = await signUp();
			setDevIdentityOutcome("adult");
			await begin(person.cookie);
			await begin(person.cookie);

			const rows = await db
				.select({ status: identity_verification.status })
				.from(identity_verification)
				.where(eq(identity_verification.member_id, person.memberId));
			expect(rows).toHaveLength(2);
			expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);
			expect(rows.filter((r) => r.status === "superseded")).toHaveLength(1);
		});

		test("starting twice at once still leaves only one open attempt", async () => {
			const person = await signUp();
			setDevIdentityOutcome("adult");
			await Promise.allSettled([begin(person.cookie), begin(person.cookie)]);

			const open = await db
				.select({ id: identity_verification.id })
				.from(identity_verification)
				.where(
					and(
						eq(identity_verification.member_id, person.memberId),
						eq(identity_verification.status, "pending"),
					),
				);
			expect(open.length).toBeLessThanOrEqual(1);
		});
	},
);

describe.skipIf(!databaseReady)(
	"adult verification — identity boundary",
	() => {
		/**
		 * Someone else's verification never becomes mine. Alice's attempt cannot be pointed at from Bob's
		 * session (the request has no slot), and Bob has no open attempt.
		 */
		test("can't complete with another account's session", async () => {
			const alice = await signUp("Alice");
			const bob = await signUp("Bob");
			setDevIdentityOutcome("adult");
			await begin(alice.cookie);

			const response = await verify(bob.cookie);
			expect(response.status).toBe(404);
			expect(await memberRow(bob.memberId)).toEqual({
				verified: false,
				adult: false,
				showAdult: false,
			});
			/** Alice's attempt is still open; Bob's request did not consume it. */
			expect(
				(
					await db
						.select({ id: identity_verification.id })
						.from(identity_verification)
						.where(
							and(
								eq(identity_verification.member_id, alice.memberId),
								eq(identity_verification.status, "pending"),
							),
						)
				).length,
			).toBe(1);
		});

		/**
		 * A guardian-consent verification cannot be consumed here. Both procedures using the same
		 * authority does not make their verifications interchangeable: the table this path queries has no
		 * row for that verification at all.
		 */
		test("a guardian consent's identity verification cannot open adult eligibility", async () => {
			const person = await signUp();
			expect((await declareAge(person.cookie, yearsAgo(10))).status).toBe(200);

			const created = (await (
				await post("/v2/me/membership/guardian", person.cookie)
			).json()) as { consentPath: string };
			const token = created.consentPath.replace("/guardian/", "");
			expect((await post(`/v2/guardian/${token}/verification`)).status).toBe(
				200,
			);
			expect((await post(`/v2/guardian/${token}/verify`)).status).toBe(200);

			/** The guardian finished verifying; the child's entitlement did not change at all. */
			expect(await memberRow(person.memberId)).toEqual({
				verified: false,
				adult: false,
				showAdult: false,
			});
			/**
			 * That verification creates no row in this table: nothing exists here to consume, which is why
			 * sharing an authority does not make them interchangeable.
			 */
			expect(
				await db
					.select({ id: identity_verification.id })
					.from(identity_verification)
					.where(eq(identity_verification.member_id, person.memberId)),
			).toEqual([]);

			/**
			 * That account is a child, so it is stopped at the door first (403). Not 404 is the point: the
			 * child restriction stands before the attempt lookup.
			 */
			const response = await verify(person.cookie);
			expect(response.status).toBe(403);
			expect((await response.json()) as { code: string }).toMatchObject({
				code: "minor_adult_restricted",
			});
		});
	},
);

describe.skipIf(!databaseReady)(
	"child restriction — a direct call doesn't get through either",
	() => {
		/** Makes a child with all three adult axes on, the worst representable combination. */
		async function corruptChild(): Promise<Person> {
			const person = await signUp();
			await declareAge(person.cookie, yearsAgo(10));
			await db
				.update(member)
				.set({ verified: true, adult: true, show_adult: true })
				.where(eq(member.id, person.memberId));
			return person;
		}

		test("a child can't start identity verification", async () => {
			const person = await corruptChild();
			const response = await begin(person.cookie);
			expect(response.status).toBe(403);
			/**
			 * Does not reuse the adult gate's code: `adult_verification_required` tells the member to
			 * complete verification, which is false for an under-14.
			 */
			expect((await response.json()) as { code: string }).toMatchObject({
				code: "minor_adult_restricted",
			});
		});

		test("a child can't complete it either", async () => {
			const person = await corruptChild();
			expect((await verify(person.cookie)).status).toBe(403);
		});

		/**
		 * An account that became a child while the verification window was open. Trusting only the
		 * decision at start would apply that verification, and that state cannot be undone.
		 */
		test("turning into a child during verification is not reflected", async () => {
			const person = await signUp();
			setDevIdentityOutcome("adult");
			expect((await begin(person.cookie)).status).toBe(200);

			expect((await declareAge(person.cookie, yearsAgo(9))).status).toBe(200);

			const response = await verify(person.cookie);
			expect(response.status).toBe(403);
			expect(await memberRow(person.memberId)).toMatchObject({
				verified: false,
				adult: false,
			});
		});
	},
);

describe.skipIf(!databaseReady)("monotonicity", () => {
	/**
	 * A later minor verification does not roll back adult entitlement. An operation the user can
	 * invoke themselves must not become a way to revert confirmed identity state; revoking entitlement
	 * is operations' job and this slice has no such operation.
	 */
	test("a minor verification after gaining adult eligibility does not erase it", async () => {
		const person = await signUp();
		await runVerification(person.cookie, "adult");
		expect((await runVerification(person.cookie, "minor")).status).toBe(200);

		expect(await memberRow(person.memberId)).toMatchObject({
			verified: true,
			adult: true,
		});
	});

	/** The attempt row honestly keeps the fact confirmed at that time, a different axis from member state. */
	test("the attempt row records the fact of having been a minor as is", async () => {
		const person = await signUp();
		await runVerification(person.cookie, "adult");
		await runVerification(person.cookie, "minor");

		const rows = await db
			.select({ adult: identity_verification.adult })
			.from(identity_verification)
			.where(
				and(
					eq(identity_verification.member_id, person.memberId),
					eq(identity_verification.status, "verified"),
				),
			);
		expect(rows.map((r) => r.adult).sort()).toEqual([false, true]);
	});

	/**
	 * A failed verification does not erase an already-verified account's entitlement. Failure means
	 * "not verified", not "verification revoked".
	 */
	test("a verification failure does not roll back verified", async () => {
		const person = await signUp();
		await runVerification(person.cookie, "adult");
		expect((await runVerification(person.cookie, "failed")).status).toBe(400);

		expect(await memberRow(person.memberId)).toMatchObject({
			verified: true,
			adult: true,
		});
	});

	/**
	 * The way back for re-verification: the server stores no birth date, so entitlement does not
	 * reopen by itself as the person ages. It must open when they verify again.
	 */
	test("a member verified as a minor can verify again and become an adult", async () => {
		const person = await signUp();
		await runVerification(person.cookie, "minor");
		expect(await memberRow(person.memberId)).toMatchObject({ adult: false });

		await runVerification(person.cookie, "adult");
		expect(await memberRow(person.memberId)).toMatchObject({
			verified: true,
			adult: true,
		});
	});
});

describe.skipIf(!databaseReady)("deletion", () => {
	test("in-progress and finished attempts disappear together", async () => {
		for (const stage of ["pending", "verified"] as const) {
			const person = await signUp();
			if (stage === "pending") {
				setDevIdentityOutcome("adult");
				await begin(person.cookie);
			} else {
				await runVerification(person.cookie, "adult");
			}

			await db.delete(user).where(eq(user.email, person.email));

			const rows = await db
				.select({ id: identity_verification.id })
				.from(identity_verification)
				.where(eq(identity_verification.member_id, person.memberId));
			expect(rows, `an attempt remained at stage ${stage}`).toEqual([]);
		}
	});
});

describe.skipIf(!databaseReady)(
	"yearly re-verification — a deployment with the switch off",
	() => {
		/**
		 * This setting runs with the switch off (`ADULT_REVERIFICATION_ENABLED` unset), so viewing must
		 * not close however many years ago the last verification was. That is the rollout default; the
		 * switched-on behaviour is covered in `adult-recheck.test.ts`.
		 */
		test("re-verification is not required even after more than a year, and viewing opens", async () => {
			const person = await signUp();
			await runVerification(person.cookie, "adult");
			await db
				.update(identity_verification)
				.set({ verified_at: new Date(Date.now() - 3 * 365 * 24 * 60 * 60_000) })
				.where(eq(identity_verification.member_id, person.memberId));
			await db
				.update(member)
				.set({ show_adult: true })
				.where(eq(member.id, person.memberId));

			const me = await app.request("/v2/me", {
				headers: { Origin: WEB_ORIGIN, Cookie: person.cookie },
			});
			expect(
				(await me.json()) as { adultRecheckRequired: boolean },
			).toMatchObject({ adultRecheckRequired: false });

			const adultOnly = await app.request("/v2/stories?rating=adult", {
				headers: { Origin: WEB_ORIGIN, Cookie: person.cookie },
			});
			expect(adultOnly.status).toBe(200);
		});
	},
);
