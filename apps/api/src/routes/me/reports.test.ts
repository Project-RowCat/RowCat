import { MY_REPORTS_MAX_PAGE_SIZE } from "@rowcat/contracts";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	member,
	moderation_case,
	moderation_report,
	notification,
	story,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * The reporter's lifecycle view, through the real Hono app and Postgres. Four things are checked,
 * three of them absences:
 *
 * ```text
 * 1. received -> reviewing -> reviewed actually flows
 * 2. there is no place to read someone else's report
 * 3. the operator axis (case id, report count, notes, operator identity, internal disposition) does not leak
 * 4. closing creates exactly one notification, including under retry, races and account deletion
 * ```
 *
 * Calling service functions directly would leave the fragile spots outside the test: whether the
 * ownership predicate is really on the route, whether the gate is `requireViewer` (a suspended
 * member reads their own list), and whether one conditional UPDATE solves idempotency and races
 * together.
 */

const EMAIL_PREFIX = "my-reports-test-";

/** Everything the reporter response may carry; this array is the exposure boundary. */
const MY_REPORT_KEYS = [
	"id",
	"targetType",
	"reason",
	"state",
	"createdAt",
	"reviewedAt",
].sort();

interface Account {
	cookie: string;
	memberId: string;
}

const CREATED_MEMBERS: string[] = [];

async function signUp() {
	const account = await createTestMember(EMAIL_PREFIX, {
		name: "Report history test",
	});
	CREATED_MEMBERS.push(account.memberId);
	return account;
}

/** Operator account: the product API has no promotion path, so this uses the same method as the seed script. */
async function signUpOperator(): Promise<Account> {
	const account = await signUp();
	await db
		.update(member)
		.set({ role: "staff" })
		.where(eq(member.id, account.memberId));
	return account;
}

async function seedStory(ownerId: string): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: `Story ${id.slice(0, 6)}`,
		visibility: "public",
		origin_draft_id: newId(),
		play_payload: { v: 1 },
	});
	return id;
}

const get = (path: string, cookie: string | null) =>
	app.request(path, {
		headers: { Origin: WEB_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
	});

const post = (path: string, cookie: string | null, body: unknown) =>
	app.request(path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: WEB_ORIGIN,
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify(body),
	});

interface MyReportRow {
	id: string;
	targetType: string;
	reason: string;
	state: string;
	createdAt: string;
	reviewedAt: string | null;
}

const myReports = async (
	cookie: string,
	search = "",
): Promise<{ items: MyReportRow[]; nextCursor: string | null }> => {
	const response = await get(`/v2/me/moderation/reports${search}`, cookie);
	expect(response.status).toBe(200);
	return (await response.json()) as {
		items: MyReportRow[];
		nextCursor: string | null;
	};
};

/** Files one report; the target is a fresh story each time so the duplicate constraint is not hit. */
async function reportSomething(
	reporter: Account,
	options: { reason?: string; details?: string } = {},
): Promise<{ reportId: string; storyId: string; ownerId: string }> {
	const owner = await signUp();
	const storyId = await seedStory(owner.memberId);
	const response = await post("/v2/reports", reporter.cookie, {
		target: { type: "story", storyId },
		reason: options.reason ?? "spam",
		...(options.details ? { details: options.details } : {}),
	});
	expect(response.status).toBe(201);
	const { reportId } = (await response.json()) as { reportId: string };
	return { reportId, storyId, ownerId: owner.memberId };
}

const resolve = (
	reportId: string,
	body: { status: "resolved" | "dismissed"; note: string },
) => post(`/v2/moderation/reports/${reportId}/resolve`, OPERATOR.cookie, body);

/** Review-completed notifications this member received; the count is the dominant assertion in this file. */
const reviewedNotifications = (recipientId: string) =>
	db
		.select()
		.from(notification)
		.where(
			and(
				eq(notification.recipient, recipientId),
				eq(notification.kind, "report_reviewed"),
			),
		);

const reportRow = async (reportId: string) => {
	const [row] = await db
		.select()
		.from(moderation_report)
		.where(eq(moderation_report.id, reportId));
	return row;
};

const databaseReady = await connectTestDatabase();

const OPERATOR: Account = databaseReady
	? await signUpOperator()
	: { cookie: "", memberId: "" };

