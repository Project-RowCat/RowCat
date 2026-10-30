import { OPS_ERROR_CODE } from "@rowcat/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { app } from "../../app.ts";
import { closeDb, db } from "../../db/client.ts";
import {
	admin_audit_log,
	member,
	notification,
	ops_app_version_floor,
	ops_feature_flag,
	story,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { resetOpsCacheForTest } from "../../services/ops.ts";

import { createTestMember, TEST_PASSWORD } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { WEB_ORIGIN } from "../../test/http.ts";

/**
 * Operations console, exercised through the real Hono app and a real Postgres.
 *
 * Calling service functions directly would leave the fragile parts outside the test: whether the
 * role gate is actually wired on the route, whether turning a switch off actually blocks the other
 * route, and whether a privileged operation writes exactly one audit row.
 *
 * 1. Authorization: guest 401, member 403, staff may read, only admin may touch the allowlist
 *    and versions. A suspended operator is refused even with the role intact, so a hijacked admin
 *    account cannot lend the operator's key.
 * 2. Fail-closed: an out-of-vocabulary switch key is never stored, so a free-key form cannot
 *    create a row no route reads.
 * 3. Enforcement really happens: turning a switch off rejects `POST /v2/stories`. Without that
 *    check this slice would only draw switches on a screen.
 * 4. Audit: one privileged change makes one row, and no secret reaches the metadata.
 * 5. Projection boundary: the member-detail key set is counted whole. `not.toHaveProperty` only
 *    blocks fields known today and lets new values leak when a column is added or the projection is
 *    reused.
 */

const EMAIL_PREFIX = "admin-test-";

/**
 * The iOS floors this file sets, which are also the ownership boundary of app-update notices.
 *
 * A broadcast creates a row for every member in the database, so recipients cannot tell whose
 * notice it is. The only usable axis is the key: `app-update:<platform>:<version>` derives from the
 * floors set here, so this list defines which rows this file created.
 *
 * Cleanup used to filter on `kind = 'app_update'` alone. That swept up notices (and their push
 * deliveries) from other files sharing the database, and the failure appeared in the file that got
 * deleted from rather than the one deleting (`services/push/enqueue.test.ts` broadcasts its own
 * notice at floor `9.9.9`; the keys now differ, so they do not touch).
 *
 * Narrowing keeps this file's guarantee: rows left by an interrupted earlier run carry the same
 * keys and are still deleted, so assertions counting full-member broadcasts do not drift on a dirty
 * database.
 */
const OWNED_APP_UPDATE_KEYS = ["1.4.0", "1.5.0", "3.0.0"].map(
	(version) => `app-update:ios:${version}`,
);

/** Selects only this file's app-update notices; reads and deletes share the predicate. */
const ownAppUpdateNotices = () =>
	and(
		eq(notification.kind, "app_update"),
		inArray(notification.source_key, OWNED_APP_UPDATE_KEYS),
	);

const deleteOwnAppUpdateNotices = () =>
	db.delete(notification).where(ownAppUpdateNotices());

interface Account {
	cookie: string;
	memberId: string;
}

const CREATED_MEMBERS: string[] = [];

async function signUp() {
	const account = await createTestMember(EMAIL_PREFIX, {
		name: "operations console test",
	});
	CREATED_MEMBERS.push(account.memberId);
	return account;
}

/**
 * Operator account, made the way the seed script does it (writing the column directly).
 *
 * The product API has no promotion path, and this helper's shape shows it: a `PATCH /me/role` would
 * have been called here, and its absence is the substance of §20.
 */
async function signUpOperator(role: "staff" | "admin"): Promise<Account> {
	const account = await signUp();
	await db.update(member).set({ role }).where(eq(member.id, account.memberId));
	return account;
}

const headers = (cookie: string | null, withBody = false) => ({
	...(withBody ? { "Content-Type": "application/json" } : {}),
	Origin: WEB_ORIGIN,
	...(cookie ? { Cookie: cookie } : {}),
});

const get = (path: string, cookie: string | null) =>
	app.request(path, { headers: headers(cookie) });

const send = (
	method: "POST" | "PUT",
	path: string,
	cookie: string | null,
	body: unknown,
	extra: Record<string, string> = {},
) =>
	app.request(path, {
		method,
		headers: { ...headers(cookie, true), ...extra },
		body: JSON.stringify(body),
	});

const databaseReady = await connectTestDatabase();

const GUEST = null;
const USER: Account = databaseReady
	? await signUp()
	: { cookie: "", memberId: "" };
const STAFF: Account = databaseReady
	? await signUpOperator("staff")
	: { cookie: "", memberId: "" };
const ADMIN: Account = databaseReady
	? await signUpOperator("admin")
	: { cookie: "", memberId: "" };

/**
 * Switches are global state, so they are cleared per test.
 *
 * The in-process 5-second cache is cleared too; clearing only the DB lets the next test see the
 * previous test's switch for 5 seconds, making the file order-dependent in a way that breaks only
 * in CI.
 */
beforeEach(async () => {
	if (!databaseReady) return;
	await db.delete(ops_feature_flag);
	await db.delete(ops_app_version_floor);
	resetOpsCacheForTest();
});

afterAll(async () => {
	if (databaseReady) {
		await db.delete(ops_feature_flag);
		await db.delete(ops_app_version_floor);
		if (CREATED_MEMBERS.length) {
			await db
				.delete(admin_audit_log)
				.where(inArray(admin_audit_log.operator, CREATED_MEMBERS));
			await db.delete(story).where(inArray(story.owner, CREATED_MEMBERS));
		}
		resetOpsCacheForTest();
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

/* 1. Authorization */

describe.skipIf(!databaseReady)("operations console — authorization", () => {
	/**
	 * Every read behind the operator gate. Iterating a list is the point: without adding a line here
	 * when a route is added, that endpoint could be open with no gate and this file would still pass.
	 */
	const OPERATOR_READS = [
		"/v2/admin/overview",
		"/v2/admin/members",
		"/v2/admin/stories",
		"/v2/admin/operations/features",
		"/v2/admin/operations/app-versions",
		"/v2/admin/audit",
	];

	test.each(OPERATOR_READS)("a guest gets 401 — %s", async (path) => {
		const response = await get(path, GUEST);
		expect(response.status).toBe(401);
	});

	test.each(OPERATOR_READS)("a regular member gets 403 — %s", async (path) => {
		const response = await get(path, USER.cookie);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe("moderator_required");
	});

	test.each(OPERATOR_READS)("staff passes — %s", async (path) => {
		const response = await get(path, STAFF.cookie);
		expect(response.status).toBe(200);
	});

	/**
	 * Where staff and admin diverge. That split exists only beside real operations (§22): the app
	 * version floor that locks the app, and the managed-generation allowlist.
	 */
	test("staff can't change feature switches", async () => {
		const response = await send(
			"PUT",
			"/v2/admin/operations/features/chat",
			STAFF.cookie,
			{ state: "off", reason: "Test" },
		);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe("admin_required");
	});

	test("staff can't change the minimum version", async () => {
		const response = await send(
			"PUT",
			"/v2/admin/operations/app-versions/ios",
			STAFF.cookie,
			{ minVersion: "1.0.0", reason: "Test" },
		);
		expect(response.status).toBe(403);
	});

	/**
	 * A suspended operator is refused even with the role intact.
	 *
	 * The most important case here: it is the only place that observes the gate sitting on
	 * `requireActiveViewer`. Without it a hijacked admin account could keep operating.
	 */
	test("a suspended operator is refused even with the role still in place", async () => {
		const suspended = await signUpOperator("admin");
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, suspended.memberId));

		const read = await get("/v2/admin/overview", suspended.cookie);
		expect(read.status).toBe(403);
		const body = (await read.json()) as { code: string };
		expect(body.code).toBe("account_restricted");

		const write = await send(
			"PUT",
			"/v2/admin/operations/features/chat",
			suspended.cookie,
			{ state: "off", reason: "Test" },
		);
		expect(write.status).toBe(403);

		/** The allowlist is behind the same gate; the role column alone does not authorize. */
		const allow = await send(
			"POST",
			`/v2/admin/members/${USER.memberId}/managed-generation`,
			suspended.cookie,
			{ allowed: true, reason: "Test" },
		);
		expect(allow.status).toBe(403);
	});
});

/* 2. Feature switches: vocabulary and fail-closed */

describe.skipIf(!databaseReady)("feature switches", () => {
	test("a known key changes, and the list answers with that state as is", async () => {
		const response = await send(
			"PUT",
			"/v2/admin/operations/features/chat",
			ADMIN.cookie,
			{
				state: "off",
				message: "Under maintenance.",
				reason: "upstream outage",
			},
		);
		expect(response.status).toBe(200);
		const flag = (await response.json()) as {
			key: string;
			state: string;
			enabled: boolean;
			message: string;
		};
		expect(flag).toMatchObject({
			key: "chat",
			state: "off",
			enabled: false,
			message: "Under maintenance.",
		});

		const list = await get("/v2/admin/operations/features", ADMIN.cookie);
		const body = (await list.json()) as {
			items: { key: string; state: string; enabled: boolean }[];
		};
		/** Untouched keys come back too; otherwise they would be missing from the screen when someone wants to turn them off. */
		expect(body.items.map((i) => i.key).sort()).toEqual(
			["chat", "publish", "signup", "sync"].sort(),
		);
		expect(body.items.find((i) => i.key === "chat")?.enabled).toBe(false);
		expect(body.items.find((i) => i.key === "sync")?.state).toBe("default");
		expect(body.items.find((i) => i.key === "sync")?.enabled).toBe(true);
	});

	/**
	 * An unknown key is never stored, which is what "the vocabulary is closed" means.
	 *
	 * Beyond the 400, this checks that no row was created; if the route rejected after the service had
	 * already written, the status assertion alone would pass.
	 */
	test("a key outside the vocabulary is refused and leaves no row", async () => {
		const response = await send(
			"PUT",
			"/v2/admin/operations/features/nuclear-launch",
			ADMIN.cookie,
			{ state: "off", reason: "Test" },
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe(OPS_ERROR_CODE.unknownFeature);

		const rows = await db.select().from(ops_feature_flag);
		expect(rows).toHaveLength(0);
	});

	/** The reason is required by the contract, so a reasonless change is not expressible. */
	test("a change without a reason is refused", async () => {
		const response = await send(
			"PUT",
			"/v2/admin/operations/features/chat",
			ADMIN.cookie,
			{ state: "off" },
		);
		expect(response.status).toBe(400);
	});
});

/* 3. Switches really block */

describe.skipIf(!databaseReady)("server enforcement", () => {
	/**
	 * The most important test in this file.
	 *
	 * Without it the operations-settings slice would only draw switches on a screen. It checks three
	 * things: another route rejects when the switch is off, the code is machine-readable, and
	 * restoring the switch lets requests through again.
	 */
	test("turning publish off refuses publishing, and reverting lets it through again", async () => {
		const creator = await signUp();

		const publish = () =>
			send("POST", "/v2/stories", creator.cookie, {
				metadata: {
					title: "breaker test",
					visibility: "private",
					adult: false,
				},
				play: { scenario: "Body" },
				originDraftId: newId(),
			});

		/** Before turning it off, the publish policy decides; the result is at least not `feature_disabled`. */
		const before = await publish();
		const beforeBody = (await before.json()) as { code?: string };
		expect(beforeBody.code).not.toBe(OPS_ERROR_CODE.featureDisabled);

		await send("PUT", "/v2/admin/operations/features/publish", ADMIN.cookie, {
			state: "off",
			message: "Publishing under maintenance",
			reason: "incident response",
		});

		const blocked = await publish();
		expect(blocked.status).toBe(403);
		const blockedBody = (await blocked.json()) as {
			code: string;
			message: string;
		};
		expect(blockedBody.code).toBe(OPS_ERROR_CODE.featureDisabled);
		/** The operator's message reaches the user verbatim. */
		expect(blockedBody.message).toBe("Publishing under maintenance");

		await send("PUT", "/v2/admin/operations/features/publish", ADMIN.cookie, {
			state: "on",
			reason: "recovery",
		});

		const after = await publish();
		const afterBody = (await after.json()) as { code?: string };
		expect(afterBody.code).not.toBe(OPS_ERROR_CODE.featureDisabled);
	});

	/**
	 * Signup breaker, standing on the email signup path.
	 *
	 * Only here is it observable that the middleware sits before the Better Auth handler. It also
	 * checks that the scope is narrowed to `sign-up`: covering all of `/auth/*` would kill the login
	 * below too.
	 */
	test("turning signup off blocks sign-up while sign-in stays as is", async () => {
		const existing = await signUp();

		await send("PUT", "/v2/admin/operations/features/signup", ADMIN.cookie, {
			state: "off",
			reason: "spam response",
		});

		const blocked = await app.request("/v2/auth/sign-up/email", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
			body: JSON.stringify({
				name: "should be blocked",
				email: `${EMAIL_PREFIX}${newId()}@example.test`,
				password: TEST_PASSWORD,
			}),
		});
		expect(blocked.status).toBe(403);
		const body = (await blocked.json()) as { code: string };
		expect(body.code).toBe(OPS_ERROR_CODE.featureDisabled);

		/** Existing members are unaffected: closing signup does not close login. */
		const me = await get("/v2/me", existing.cookie);
		expect(me.status).toBe(200);
		expect((await me.json()) as { id: string } | null).not.toBeNull();
	});

	/**
	 * Sync blocks push only; pull stays open.
	 *
	 * The asymmetry is intended and observable only here. Blocking pull would cut a device off from
	 * its own data, which is holding data hostage rather than a breaker.
	 */
	test("pull stays open even with sync off", async () => {
		const person = await signUp();

		await send("PUT", "/v2/admin/operations/features/sync", ADMIN.cookie, {
			state: "off",
			reason: "storage maintenance",
		});

		const push = await app.request("/v2/me/sync/records", {
			method: "POST",
			headers: {
				...headers(person.cookie, true),
				"Idempotency-Key": newId(),
			},
			body: JSON.stringify({ items: [] }),
		});
		expect(push.status).toBe(403);
		expect((await push.json()) as { code: string }).toMatchObject({
			code: OPS_ERROR_CODE.featureDisabled,
		});

		const pull = await get("/v2/me/sync/records?since=0", person.cookie);
		expect(pull.status).toBe(200);
	});

	/** The public runtime config reports disabled features without a session. */
	test("the public runtime config tells guests which features are off", async () => {
		await send("PUT", "/v2/admin/operations/features/chat", ADMIN.cookie, {
			state: "off",
			message: "Conversations under maintenance",
			reason: "upstream outage",
		});

		const response = await get("/v2/runtime-config", GUEST);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			disabledFeatures: { key: string; message: string }[];
			minAppVersion: { ios: string | null; android: string | null };
		};
		expect(body.disabledFeatures).toEqual([
			{ key: "chat", message: "Conversations under maintenance" },
		]);
		expect(body.minAppVersion).toEqual({ ios: null, android: null });
	});
});

/* 4. Minimum app version */

describe.skipIf(!databaseReady)("minimum app version", () => {
	test.each([
		["1.2", "not three components"],
		["1.2.0-beta.1", "prereleases are not accepted"],
		["v1.2.0", "prefixes are not accepted"],
		["01.2.0", "leading zeros are not accepted"],
		["", 'an empty string is not "no floor" — null means that'],
	])("the invalid version %s is refused (%s)", async (version) => {
		const response = await send(
			"PUT",
			"/v2/admin/operations/app-versions/ios",
			ADMIN.cookie,
			{ minVersion: version, reason: "Test" },
		);
		expect(response.status).toBe(400);
		const rows = await db.select().from(ops_app_version_floor);
		expect(rows).toHaveLength(0);
	});

	test("a floor shows up in the public runtime config, and null clears it", async () => {
		const set = await send(
			"PUT",
			"/v2/admin/operations/app-versions/ios",
			ADMIN.cookie,
			{
				minVersion: "1.2.0",
				message: "Please update to the latest version.",
				reason: "fix for a critical defect",
			},
		);
		expect(set.status).toBe(200);

		const config = (await (await get("/v2/runtime-config", GUEST)).json()) as {
			minAppVersion: { ios: string | null; android: string | null };
			updateMessage: string;
		};
		expect(config.minAppVersion).toEqual({ ios: "1.2.0", android: null });
		expect(config.updateMessage).toBe("Please update to the latest version.");

		const cleared = await send(
			"PUT",
			"/v2/admin/operations/app-versions/ios",
			ADMIN.cookie,
			{ minVersion: null, reason: "rollback" },
		);
		expect(cleared.status).toBe(200);
		expect((await cleared.json()) as { minVersion: null }).toMatchObject({
			minVersion: null,
		});
	});

	test("an unknown platform is refused", async () => {
		const response = await send(
			"PUT",
			"/v2/admin/operations/app-versions/windows",
			ADMIN.cookie,
			{ minVersion: "1.0.0", reason: "Test" },
		);
		expect(response.status).toBe(400);
	});
});

/* 4b. App-update notices */

describe.skipIf(!databaseReady)("app update announcement", () => {
	/**
	 * Deletes only the rows this file's broadcasts created (`OWNED_APP_UPDATE_KEYS`). Filtering on
	 * kind alone sweeps other files' notices running alongside, and that dependency breaks only when
	 * ordering changes, in the file deleted from rather than the one deleting.
	 *
	 * The assertions below read with the same predicate. For a while only deletion was narrow while
	 * reads covered the whole kind; that asymmetry broke once another file creating `app_update`
	 * landed in the same worker database (`services/push/enqueue.test.ts` broadcasts `9.9.9` to
	 * everyone), which happened when a file rename changed batching. What narrowed is the reading
	 * scope, not the check.
	 */
	beforeEach(async () => {
		if (!databaseReady) return;
		await deleteOwnAppUpdateNotices();
	});

	/**
	 * Clears both notices and audit rows.
	 *
	 * The audit block counts this operation's rows (below); leaving them would tie that assertion to
	 * how many broadcasts ran in this block, breaking each time a test is added.
	 */
	afterAll(async () => {
		if (!databaseReady) return;
		await deleteOwnAppUpdateNotices();
		await db
			.delete(admin_audit_log)
			.where(eq(admin_audit_log.action, "admin.app-update.broadcast"));
	});

	const setFloor = (platform: string, minVersion: string | null) =>
		send("PUT", `/v2/admin/operations/app-versions/${platform}`, ADMIN.cookie, {
			minVersion,
			reason: "Test",
		});

	const broadcast = (platform: string, cookie: string | null, body?: unknown) =>
		send(
			"POST",
			`/v2/admin/operations/app-versions/${platform}/notice`,
			cookie,
			body ?? { reason: "test announcement" },
		);

	const statusFor = async (platform: string, cookie: string | null) => {
		const response = await get(
			"/v2/admin/operations/app-versions/notice",
			cookie,
		);
		const body = (await response.json()) as {
			items: Record<string, unknown>[];
		};
		return body.items.find((item) => item.platform === platform);
	};

	const memberCount = async () => (await db.select().from(member)).length;

	/**
	 * With no floor there is nothing to announce.
	 *
	 * The point is not returning a silent success: an operator who got one would leave believing it
	 * was announced while nothing reached any inbox.
	 */
	test("sending is refused when there is no floor", async () => {
		const response = await broadcast("ios", ADMIN.cookie);
		expect(response.status).toBe(409);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe("app_version_floor_unset");

		const rows = await db
			.select()
			.from(notification)
			.where(ownAppUpdateNotices());
		expect(rows).toHaveLength(0);
	});

	test("sending creates one row for every member", async () => {
		await setFloor("ios", "1.4.0");
		const total = await memberCount();

		const response = await broadcast("ios", ADMIN.cookie);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			notified: number;
			alreadyNotified: number;
			status: { notifiedRecipients: number; broadcastComplete: boolean };
		};
		expect(body.notified).toBe(total);
		expect(body.alreadyNotified).toBe(0);
		expect(body.status.notifiedRecipients).toBe(total);
		expect(body.status.broadcastComplete).toBe(true);

		const rows = await db
			.select()
			.from(notification)
			.where(ownAppUpdateNotices());
		expect(rows).toHaveLength(total);
		/** The version freezes onto the row so reads do not re-query the floor. */
		expect(rows[0]?.app_platform).toBe("ios");
		expect(rows[0]?.app_version).toBe("1.4.0");
		expect(rows[0]?.source_key).toBe("app-update:ios:1.4.0");
	});

	/**
	 * A rerun is the normal path. An operator whose response was lost can only press again, and that
	 * must not stack another row.
	 */
	test("a rerun creates no rows and states how many already received it", async () => {
		await setFloor("ios", "1.4.0");
		const total = await memberCount();
		await broadcast("ios", ADMIN.cookie);

		const again = await broadcast("ios", ADMIN.cookie);
		expect(again.status).toBe(200);
		const body = (await again.json()) as {
			notified: number;
			alreadyNotified: number;
		};
		/** Zero is not an error; `alreadyNotified` gives that zero its meaning. */
		expect(body.notified).toBe(0);
		expect(body.alreadyNotified).toBe(total);

		const rows = await db
			.select()
			.from(notification)
			.where(ownAppUpdateNotices());
		expect(rows).toHaveLength(total);
	});

	/**
	 * Changing the floor is a different event: the key contains the version, so someone who got 1.4.0
	 * still gets 1.5.0.
	 */
	test("after the floor changes, it can be sent again for the new version", async () => {
		await setFloor("ios", "1.4.0");
		const total = await memberCount();
		await broadcast("ios", ADMIN.cookie);

		await setFloor("ios", "1.5.0");
		const status = await statusFor("ios", ADMIN.cookie);
		/** The new version has reached nobody yet; drawing the old version's count would be wrong. */
		expect(status).toMatchObject({
			minVersion: "1.5.0",
			notifiedRecipients: 0,
		});

		const response = await broadcast("ios", ADMIN.cookie);
		const body = (await response.json()) as { notified: number };
		expect(body.notified).toBe(total);

		const rows = await db
			.select()
			.from(notification)
			.where(ownAppUpdateNotices());
		expect(rows).toHaveLength(total * 2);
	});

	test("staff reads the status but can't send", async () => {
		/**
		 * Uses ios: the audit block below counts android floor changes, and touching that platform here
		 * would tie that assertion to this file's execution order.
		 */
		await setFloor("ios", "3.0.0");

		const read = await get(
			"/v2/admin/operations/app-versions/notice",
			STAFF.cookie,
		);
		expect(read.status).toBe(200);

		const response = await broadcast("ios", STAFF.cookie);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe("admin_required");
	});

	/**
	 * The request cannot choose the version. Silently ignoring it would let the sender believe they
	 * announced that version; the contract is `.strict()`, so it is a 400.
	 */
	test("putting a version or copy in the body is a 400", async () => {
		await setFloor("ios", "1.4.0");
		for (const body of [
			{ reason: "Test", version: "9.9.9" },
			{ reason: "Test", message: "Update now" },
		]) {
			const response = await broadcast("ios", ADMIN.cookie, body);
			expect(response.status).toBe(400);
		}
	});

	test("an unknown platform is refused", async () => {
		const response = await broadcast("windows", ADMIN.cookie);
		expect(response.status).toBe(400);
	});

	/**
	 * Counts the response's key set.
	 *
	 * Phrased as "no sensitive field" it would pass while leaking the day a column is added. Never
	 * present here: recipient list, operator identity, announcement copy.
	 */
	test("the status's key set is fixed", async () => {
		await setFloor("ios", "1.4.0");
		const status = await statusFor("ios", ADMIN.cookie);
		expect(Object.keys(status ?? {}).sort()).toEqual(
			[
				"broadcastComplete",
				"lastNotifiedAt",
				"minVersion",
				"notifiedRecipients",
				"pendingRecipients",
				"platform",
				"totalRecipients",
			].sort(),
		);
	});

	/**
	 * This operation only reads the floor. If one announcement moved it, two operations would be glued
	 * together and the cost of one mistake would change entirely.
	 */
	test("the announcement does not change the floor", async () => {
		await setFloor("ios", "1.4.0");
		await broadcast("ios", ADMIN.cookie);

		const rows = await db.select().from(ops_app_version_floor);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.min_version).toBe("1.4.0");
	});
});

