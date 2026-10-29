import { eq, inArray } from "drizzle-orm";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { closeDb, db } from "../../db/client.ts";
import {
	notification,
	push_delivery,
	push_registration,
	session,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import {
	connectTestDatabase,
	deleteTestUsers,
	testMemberIds,
} from "../../test/database.ts";
import { createNotification, notificationSourceKey } from "../notifications.ts";
import {
	claimPushDeliveries,
	claimPushReceipts,
	PUSH_DELIVERY_TTL_MS,
	PUSH_REGISTRATION_INACTIVE,
	sendClaimedPushDeliveries,
	settlePushReceipts,
} from "./delivery.ts";

/**
 * Exercises the delivery state machine on real Postgres:
 * 1. claiming is concurrency-safe (two runs never claim the same row)
 * 2. transient failures back off and permanent ones stop
 * 3. a dead token disables only its registration, not a neighbouring device
 * 4. an expired delivery ends unsent
 * 5. eligibility at creation time does not authorize sending now
 * 6. none of it touches a `notification` row (the most important: whatever delivery does, the
 *    inbox is unchanged; that is what "push is not authority" means)
 */

const EMAIL_PREFIX = "push-delivery-test-";

const databaseReady = await connectTestDatabase();

afterAll(async () => {
	await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	/**
	 * Claiming is global (the predicate has no member; the job does not know accounts), so one test's
	 * leftover deliveries would join the next test's batch. Clear before each test, but only rows this
	 * suite created: an unscoped delete would wipe registrations and deliveries of other files on the
	 * same database, and the failure would surface in the deleted side (`enqueue.test.ts`), not here.
	 * Per-worker databases prevent the overlap today, but isolation is not this file's property; the
	 * prefix is the suite's ownership boundary and must stand as a predicate here too. Each test still
	 * starts with nothing left by earlier tests.
	 */
	const owned = testMemberIds(EMAIL_PREFIX);
	await db.delete(push_delivery).where(
		inArray(
			push_delivery.notification_id,
			db
				.select({ id: notification.id })
				.from(notification)
				.where(inArray(notification.recipient, testMemberIds(EMAIL_PREFIX))),
		),
	);
	await db
		.delete(push_registration)
		.where(inArray(push_registration.member_id, owned));
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const ticketsOk = (count: number) =>
	jsonResponse({
		data: Array.from({ length: count }, (_, i) => ({
			status: "ok",
			id: `ticket-${i}`,
		})),
	});

interface Fixture {
	memberId: string;
	authUserId: string;
	notificationId: string;
	registrationIds: string[];
	deliveryIds: string[];
}

/**
 * One member, n registrations, one notification gives n deliveries. `ineligibleBefore` removes
 * eligibility before the notification is created, to compare whether the creating side (`enqueue`)
 * and the claiming side (`claim`) see the same predicate.
 */
async function seed(
	devices = 1,
	options: { ineligibleBefore?: "disabled" | "expired" } = {},
): Promise<Fixture> {
	const account = await createTestMember(EMAIL_PREFIX);
	const [sessionRow] = await db
		.select({ id: session.id })
		.from(session)
		.where(eq(session.userId, account.authUserId))
		.limit(1);

	const registrationIds: string[] = [];
	for (let i = 0; i < devices; i += 1) {
		const id = newId();
		await db.insert(push_registration).values({
			id,
			member_id: account.memberId,
			session_id: sessionRow?.id ?? "",
			installation_id: newId(),
			platform: "ios",
			provider: "expo",
			token: `ExponentPushToken[${id}]`,
		});
		registrationIds.push(id);
	}

	if (options.ineligibleBefore === "disabled")
		await db
			.update(push_registration)
			.set({ disabled_at: new Date() })
			.where(eq(push_registration.id, registrationIds[0] ?? ""));
	if (options.ineligibleBefore === "expired")
		await db
			.update(session)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(session.userId, account.authUserId));

	await db.transaction((tx) =>
		createNotification(tx, {
			recipientId: account.memberId,
			kind: "story_comment",
			sourceKey: notificationSourceKey.comment(newId()),
		}),
	);

	const [row] = await db
		.select({ id: notification.id })
		.from(notification)
		.where(eq(notification.recipient, account.memberId));
	const deliveries = await db
		.select({ id: push_delivery.id })
		.from(push_delivery)
		.where(eq(push_delivery.notification_id, row?.id ?? ""));

	return {
		memberId: account.memberId,
		authUserId: account.authUserId,
		notificationId: row?.id ?? "",
		registrationIds,
		deliveryIds: deliveries.map((d) => d.id),
	};
}

const deliveryRows = (ids: string[]) =>
	db
		.select({
			id: push_delivery.id,
			state: push_delivery.state,
			attempts: push_delivery.attempts,
			nextAttemptAt: push_delivery.next_attempt_at,
			ticketId: push_delivery.ticket_id,
			lastError: push_delivery.last_error,
			settledAt: push_delivery.settled_at,
		})
		.from(push_delivery)
		.where(inArray(push_delivery.id, ids));

const registrationRow = async (id: string) => {
	const [row] = await db
		.select({ disabledAt: push_registration.disabled_at })
		.from(push_registration)
		.where(eq(push_registration.id, id));
	return row;
};

/** Device turned off by the user, or the provider did not know the token; both use this column. */
const disableRegistration = (id: string) =>
	db
		.update(push_registration)
		.set({ disabled_at: new Date() })
		.where(eq(push_registration.id, id));

/**
 * Expires the account's session but keeps the row. Sign-out and revocation cascade to the
 * registration and take deliveries with them; this builds the branch the cascade does not reach.
 */
const expireSession = (authUserId: string) =>
	db
		.update(session)
		.set({ expiresAt: new Date(Date.now() - 60_000) })
		.where(eq(session.userId, authUserId));

const notificationRow = async (id: string) => {
	const [row] = await db
		.select({
			id: notification.id,
			readAt: notification.read_at,
			createdAt: notification.created_at,
		})
		.from(notification)
		.where(eq(notification.id, id));
	return row;
};

describe.skipIf(!databaseReady)("claiming", () => {
	test("claims candidates and reserves them in one transaction", async () => {
		const fixture = await seed();
		const now = new Date();
		const claim = await claimPushDeliveries(10, now);

		expect(claim.deliveries.map((d) => d.deliveryId)).toEqual(
			fixture.deliveryIds,
		);
		expect(claim.deliveries[0]?.copy.body).toBe(
			"Your story has a new comment.",
		);

		const [row] = await deliveryRows(fixture.deliveryIds);
		/** Pessimistic reservation: attempts rise and the next time moves before sending. */
		expect(row?.attempts).toBe(1);
		expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
	});

	/**
	 * While the lease is live a second run does not see the row; this is why two replicas never send
	 * the same delivery twice.
	 */
	test("a second run doesn't claim the same row", async () => {
		const fixture = await seed();
		const now = new Date();
		const first = await claimPushDeliveries(10, now);
		const second = await claimPushDeliveries(10, now);

		expect(first.deliveries).toHaveLength(fixture.deliveryIds.length);
		expect(second.deliveries).toHaveLength(0);
	});

	/** An expired delivery ends unsent; a banner for a three-day-old comment is noise. */
	test("a delivery past its lifetime ends as expired", async () => {
		const fixture = await seed();
		const now = new Date(Date.now() + PUSH_DELIVERY_TTL_MS + 60_000);
		const claim = await claimPushDeliveries(10, now);

		expect(claim.deliveries).toHaveLength(0);
		expect(claim.expired).toBe(1);

		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("expired");
		expect(row?.lastError).toBe("expired");
		expect(row?.settledAt).not.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("reaching the attempt cap ends it without sending", async () => {
		const fixture = await seed();
		await db
			.update(push_delivery)
			.set({ attempts: 99 })
			.where(inArray(push_delivery.id, fixture.deliveryIds));

		const claim = await claimPushDeliveries(10, new Date());
		expect(claim.deliveries).toHaveLength(0);
		expect(claim.exhausted).toBe(1);

		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("failed");
		expect(row?.lastError).toBe("attempts_exhausted");
	});
});

describe.skipIf(!databaseReady)("sending", () => {
	test("once accepted, waits for the receipt", async () => {
		const fixture = await seed();
		fetchMock.mockResolvedValue(ticketsOk(1));

		const claim = await claimPushDeliveries(10, new Date());
		const report = await sendClaimedPushDeliveries(
			claim.deliveries,
			new Date(),
		);
		expect(report.accepted).toBe(1);

		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("accepted");
		expect(row?.ticketId).toBe("ticket-0");
		expect(row?.settledAt).toBeNull();
	});

	test("a transient failure backs off and becomes a candidate again", async () => {
		const fixture = await seed();
		fetchMock.mockRejectedValue(new Error("offline"));

		const now = new Date();
		const claim = await claimPushDeliveries(10, now);
		const report = await sendClaimedPushDeliveries(claim.deliveries, now);
		expect(report.retried).toBe(1);

		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("pending");
		expect(row?.lastError).toBe("network");
		expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
	});

	test("a permanent failure is not retried", async () => {
		const fixture = await seed();
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: [{ status: "error", details: { error: "MessageTooBig" } }],
			}),
		);

		const claim = await claimPushDeliveries(10, new Date());
		await sendClaimedPushDeliveries(claim.deliveries, new Date());

		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("failed");
		expect(row?.lastError).toBe("MessageTooBig");
	});

	/** A dead token disables only its own registration. */
	test("an unknown device has its registration turned off", async () => {
		const fixture = await seed();
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
			}),
		);

		const claim = await claimPushDeliveries(10, new Date());
		const report = await sendClaimedPushDeliveries(
			claim.deliveries,
			new Date(),
		);
		expect(report.disabled).toBe(1);

		const registration = await registrationRow(
			fixture.registrationIds[0] ?? "",
		);
		expect(registration?.disabledAt).not.toBeNull();
	});

	/** One device's failure does not block another's; this is why deliveries are per registration. */
	test("one device dying doesn't stop delivery to the next", async () => {
		const fixture = await seed(2);
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: [
					{ status: "error", details: { error: "DeviceNotRegistered" } },
					{ status: "ok", id: "ticket-live" },
				],
			}),
		);

		const claim = await claimPushDeliveries(10, new Date());
		expect(claim.deliveries).toHaveLength(2);
		const report = await sendClaimedPushDeliveries(
			claim.deliveries,
			new Date(),
		);

		expect(report.disabled).toBe(1);
		expect(report.accepted).toBe(1);

		const rows = await deliveryRows(fixture.deliveryIds);
		expect(rows.map((r) => r.state).sort()).toEqual(["accepted", "failed"]);
	});

	/** The slice's promise: whatever delivery does, the notification does not change. */
	test("no failure touches the notification", async () => {
		const fixture = await seed();
		const before = await notificationRow(fixture.notificationId);

		fetchMock.mockResolvedValue(
			jsonResponse({
				data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
			}),
		);
		const claim = await claimPushDeliveries(10, new Date());
		await sendClaimedPushDeliveries(claim.deliveries, new Date());

		const after = await notificationRow(fixture.notificationId);
		expect(after).toEqual(before);
		expect(after?.readAt).toBeNull();
	});
});