afterAll(async () => {
	if (databaseReady) {
		/** Case first; deleting the member afterwards would otherwise leave the report anonymous. */
		if (CREATED_MEMBERS.length)
			await db
				.delete(moderation_case)
				.where(
					inArray(
						moderation_case.id,
						db
							.select({ id: moderation_report.case_id })
							.from(moderation_report)
							.where(inArray(moderation_report.reporter, CREATED_MEMBERS)),
					),
				);
		await db.delete(story).where(isNull(story.owner));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

// Lifecycle

describe.skipIf(!databaseReady)("my reports — lifecycle", () => {
	test("filing shows it in the list as `Under review`", async () => {
		const reporter = await signUp();
		const { reportId } = await reportSomething(reporter, {
			reason: "harassment",
		});

		const { items } = await myReports(reporter.cookie);
		const row = items.find((item) => item.id === reportId);
		expect(row).toMatchObject({
			id: reportId,
			targetType: "story",
			reason: "harassment",
			state: "reviewing",
			reviewedAt: null,
		});
		expect(Date.parse(row?.createdAt ?? "")).not.toBeNaN();
	});

	/** Filing creates no notification: re-announcing what the user just did is noise. The durable receipt is this list. */
	test("filing alone creates no notification", async () => {
		const reporter = await signUp();
		await reportSomething(reporter);
		expect(await reviewedNotifications(reporter.memberId)).toHaveLength(0);
	});

	test("closing as `resolved` makes it `Reviewed` and sends one notification", async () => {
		const reporter = await signUp();
		const { reportId } = await reportSomething(reporter);

		expect(
			(await resolve(reportId, { status: "resolved", note: "" })).status,
		).toBe(204);

		const { items } = await myReports(reporter.cookie);
		const row = items.find((item) => item.id === reportId);
		expect(row?.state).toBe("reviewed");
		expect(Date.parse(row?.reviewedAt ?? "")).not.toBeNaN();
		expect(await reviewedNotifications(reporter.memberId)).toHaveLength(1);
	});

	/**
	 * `dismissed` is also `Reviewed`. If dispositions looked different, the value would become an
	 * announcement that nothing was done, and the reporter would infer what happened to the other
	 * person.
	 */
	test("`dismissed` is the same `Reviewed` and sends the same kind of notification", async () => {
		const reporter = await signUp();
		const { reportId } = await reportSomething(reporter);

		expect(
			(await resolve(reportId, { status: "dismissed", note: "" })).status,
		).toBe(204);

		const response = await get("/v2/me/moderation/reports", reporter.cookie);
		const body = await response.text();
		const { items } = JSON.parse(body) as { items: MyReportRow[] };
		expect(items.find((item) => item.id === reportId)?.state).toBe("reviewed");
		/** No internal disposition vocabulary anywhere in the response, checked on the serialized string. */
		expect(body).not.toContain("dismissed");
		expect(body).not.toContain("resolved");

		const rows = await reviewedNotifications(reporter.memberId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("report_reviewed");
	});

	/**
	 * The record survives when the target disappears. If the list re-checked target visibility, a
	 * reported story being hidden or deleted would drop its row from the reporter's history.
	 */
	test("the row stays even when the reported story is deleted", async () => {
		const reporter = await signUp();
		const { reportId, storyId } = await reportSomething(reporter);
		await db.delete(story).where(eq(story.id, storyId));

		const { items } = await myReports(reporter.cookie);
		expect(items.map((item) => item.id)).toContain(reportId);
	});
});

// Ownership

describe.skipIf(!databaseReady)("my reports — ownership", () => {
	test("Alice and Bob each see only their own reports", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const a = await reportSomething(alice);
		const b = await reportSomething(bob);

		const aliceItems = (await myReports(alice.cookie)).items.map((r) => r.id);
		const bobItems = (await myReports(bob.cookie)).items.map((r) => r.id);

		expect(aliceItems).toContain(a.reportId);
		expect(aliceItems).not.toContain(b.reportId);
		expect(bobItems).toContain(b.reportId);
		expect(bobItems).not.toContain(a.reportId);
	});

	/**
	 * A request pointing at another member is not expressible. Naming a reporter in the query does
	 * nothing because the predicate is pinned to the session's member; the response is the caller's
	 * own list, not a 400.
	 */
	test("naming someone else's report in the query still returns your own list", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const a = await reportSomething(alice);

		const { items } = await myReports(
			bob.cookie,
			`?reporterId=${alice.memberId}&memberId=${alice.memberId}&viewerId=${alice.memberId}`,
		);
		expect(items.map((r) => r.id)).not.toContain(a.reportId);
	});

	/** Operator detail is still operator-only; holding a report id does not open that door. */
	test("even your own report id can't open the operator detail", async () => {
		const reporter = await signUp();
		const { reportId } = await reportSomething(reporter);
		expect(
			(await get(`/v2/moderation/reports/${reportId}`, reporter.cookie)).status,
		).toBe(403);
	});

	test("a guest gets 401", async () => {
		expect((await get("/v2/me/moderation/reports", null)).status).toBe(401);
	});

	/** The gate is `requireViewer`: blocking a suspended member from reading their own report history would hold their own records hostage. */
	test("a suspended member still reads their own reports", async () => {
		const reporter = await signUp();
		const { reportId } = await reportSomething(reporter);

		// Create a case targeting this member and suspend them.
		const complainer = await signUp();
		const created = await post("/v2/reports", complainer.cookie, {
			target: { type: "member", memberId: reporter.memberId },
			reason: "harassment",
		});
		const { reportId: against } = (await created.json()) as {
			reportId: string;
		};
		const detail = await get(
			`/v2/moderation/reports/${against}`,
			OPERATOR.cookie,
		);
		const { caseId } = (await detail.json()) as { caseId: string };
		expect(
			(
				await post("/v2/moderation/actions", OPERATOR.cookie, {
					caseId,
					kind: "suspend_member",
					reason: "repeated violations",
					publicReason: "You repeatedly broke the community rules.",
				})
			).status,
		).toBe(201);

		const { items } = await myReports(reporter.cookie);
		expect(items.map((r) => r.id)).toContain(reportId);
	});
});

// Exposure boundary

describe.skipIf(!databaseReady)("my reports — what does not go out", () => {
	/** Counts the whole key set; asserting one field undefined would pass and leak the day a column is added. The six here are the full allowlist. */
	test("a row's key set is exactly six", async () => {
		const reporter = await signUp();
		await reportSomething(reporter, {
			details: "the reporter's own description",
		});

		const { items } = await myReports(reporter.cookie);
		expect(items.length).toBeGreaterThan(0);
		for (const row of items)
			expect(Object.keys(row).sort()).toEqual(MY_REPORT_KEYS);
	});

	/**
	 * No operator note, identity, case id or same-target report count leaves. Two reports are put on
	 * one case so a leaked `caseReportCount` would show up in the response.
	 */
	test("no operator axis anywhere in the response", async () => {
		const reporter = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);

		const mine = await post("/v2/reports", reporter.cookie, {
			target: { type: "story", storyId },
			reason: "spam",
			details: "the reporter's own description",
		});
		const { reportId } = (await mine.json()) as { reportId: string };

		// Another person's report on the same target; the case is shared.
		const other = await signUp();
		await post("/v2/reports", other.cookie, {
			target: { type: "story", storyId },
			reason: "hate",
		});

		const detail = await get(
			`/v2/moderation/reports/${reportId}`,
			OPERATOR.cookie,
		);
		const { caseId, caseReports } = (await detail.json()) as {
			caseId: string;
			caseReports: { id: string; caseReportCount: number }[];
		};
		/** The operator side really sees two: case id, grouped report count and the other reporter's report id. None may reach the reporter. */
		expect(caseReports).toHaveLength(2);
		expect(caseReports[0]?.caseReportCount).toBe(2);
		const siblingIds = caseReports
			.map((row) => row.id)
			.filter((id) => id !== reportId);

		expect(
			(
				await resolve(reportId, {
					status: "dismissed",
					note: "INTERNAL-NOTE-DO-NOT-LEAK",
				})
			).status,
		).toBe(204);

		const body = await (
			await get("/v2/me/moderation/reports", reporter.cookie)
		).text();
		for (const secret of [
			"INTERNAL-NOTE-DO-NOT-LEAK",
			caseId,
			OPERATOR.memberId,
			reporter.memberId,
			storyId,
			other.memberId,
			...siblingIds,
			"the reporter's own description",
			"caseReportCount",
			"resolutionNote",
			"resolver",
			"evidence",
		])
			expect(body).not.toContain(secret);
	});

	/** No operator on the notification side either; `actor` is always NULL. */
	test("the review-complete notification carries no operator or reference", async () => {
		const reporter = await signUp();
		const { reportId } = await reportSomething(reporter);
		await resolve(reportId, { status: "resolved", note: "internal note" });

		const [row] = await reviewedNotifications(reporter.memberId);
		expect(row?.actor).toBeNull();
		expect(row?.story_id).toBeNull();
		expect(row?.comment_id).toBeNull();
		expect(row?.moderation_action_id).toBeNull();
		expect(row?.moderation_appeal_id).toBeNull();
		expect(row?.app_platform).toBeNull();
		expect(row?.app_version).toBeNull();

		/** Only the four common keys on the wire. */
		const page = (await (
			await get("/v2/me/notifications", reporter.cookie)
		).json()) as { items: Record<string, unknown>[] };
		const dto = page.items.find((item) => item.kind === "report_reviewed");
		expect(Object.keys(dto ?? {}).sort()).toEqual(
			["createdAt", "id", "kind", "readAt"].sort(),
		);
	});

	/**
	 * None of an AI-response report's evidence appears. It is the only plaintext that leaves E2EE, so
	 * it must not get a path to live permanently on the reporter's account screen.
	 */
	test("an AI response report's evidence doesn't appear in the list", async () => {
		const reporter = await signUp();
		const created = await post("/v2/reports", reporter.cookie, {
			target: {
				type: "ai_response",
				evidence: {
					response: {
						content: "AI-EVIDENCE-DO-NOT-LEAK",
						createdAt: "2026-08-20T00:00:00.000Z",
					},
					precedingUserMessage: {
						content: "USER-MESSAGE-DO-NOT-LEAK",
						createdAt: "2026-08-20T00:00:00.000Z",
					},
					model: "claude-secret-alias",
				},
			},
			reason: "sexual_content",
		});
		expect(created.status).toBe(201);

		const body = await (
			await get("/v2/me/moderation/reports", reporter.cookie)
		).text();
		expect(body).toContain("ai_response");
		for (const secret of [
			"AI-EVIDENCE-DO-NOT-LEAK",
			"USER-MESSAGE-DO-NOT-LEAK",
			"claude-secret-alias",
		])
			expect(body).not.toContain(secret);
	});

	/** A private list does not sit in a shared cache, same policy as the adjacent `/me/moderation`. */
	test("the response doesn't sit in a shared cache", async () => {
		const reporter = await signUp();
		await reportSomething(reporter);
		const response = await get("/v2/me/moderation/reports", reporter.cookie);
		expect(response.headers.get("Cache-Control")).toContain("private");
	});
});

// Idempotency and races

describe.skipIf(!databaseReady)(
	"review-complete notifications — only one",
	() => {
		/** A retry creates nothing: closing is a conditional UPDATE on `status = 'open'`, so the second request updates 0 rows, and notification creation inside that returned value is caught with it. */
		test("requesting the same close again doesn't add notifications", async () => {
			const reporter = await signUp();
			const { reportId } = await reportSomething(reporter);

			expect(
				(await resolve(reportId, { status: "resolved", note: "" })).status,
			).toBe(204);
			expect(
				(await resolve(reportId, { status: "resolved", note: "" })).status,
			).toBe(404);

			expect(await reviewedNotifications(reporter.memberId)).toHaveLength(1);
			expect((await reportRow(reportId))?.status).toBe("resolved");
		});

		/** Two operators closing side by side transition once. Which one wins is not promised; the conditional UPDATE is already the boundary, so there is no application mutex. */
		test("even with concurrent closes, there is one transition and one notification each", async () => {
			const reporter = await signUp();
			const { reportId } = await reportSomething(reporter);

			const results = await Promise.all([
				resolve(reportId, { status: "resolved", note: "A" }),
				resolve(reportId, { status: "dismissed", note: "B" }),
			]);
			expect(results.map((r) => r.status).sort()).toEqual([204, 404]);

			expect(await reviewedNotifications(reporter.memberId)).toHaveLength(1);
			expect(["resolved", "dismissed"]).toContain(
				(await reportRow(reportId))?.status,
			);
		});

		/**
		 * Other reporters on the same case are not notified: the notification attaches to the report
		 * transition, not case closure. Case-level would notify every reporter in one closure and require
		 * this code to know their identities.
		 */
		test("other reporters in the same case get one only when their own report closes", async () => {
			const alice = await signUp();
			const bob = await signUp();
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId);

			const first = await post("/v2/reports", alice.cookie, {
				target: { type: "story", storyId },
				reason: "spam",
			});
			const { reportId: aliceReport } = (await first.json()) as {
				reportId: string;
			};
			const second = await post("/v2/reports", bob.cookie, {
				target: { type: "story", storyId },
				reason: "hate",
			});
			const { reportId: bobReport } = (await second.json()) as {
				reportId: string;
			};

			await resolve(aliceReport, { status: "resolved", note: "" });
			expect(await reviewedNotifications(alice.memberId)).toHaveLength(1);
			expect(await reviewedNotifications(bob.memberId)).toHaveLength(0);
			/** Bob's report is still open; closing the case did not swallow it. */
			expect((await myReports(bob.cookie)).items[0]?.state).toBe("reviewing");

			await resolve(bobReport, { status: "dismissed", note: "" });
			expect(await reviewedNotifications(bob.memberId)).toHaveLength(1);
			expect(await reviewedNotifications(alice.memberId)).toHaveLength(1);
		});

		/** A deleted reporter does not block closing: the `reporter` FK is `set null`, so it succeeds without a notification. Throwing would let one account deletion block the operator queue forever. */
		test("a report whose reporter deleted their account still closes as is", async () => {
			const reporter = await signUp();
			const { reportId } = await reportSomething(reporter);
			await db
				.update(moderation_report)
				.set({ reporter: null })
				.where(eq(moderation_report.id, reportId));

			expect(
				(await resolve(reportId, { status: "resolved", note: "" })).status,
			).toBe(204);
			expect((await reportRow(reportId))?.status).toBe("resolved");
			expect(await reviewedNotifications(reporter.memberId)).toHaveLength(0);
		});

		/** Marking a notification read is not moderation state: the notification is a copy and the authority is the `moderation_report` row, so touching it would turn inbox cleanup into data loss. */
		test("reading the notification doesn't change the report state", async () => {
			const reporter = await signUp();
			const { reportId } = await reportSomething(reporter);
			await resolve(reportId, { status: "resolved", note: "" });

			const [row] = await reviewedNotifications(reporter.memberId);
			const before = await reportRow(reportId);
			expect(
				(
					await app.request(`/v2/me/notifications/${row?.id}/read`, {
						method: "PUT",
						headers: { Origin: WEB_ORIGIN, Cookie: reporter.cookie },
					})
				).status,
			).toBe(200);

			const after = await reportRow(reportId);
			expect(after?.status).toBe(before?.status);
			expect(after?.resolved_at?.toISOString()).toBe(
				before?.resolved_at?.toISOString(),
			);
			expect((await myReports(reporter.cookie)).items[0]?.state).toBe(
				"reviewed",
			);
		});
	},
);