/* 5. Audit */

describe.skipIf(!databaseReady)("audit records", () => {
	const auditFor = (action: string, targetId: string) =>
		db
			.select()
			.from(admin_audit_log)
			.where(eq(admin_audit_log.target_id, targetId))
			.then((rows) => rows.filter((r) => r.action === action));

	/**
	 * The audit table is append-only, so earlier tests that changed the same key leave rows behind
	 * (the switch vocabulary has only four keys and every other block uses each once). So this checks
	 * the increase rather than an absolute count, the same shape as the `chat` rejection test above.
	 */
	test("one switch change creates exactly one audit row", async () => {
		const before = await auditFor("ops.feature_flag.set", "publish");
		await send("PUT", "/v2/admin/operations/features/publish", ADMIN.cookie, {
			state: "off",
			reason: "maintenance",
		});

		const after = await auditFor("ops.feature_flag.set", "publish");
		expect(after).toHaveLength(before.length + 1);
		const seen = new Set(before.map((row) => row.id));
		const rows = after.filter((row) => !seen.has(row.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.operator).toBe(ADMIN.memberId);
		expect(rows[0]?.target_type).toBe("feature_flag");
		expect(rows[0]?.metadata).toMatchObject({
			reason: "maintenance",
			previousState: "default",
			nextState: "off",
		});
	});

	test("sending an announcement leaves only the count and the reason", async () => {
		/** Measured as an increase: a reused database keeps the previous run's broadcast rows. */
		const before = await auditFor("admin.app-update.broadcast", "ios");
		await send("PUT", "/v2/admin/operations/app-versions/ios", ADMIN.cookie, {
			minVersion: "1.4.0",
			reason: "Test",
		});
		await send(
			"POST",
			"/v2/admin/operations/app-versions/ios/notice",
			ADMIN.cookie,
			{ reason: "forced release notice" },
		);

		const seen = new Set(before.map((row) => row.id));
		const rows = (await auditFor("admin.app-update.broadcast", "ios")).filter(
			(row) => !seen.has(row.id),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.operator).toBe(ADMIN.memberId);
		expect(rows[0]?.target_type).toBe("app_version_floor");
		expect(rows[0]?.metadata).toMatchObject({
			reason: "forced release notice",
			platform: "ios",
			appVersion: "1.4.0",
		});
		/**
		 * The roster is not in the audit: several operators read this record, so recipient ids or emails
		 * there would themselves be a leak path.
		 */
		const metadata = rows[0]?.metadata as Record<string, unknown>;
		expect(Object.keys(metadata).sort()).toEqual(
			["appVersion", "notified", "platform", "reason"].sort(),
		);

		await deleteOwnAppUpdateNotices();
	});

	test("a version floor change keeps the previous value too", async () => {
		/** Measured as an increase, like the switch test above: the audit table is append-only. */
		const before = await auditFor("ops.version_floor.set", "android");
		await send(
			"PUT",
			"/v2/admin/operations/app-versions/android",
			ADMIN.cookie,
			{ minVersion: "2.0.0", reason: "security patch" },
		);
		await send(
			"PUT",
			"/v2/admin/operations/app-versions/android",
			ADMIN.cookie,
			{ minVersion: "2.1.0", reason: "follow-up patch" },
		);

		const seen = new Set(before.map((row) => row.id));
		const rows = (await auditFor("ops.version_floor.set", "android")).filter(
			(row) => !seen.has(row.id),
		);
		expect(rows).toHaveLength(2);
		const latest = rows.sort(
			(a, b) => b.created_at.getTime() - a.created_at.getTime(),
		)[0];
		/**
		 * Without the previous value the audit only says "someone changed it to 2.1.0". Incident response
		 * needs what it was, and without it there is nowhere to roll back to.
		 */
		expect(latest?.metadata).toMatchObject({
			previousMinVersion: "2.0.0",
			nextMinVersion: "2.1.0",
		});
	});

	/**
	 * A failed change creates no audit row.
	 *
	 * This is the observable half of "the settings write and the audit share one transaction". The
	 * other half (audit failure rolls the setting back) needs a broken DB to observe, so it is not
	 * covered here; the type of `recordAudit` requiring `Tx` enforces the rule.
	 */
	test("a refused change leaves no audit row", async () => {
		/**
		 * Compares before and after rather than counting absolutes.
		 *
		 * The audit table is append-only so `beforeEach` does not clear it (clearing would violate the
		 * property under test). Earlier tests in this file already left rows, and an absolute count fails
		 * because of them; this was written that way once and caught. "Did not grow" is the exact form of
		 * the fact this test states.
		 */
		const before = (await auditFor("ops.feature_flag.set", "chat")).length;

		const response = await send(
			"PUT",
			"/v2/admin/operations/features/chat",
			STAFF.cookie,
			{ state: "off", reason: "unauthorized attempt" },
		);
		expect(response.status).toBe(403);

		expect(await auditFor("ops.feature_flag.set", "chat")).toHaveLength(before);
	});

	/**
	 * No secret reaches the metadata.
	 *
	 * Serializes every audit row this file created and scans it whole. Checking fields one by one
	 * misses the check when a new operation is added; a whole scan catches whatever grows.
	 */
	test("audit metadata has no secrets", async () => {
		await send("PUT", "/v2/admin/operations/features/chat", ADMIN.cookie, {
			state: "off",
			reason: "Test",
		});

		const rows = await db
			.select()
			.from(admin_audit_log)
			.where(inArray(admin_audit_log.operator, CREATED_MEMBERS));
		expect(rows.length).toBeGreaterThan(0);

		const serialized = JSON.stringify(rows.map((r) => r.metadata));
		for (const forbidden of [
			TEST_PASSWORD,
			"password",
			"secret",
			"token",
			"cookie",
			"session",
			"@example.test",
		])
			expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
	});

	test("the audit query is newest-first and narrows by action prefix", async () => {
		await send("PUT", "/v2/admin/operations/features/chat", ADMIN.cookie, {
			state: "off",
			reason: "first",
		});
		await send("PUT", "/v2/admin/operations/app-versions/ios", ADMIN.cookie, {
			minVersion: "3.0.0",
			reason: "second",
		});

		const response = await get(
			"/v2/admin/audit?action=ops.version_floor",
			STAFF.cookie,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			items: { action: string; operatorNickname: string | null }[];
		};
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.items.every((i) => i.action === "ops.version_floor.set")).toBe(
			true,
		);
		/** The nickname arrives by join, observing the rule that rows do not snapshot it. */
		expect(body.items[0]?.operatorNickname).toBe("operations console test");
	});

	/**
	 * The audit record has no write surface.
	 *
	 * "Append-only" exists only as the absence of code, so that absence is observed here: with no
	 * route the answer is a 404.
	 */
	test.each([
		["DELETE", "/v2/admin/audit"],
		["PATCH", "/v2/admin/audit"],
	])("the audit record has no %s surface", async (method, path) => {
		const response = await app.request(path, {
			method,
			headers: headers(ADMIN.cookie),
		});
		expect(response.status).toBe(404);
	});
});