describe.skipIf(!databaseReady)("receipts", () => {
	const accept = async (fixture: Fixture) => {
		fetchMock.mockResolvedValue(ticketsOk(fixture.deliveryIds.length));
		const claim = await claimPushDeliveries(10, new Date());
		await sendClaimedPushDeliveries(claim.deliveries, new Date());
	};

	/** The receipt time was pushed out, so it is not claimed before then. */
	test("doesn't ask right away", async () => {
		const fixture = await seed();
		await accept(fixture);
		const claim = await claimPushReceipts(10, new Date());
		expect(claim.receipts).toHaveLength(0);
	});

	test("a successful receipt ends it as delivered", async () => {
		const fixture = await seed();
		await accept(fixture);

		const later = new Date(Date.now() + 60 * 60 * 1000);
		const claim = await claimPushReceipts(10, later);
		expect(claim.receipts).toHaveLength(1);

		fetchMock.mockResolvedValue(
			jsonResponse({ data: { "ticket-0": { status: "ok" } } }),
		);
		const report = await settlePushReceipts(claim.receipts, later);
		expect(report.delivered).toBe(1);

		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("delivered");
		expect(row?.settledAt).not.toBeNull();
	});

	/** A missing receipt is not a failure; look again later. */
	test("a receipt that isn't ready isn't recorded as a failure", async () => {
		const fixture = await seed();
		await accept(fixture);

		const later = new Date(Date.now() + 60 * 60 * 1000);
		const claim = await claimPushReceipts(10, later);
		fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
		const report = await settlePushReceipts(claim.receipts, later);

		expect(report.pending).toBe(1);
		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("accepted");
	});

	test("a receipt naming a dead token turns the registration off", async () => {
		const fixture = await seed();
		await accept(fixture);

		const later = new Date(Date.now() + 60 * 60 * 1000);
		const claim = await claimPushReceipts(10, later);
		fetchMock.mockResolvedValue(
			jsonResponse({
				data: {
					"ticket-0": {
						status: "error",
						details: { error: "DeviceNotRegistered" },
					},
				},
			}),
		);
		await settlePushReceipts(claim.receipts, later);

		expect(
			(await registrationRow(fixture.registrationIds[0] ?? ""))?.disabledAt,
		).not.toBeNull();
		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.state).toBe("failed");
		/** The notification is unchanged. */
		expect((await notificationRow(fixture.notificationId))?.readAt).toBeNull();
	});
});