// Pagination

describe.skipIf(!databaseReady)("my reports — page by page", () => {
	/** No duplicate or omission at the cursor boundary. Four reports filed back to back can land in the same millisecond; without id in the sort key a row would show twice or vanish there. */
	test("joining page by page neither duplicates nor drops", async () => {
		const reporter = await signUp();
		const created: string[] = [];
		for (let i = 0; i < 4; i += 1)
			created.push((await reportSomething(reporter)).reportId);

		const collected: string[] = [];
		let cursor = "";
		for (let page = 0; page < 5; page += 1) {
			const body = await myReports(
				reporter.cookie,
				`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			);
			expect(body.items.length).toBeLessThanOrEqual(2);
			collected.push(...body.items.map((item) => item.id));
			if (!body.nextCursor) break;
			cursor = body.nextCursor;
		}

		expect(new Set(collected).size).toBe(collected.length);
		expect(collected.sort()).toEqual([...created].sort());
	});

	/** Newest first; the report just filed is on top. */
	test("newest first", async () => {
		const reporter = await signUp();
		const first = await reportSomething(reporter);
		const second = await reportSomething(reporter);
		const { items } = await myReports(reporter.cookie);
		expect(items[0]?.id).toBe(second.reportId);
		expect(items[1]?.id).toBe(first.reportId);
	});

	/** No unbounded dump; the contract rejects it with a 400. */
	test("refuses a request over the cap", async () => {
		const reporter = await signUp();
		expect(
			(
				await get(
					`/v2/me/moderation/reports?limit=${MY_REPORTS_MAX_PAGE_SIZE + 1}`,
					reporter.cookie,
				)
			).status,
		).toBe(400);
		expect(
			(await get("/v2/me/moderation/reports?limit=100000", reporter.cookie))
				.status,
		).toBe(400);
	});

	/** No reports gives an empty array, not a 404. */
	test("no reports is an empty list", async () => {
		const reporter = await signUp();
		expect(await myReports(reporter.cookie)).toEqual({
			items: [],
			nextCursor: null,
		});
	});
});