/* 6. Projection boundary */

describe.skipIf(!databaseReady)("projection boundary", () => {
	/**
	 * Counts the response's key set.
	 *
	 * `not.toHaveProperty("passwordHash")` only blocks fields known today and lets new values leak
	 * when a member column is added or the projection is reused. `/me/stories` guards its playback
	 * payload the same way.
	 */
	test("the member detail's key set is fixed", async () => {
		const response = await get(
			`/v2/admin/members/${USER.memberId}`,
			STAFF.cookie,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;

		expect(Object.keys(body).sort()).toEqual([
			"operator",
			"profile",
			"recentActions",
			"restrictions",
		]);
		expect(Object.keys(body.profile as object).sort()).toEqual([
			"avatarUrl",
			"bio",
			"followers",
			"id",
			"nickname",
			"stories",
		]);
		expect(Object.keys(body.operator as object).sort()).toEqual([
			"adult",
			"ageStatus",
			"createdAt",
			"email",
			"managedGenerationAllowed",
			"role",
			"showAdult",
			"status",
			"verified",
		]);
	});

	/** The list carries no email; it appears only when opening one member's detail. */
	test("the member list has no email", async () => {
		const response = await get("/v2/admin/members", STAFF.cookie);
		const body = (await response.json()) as {
			items: Record<string, unknown>[];
		};
		expect(body.items.length).toBeGreaterThan(0);
		for (const item of body.items)
			expect(Object.keys(item).sort()).toEqual([
				"activeRestrictions",
				"ageStatus",
				"createdAt",
				"id",
				"nickname",
				"role",
				"status",
			]);
	});

	/**
	 * The story list carries no playback payload.
	 *
	 * Operator access is not grounds to open authored content. A string that must never appear is
	 * seeded and the whole response is scanned; counting keys alone would miss nested values leaking.
	 */
	test("the story list and detail carry no authored content", async () => {
		const creator = await signUp();
		const storyId = newId();
		const SECRET = "a-scenario-that-must-never-appear-in-a-response";
		await db.insert(story).values({
			id: storyId,
			owner: creator.memberId,
			title: "Projection test",
			visibility: "private",
			origin_draft_id: newId(),
			play_payload: { version: 1, storyId, scenario: SECRET },
		});

		const list = await get("/v2/admin/stories?q=Projection test", STAFF.cookie);
		expect(await list.text()).not.toContain(SECRET);

		const detail = await get(`/v2/admin/stories/${storyId}`, STAFF.cookie);
		expect(detail.status).toBe(200);
		const text = await detail.text();
		expect(text).not.toContain(SECRET);

		const body = JSON.parse(text) as { story: Record<string, unknown> };
		/** Unlike the owner's view, private is visible here; that is the resource's definition. */
		expect(body.story).toMatchObject({ id: storyId, visibility: "private" });
	});

	/** A missing member and a deleted member are the same 404; distinguishing them would make an existence probe. */
	test("an unknown member is 404", async () => {
		const response = await get(`/v2/admin/members/${newId()}`, STAFF.cookie);
		expect(response.status).toBe(404);
	});
});

/* 9. Manual adult eligibility */

/**
 * This block catches four things.
 *
 * 1. The door is admin. If staff could open it, this operation would open a legal requirement
 *    (identity verification and age 19+) with lookup permission.
 * 2. Some combinations are not expressible. Adult eligibility without verification commits by no
 *    path, and a rejected request does not half-move the member row.
 * 3. Children are not granted, but revocation stays open. The rule that age dominates the three
 *    adult axes must actually pass through the route.
 * 4. `show_adult` is untouched. If this flipped a member's own choice, they would see a screen
 *    they never chose.
 */
describe.skipIf(!databaseReady)("adult eligibility", () => {
	const setAxes = (
		memberId: string,
		body: unknown,
		cookie: string | null = ADMIN.cookie,
	) =>
		send(
			"POST",
			`/v2/admin/members/${memberId}/adult-verification`,
			cookie,
			body,
		);

	const axesOf = async (memberId: string) => {
		const [row] = await db
			.select({
				verified: member.verified,
				adult: member.adult,
				showAdult: member.show_adult,
			})
			.from(member)
			.where(eq(member.id, memberId));
		return row;
	};

	test("guests, regular members and staff are blocked", async () => {
		const target = await signUp();
		const body = { verified: true, adult: true, reason: "Test" };

		expect((await setAxes(target.memberId, body, GUEST)).status).toBe(401);
		expect((await setAxes(target.memberId, body, USER.cookie)).status).toBe(
			403,
		);
		expect((await setAxes(target.memberId, body, STAFF.cookie)).status).toBe(
			403,
		);
		expect(await axesOf(target.memberId)).toMatchObject({
			verified: false,
			adult: false,
		});
	});

	test("an admin turns on both axes together", async () => {
		const target = await signUp();
		const response = await setAxes(target.memberId, {
			verified: true,
			adult: true,
			reason: "manual verification during a verification provider outage",
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toMatchObject({
			memberId: target.memberId,
			verified: true,
			adult: true,
			changed: true,
		});
		expect(await axesOf(target.memberId)).toMatchObject({
			verified: true,
			adult: true,
		});
	});

	/** The response key set is fixed; reason, operator and age band do not leak. */
	test("the response's key set is fixed", async () => {
		const target = await signUp();
		const response = await setAxes(target.memberId, {
			verified: true,
			adult: false,
			reason: "Test",
		});
		const body = (await response.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(
			["adult", "changed", "memberId", "showAdult", "verified"].sort(),
		);
	});

	/**
	 * Adult eligibility without verification is not expressible. The contract's `refine` blocks it,
	 * and the rejection does not half-move the member row.
	 */
	test("adult eligibility without identity verification is refused and nothing changes", async () => {
		const target = await signUp();
		const response = await setAxes(target.memberId, {
			verified: false,
			adult: true,
			reason: "invalid combination",
		});

		expect(response.status).toBe(400);
		expect(await axesOf(target.memberId)).toMatchObject({
			verified: false,
			adult: false,
		});
	});

	/**
	 * Age dominates the three adult axes. Revocation stays open on child accounts: there is no reason
	 * to carve an exception for an operation that reduces eligibility.
	 */
	test("it is never granted to a child, but it can be revoked", async () => {
		const target = await signUp();
		await db
			.update(member)
			.set({ age_status: "child", verified: true, adult: true })
			.where(eq(member.id, target.memberId));

		const granted = await setAxes(target.memberId, {
			verified: true,
			adult: true,
			reason: "attempt to grant to a child",
		});
		expect(granted.status).toBe(403);
		expect(((await granted.json()) as { code: string }).code).toBe(
			"minor_adult_restricted",
		);

		const revoked = await setAxes(target.memberId, {
			verified: false,
			adult: false,
			reason: "revoking a child account's eligibility",
		});
		expect(revoked.status).toBe(200);
		expect(await axesOf(target.memberId)).toMatchObject({
			verified: false,
			adult: false,
		});
	});

	/**
	 * The display opt-in is the member's own value and survives revocation. Without eligibility it
	 * opens nothing even when true, so there is no reason to clear it, and clearing would erase the
	 * person's choice once they re-verify normally.
	 */
	test("does not touch show_adult", async () => {
		const target = await signUp();
		await db
			.update(member)
			.set({ verified: true, adult: true, show_adult: true })
			.where(eq(member.id, target.memberId));

		const response = await setAxes(target.memberId, {
			verified: false,
			adult: false,
			reason: "revoking eligibility",
		});

		expect(((await response.json()) as { showAdult: boolean }).showAdult).toBe(
			true,
		);
		expect(await axesOf(target.memberId)).toMatchObject({
			verified: false,
			adult: false,
			showAdult: true,
		});
	});

	/** A target state is naturally idempotent: a repeat is not a failure but `changed: false`. */
	test("a repeat request for the same state succeeds and does not move the member row", async () => {
		const target = await signUp();
		const body = { verified: true, adult: true, reason: "manual verification" };

		await setAxes(target.memberId, body);
		const again = await setAxes(target.memberId, body);

		expect(again.status).toBe(200);
		expect(((await again.json()) as { changed: boolean }).changed).toBe(false);
	});

	test("an unknown member is 404", async () => {
		const response = await setAxes(newId(), {
			verified: true,
			adult: true,
			reason: "Test",
		});
		expect(response.status).toBe(404);
	});

	/**
	 * The audit carries both the previous and next state. With only the next state the row cannot say
	 * "from what to what", leaving just the result and no sense of the operation's size.
	 */
	test("the audit keeps the previous and next state and the reason", async () => {
		const target = await signUp();
		await setAxes(target.memberId, {
			verified: true,
			adult: true,
			reason: "verification provider outage",
		});

		const rows = await db
			.select()
			.from(admin_audit_log)
			.where(eq(admin_audit_log.target_id, target.memberId))
			.then((all) =>
				all.filter((r) => r.action === "admin.member.adult_verification"),
			);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.operator).toBe(ADMIN.memberId);
		expect(rows[0]?.target_type).toBe("member");
		expect(rows[0]?.metadata).toEqual({
			reason: "verification provider outage",
			before: { verified: false, adult: false },
			after: { verified: true, adult: true },
			changed: true,
		});
	});

	/** The gate stands before the service, so unauthorized attempts do not accumulate in the audit. */
	test("an unauthorized attempt leaves no audit row", async () => {
		const target = await signUp();
		await setAxes(
			target.memberId,
			{ verified: true, adult: true, reason: "unauthorized attempt" },
			STAFF.cookie,
		);

		const rows = await db
			.select()
			.from(admin_audit_log)
			.where(eq(admin_audit_log.target_id, target.memberId));
		expect(rows).toEqual([]);
	});
});

/* 10. Managed-generation allowlist */

describe.skipIf(!databaseReady)("managed generation allowlist", () => {
	const setAllowed = (
		memberId: string,
		body: unknown,
		cookie: string | null = ADMIN.cookie,
	) =>
		send(
			"POST",
			`/v2/admin/members/${memberId}/managed-generation`,
			cookie,
			body,
		);

	const allowedOf = async (memberId: string) => {
		const [row] = await db
			.select({ allowed: member.managed_generation_allowed })
			.from(member)
			.where(eq(member.id, memberId));
		return row?.allowed;
	};

	test("guests, regular members and staff are blocked", async () => {
		const body = { allowed: true, reason: "request" };
		expect((await setAllowed(USER.memberId, body, GUEST)).status).toBe(401);
		expect((await setAllowed(USER.memberId, body, USER.cookie)).status).toBe(
			403,
		);
		expect((await setAllowed(USER.memberId, body, STAFF.cookie)).status).toBe(
			403,
		);
		expect(await allowedOf(USER.memberId)).toBe(false);
	});

	test("an admin turns it on and off, and the detail answers with that value as is", async () => {
		const target = await signUp();
		const on = await setAllowed(target.memberId, {
			allowed: true,
			reason: "beta tester",
		});
		expect(on.status).toBe(200);
		expect(await on.json()).toEqual({
			memberId: target.memberId,
			allowed: true,
			changed: true,
		});
		const detail = (await (
			await get(`/v2/admin/members/${target.memberId}`, ADMIN.cookie)
		).json()) as { operator: { managedGenerationAllowed: boolean } };
		expect(detail.operator.managedGenerationAllowed).toBe(true);

		const again = await setAllowed(target.memberId, {
			allowed: true,
			reason: "repeat request",
		});
		expect(((await again.json()) as { changed: boolean }).changed).toBe(false);

		await setAllowed(target.memberId, { allowed: false, reason: "ended" });
		expect(await allowedOf(target.memberId)).toBe(false);
	});

	test("a missing reason or an unknown field is a 400", async () => {
		expect(
			(await setAllowed(USER.memberId, { allowed: true, reason: "" })).status,
		).toBe(400);
		expect(
			(
				await setAllowed(USER.memberId, {
					allowed: true,
					reason: "request",
					everyone: true,
				})
			).status,
		).toBe(400);
	});

	test("an unknown member is 404", async () => {
		expect(
			(await setAllowed(newId(), { allowed: true, reason: "request" })).status,
		).toBe(404);
	});

	test("the audit keeps the previous and next value and the reason", async () => {
		const target = await signUp();
		await setAllowed(target.memberId, { allowed: true, reason: "beta" });
		const rows = await db
			.select()
			.from(admin_audit_log)
			.where(
				and(
					eq(admin_audit_log.target_id, target.memberId),
					eq(admin_audit_log.action, "admin.member.managed_generation.set"),
				),
			);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.metadata).toMatchObject({
			reason: "beta",
			before: false,
			after: true,
			changed: true,
		});
	});
});
