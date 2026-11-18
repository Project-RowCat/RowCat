import { describe, expect, test } from "vitest";
import {
	DEVICE_USER_CODE_ALPHABET,
	DEVICE_USER_CODE_LENGTH,
	DeviceCodeRequest,
	DeviceCodeResponse,
	deviceUserCodeFrom,
	formatDeviceUserCode,
	MCP_DEVICE_CLIENT_ID,
} from "./device-authorization.ts";

describe("the user code a person compares", () => {
	test("the alphabet has no look-alikes and 32 symbols", () => {
		expect(DEVICE_USER_CODE_ALPHABET).toHaveLength(32);
		expect(new Set(DEVICE_USER_CODE_ALPHABET).size).toBe(32);
		for (const lookAlike of ["0", "O", "1", "I"])
			expect(DEVICE_USER_CODE_ALPHABET).not.toContain(lookAlike);
	});

	test("case and separators are forgiven", () => {
		expect(deviceUserCodeFrom("abcd-efgh")).toBe("ABCDEFGH");
		expect(deviceUserCodeFrom(" ABCD EFGH ")).toBe("ABCDEFGH");
		expect(deviceUserCodeFrom("ABCDEFGH")).toBe("ABCDEFGH");
	});

	/** Guessing `O` for `0` would approve a code nobody was shown. */
	test("characters outside the alphabet are not guessed at", () => {
		expect(deviceUserCodeFrom("ABCD-EFG0")).toBeNull();
		expect(deviceUserCodeFrom("ABCD-EFGI")).toBeNull();
		expect(deviceUserCodeFrom("ABCD-EFG")).toBeNull();
		expect(deviceUserCodeFrom("ABCD-EFGHJ")).toBeNull();
		expect(deviceUserCodeFrom("ABCD/EFGH")).toBeNull();
		expect(deviceUserCodeFrom(undefined)).toBeNull();
		expect(deviceUserCodeFrom(["ABCDEFGH"])).toBeNull();
	});

	test("read as two groups of four, and the grouping folds back", () => {
		const code = "ABCDEFGH";
		expect(code).toHaveLength(DEVICE_USER_CODE_LENGTH);
		expect(formatDeviceUserCode(code)).toBe("ABCD-EFGH");
		expect(deviceUserCodeFrom(formatDeviceUserCode(code))).toBe(code);
	});
});

describe("the request names the client and nothing else", () => {
	test("the one client passes", () => {
		expect(
			DeviceCodeRequest.safeParse({ client_id: MCP_DEVICE_CLIENT_ID }).success,
		).toBe(true);
	});

	test("another client, a pre-bound account or a scope does not", () => {
		expect(DeviceCodeRequest.safeParse({ client_id: "other" }).success).toBe(
			false,
		);
		expect(
			DeviceCodeRequest.safeParse({
				client_id: MCP_DEVICE_CLIENT_ID,
				user_id: "someone",
			}).success,
		).toBe(false);
		expect(
			DeviceCodeRequest.safeParse({
				client_id: MCP_DEVICE_CLIENT_ID,
				scope: "openid",
			}).success,
		).toBe(false);
	});
});

/** The tool may hand `verification_uri_complete` to the operating system's opener. */
test("only http(s) approval addresses are accepted", () => {
	const answer = (uri: string) =>
		DeviceCodeResponse.safeParse({
			device_code: "d",
			user_code: "ABCDEFGH",
			verification_uri: uri,
			verification_uri_complete: uri,
			expires_in: 600,
			interval: 5,
		}).success;
	expect(answer("https://rowcat.example/device")).toBe(true);
	expect(answer("http://localhost:3000/device")).toBe(true);
	expect(answer("file:///etc/passwd")).toBe(false);
	expect(answer("javascript:alert(1)")).toBe(false);
	expect(answer("rowcat://device")).toBe(false);
});
