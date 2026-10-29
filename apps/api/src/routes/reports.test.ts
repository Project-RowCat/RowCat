import { REPORT_ERROR_CODE, REPORT_LIMITS } from "@rowcat/contracts";
import { eq, inArray, isNull } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import {
	member,
	moderation_case,
	moderation_report,
	story,
	story_comment,
} from "../db/schema.ts";
import { newId } from "../lib/id.ts";

import { createTestMember, TEST_PASSWORD } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * Report intake across every boundary, through the real Hono app and Postgres. The checks are about
 * what must not happen:
 *
 * - only server-decided values are stored, whatever the client sends (evidence snapshot,
 *   reporter)
 * - the existence of an invisible target does not leak through response differences
 * - private-conversation evidence is limited to what was explicitly chosen (E2EE boundary)
 * - one person cannot create review work without limit
 */

const EMAIL_PREFIX = "reports-test-";

/**
 * Members this file created, used for cleanup. Reports outlive their reporter (only identity is
 * detached), so deleting members leaves reports piling up in the global queue and creating order
 * dependence across runs. Cases are deleted explicitly; reports and actions cascade from them.
 */
const CREATED_MEMBERS: string[] = [];

async function signUp() {
	const account = await createTestMember(EMAIL_PREFIX, { name: "Report test" });
	CREATED_MEMBERS.push(account.memberId);
	return account;
}

async function seedStory(
	ownerId: string,
	options: {
		visibility?: "public" | "private" | "archived";
		adult?: boolean;
		hidden?: boolean;
		title?: string;
		description?: string;
	} = {},
): Promise<string> {
	const id = newId();
	await db.insert(story).values({
		id,
		owner: ownerId,
		title: options.title ?? `Story ${id.slice(0, 6)}`,
		description: options.description ?? "description",
		visibility: options.visibility ?? "public",
		adult: options.adult ?? false,
		hidden: options.hidden ?? false,
		origin_draft_id: newId(),
		play_payload: { v: 1 },
	});
	return id;
}

const seedComment = async (
	storyId: string,
	authorId: string,
	body: string,
): Promise<string> => {
	const id = newId();
	await db
		.insert(story_comment)
		.values({ id, story_id: storyId, author: authorId, body });
	return id;
};

