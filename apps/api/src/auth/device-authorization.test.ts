import {
	DEVICE_APPROVAL_PAGE_PATH,
	DEVICE_USER_CODE_ALPHABET,
	DEVICE_USER_CODE_PARAM,
	DeviceCodeResponse,
	deviceUserCodeFrom,
	MCP_DEVICE_CLIENT_ID,
} from "@rowcat/contracts";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { closeDb, db } from "../db/client.ts";
import { deviceCode, session } from "../db/schema.ts";
import { webOrigin } from "../env.ts";
import { createTestMember, type TestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { api, apiGet, authPost, cookieFromResponse } from "../test/http.ts";
import {
	DEVICE_CODE_TTL_SECONDS,
	deviceAuthorizationPlugin,
	newDeviceUserCode,
} from "./device-authorization.ts";

/**
 * `rowcat-mcp`'s sign-in, end to end through the real app: a code is issued, a signed-in person
 * approves it on the web's endpoints, and the tool's poll comes back with the session **as a signed
 * cookie** — the same credential every other client holds.
 *
 * What these pin is what this server added to the library's grant: the bearer-token endpoint is
 * gone, the request names nothing but the client, and an old session cannot mint a fresh one.
 */

describe("issuance and the readers agree on one alphabet", () => {
	test("every byte lands in the contract's alphabet", () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
		for (let start = 0; start < 256; start += 8) {
			const code = newDeviceUserCode(bytes.subarray(start, start + 8));
			expect(deviceUserCodeFrom(code)).toBe(code);
		}
		expect(newDeviceUserCode(new Uint8Array(8))).toBe(
			DEVICE_USER_CODE_ALPHABET[0]?.repeat(8),
		);
	});

	test("a fresh code is readable back", () => {
		const code = newDeviceUserCode();
		expect(deviceUserCodeFrom(code)).toBe(code);
	});
});

describe("the bearer-token endpoint is gone", () => {
	/**
	 * Proves the removal still removes something: if the library renames that endpoint, the left half
	 * stops holding and this says so before a release mounts a token-in-body door again.
	 */
	test("the library has it, the plugin this server mounts does not", () => {
		expect(Object.keys(deviceAuthorization().endpoints)).toContain(
			"deviceToken",
		);
		const mounted = Object.keys(
			deviceAuthorizationPlugin("http://localhost:3000").endpoints,
		);
		expect(mounted).not.toContain("deviceToken");
		expect(mounted).toEqual(
			expect.arrayContaining([
				"deviceCode",
				"deviceVerify",
				"deviceApprove",
				"deviceDeny",
				"deviceSession",
			]),
		);
	});
});

const EMAIL_PREFIX = "device-auth-test-";
const databaseReady = await connectTestDatabase();

/** Codes this file issued; unclaimed ones belong to no account, so the user cleanup cannot find them. */
const issued: string[] = [];

afterAll(async () => {
	if (databaseReady) {
		if (issued.length > 0)
			await db.delete(deviceCode).where(inArray(deviceCode.deviceCode, issued));
		await deleteTestUsers(EMAIL_PREFIX);
	}
	await closeDb();
});

interface ErrorBody {
	error?: string;
	code?: string;
}

const issue = async (): Promise<DeviceCodeResponse> => {
	const response = await authPost("/device/code", {
		client_id: MCP_DEVICE_CLIENT_ID,
	});
	expect(response.status).toBe(200);
	const body = DeviceCodeResponse.parse(await response.json());
	issued.push(body.device_code);
	return body;
};

const poll = (code: string) =>
	authPost("/device/session", {
		device_code: code,
		client_id: MCP_DEVICE_CLIENT_ID,
	});

/** Polls are spaced by the server (`slow_down`); a test rewinds the clock instead of sleeping. */
const rewindPoll = (code: string) =>
	db
		.update(deviceCode)
		.set({ lastPolledAt: new Date(Date.now() - 60_000) })
		.where(eq(deviceCode.deviceCode, code));

/** What the web page does: read (and so claim) the request, then answer it. */
const openPage = (userCode: string, member: TestMember) =>
	apiGet(
		`/auth/device?${DEVICE_USER_CODE_PARAM}=${encodeURIComponent(userCode)}`,
		member.cookie,
	);
const approve = (userCode: string, member: TestMember) =>
	authPost("/device/approve", { userCode }, member.cookie);
const deny = (userCode: string, member: TestMember) =>
	authPost("/device/deny", { userCode }, member.cookie);

const errorOf = async (response: Response): Promise<ErrorBody> =>
	(await response.json()) as ErrorBody;

