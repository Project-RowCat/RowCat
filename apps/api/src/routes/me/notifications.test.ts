import { eq, inArray, isNull } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	member,
	moderation_case,
	notification,
	story,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";

import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * In-app notifications, run through the real Hono app and Postgres. Calling service functions
 * directly would leave the fragile parts outside the test: ownership coming only from the session,
 * someone else's notification giving the same response as a missing one, sanctioned accounts
 * reaching their own inbox, and which writes actually create a row.
 *
 * 1. Alice's notifications are invisible to Bob, and Bob cannot mark them read.
 * 2. Comment bodies, operator identity and internal reasons appear nowhere in responses.
 * 3. Own comments and duplicate follows create no row.
 * 4. Blocking prevents future rows and sweeps those already delivered.
 * 5. Accepting an appeal does not produce two rows.
 * 6. Suspended and banned members can read their inbox and mark read.
 */

const EMAIL_PREFIX = "notification-test-";

interface Account {
	cookie: string;
	memberId: string;
}

/**
 * Cases this file created; the only basis for cleanup. Tracing back through the reporter (the
 * moderation tests' approach) is weak here: this file deletes members, which sets `reporter` to
 * null, and those reports would sit in the global queue forever. The queue is oldest-first, so a
 * later test file would fail to find its own just-created report on the first page, a failure whose
 * cause lies elsewhere. Deleting a case cascades to its reports and actions.
 */
const CREATED_CASES: string[] = [];

const signUp = (name = "Notification test") =>
	createTestMember(EMAIL_PREFIX, { name });

/** Operators have no promotion path in the product API, so create one the way the seed script does. */
async function signUpOperator(): Promise<Account> {
	const account = await signUp("Operator");
	await db
		.update(member)
		.set({ role: "staff" })
		.where(eq(member.id, account.memberId));
	return account;
}