const postReport = (cookie: string | null, body: unknown): Promise<Response> =>
	Promise.resolve(
		app.request("/v2/reports", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const reportRows = (reporterId: string) =>
	db
		.select()
		.from(moderation_report)
		.where(eq(moderation_report.reporter, reporterId));

/** Minimal valid AI evidence; other tests layer extra fields on it. */
const AI_EVIDENCE = {
	response: {
		content: "The response in question",
		createdAt: "2026-08-20T00:00:00.000Z",
	},
};

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	if (databaseReady) {
		/** Cases first, so reports are not left anonymized by the member deletion. */
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

describe.skipIf(!databaseReady)("reports — public targets", () => {
	test("reporting a story makes the server take a snapshot", async () => {
		const reporter = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, {
			title: "The story in question",
			description: "description body",
		});

		const response = await postReport(reporter.cookie, {
			target: { type: "story", storyId },
			reason: "harassment",
			details: "This is the description",
		});
		expect(response.status).toBe(201);

		const [row] = await reportRows(reporter.memberId);
		expect(row?.target_type).toBe("story");
		expect(row?.target_id).toBe(storyId);
		/** Evidence comes from the row the server read, not the request; if the reporter could invent a title it would not be evidence (same rule as the playback snapshot). */
		expect(row?.evidence).toMatchObject({
			type: "story",
			snapshot: {
				title: "The story in question",
				description: "description body",
			},
		});
	});

	test("comment reports are checked as a story–comment pair", async () => {
		const reporter = await signUp();
		const author = await signUp();
		const storyId = await seedStory(author.memberId);
		const otherStoryId = await seedStory(author.memberId);
		const commentId = await seedComment(
			storyId,
			author.memberId,
			"Comment body",
		);

		// Pointing at that comment under a different story is the same as a missing comment.
		const mismatched = await postReport(reporter.cookie, {
			target: { type: "comment", storyId: otherStoryId, commentId },
			reason: "spam",
		});
		expect(mismatched.status).toBe(404);

		const ok = await postReport(reporter.cookie, {
			target: { type: "comment", storyId, commentId },
			reason: "spam",
		});
		expect(ok.status).toBe(201);

		const [row] = await reportRows(reporter.memberId);
		expect(row?.evidence).toMatchObject({
			type: "comment",
			snapshot: { body: "Comment body", authorId: author.memberId },
		});
	});

	test("a member report's evidence is only the public profile projection", async () => {
		const reporter = await signUp();
		const target = await signUp();

		const response = await postReport(reporter.cookie, {
			target: { type: "member", memberId: target.memberId },
			reason: "impersonation",
		});
		expect(response.status).toBe(201);

		const [row] = await reportRows(reporter.memberId);
		/** Count keys: checking fields one by one would miss a new member column riding into the evidence. */
		const snapshot = (row?.evidence as { snapshot: Record<string, unknown> })
			.snapshot;
		expect(Object.keys(snapshot).sort()).toEqual(["bio", "displayName"]);
		expect(JSON.stringify(row?.evidence)).not.toContain("@example.test");
	});

	test("you can't report yourself as a member", async () => {
		const reporter = await signUp();
		const response = await postReport(reporter.cookie, {
			target: { type: "member", memberId: reporter.memberId },
			reason: "other",
		});
		expect(response.status).toBe(400);
		expect(((await response.json()) as { code: string }).code).toBe(
			REPORT_ERROR_CODE.selfTarget,
		);
	});
});

describe.skipIf(!databaseReady)("reports — targets you can't see", () => {
	test("hidden, missing and private stories are all the same 404", async () => {
		const reporter = await signUp();
		const owner = await signUp();
		const hidden = await seedStory(owner.memberId, { hidden: true });
		const priv = await seedStory(owner.memberId, { visibility: "private" });

		for (const storyId of [hidden, priv, "missing-story-id"]) {
			const response = await postReport(reporter.cookie, {
				target: { type: "story", storyId },
				reason: "spam",
			});
			expect(response.status).toBe(404);
			/** The code must match too; a distinct reason would itself reveal that the story exists and break the detail path's existence hiding. */
			expect(((await response.json()) as { code: string }).code).toBe(
				"not_found",
			);
		}
		expect(await reportRows(reporter.memberId)).toHaveLength(0);
	});

	test("an adult story is a 404 too for a viewer who can't see adult content", async () => {
		const reporter = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId, { adult: true });

		const response = await postReport(reporter.cookie, {
			target: { type: "story", storyId },
			reason: "sexual_content",
		});
		expect(response.status).toBe(404);
	});

	test("a guest can't report", async () => {
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);
		const response = await postReport(null, {
			target: { type: "story", storyId },
			reason: "spam",
		});
		expect(response.status).toBe(401);
	});
});

describe.skipIf(!databaseReady)(
	"reports — AI responses (the E2EE boundary)",
	() => {
		test("only the explicitly chosen evidence is stored", async () => {
			const reporter = await signUp();
			const response = await postReport(reporter.cookie, {
				target: {
					type: "ai_response",
					evidence: {
						...AI_EVIDENCE,
						precedingUserMessage: {
							content: "My question",
							createdAt: "2026-08-20T00:00:00.000Z",
						},
						model: "claude-sonnet",
					},
				},
				reason: "minor_safety",
			});
			expect(response.status).toBe(201);

			const [row] = await reportRows(reporter.memberId);
			// No server target row; the conversation is not ours.
			expect(row?.target_id).toBeNull();
			const snapshot = (row?.evidence as { snapshot: Record<string, unknown> })
				.snapshot;
			expect(Object.keys(snapshot).sort()).toEqual([
				"model",
				"precedingUserMessage",
				"response",
			]);
		});

		test("**one field the contract doesn't know refuses the whole request**", async () => {
			const reporter = await signUp();
			/** The core of §78: even if a screen mistakenly adds room memory, seed or other messages, the server never stores them partially; the whole request is a 400. */
			const smuggled = await postReport(reporter.cookie, {
				target: {
					type: "ai_response",
					evidence: {
						...AI_EVIDENCE,
						roomMemory: ["The user likes cats"],
						roomId: "room-1",
						history: [{ role: "user", content: "Earlier conversation" }],
					},
				},
				reason: "other",
			});
			expect(smuggled.status).toBe(400);
			expect(await reportRows(reporter.memberId)).toHaveLength(0);
		});

		test("refuses evidence over the cap", async () => {
			const reporter = await signUp();
			const response = await postReport(reporter.cookie, {
				target: {
					type: "ai_response",
					evidence: {
						response: {
							content: "a".repeat(REPORT_LIMITS.aiEvidenceContent + 1),
							createdAt: "2026-08-20T00:00:00.000Z",
						},
					},
				},
				reason: "other",
			});
			expect(response.status).toBe(400);
		});

		test("each AI response report gets its own case", async () => {
			const reporter = await signUp();
			for (const content of ["Response one", "Response two"]) {
				const response = await postReport(reporter.cookie, {
					target: {
						type: "ai_response",
						evidence: {
							response: { content, createdAt: "2026-08-20T00:00:00.000Z" },
						},
					},
					reason: "other",
				});
				expect(response.status).toBe(201);
			}
			const rows = await reportRows(reporter.memberId);
			expect(rows).toHaveLength(2);
			/** With no target id there is no "same target", so they are not grouped. */
			expect(rows[0]?.case_id).not.toBe(rows[1]?.case_id);
		});
	},
);