describe.skipIf(!databaseReady)("the grant, end to end", () => {
	test("issued, approved on the web, redeemed as a signed cookie that /me answers", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		const request = await issue();

		expect(deviceUserCodeFrom(request.user_code)).toBe(request.user_code);
		expect(request.verification_uri).toBe(
			new URL(DEVICE_APPROVAL_PAGE_PATH, webOrigin).toString(),
		);
		expect(
			new URL(request.verification_uri_complete).searchParams.get(
				DEVICE_USER_CODE_PARAM,
			),
		).toBe(request.user_code);
		expect(request.expires_in).toBe(DEVICE_CODE_TTL_SECONDS);

		const pending = await poll(request.device_code);
		expect(pending.status).toBe(400);
		expect((await errorOf(pending)).error).toBe("authorization_pending");

		const page = await openPage(request.user_code, member);
		expect(page.status).toBe(200);
		expect(await page.json()).toMatchObject({
			status: "pending",
			client_id: MCP_DEVICE_CLIENT_ID,
		});
		expect((await approve(request.user_code, member)).status).toBe(200);

		/** Polling again at once is told to back off — the tool's loop depends on that answer. */
		const eager = await poll(request.device_code);
		expect(eager.status).toBe(400);
		expect((await errorOf(eager)).error).toBe("slow_down");

		await rewindPoll(request.device_code);
		const redeemed = await poll(request.device_code);
		expect(redeemed.status).toBe(200);
		const body = (await redeemed.json()) as Record<string, unknown>;
		expect(body).toEqual({ ok: true });
		const cookie = cookieFromResponse(redeemed);
		expect(cookie).toContain("session_token");

		const viewer = (await (await apiGet("/me", cookie)).json()) as {
			id?: string;
		} | null;
		expect(viewer?.id).toBe(member.memberId);

		/** One request, one session: the row is consumed. */
		await rewindPoll(request.device_code);
		const again = await poll(request.device_code);
		expect(again.status).toBe(400);
		expect((await errorOf(again)).error).toBe("invalid_grant");
	});

	test("a denied request ends the tool's attempt", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		const request = await issue();
		await openPage(request.user_code, member);
		expect((await deny(request.user_code, member)).status).toBe(200);
		const denied = await poll(request.device_code);
		expect(denied.status).toBe(400);
		expect((await errorOf(denied)).error).toBe("access_denied");
		expect(cookieFromResponse(denied)).not.toContain("session_token");
	});

	test("an expired request is refused", async () => {
		const request = await issue();
		await db
			.update(deviceCode)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(deviceCode.deviceCode, request.device_code));
		const expired = await poll(request.device_code);
		expect(expired.status).toBe(400);
		expect((await errorOf(expired)).error).toBe("expired_token");
	});

	/**
	 * The first signed-in account to open the page holds the request; another account sees neither
	 * which tool asked nor a way to answer.
	 */
	test("a request opened by one account cannot be approved by another", async () => {
		const owner = await createTestMember(EMAIL_PREFIX);
		const other = await createTestMember(EMAIL_PREFIX);
		const request = await issue();
		await openPage(request.user_code, owner);
		const seen = (await (
			await openPage(request.user_code, other)
		).json()) as Record<string, unknown>;
		expect(seen.client_id).toBeUndefined();
		expect((await approve(request.user_code, other)).status).toBe(403);
		const still = await poll(request.device_code);
		expect((await errorOf(still)).error).toBe("authorization_pending");
	});
});

describe.skipIf(!databaseReady)("door rules in front of the library", () => {
	test("the request names the client and nothing else", async () => {
		const preBound = await authPost("/device/code", {
			client_id: MCP_DEVICE_CLIENT_ID,
			user_id: "someone-else",
		});
		expect(preBound.status).toBe(400);
		expect((await errorOf(preBound)).error).toBe("invalid_request");

		const scoped = await authPost("/device/code", {
			client_id: MCP_DEVICE_CLIENT_ID,
			scope: "openid",
		});
		expect(scoped.status).toBe(400);

		const stranger = await authPost("/device/code", { client_id: "other" });
		expect(stranger.status).toBe(400);
	});

	test("the bearer-token path answers nothing", async () => {
		const request = await issue();
		const response = await authPost("/device/token", {
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: request.device_code,
			client_id: MCP_DEVICE_CLIENT_ID,
		});
		expect(response.status).toBe(404);
	});

	test("a poll carries the code and the client, nothing else", async () => {
		const request = await issue();
		const response = await authPost("/device/session", {
			device_code: request.device_code,
			client_id: MCP_DEVICE_CLIENT_ID,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		});
		expect(response.status).toBe(400);
		expect((await errorOf(response)).error).toBe("invalid_request");
	});

	/** An old cookie must not be able to mint a fresh session (freshness guards passkey registration). */
	test("approving needs a recent sign-in, and the request survives the refusal", async () => {
		const member = await createTestMember(EMAIL_PREFIX);
		await db
			.update(session)
			.set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
			.where(eq(session.userId, member.authUserId));
		const request = await issue();
		expect((await openPage(request.user_code, member)).status).toBe(200);
		const stale = await approve(request.user_code, member);
		expect(stale.status).toBe(403);
		expect((await errorOf(stale)).code).toBe("SESSION_NOT_FRESH");
		const still = await poll(request.device_code);
		expect((await errorOf(still)).error).toBe("authorization_pending");
	});

	test("a guest cannot approve", async () => {
		const request = await issue();
		const response = await authPost("/device/approve", {
			userCode: request.user_code,
		});
		expect(response.status).toBe(401);
	});
});

/** Kept apart so the path the web calls is pinned by value, not only through the helpers above. */
test.skipIf(!databaseReady)(
	"the page reads through /v2/auth/device",
	async () => {
		const response = await api(
			`/auth/device?${DEVICE_USER_CODE_PARAM}=NOTACODE`,
		);
		expect(response.status).toBe(400);
	},
);