async function seedStory(ownerId: string | null): Promise<string> {
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

const json = (cookie: string | null, body?: unknown) => ({
	headers: {
		"Content-Type": "application/json",
		Origin: WEB_ORIGIN,
		...(cookie ? { Cookie: cookie } : {}),
	},
	...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const get = (path: string, cookie: string | null) =>
	app.request(path, {
		headers: { Origin: WEB_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
	});

const post = (path: string, cookie: string | null, body: unknown) =>
	app.request(path, { method: "POST", ...json(cookie, body) });

const put = (path: string, cookie: string | null, body?: unknown) =>
	app.request(path, { method: "PUT", ...json(cookie, body) });

interface Row {
	id: string;
	kind: string;
	createdAt: string;
	readAt: string | null;
	actor?: { id: string; displayName: string; avatarUrl: string | null } | null;
	story?: { id: string; title: string } | null;
	commentId?: string | null;
	action?: { id: string; kind: string; publicReason: string } | null;
	appeal?: { id: string; actionId: string; status: string } | null;
}

const inbox = async (
	account: Account,
	query = "",
): Promise<{ items: Row[]; nextCursor: string | null }> =>
	(await (
		await get(`/v2/me/notifications${query}`, account.cookie)
	).json()) as { items: Row[]; nextCursor: string | null };

const unreadCount = async (account: Account): Promise<number> =>
	(
		(await (
			await get("/v2/me/notifications/unread-count", account.cookie)
		).json()) as { unread: number }
	).unread;

const kindsOf = async (account: Account): Promise<string[]> =>
	(await inbox(account)).items.map((row) => row.kind);

const comment = (author: Account, storyId: string, body = "Enjoyed it") =>
	post(`/v2/stories/${storyId}/comments`, author.cookie, { body });

const setFollow = (follower: Account, creator: string, following: boolean) =>
	put("/v2/follows", follower.cookie, { creator, following });

const setBlock = (blocker: Account, creator: string, blocked: boolean) =>
	put("/v2/blocks", blocker.cookie, { creator, blocked });

/**
 * File one report and return its case id; enforcement comes only from the case. A fresh reporter is
 * created each time because filing is rate-limited per member (10 in 10 minutes); one file-lifetime
 * account would start getting 429s in later tests, showing up as "no notification arrives" with no
 * relation to notifications.
 */
async function caseFor(
	target: Record<string, unknown>,
	reason = "spam",
): Promise<string> {
	const reporter = await signUp("Reporter");
	const response = await post("/v2/reports", reporter.cookie, {
		target,
		reason,
	});
	const { reportId } = (await response.json()) as { reportId: string };
	const detail = await get(
		`/v2/moderation/reports/${reportId}`,
		OPERATOR.cookie,
	);
	const { caseId } = (await detail.json()) as { caseId: string };
	CREATED_CASES.push(caseId);
	return caseId;
}

const act = (body: Record<string, unknown>) =>
	post("/v2/moderation/actions", OPERATOR.cookie, body);

const databaseReady = await connectTestDatabase();

/** Only the operator lives for the whole file: needed for queue reads and enforcement, which have no rate limit. */
const OPERATOR: Account = databaseReady
	? await signUpOperator()
	: { cookie: "", memberId: "" };

afterAll(async () => {
	if (databaseReady) {
		/** Cases first; after members are deleted there is no way to trace reports back. */
		if (CREATED_CASES.length)
			await db
				.delete(moderation_case)
				.where(inArray(moderation_case.id, CREATED_CASES));
		await db.delete(story).where(isNull(story.owner));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("comment notifications", () => {
	test("commenting on someone else's story gives the creator one row", async () => {
		const alice = await signUp();
		const bob = await signUp("Cat");
		const storyId = await seedStory(alice.memberId);

		expect((await comment(bob, storyId)).status).toBe(201);

		const { items } = await inbox(alice);
		expect(items).toHaveLength(1);
		expect(items[0]?.kind).toBe("story_comment");
		expect(items[0]?.actor?.id).toBe(bob.memberId);
		expect(items[0]?.story?.id).toBe(storyId);
		expect(items[0]?.readAt).toBeNull();
		// Bob gets nothing for his own action; the recipient is the other party.
		expect(await kindsOf(bob)).toEqual([]);
	});

	/**
	 * The body appears nowhere in the response. The whole key set is counted to confirm the contract
	 * adds fields rather than removing them; one extra field breaks this assertion first.
	 */
	test("the comment body is not in the notification payload", async () => {
		const alice = await signUp();
		const bob = await signUp("Cat");
		const storyId = await seedStory(alice.memberId);
		await comment(
			bob,
			storyId,
			"this sentence must never appear in a notification",
		);

		const { items } = await inbox(alice);
		const row = items[0];
		expect(row).toBeDefined();
		expect(JSON.stringify(row)).not.toContain(
			"must never appear in a notification",
		);
		expect(new Set(Object.keys(row ?? {}))).toEqual(
			new Set([
				"id",
				"kind",
				"createdAt",
				"readAt",
				"actor",
				"story",
				"commentId",
			]),
		);
	});

	test("commenting on your own story creates no notification", async () => {
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);

		expect((await comment(alice, storyId)).status).toBe(201);
		expect(await kindsOf(alice)).toEqual([]);
	});

	/** A work whose owner identity was erased by account deletion has nobody to notify; the comment still succeeds. */
	test("commenting on an ownerless public story succeeds with no notification", async () => {
		const bob = await signUp();
		const storyId = await seedStory(null);

		expect((await comment(bob, storyId)).status).toBe(201);
		const [row] = await db
			.select({ id: notification.id })
			.from(notification)
			.where(eq(notification.story_id, storyId));
		expect(row).toBeUndefined();
	});

	/**
	 * Observable side of comment and notification sharing one transaction. There is no place to inject
	 * a failure outside the route, so check the converse: whenever the comment succeeded, the
	 * notification row is already committed. Were they split, a window of "comment exists,
	 * notification later" would exist.
	 */
	test("by the time the comment response returns 200, the notification is already committed", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);

		const response = await comment(bob, storyId);
		const { comment: created } = (await response.json()) as {
			comment: { id: string };
		};
		const [row] = await db
			.select({ sourceKey: notification.source_key })
			.from(notification)
			.where(eq(notification.recipient, alice.memberId));
		expect(row?.sourceKey).toBe(`comment:${created.id}`);
	});
});

describe.skipIf(!databaseReady)("follow notifications", () => {
	test("a new follow is one row, and repeating the same request keeps it one row", async () => {
		const alice = await signUp();
		const bob = await signUp("Cat");

		await setFollow(bob, alice.memberId, true);
		await setFollow(bob, alice.memberId, true);
		await setFollow(bob, alice.memberId, true);

		const { items } = await inbox(alice);
		expect(items).toHaveLength(1);
		expect(items[0]?.kind).toBe("follow");
		expect(items[0]?.actor?.id).toBe(bob.memberId);
	});

	test("unfollowing creates no notification and doesn't delete the existing row", async () => {
		const alice = await signUp();
		const bob = await signUp();

		await setFollow(bob, alice.memberId, true);
		await setFollow(bob, alice.memberId, false);

		// A notification records a past event, not the current relation state.
		expect(await kindsOf(alice)).toEqual(["follow"]);
	});

	/** Following again is a genuinely new event but adds no row: the key is per actor, so the row revives, unread and back at the top of the list. */
	test("following again revives the same row as unread", async () => {
		const alice = await signUp();
		const bob = await signUp();

		await setFollow(bob, alice.memberId, true);
		const first = (await inbox(alice)).items[0];
		expect(first).toBeDefined();
		await put(`/v2/me/notifications/${first?.id}/read`, alice.cookie);
		expect(await unreadCount(alice)).toBe(0);

		await setFollow(bob, alice.memberId, false);
		await setFollow(bob, alice.memberId, true);

		const { items } = await inbox(alice);
		expect(items).toHaveLength(1);
		expect(items[0]?.id).toBe(first?.id);
		expect(items[0]?.readAt).toBeNull();
		expect(await unreadCount(alice)).toBe(1);
	});
});

describe.skipIf(!databaseReady)("blocks and notifications", () => {
	test("follows and comments from someone you blocked don't become notifications", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);

		await setBlock(alice, bob.memberId, true);

		/** Bob can still perform these actions; blocking does not stop his viewing. Only the event's entry into Alice's inbox is prevented. */
		expect((await comment(bob, storyId)).status).toBe(201);
		await setFollow(bob, alice.memberId, true);

		expect(await kindsOf(alice)).toEqual([]);
		expect(await unreadCount(alice)).toBe(0);
	});

	test("blocking sweeps away the social notifications that person already created", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();
		const storyId = await seedStory(alice.memberId);

		await comment(bob, storyId);
		await setFollow(bob, alice.memberId, true);
		await setFollow(carol, alice.memberId, true);
		expect(await kindsOf(alice)).toHaveLength(3);

		await setBlock(alice, bob.memberId, true);

		const { items } = await inbox(alice);
		expect(items).toHaveLength(1);
		expect(items[0]?.actor?.id).toBe(carol.memberId);
	});

	/** Same rule as follow revival: we do not hold on to what the user cleared. */
	test("unblocking doesn't revive the swept notifications", async () => {
		const alice = await signUp();
		const bob = await signUp();

		await setFollow(bob, alice.memberId, true);
		await setBlock(alice, bob.memberId, true);
		await setBlock(alice, bob.memberId, false);

		expect(await kindsOf(alice)).toEqual([]);
	});

	/** Blocking must not touch moderation notifications; otherwise blocking someone would be a way to hide one's own sanction notice. */
	test("blocking doesn't touch moderation notifications", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);

		/**
		 * The moderation notification comes from hiding a work, not suspending the account: a suspended
		 * account cannot call `/v2/blocks` (`requireActiveViewer`), so the operation under test would
		 * never happen. Blocking staying open under restriction and suspension blocking writes are
		 * different axes.
		 */
		const caseId = await caseFor({ type: "story", storyId });
		await act({
			caseId,
			kind: "hide_story",
			reason: "internal note",
			publicReason: "guideline violation",
		});
		await setFollow(bob, alice.memberId, true);
		expect(await kindsOf(alice)).toHaveLength(2);

		await setBlock(alice, bob.memberId, true);

		expect(await kindsOf(alice)).toEqual(["moderation_action"]);
	});
});

