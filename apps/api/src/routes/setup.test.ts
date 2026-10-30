import { formatSetupCode } from "@rowcat/domain";
import { and, eq } from "drizzle-orm";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { admin_audit_log, deployment_setup, member } from "../db/schema.ts";
import {
	deriveSetupCode,
	prepareDeploymentSetup,
} from "../services/setup/index.ts";
import { createTestMember, type TestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * First-run setup and the admin readiness list.
 *
 * The setup row is one per database, so this file owns it for its duration: the row a developer's
 * database already had is read first and put back at the end, and every test starts from a row it
 * wrote itself with a known salt. Going through `prepareDeploymentSetup` for the open state would
 * make the file depend on whether any admin exists anywhere in the database (the dev account, another
 * suite's leftovers), so that function is exercised only on the branch this file can construct: an
 * admin exists, and setup closes.
 */

const EMAIL_PREFIX = "setup-test-";
const SALT = "setup-test-salt";
const ROW_ID = "deployment";
/**
 * The row is a singleton, so this predicate selects everything the table can hold; it is spelled out
 * because test cleanup never deletes a member-linked table bare (`test/boundaries.test.ts`).
 */
const ownRow = eq(deployment_setup.id, ROW_ID);

const databaseReady = await connectTestDatabase();

type SetupRow = typeof deployment_setup.$inferSelect;
let original: SetupRow | undefined;

const headers = (cookie: string | null, withBody = false) => ({
	...(withBody ? { "Content-Type": "application/json" } : {}),
	Origin: WEB_ORIGIN,
	...(cookie ? { Cookie: cookie } : {}),
});

const get = (path: string, cookie: string | null) =>
	app.request(path, { headers: headers(cookie) });

const claim = (cookie: string | null, code: unknown) =>
	app.request("/v2/setup/claim", {
		method: "POST",
		headers: headers(cookie, true),
		body: JSON.stringify({ code }),
	});

const codeOf = async (response: Response) =>
	((await response.json()) as { code: string }).code;

const signUp = (): Promise<TestMember> =>
	createTestMember(EMAIL_PREFIX, { name: "setup test" });

const roleOf = async (memberId: string) =>
	(
		await db
			.select({ role: member.role })
			.from(member)
			.where(eq(member.id, memberId))
	)[0]?.role;

async function openSetup(): Promise<void> {
	await db.delete(deployment_setup).where(ownRow);
	await db.insert(deployment_setup).values({ id: ROW_ID, salt: SALT });
}

beforeAll(async () => {
	if (!databaseReady) return;
	[original] = await db.select().from(deployment_setup);
});

beforeEach(async () => {
	if (databaseReady) await openSetup();
});

afterAll(async () => {
	if (databaseReady) {
		await db.delete(deployment_setup).where(ownRow);
		/** Restored before the members go, so `completed_by` is still valid if it pointed at one of them. */
		if (original) await db.insert(deployment_setup).values(original);
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

describe.skipIf(!databaseReady)("first-run setup — status", () => {
	test("open while the row is not completed, closed after", async () => {
		const open = await get("/v2/setup", null);
		expect(open.status).toBe(200);
		expect(await open.json()).toEqual({ open: true });
		/** Changes once, in one request; a shared cache holding `open: true` would draw a form that can only fail. */
		expect(open.headers.get("cache-control")).toBe("private, no-cache");

		await db
			.update(deployment_setup)
			.set({ completed_at: new Date() })
			.where(eq(deployment_setup.id, ROW_ID));
		expect(await (await get("/v2/setup", null)).json()).toEqual({
			open: false,
		});
	});

	test("no row reads as closed — there is no code anyone could hold", async () => {
		await db.delete(deployment_setup).where(ownRow);
		expect(await (await get("/v2/setup", null)).json()).toEqual({
			open: false,
		});
	});

	test("boot closes setup when an admin already exists", async () => {
		const admin = await signUp();
		await db
			.update(member)
			.set({ role: "admin" })
			.where(eq(member.id, admin.memberId));

		expect(await prepareDeploymentSetup()).toEqual({ open: false });
		const [row] = await db.select().from(deployment_setup);
		expect(row?.completed_at).not.toBeNull();
		expect(row?.completed_by).toBeNull();
	});

	test("boot creates the row once and keeps its salt", async () => {
		await db.delete(deployment_setup).where(ownRow);
		await prepareDeploymentSetup();
		const [first] = await db.select().from(deployment_setup);
		await prepareDeploymentSetup();
		const [second] = await db.select().from(deployment_setup);
		expect(first?.salt).toBeTruthy();
		expect(second?.salt).toBe(first?.salt);
	});
});

describe.skipIf(!databaseReady)("first-run setup — claim", () => {
	test("a guest is asked to sign in", async () => {
		const response = await claim(null, deriveSetupCode(SALT));
		expect(response.status).toBe(401);
	});

	test("a wrong code changes nothing", async () => {
		const someone = await signUp();
		const response = await claim(someone.cookie, "0000-0000-0000");
		expect(response.status).toBe(403);
		expect(await codeOf(response)).toBe("setup_code_invalid");
		expect(await roleOf(someone.memberId)).toBe("user");
		expect(await (await get("/v2/setup", null)).json()).toEqual({
			open: true,
		});
	});

	test("a code that cannot be one is refused the same way", async () => {
		const someone = await signUp();
		const response = await claim(someone.cookie, "not a code");
		expect(response.status).toBe(403);
		expect(await codeOf(response)).toBe("setup_code_invalid");
	});

	test("the body takes the code alone", async () => {
		const someone = await signUp();
		const response = await app.request("/v2/setup/claim", {
			method: "POST",
			headers: headers(someone.cookie, true),
			body: JSON.stringify({
				code: deriveSetupCode(SALT),
				role: "admin",
				memberId: "someone-else",
			}),
		});
		expect(response.status).toBe(400);
		expect(await roleOf(someone.memberId)).toBe("user");
	});

	test("the right code makes the caller admin, once", async () => {
		const first = await signUp();
		/** Typed the way a person copies it: printed form, lower case. */
		const typed = formatSetupCode(deriveSetupCode(SALT)).toLowerCase();

		const response = await claim(first.cookie, typed);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ memberId: first.memberId });
		expect(await roleOf(first.memberId)).toBe("admin");

		const [row] = await db.select().from(deployment_setup);
		expect(row?.completed_at).not.toBeNull();
		expect(row?.completed_by).toBe(first.memberId);

		const audit = await db
			.select({ metadata: admin_audit_log.metadata })
			.from(admin_audit_log)
			.where(
				and(
					eq(admin_audit_log.operator, first.memberId),
					eq(admin_audit_log.action, "admin.setup.claim"),
				),
			);
		expect(audit).toHaveLength(1);
		expect(audit[0]?.metadata).toEqual({ before: "user", after: "admin" });

		/** The same code, a second member: closed, and the second member stays a member. */
		const second = await signUp();
		const again = await claim(second.cookie, typed);
		expect(again.status).toBe(409);
		expect(await codeOf(again)).toBe("setup_closed");
		expect(await roleOf(second.memberId)).toBe("user");
	});

	test("a restricted account cannot claim", async () => {
		const restricted = await signUp();
		await db
			.update(member)
			.set({ status: "suspended" })
			.where(eq(member.id, restricted.memberId));
		const response = await claim(restricted.cookie, deriveSetupCode(SALT));
		expect(response.status).toBe(403);
		expect(await codeOf(response)).toBe("account_restricted");
		expect(await roleOf(restricted.memberId)).toBe("user");
	});

	test("attempts are rate limited per member", async () => {
		const guesser = await signUp();
		for (let i = 0; i < 10; i++)
			expect((await claim(guesser.cookie, "0000-0000-0000")).status).toBe(403);
		const limited = await claim(guesser.cookie, deriveSetupCode(SALT));
		expect(limited.status).toBe(429);
		expect(await codeOf(limited)).toBe("setup_rate_limited");
		expect(await roleOf(guesser.memberId)).toBe("user");
	});
});

describe.skipIf(!databaseReady)("deployment readiness", () => {
	const PATH = "/v2/admin/deployment/readiness";

	test("admin only", async () => {
		expect((await get(PATH, null)).status).toBe(401);

		const user = await signUp();
		expect((await get(PATH, user.cookie)).status).toBe(403);

		const staff = await signUp();
		await db
			.update(member)
			.set({ role: "staff" })
			.where(eq(member.id, staff.memberId));
		const refused = await get(PATH, staff.cookie);
		expect(refused.status).toBe(403);
		expect(await codeOf(refused)).toBe("admin_required");
	});

	test("states and variable names only — no values", async () => {
		const admin = await signUp();
		await db
			.update(member)
			.set({ role: "admin" })
			.where(eq(member.id, admin.memberId));

		const response = await get(PATH, admin.cookie);
		expect(response.status).toBe(200);
		const text = await response.text();
		const body = JSON.parse(text) as {
			mode: string;
			capabilities: Record<string, unknown>[];
		};

		expect(Object.keys(body).sort()).toEqual(["capabilities", "mode"]);
		expect(body.capabilities.length).toBeGreaterThan(10);
		for (const capability of body.capabilities) {
			expect(Object.keys(capability).sort()).toEqual([
				"blocksRelease",
				"group",
				"id",
				"label",
				"status",
				"variables",
			]);
			expect(
				(capability.variables as string[]).length,
				String(capability.id),
			).toBeGreaterThan(0);
		}

		/** The values the doctor's `summary`/`detail` would have carried. */
		for (const value of [
			process.env.DATABASE_URL,
			process.env.BETTER_AUTH_SECRET,
			process.env.API_ORIGIN,
		])
			if (value) expect(text).not.toContain(value);
	});
});
