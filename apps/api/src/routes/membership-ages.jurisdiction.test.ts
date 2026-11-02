import {
	MEMBERSHIP_ERROR_CODE,
	type RuntimeConfigDto,
} from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { member } from "../db/schema.ts";
import { createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * A deployment that runs guardian consent under 13 and adulthood at 18
 * (`vitest.jurisdiction.config.ts`). The rules themselves are pure and covered in `@rowcat/domain`;
 * this file pins the wiring, the place a forgotten argument would quietly fall back to Korean law:
 * the declaration endpoint decides with the configured age, the runtime config tells clients the same
 * number, and the refusals say it.
 */

const EMAIL_PREFIX = "membership-ages-test-";

const call = (
	path: string,
	cookie: string | null,
	init: { method?: string; body?: unknown } = {},
) =>
	Promise.resolve(
		app.request(path, {
			method: init.method ?? (init.body === undefined ? "GET" : "POST"),
			headers: {
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
				...(init.body === undefined
					? {}
					: { "Content-Type": "application/json" }),
			},
			...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
		}),
	);

/** A date N years and D days before today in KST, so the boundary is exact. */
const birthDate = (years: number, days = 0): string => {
	const now = new Date(Date.now() + 9 * 60 * 60_000);
	return new Date(
		Date.UTC(
			now.getUTCFullYear() - years,
			now.getUTCMonth(),
			now.getUTCDate() - days,
		),
	)
		.toISOString()
		.slice(0, 10);
};

const ageStatusOf = async (memberId: string) =>
	(
		await db
			.select({ status: member.age_status })
			.from(member)
			.where(eq(member.id, memberId))
	)[0]?.status;

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("a deployment's own ages", () => {
	test("the runtime config tells clients the configured ages", async () => {
		const config = (await (
			await call("/v2/runtime-config", null)
		).json()) as RuntimeConfigDto;
		expect(config.membershipAges).toEqual({ guardianConsent: 13, adult: 18 });
	});

	/** Under Korean law this member is a child; here 13 is the line, so they are not. */
	test("a member who just turned 13 is not a child, one a day short of it is", async () => {
		const thirteen = await createTestMember(EMAIL_PREFIX);
		expect(
			(
				await call("/v2/me/membership/age", thirteen.cookie, {
					body: { birthDate: birthDate(13) },
				})
			).status,
		).toBe(200);
		expect(await ageStatusOf(thirteen.memberId)).toBe("standard");

		const twelve = await createTestMember(EMAIL_PREFIX);
		await call("/v2/me/membership/age", twelve.cookie, {
			body: { birthDate: birthDate(13, -1) },
		});
		expect(await ageStatusOf(twelve.memberId)).toBe("child");
	});

	test("a refusal names the configured age", async () => {
		const child = await createTestMember(EMAIL_PREFIX);
		await call("/v2/me/membership/age", child.cookie, {
			body: { birthDate: birthDate(10) },
		});
		const refused = await call("/v2/stories?rating=adult", child.cookie);
		expect(refused.status).toBe(403);
		const body = (await refused.json()) as { code: string; message: string };
		expect(body.code).toBe(MEMBERSHIP_ERROR_CODE.minorAdultRestricted);
		expect(body.message).toContain("under 13");
	});
});
