import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [] as Record<string, unknown>[],
	checkRateLimit: vi.fn(async () => undefined),
	resolveVerifier: vi.fn(),
	verify: vi.fn(),
}));

vi.mock("../db/client.ts", () => {
	const chain = {
		from: () => chain,
		where: () => chain,
		limit: async () => state.rows,
	};
	return { db: { select: () => chain } };
});

vi.mock("../lib/rate-limit/index.ts", () => ({
	checkRateLimit: state.checkRateLimit,
}));

vi.mock("./identity/provider.ts", () => ({
	resolveIdentityVerifier: state.resolveVerifier,
}));

import { submitGuardianVerification } from "./guardian.ts";

const row = (token: string, verificationRef: string | null) => ({
	id: "consent-row-id",
	memberId: "member-id",
	status: "pending",
	tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
	expiresAt: new Date(Date.now() + 60_000),
	verificationRef,
});

describe("validation order of the guardian verification rate limit", () => {
	beforeEach(() => {
		state.rows = [];
		state.checkRateLimit.mockClear();
		state.resolveVerifier.mockReset();
		state.verify.mockReset();
		state.resolveVerifier.mockReturnValue({
			name: "test",
			begin: vi.fn(),
			verify: state.verify,
		});
	});

	test("an unknown token is a 404 before reaching the counter and the provider", async () => {
		await expect(
			submitGuardianVerification({ token: "not-a-real-token" }),
		).rejects.toMatchObject({ status: 404 });
		expect(state.checkRateLimit).not.toHaveBeenCalled();
		expect(state.resolveVerifier).not.toHaveBeenCalled();
		expect(state.verify).not.toHaveBeenCalled();
	});

	test("a valid request that wasn't started doesn't spend the external call budget either", async () => {
		const token = "valid-token";
		state.rows = [row(token, null)];
		await expect(submitGuardianVerification({ token })).rejects.toMatchObject({
			status: 400,
		});
		expect(state.checkRateLimit).not.toHaveBeenCalled();
		expect(state.resolveVerifier).not.toHaveBeenCalled();
	});

	test("calls the provider only after counting the validated request id", async () => {
		const token = "valid-token";
		state.rows = [row(token, "provider-reference")];
		state.verify.mockResolvedValue({ verified: false, reason: "failed" });

		await expect(submitGuardianVerification({ token })).rejects.toMatchObject({
			status: 400,
		});
		expect(state.checkRateLimit).toHaveBeenCalledWith(
			"guardianVerify",
			"consent-row-id",
		);
		expect(state.verify).toHaveBeenCalledWith({
			requestId: "consent-row-id",
			reference: "provider-reference",
		});
		expect(state.checkRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
			state.verify.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
	});
});