describe.skipIf(!databaseReady)("moderation notifications", () => {
	test("suspension, ban and capability restriction notify the target", async () => {
		for (const kind of [
			"suspend_member",
			"ban_member",
			"restrict_capability",
		] as const) {
			const target = await signUp();
			const caseId = await caseFor({
				type: "member",
				memberId: target.memberId,
			});
			const response = await act({
				caseId,
				kind,
				reason: "internal note",
				publicReason: "public reason",
				...(kind === "restrict_capability"
					? { capability: "comment.write" }
					: {}),
			});
			expect(response.status).toBe(201);

			const { items } = await inbox(target);
			expect(items.map((row) => row.kind)).toEqual(["moderation_action"]);
			expect(items[0]?.action?.kind).toBe(kind);
			expect(items[0]?.action?.publicReason).toBe("public reason");
		}
	});

	test("hiding a story notifies the creator", async () => {
		const alice = await signUp();
		const storyId = await seedStory(alice.memberId);
		const caseId = await caseFor({ type: "story", storyId });

		await act({
			caseId,
			kind: "hide_story",
			reason: "internal note",
			publicReason: "guideline violation",
		});

		const { items } = await inbox(alice);
		expect(items.map((row) => row.kind)).toEqual(["moderation_action"]);
		expect(items[0]?.action?.kind).toBe("hide_story");
	});

	test("deleting a comment notifies its author without carrying the body", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		const created = (await (
			await comment(bob, storyId, "a sentence to be deleted")
		).json()) as {
			comment: { id: string };
		};
		const caseId = await caseFor(
			{ type: "comment", storyId, commentId: created.comment.id },
			"harassment",
		);

		await act({
			caseId,
			kind: "remove_comment",
			reason: "internal note",
			publicReason: "guideline violation",
		});

		const { items } = await inbox(bob);
		expect(items.map((row) => row.kind)).toEqual(["moderation_action"]);
		expect(JSON.stringify(items)).not.toContain("a sentence to be deleted");
	});

	/** Operator identity appears nowhere in the response. The row's `actor` is for social events only and is always NULL on moderation notifications. */
	test("the operator's identity and the internal reason are not in the notification", async () => {
		const target = await signUp();
		const caseId = await caseFor({ type: "member", memberId: target.memberId });
		await act({
			caseId,
			kind: "suspend_member",
			reason: "this note must not go out to the target",
			publicReason: "rule violation",
		});

		const { items } = await inbox(target);
		const payload = JSON.stringify(items);
		expect(payload).not.toContain(OPERATOR.memberId);
		expect(payload).not.toContain("this note");
		expect(payload).not.toContain("staff");
		expect(new Set(Object.keys(items[0] ?? {}))).toEqual(
			new Set(["id", "kind", "createdAt", "readAt", "action"]),
		);
		// The row has no actor either: it is not stored, rather than removed from the response.
		const [row] = await db
			.select({ actor: notification.actor })
			.from(notification)
			.where(eq(notification.recipient, target.memberId));
		expect(row?.actor).toBeNull();
	});

	test("an operator reversing it directly sends a lifted notification", async () => {
		const target = await signUp();
		const caseId = await caseFor({ type: "member", memberId: target.memberId });
		await act({
			caseId,
			kind: "suspend_member",
			reason: "internal note",
			publicReason: "rule violation",
		});
		await act({
			caseId,
			kind: "restore_member",
			reason: "misjudgment",
			publicReason: "The sanction was lifted",
		});

		const kinds = await kindsOf(target);
		// Newest first, so the reversal comes first.
		expect(kinds).toEqual(["moderation_reversed", "moderation_action"]);
	});
});