describe.skipIf(!databaseReady)(
	"asks for entitlement again when sending",
	() => {
		/**
		 * Why this group exists: a delivery is created for a registration eligible then and may stay
		 * `pending` arbitrarily long. If the user turned the device off or the session expired in between,
		 * it must not go out.
		 */
		test("doesn't send to a registration turned off after creation", async () => {
			const fixture = await seed();
			await disableRegistration(fixture.registrationIds[0] ?? "");

			const claim = await claimPushDeliveries(10, new Date());

			expect(claim.deliveries).toHaveLength(0);
			expect(claim.inactive).toBe(1);
			/** Not counted as cap-exhausted; the reason differs. */
			expect(claim.exhausted).toBe(0);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		/**
		 * Settled, not filtered: merely excluding it from the detail query would leave the row `pending`,
		 * occupying every batch until the cap or lifetime takes it.
		 */
		test("that delivery ends with a reason", async () => {
			const fixture = await seed();
			await disableRegistration(fixture.registrationIds[0] ?? "");
			await claimPushDeliveries(10, new Date());

			const [row] = await deliveryRows(fixture.deliveryIds);
			expect(row?.state).toBe("failed");
			expect(row?.lastError).toBe(PUSH_REGISTRATION_INACTIVE);
			expect(row?.settledAt).not.toBeNull();
		});

		test("once finished it isn't claimed again", async () => {
			const fixture = await seed();
			await disableRegistration(fixture.registrationIds[0] ?? "");
			await claimPushDeliveries(10, new Date());

			/** Not a candidate after the lease ends either, since it is no longer `pending`. */
			const later = new Date(Date.now() + 60 * 60 * 1000);
			const again = await claimPushDeliveries(10, later);
			expect(again.deliveries).toHaveLength(0);
			expect(again.inactive).toBe(0);

			const [row] = await deliveryRows(fixture.deliveryIds);
			expect(row?.attempts).toBe(1);
		});

		/**
		 * Session expiry is the branch the cascade does not reach; registration and delivery rows both
		 * remain. The creating side already uses this predicate and the sending side sees the same one.
		 */
		test("doesn't send to the registration of a session that expired after creation either", async () => {
			const fixture = await seed();
			await expireSession(fixture.authUserId);

			const claim = await claimPushDeliveries(10, new Date());
			expect(claim.deliveries).toHaveLength(0);
			expect(claim.inactive).toBe(1);
			expect(fetchMock).not.toHaveBeenCalled();

			const [row] = await deliveryRows(fixture.deliveryIds);
			expect(row?.state).toBe("failed");
			expect(row?.lastError).toBe(PUSH_REGISTRATION_INACTIVE);
		});

		/** The inbox is still unchanged. */
		test("losing entitlement leaves the notification as is", async () => {
			const fixture = await seed();
			const before = await notificationRow(fixture.notificationId);

			await disableRegistration(fixture.registrationIds[0] ?? "");
			await claimPushDeliveries(10, new Date());

			const after = await notificationRow(fixture.notificationId);
			expect(after).toEqual(before);
			expect(after?.readAt).toBeNull();
		});

		/**
		 * Eligibility is per registration: turning one device off does not block its neighbour. (It also
		 * shows the creating side already uses the same predicate: both registrations were eligible at
		 * creation and only one differs now.)
		 */
		test("turning one device off still delivers to the next", async () => {
			const fixture = await seed(2);
			expect(fixture.deliveryIds).toHaveLength(2);
			await disableRegistration(fixture.registrationIds[0] ?? "");

			const claim = await claimPushDeliveries(10, new Date());
			expect(claim.inactive).toBe(1);
			expect(claim.deliveries).toHaveLength(1);
			expect(claim.deliveries[0]?.registrationId).toBe(
				fixture.registrationIds[1],
			);

			fetchMock.mockResolvedValue(ticketsOk(1));
			const report = await sendClaimedPushDeliveries(
				claim.deliveries,
				new Date(),
			);
			expect(report.accepted).toBe(1);

			const rows = await deliveryRows(fixture.deliveryIds);
			expect(rows.map((r) => r.state).sort()).toEqual(["accepted", "failed"]);
		});

		/**
		 * A deleted registration is already answered by the cascade (its deliveries go too). The predicate
		 * is still checked by value so a cascade change cannot silently read as eligible.
		 */
		test("when the registration goes, its deliveries go too", async () => {
			const fixture = await seed();
			await db
				.delete(push_registration)
				.where(eq(push_registration.id, fixture.registrationIds[0] ?? ""));

			expect(await deliveryRows(fixture.deliveryIds)).toHaveLength(0);
			const claim = await claimPushDeliveries(10, new Date());
			expect(claim.deliveries).toHaveLength(0);
			/** The notification remains. */
			expect(await notificationRow(fixture.notificationId)).toBeDefined();
		});
	},
);

describe.skipIf(!databaseReady)(
	"the creating side and the sending side read the same predicate",
	() => {
		/**
		 * This group pins the predicate's result, not its text: both moments must answer the same
		 * question the same way. An ineligible registration gets no delivery created, and one that lost
		 * eligibility after creation gets nothing sent. While only the creating side had the predicate
		 * the latter was missing entirely, with no error.
		 */
		for (const kind of ["disabled", "expired"] as const) {
			test(`${kind}: caught at creation, there is no delivery`, async () => {
				const fixture = await seed(1, { ineligibleBefore: kind });
				expect(fixture.deliveryIds).toHaveLength(0);
			});

			test(`${kind}: caught after creation, it isn't sent`, async () => {
				const fixture = await seed();
				expect(fixture.deliveryIds).toHaveLength(1);

				if (kind === "disabled")
					await disableRegistration(fixture.registrationIds[0] ?? "");
				else await expireSession(fixture.authUserId);

				const claim = await claimPushDeliveries(10, new Date());
				expect(claim.deliveries).toHaveLength(0);
				expect(claim.inactive).toBe(1);
				expect(fetchMock).not.toHaveBeenCalled();
			});
		}

		/** An eligible registration passes both moments, proving the group is not vacuous. */
		test("with entitlement, it is created and sent", async () => {
			const fixture = await seed();
			expect(fixture.deliveryIds).toHaveLength(1);

			const claim = await claimPushDeliveries(10, new Date());
			expect(claim.deliveries.map((d) => d.deliveryId)).toEqual(
				fixture.deliveryIds,
			);
			expect(claim.inactive).toBe(0);
		});
	},
);

describe.skipIf(!databaseReady)("restart", () => {
	/**
	 * An expired lease makes it a candidate again, so a dead process cannot stall a delivery forever
	 * (an expiring lease rather than a lock).
	 */
	test("a delivery claimed by a process that died is claimed again once the lease ends", async () => {
		const fixture = await seed();
		await claimPushDeliveries(10, new Date());

		const later = new Date(Date.now() + 10 * 60 * 1000);
		const again = await claimPushDeliveries(10, later);
		expect(again.deliveries.map((d) => d.deliveryId)).toEqual(
			fixture.deliveryIds,
		);

		const [row] = await deliveryRows(fixture.deliveryIds);
		expect(row?.attempts).toBe(2);
	});
});