describe.skipIf(!databaseReady)(
	"reports — duplicates and rapid repeats",
	() => {
		test("the same reporter can't open two on the same target", async () => {
			const reporter = await signUp();
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId);

			expect(
				(
					await postReport(reporter.cookie, {
						target: { type: "story", storyId },
						reason: "spam",
					})
				).status,
			).toBe(201);

			const again = await postReport(reporter.cookie, {
				target: { type: "story", storyId },
				reason: "harassment",
			});
			expect(again.status).toBe(409);
			expect(((await again.json()) as { code: string }).code).toBe(
				REPORT_ERROR_CODE.duplicate,
			);
		});

		test("duplicates from **different** reporters aren't blocked, and they group into one case", async () => {
			const owner = await signUp();
			const storyId = await seedStory(owner.memberId);
			const first = await signUp();
			const second = await signUp();

			for (const reporter of [first, second])
				expect(
					(
						await postReport(reporter.cookie, {
							target: { type: "story", storyId },
							reason: "spam",
						})
					).status,
				).toBe(201);

			/** Volume is itself a moderation signal; global dedup would erase it (§17). */
			const cases = await db
				.select()
				.from(moderation_case)
				.where(eq(moderation_case.target_id, storyId));
			expect(cases).toHaveLength(1);
			const reports = await db
				.select()
				.from(moderation_report)
				.where(eq(moderation_report.target_id, storyId));
			expect(reports).toHaveLength(2);
		});

		/** Walks the queue to the end by cursor; a one-page assertion silently fails for the wrong reason as other tests grow the shared database. */
		async function drainQueue(
			cookie: string,
		): Promise<{ targetId: string | null; caseReportCount: number }[]> {
			const rows: { targetId: string | null; caseReportCount: number }[] = [];
			let cursor = "";
			for (let page = 0; page < 50; page++) {
				const response = await app.request(
					`/v2/moderation/reports?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
					{ headers: { Origin: WEB_ORIGIN, Cookie: cookie } },
				);
				expect(response.status).toBe(200);
				const body = (await response.json()) as {
					items: { targetId: string | null; caseReportCount: number }[];
					nextCursor: string | null;
				};
				rows.push(...body.items);
				if (!body.nextCursor) return rows;
				cursor = body.nextCursor;
			}
			throw new Error("the queue never ends — the cursor is not advancing");
		}

		/**
		 * The per-case report count must belong to that case. It is a correlated subquery, so a name
		 * collision silently turns it into the global report count; types and other tests do not catch it
		 * and every case looks like it has hundreds of reports. That happened once.
		 */
		test("the queue's per-case report count is **that case's** count", async () => {
			const operator = await signUp();
			await db
				.update(member)
				.set({ role: "staff" })
				.where(eq(member.id, operator.memberId));

			const owner = await signUp();
			const shared = await seedStory(owner.memberId);
			const alone = await seedStory(owner.memberId);
			for (const reporter of [await signUp(), await signUp()])
				await postReport(reporter.cookie, {
					target: { type: "story", storyId: shared },
					reason: "spam",
				});
			const solo = await signUp();
			await postReport(solo.cookie, {
				target: { type: "story", storyId: alone },
				reason: "spam",
			});

			/**
			 * The queue is oldest-first and this test looks at just-created rows. Filtering one page would
			 * silently yield zero rows once earlier tests pile up more than 50 reports, and that failure
			 * would be unrelated to the defect guarded here, so walk by cursor to the end.
			 */
			const rows = await drainQueue(operator.cookie);
			const sharedRows = rows.filter((row) => row.targetId === shared);
			const aloneRows = rows.filter((row) => row.targetId === alone);
			expect(sharedRows).toHaveLength(2);
			expect(sharedRows.every((row) => row.caseReportCount === 2)).toBe(true);
			expect(aloneRows[0]?.caseReportCount).toBe(1);
		});

		test("one person can't create unlimited review work", async () => {
			const reporter = await signUp();
			const owner = await signUp();

			// Up to the cap (10) passes within the window (10 minutes).
			for (let i = 0; i < 10; i++) {
				const storyId = await seedStory(owner.memberId);
				const response = await postReport(reporter.cookie, {
					target: { type: "story", storyId },
					reason: "spam",
				});
				expect(response.status).toBe(201);
			}

			const storyId = await seedStory(owner.memberId);
			const blocked = await postReport(reporter.cookie, {
				target: { type: "story", storyId },
				reason: "spam",
			});
			expect(blocked.status).toBe(429);
			expect(((await blocked.json()) as { code: string }).code).toBe(
				REPORT_ERROR_CODE.rateLimited,
			);
			/** Says when to retry; without it the client hammers again immediately. */
			expect(blocked.headers.get("Retry-After")).toBeTruthy();
		});
	},
);

describe.skipIf(!databaseReady)("reports — what can't be expressed", () => {
	test("the reporter can't pick the punishment, and can't carry a reporter identity", async () => {
		const reporter = await signUp();
		const victim = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);

		const response = await postReport(reporter.cookie, {
			target: { type: "story", storyId },
			reason: "spam",
			// Values with no slot in the contract; silently ignored and not stored.
			action: "ban",
			hide: true,
			reporterId: victim.memberId,
			status: "resolved",
		});
		expect(response.status).toBe(201);

		const [row] = await reportRows(reporter.memberId);
		/** The reporter comes only from the session; this breaks if the body value won. */
		expect(row?.reporter).toBe(reporter.memberId);
		// A filed report is always open; a report is not enforcement (§12).
		expect(row?.status).toBe("open");
		expect(JSON.stringify(row)).not.toContain("ban");
	});

	test("a free-string target is not accepted", async () => {
		const reporter = await signUp();
		const response = await postReport(reporter.cookie, {
			target: { type: "anything", targetId: "anything" },
			reason: "spam",
		});
		expect(response.status).toBe(400);
	});

	test("the receipt has neither a case id nor a report count", async () => {
		const reporter = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);

		const response = await postReport(reporter.cookie, {
			target: { type: "story", storyId },
			reason: "spam",
		});
		const body = (await response.json()) as Record<string, unknown>;
		/** Count keys (§49); a "reported many times already" signal could coordinate targeted reporting. */
		expect(Object.keys(body).sort()).toEqual(["createdAt", "reportId"]);
	});

	test("a deleted member's report loses only its identity while the target lives", async () => {
		const reporter = await signUp();
		const owner = await signUp();
		const storyId = await seedStory(owner.memberId);
		await postReport(reporter.cookie, {
			target: { type: "story", storyId },
			reason: "spam",
		});

		await app.request("/v2/auth/delete-user", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: reporter.cookie,
			},
			body: JSON.stringify({ password: TEST_PASSWORD }),
		});

		const [row] = await db
			.select()
			.from(moderation_report)
			.where(eq(moderation_report.target_id, storyId));
		expect(row).toBeDefined();
		/** Review of someone else's content stays; only the reporter identity is erased (§70). */
		expect(row?.reporter).toBeNull();
		expect(
			await db.select().from(member).where(eq(member.id, reporter.memberId)),
		).toHaveLength(0);
	});
});