describe.skipIf(!databaseReady)("appeal result notifications", () => {
	/** Put the member in an appealable state and return the appeal id. */
	async function appealFor(
		target: Account,
	): Promise<{ appealId: string; caseId: string }> {
		const caseId = await caseFor({ type: "member", memberId: target.memberId });
		const action = (await (
			await act({
				caseId,
				kind: "suspend_member",
				reason: "internal note",
				publicReason: "rule violation",
			})
		).json()) as { id: string };
		const appeal = (await (
			await post("/v2/me/moderation/appeals", target.cookie, {
				actionId: action.id,
				message: "This is unfair",
			})
		).json()) as { id: string };
		return { appealId: appeal.id, caseId };
	}

	/**
	 * Subtlest rule here: acceptance reverses the action internally, and announcing that reversal too
	 * would make one event two rows, which the user reads as two events.
	 */
	test("acceptance is a single appeal-result row — no separate lifted notification goes out", async () => {
		const target = await signUp();
		const { appealId } = await appealFor(target);

		await post(`/v2/moderation/appeals/${appealId}/resolve`, OPERATOR.cookie, {
			status: "accepted",
			note: "Confirmed",
		});

		const { items } = await inbox(target);
		expect(items.map((row) => row.kind)).toEqual([
			"appeal_resolved",
			"moderation_action",
		]);
		expect(items[0]?.appeal?.status).toBe("accepted");
		// The resolution note has no slot in the member response.
		expect(JSON.stringify(items)).not.toContain("Confirmed");
	});

	test("a rejection sends one row too", async () => {
		const target = await signUp();
		const { appealId } = await appealFor(target);

		await post(`/v2/moderation/appeals/${appealId}/resolve`, OPERATOR.cookie, {
			status: "rejected",
			note: "dismissed",
		});

		const { items } = await inbox(target);
		expect(items[0]?.kind).toBe("appeal_resolved");
		expect(items[0]?.appeal?.status).toBe("rejected");
	});
});

