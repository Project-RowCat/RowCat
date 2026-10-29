import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import {
	notification,
	ops_app_version_floor,
	push_delivery,
	push_registration,
	session,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { broadcastAppUpdate } from "../admin/app-update-notice.ts";
import {
	createNotification,
	notificationSourceKey,
	notifySocialEvent,
} from "../notifications.ts";
import { setAppVersionFloor } from "../ops.ts";
import { setBlock, setFollow } from "../social.ts";

/**
 * Exercises the notification-to-push-delivery boundary on real Postgres. Checks what happens
 * together: deliveries attach only to events that actually happened (a retry is not one, a revival
 * is), both writes share one transaction (rollback removes both), and creating deliveries makes no
 * outbound request. The service is called directly because the fragile part is how the executor
 * flows, not HTTP.
 */

const EMAIL_PREFIX = "push-enqueue-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	/**
	 * The broadcast tests raise both floors (9.9.9 · 9.9.8). A floor is a deployment-wide singleton, not
	 * a row this suite's prefix owns, so it is put back here; left in place, the next suite on this
	 * database meets a deployment that refuses every app below 9.9.9.
	 */
	if (databaseReady) await db.delete(ops_app_version_floor);
	await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

interface Account {
	memberId: string;
	authUserId: string;
}

async function signUp(): Promise<Account> {
	const account = await createTestMember(EMAIL_PREFIX);
	return { memberId: account.memberId, authUserId: account.authUserId };
}

/** One live session of this account; the place a registration hangs from. */
async function liveSessionId(account: Account): Promise<string> {
	const [row] = await db
		.select({ id: session.id })
		.from(session)
		.where(eq(session.userId, account.authUserId))
		.limit(1);
	if (!row) throw new Error("there is no session");
	return row.id;
}

async function registerDevice(
	account: Account,
	options: { disabled?: boolean; expired?: boolean } = {},
): Promise<string> {
	const id = newId();
	let sessionId = await liveSessionId(account);

	if (options.expired) {
		/** An expired session is ineligible even though its row remains. */
		sessionId = newId();
		await db.insert(session).values({
			id: sessionId,
			token: newId(),
			userId: account.authUserId,
			expiresAt: new Date(Date.now() - 60_000),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	await db.insert(push_registration).values({
		id,
		member_id: account.memberId,
		session_id: sessionId,
		installation_id: newId(),
		platform: "ios",
		provider: "expo",
		token: `ExponentPushToken[${id}]`,
		disabled_at: options.disabled ? new Date() : null,
	});
	return id;
}

const deliveriesFor = async (recipientId: string) =>
	db
		.select({
			id: push_delivery.id,
			notificationId: push_delivery.notification_id,
			registrationId: push_delivery.registration_id,
			state: push_delivery.state,
		})
		.from(push_delivery)
		.innerJoin(notification, eq(notification.id, push_delivery.notification_id))
		.where(eq(notification.recipient, recipientId));

const notificationsFor = async (recipientId: string) =>
	db
		.select({ id: notification.id, kind: notification.kind })
		.from(notification)
		.where(eq(notification.recipient, recipientId));

/**
 * Watches outbound requests. Creating deliveries must be a single INSERT; a `fetch` here would tie
 * notification correctness to an external service's availability.
 */
let fetchSpy: { mock: { calls: unknown[] } };
beforeEach(() => {
	fetchSpy = vi.spyOn(globalThis, "fetch") as unknown as {
		mock: { calls: unknown[] };
	};
});

const expectNoNetwork = () => expect(fetchSpy.mock.calls).toEqual([]);

describe.skipIf(!databaseReady)(
	"deliveries attach only to events that actually happened",
	() => {
		test("one new notification creates a delivery for each entitled registration", async () => {
			const recipient = await signUp();
			const first = await registerDevice(recipient);
			const second = await registerDevice(recipient);

			await db.transaction((tx) =>
				createNotification(tx, {
					recipientId: recipient.memberId,
					kind: "report_reviewed",
					sourceKey: notificationSourceKey.reportReviewed(newId()),
				}),
			);

			const deliveries = await deliveriesFor(recipient.memberId);
			expect(deliveries.map((d) => d.registrationId).sort()).toEqual(
				[first, second].sort(),
			);
			expect(deliveries.every((d) => d.state === "pending")).toBe(true);
			expectNoNetwork();
		});

		/**
		 * Retry is the normal path (only the response was lost); no user-visible event happened, so there
		 * is nothing to deliver.
		 */
		test("an idempotent retry creates no delivery", async () => {
			const recipient = await signUp();
			await registerDevice(recipient);
			const sourceKey = notificationSourceKey.reportReviewed(newId());

			for (let i = 0; i < 3; i += 1)
				await db.transaction((tx) =>
					createNotification(tx, {
						recipientId: recipient.memberId,
						kind: "report_reviewed",
						sourceKey,
					}),
				);

			expect(await notificationsFor(recipient.memberId)).toHaveLength(1);
			expect(await deliveriesFor(recipient.memberId)).toHaveLength(1);
		});

		/**
		 * Revival is a new event (unfollow then follow again). It reuses the notification row id, so
		 * without clearing earlier deliveries the unique constraint silently swallows the second one.
		 */
		test("following again creates a new delivery", async () => {
			const actor = await signUp();
			const recipient = await signUp();
			await registerDevice(recipient);

			await setFollow(actor.memberId, recipient.memberId, true);
			const first = await deliveriesFor(recipient.memberId);
			expect(first).toHaveLength(1);

			/** Create it already settled; revival must turn it into a new event. */
			await db
				.update(push_delivery)
				.set({ state: "delivered", settled_at: new Date() })
				.where(eq(push_delivery.id, first[0]?.id ?? ""));

			await setFollow(actor.memberId, recipient.memberId, false);
			await setFollow(actor.memberId, recipient.memberId, true);

			const again = await deliveriesFor(recipient.memberId);
			expect(again).toHaveLength(1);
			expect(again[0]?.state).toBe("pending");
			expect(again[0]?.id).not.toBe(first[0]?.id);
		});

		test("no notification or delivery to yourself", async () => {
			const account = await signUp();
			await registerDevice(account);
			await db.transaction((tx) =>
				notifySocialEvent(tx, {
					recipientId: account.memberId,
					actorId: account.memberId,
					kind: "follow",
					sourceKey: notificationSourceKey.follow(account.memberId),
				}),
			);
			expect(await notificationsFor(account.memberId)).toHaveLength(0);
			expect(await deliveriesFor(account.memberId)).toHaveLength(0);
		});

		test("no notification or delivery for events from someone you blocked", async () => {
			const actor = await signUp();
			const recipient = await signUp();
			await registerDevice(recipient);
			await setBlock(recipient.memberId, actor.memberId, true);

			await db.transaction((tx) =>
				notifySocialEvent(tx, {
					recipientId: recipient.memberId,
					actorId: actor.memberId,
					kind: "follow",
					sourceKey: notificationSourceKey.follow(actor.memberId),
				}),
			);
			expect(await notificationsFor(recipient.memberId)).toHaveLength(0);
			expect(await deliveriesFor(recipient.memberId)).toHaveLength(0);
		});

		test("moderation notifications create deliveries too", async () => {
			const recipient = await signUp();
			await registerDevice(recipient);
			await db.transaction((tx) =>
				createNotification(tx, {
					recipientId: recipient.memberId,
					kind: "moderation_action",
					sourceKey: notificationSourceKey.actionApplied(newId()),
				}),
			);
			expect(await deliveriesFor(recipient.memberId)).toHaveLength(1);
		});
	},
);

describe.skipIf(!databaseReady)(
	"not created for ineligible registrations",
	() => {
		test("a turned-off registration is not a candidate", async () => {
			const recipient = await signUp();
			await registerDevice(recipient, { disabled: true });
			await db.transaction((tx) =>
				createNotification(tx, {
					recipientId: recipient.memberId,
					kind: "report_reviewed",
					sourceKey: notificationSourceKey.reportReviewed(newId()),
				}),
			);
			expect(await deliveriesFor(recipient.memberId)).toHaveLength(0);
		});

		/** The session row outlives expiry until cleanup; the predicate decides eligibility. */
		test("the registration of an expired session is not a candidate", async () => {
			const recipient = await signUp();
			await registerDevice(recipient, { expired: true });
			await db.transaction((tx) =>
				createNotification(tx, {
					recipientId: recipient.memberId,
					kind: "report_reviewed",
					sourceKey: notificationSourceKey.reportReviewed(newId()),
				}),
			);
			expect(await deliveriesFor(recipient.memberId)).toHaveLength(0);
		});

		/** Most members have no registration; the notification is still created normally. */
		test("the notification succeeds even with no registrations at all", async () => {
			const recipient = await signUp();
			await db.transaction((tx) =>
				createNotification(tx, {
					recipientId: recipient.memberId,
					kind: "report_reviewed",
					sourceKey: notificationSourceKey.reportReviewed(newId()),
				}),
			);
			expect(await notificationsFor(recipient.memberId)).toHaveLength(1);
			expect(await deliveriesFor(recipient.memberId)).toHaveLength(0);
		});
	},
);

describe.skipIf(!databaseReady)("transaction boundary", () => {
	/**
	 * Rollback removes both. Not representable: only the notification or only the delivery remaining,
	 * which is why both go through the same executor.
	 */
	test("when the original transaction rolls back, neither notification nor delivery remains", async () => {
		const recipient = await signUp();
		await registerDevice(recipient);

		await expect(
			db.transaction(async (tx) => {
				await createNotification(tx, {
					recipientId: recipient.memberId,
					kind: "report_reviewed",
					sourceKey: notificationSourceKey.reportReviewed(newId()),
				});
				throw new Error("the product event failed");
			}),
		).rejects.toThrow("the product event failed");

		expect(await notificationsFor(recipient.memberId)).toHaveLength(0);
		expect(await deliveriesFor(recipient.memberId)).toHaveLength(0);
	});

	test("creating deliveries doesn't touch the network", async () => {
		const recipient = await signUp();
		await registerDevice(recipient);
		await db.transaction((tx) =>
			createNotification(tx, {
				recipientId: recipient.memberId,
				kind: "app_update",
				sourceKey: notificationSourceKey.appUpdate("ios", "2.0.0"),
				appPlatform: "ios",
				appVersion: "2.0.0",
			}),
		);
		expectNoNetwork();
	});
});

describe.skipIf(!databaseReady)("a broadcast is a set too", () => {
	test("an app update announcement creates deliveries", async () => {
		const operator = await signUp();
		const recipient = await signUp();
		await registerDevice(recipient);

		await setAppVersionFloor({
			platform: "ios",
			actorId: operator.memberId,
			request: { minVersion: "9.9.9", message: "", reason: "Test" },
		});
		await broadcastAppUpdate({
			platform: "ios",
			operatorId: operator.memberId,
			reason: "Test",
		});

		expect(await deliveriesFor(recipient.memberId)).toHaveLength(1);
	});

	/**
	 * Wiring stays the same as membership grows. A loop would pass here too; the static scan
	 * (`boundaries.test.ts`) catches that shape, and this test answers whether rows were actually
	 * created for many recipients.
	 */
	test("with several members, each gets one", async () => {
		const operator = await signUp();
		const recipients = [await signUp(), await signUp(), await signUp()];
		for (const recipient of recipients) await registerDevice(recipient);

		await setAppVersionFloor({
			platform: "android",
			actorId: operator.memberId,
			request: { minVersion: "9.9.8", message: "", reason: "Test2" },
		});
		await broadcastAppUpdate({
			platform: "android",
			operatorId: operator.memberId,
			reason: "Test2",
		});

		for (const recipient of recipients)
			expect(await deliveriesFor(recipient.memberId)).toHaveLength(1);
	});
});

describe.skipIf(!databaseReady)("deletion takes deliveries along", () => {
	test("when the notification goes, the delivery goes too", async () => {
		const recipient = await signUp();
		await registerDevice(recipient);
		await db.transaction((tx) =>
			createNotification(tx, {
				recipientId: recipient.memberId,
				kind: "report_reviewed",
				sourceKey: notificationSourceKey.reportReviewed(newId()),
			}),
		);
		const [row] = await notificationsFor(recipient.memberId);
		await db.delete(notification).where(eq(notification.id, row?.id ?? ""));

		const [remaining] = await db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(push_delivery)
			.where(eq(push_delivery.notification_id, row?.id ?? ""));
		expect(remaining?.n).toBe(0);
	});

	/** Session gone means registration gone, so signing out is unregistering. */
	test("when the session goes, the registration goes too", async () => {
		const account = await signUp();
		const registrationId = await registerDevice(account);
		const sessionId = await liveSessionId(account);

		await db.delete(session).where(eq(session.id, sessionId));

		const rows = await db
			.select({ id: push_registration.id })
			.from(push_registration)
			.where(
				and(
					eq(push_registration.id, registrationId),
					eq(push_registration.member_id, account.memberId),
				),
			);
		expect(rows).toHaveLength(0);
	});
});
