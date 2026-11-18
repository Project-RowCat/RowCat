import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEVICE_APPROVAL_PAGE_PATH,
	MCP_DEVICE_CLIENT_ID,
} from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import { faceForFailure, faceForRead } from "./device-approval.ts";

const CODE = "ABCDEFGH";

/**
 * The server builds the address the tool prints from the contract's path; the file route has to be a
 * literal for the generator, so the two are held together here. Moved apart, every approval link
 * lands on "not found" and nothing else fails.
 */
test("the page sits where the server sends people", () => {
	const here = fileURLToPath(new URL(".", import.meta.url));
	const route = readFileSync(join(here, "../../routes/device.tsx"), "utf8");
	expect(route).toContain(`createFileRoute("${DEVICE_APPROVAL_PAGE_PATH}")`);
});

describe("the face for what the read answered", () => {
	test("a pending request this account holds, from the tool the page knows, is reviewed", () => {
		expect(
			faceForRead(CODE, { status: "pending", client_id: MCP_DEVICE_CLIENT_ID }),
		).toEqual({ kind: "review", userCode: CODE });
	});

	/** The server answers the client only to the account that opened the request first. */
	test("no client in the answer is another account's request", () => {
		expect(faceForRead(CODE, { status: "pending" })).toEqual({
			kind: "other-account",
		});
	});

	/** A blank name on an approve button is the shape a phishing link wants. */
	test("a client the page cannot name is not offered for approval", () => {
		expect(
			faceForRead(CODE, { status: "pending", client_id: "something-else" }),
		).toEqual({ kind: "invalid" });
	});

	test("opened again after it was answered", () => {
		expect(faceForRead(CODE, { status: "approved" })).toEqual({
			kind: "answered",
		});
		expect(faceForRead(CODE, { status: "denied" })).toEqual({
			kind: "answered",
		});
	});

	test("anything else is not a request this page can answer", () => {
		expect(faceForRead(CODE, {})).toEqual({ kind: "invalid" });
		expect(faceForRead(CODE, { status: "unexpected" })).toEqual({
			kind: "invalid",
		});
	});
});

describe("the face for a refusal", () => {
	test("no answer at all is a connection failure, kept retryable", () => {
		expect(faceForFailure(CODE, null)).toEqual({
			kind: "failed",
			userCode: CODE,
			reason: "network",
		});
		expect(faceForFailure(CODE, { status: 0 })).toMatchObject({
			reason: "network",
		});
	});

	test("an old sign-in, or none, asks for a new one and keeps the code", () => {
		expect(
			faceForFailure(CODE, { status: 403, code: "SESSION_NOT_FRESH" }),
		).toEqual({ kind: "recent-login", userCode: CODE });
		expect(faceForFailure(CODE, { status: 401 })).toEqual({
			kind: "recent-login",
			userCode: CODE,
		});
	});

	test("the read's rate limit is said as such", () => {
		expect(faceForFailure(CODE, { status: 429 })).toMatchObject({
			kind: "failed",
			reason: "rate-limited",
		});
	});

	test("the library refusing this account is another account's request", () => {
		expect(
			faceForFailure(CODE, { status: 403, error: "access_denied" }),
		).toEqual({ kind: "other-account" });
	});

	test("unknown, expired or already answered all start again from the terminal", () => {
		expect(
			faceForFailure(CODE, { status: 400, error: "invalid_request" }),
		).toEqual({ kind: "invalid" });
		expect(
			faceForFailure(CODE, { status: 400, error: "expired_token" }),
		).toEqual({ kind: "invalid" });
	});

	test("anything else is a failure the person may retry", () => {
		expect(faceForFailure(CODE, { status: 500 })).toMatchObject({
			kind: "failed",
			reason: "unknown",
		});
	});
});