describe.skipIf(!databaseReady)("ownership", () => {
	test("a guest gets 401", async () => {
		expect((await get("/v2/me/notifications", null)).status).toBe(401);
		expect((await get("/v2/me/notifications/unread-count", null)).status).toBe(
			401,
		);
	});

	/** Someone else's and a nonexistent notification get the same 404; distinguishing them would be an existence probe and would allow changing another inbox. */
	test("can't mark someone else's notification read, and it is the same 404 as an unknown id", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(bob, alice.memberId, true);
		const mine = (await inbox(alice)).items[0];
		expect(mine).toBeDefined();

		const foreign = await put(
			`/v2/me/notifications/${mine?.id}/read`,
			bob.cookie,
		);
		const unknown = await put(
			`/v2/me/notifications/${newId()}/read`,
			bob.cookie,
		);
		expect(foreign.status).toBe(404);
		expect(unknown.status).toBe(404);
		/** `requestId` differs per request and is excluded; what must not diverge is what the screen branches on, the code and the wording. */
		const shape = async (response: Response) => {
			const { requestId: _ignored, ...rest } = (await response.json()) as {
				requestId?: string;
			};
			return rest;
		};
		expect(await shape(foreign)).toEqual(await shape(unknown));

		// And nothing actually changed.
		expect((await inbox(alice)).items[0]?.readAt).toBeNull();
	});

	test("Alice's notifications are not in Bob's list", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(bob, alice.memberId, true);

		expect(await kindsOf(bob)).toEqual([]);
		expect(await unreadCount(bob)).toBe(0);
	});

	/** Sanctioned members are who most needs this screen; with `requireActiveViewer` a suspended account could not read why it was suspended. */
	test("suspended and banned members can read and mark as read too", async () => {
		for (const kind of ["suspend_member", "ban_member"] as const) {
			const target = await signUp();
			const caseId = await caseFor({
				type: "member",
				memberId: target.memberId,
			});
			await act({
				caseId,
				kind,
				reason: "internal note",
				publicReason: "rule violation",
			});

			const listed = await get("/v2/me/notifications", target.cookie);
			expect(listed.status).toBe(200);
			const { items } = (await listed.json()) as { items: Row[] };
			expect(items).toHaveLength(1);

			const read = await put(
				`/v2/me/notifications/${items[0]?.id}/read`,
				target.cookie,
			);
			expect(read.status).toBe(200);
			expect(await unreadCount(target)).toBe(0);

			/** Control: the write path is still blocked, so the sanction has not been neutralized. */
			const storyId = await seedStory(OPERATOR.memberId);
			expect((await comment(target, storyId)).status).toBe(403);
		}
	});
});

describe.skipIf(!databaseReady)("read state", () => {
	test("a new notification is unread, and reading one lowers the count", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();
		await setFollow(bob, alice.memberId, true);
		await setFollow(carol, alice.memberId, true);
		expect(await unreadCount(alice)).toBe(2);

		const first = (await inbox(alice)).items[0];
		const response = await put(
			`/v2/me/notifications/${first?.id}/read`,
			alice.cookie,
		);
		expect(response.status).toBe(200);
		expect(await unreadCount(alice)).toBe(1);
	});

	/** Idempotent: the second call also succeeds and the time does not move forward. */
	test("reading the same notification again doesn't change the time", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(bob, alice.memberId, true);
		const target = (await inbox(alice)).items[0];

		const first = (await (
			await put(`/v2/me/notifications/${target?.id}/read`, alice.cookie)
		).json()) as { readAt: string };
		const second = (await (
			await put(`/v2/me/notifications/${target?.id}/read`, alice.cookie)
		).json()) as { readAt: string };

		expect(second.readAt).toBe(first.readAt);
		expect(await unreadCount(alice)).toBe(0);
	});

	test("mark-all-read is idempotent and the second gives 0", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();
		await setFollow(bob, alice.memberId, true);
		await setFollow(carol, alice.memberId, true);

		const first = (await (
			await put("/v2/me/notifications/read-all", alice.cookie)
		).json()) as { updated: number };
		const second = (await (
			await put("/v2/me/notifications/read-all", alice.cookie)
		).json()) as { updated: number };

		expect(first.updated).toBe(2);
		expect(second.updated).toBe(0);
		expect(await unreadCount(alice)).toBe(0);
	});

	/** A notification arriving after mark-all-read stays unread, because the server changes rows only within its own UPDATE's boundary; a client-sent time would tie this to that clock. */
	test("a notification that arrives after mark-all-read is unread", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();
		await setFollow(bob, alice.memberId, true);
		await put("/v2/me/notifications/read-all", alice.cookie);

		await setFollow(carol, alice.memberId, true);

		expect(await unreadCount(alice)).toBe(1);
	});
});

describe.skipIf(!databaseReady)("pagination", () => {
	/** Deliberately creates rows in the same millisecond; sorting by time alone duplicates and drops rows at that boundary, which shows only when the second page is actually fetched. */
	async function seedInbox(alice: Account, count: number): Promise<string[]> {
		const at = new Date("2026-08-20T00:00:00.000Z");
		const ids = Array.from({ length: count }, () => newId());
		await db.insert(notification).values(
			ids.map((id) => ({
				id,
				recipient: alice.memberId,
				kind: "follow",
				source_key: `follow:${id}`,
				created_at: at,
			})),
		);
		// Same axis as the server ordering: equal times fall back to id descending.
		return [...ids].sort().reverse();
	}

	test("newest first, with equal times split by id", async () => {
		const alice = await signUp();
		const expected = await seedInbox(alice, 5);

		const { items } = await inbox(alice, "?limit=5");
		expect(items.map((row) => row.id)).toEqual(expected);
	});

	test("joining by cursor neither duplicates nor drops", async () => {
		const alice = await signUp();
		const expected = await seedInbox(alice, 7);

		const first = await inbox(alice, "?limit=3");
		expect(first.items).toHaveLength(3);
		expect(first.nextCursor).not.toBeNull();

		const second = await inbox(
			alice,
			`?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
		);
		const third = await inbox(
			alice,
			`?limit=3&cursor=${encodeURIComponent(second.nextCursor ?? "")}`,
		);

		expect(third.nextCursor).toBeNull();
		const seen = [...first.items, ...second.items, ...third.items].map(
			(row) => row.id,
		);
		expect(seen).toEqual(expected);
		expect(new Set(seen).size).toBe(expected.length);
	});

	/** New notifications arriving between pages leave the seen span intact because the cursor points at "after this row"; an offset would show the boundary row twice. */
	test("a new notification between pages doesn't throw the next page off", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const expected = await seedInbox(alice, 4);

		const first = await inbox(alice, "?limit=2");
		await setFollow(bob, alice.memberId, true);
		const second = await inbox(
			alice,
			`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
		);

		expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
			expected,
		);
	});

	test("refuses a limit over the cap", async () => {
		const alice = await signUp();
		expect(
			(await get("/v2/me/notifications?limit=500", alice.cookie)).status,
		).toBe(400);
	});

	test("a broken cursor doesn't quietly fall back to the first page", async () => {
		const alice = await signUp();
		expect(
			(await get("/v2/me/notifications?cursor=not-a-cursor", alice.cookie))
				.status,
		).toBe(400);
	});
});

describe.skipIf(!databaseReady)("vanished targets", () => {
	/** The row survives when its destination disappears; the whole page does not fail. */
	test("when the story is deleted, story becomes null and the row stays", async () => {
		const alice = await signUp();
		const bob = await signUp();
		const storyId = await seedStory(alice.memberId);
		await comment(bob, storyId);

		await db.delete(story).where(eq(story.id, storyId));

		const { items } = await inbox(alice);
		expect(items).toHaveLength(1);
		expect(items[0]?.story).toBeNull();
		// The comment vanished with the story, so there is no anchor either.
		expect(items[0]?.commentId).toBeNull();
	});

	test("when the actor deletes their account, actor becomes null and the row stays", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(bob, alice.memberId, true);

		await db.delete(member).where(eq(member.id, bob.memberId));

		const { items } = await inbox(alice);
		expect(items).toHaveLength(1);
		expect(items[0]?.actor).toBeNull();
	});

	/** Deletion removes the received inbox whole. Rows left in others' inboxes where this person was the actor are covered by the test above (only identity detaches). */
	test("when the member goes, the notifications they received go too", async () => {
		const alice = await signUp();
		const bob = await signUp();
		await setFollow(bob, alice.memberId, true);

		await db.delete(member).where(eq(member.id, alice.memberId));

		const rows = await db
			.select({ id: notification.id })
			.from(notification)
			.where(eq(notification.recipient, alice.memberId));
		expect(rows).toEqual([]);
	});
});
