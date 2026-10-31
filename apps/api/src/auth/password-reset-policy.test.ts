import { describe, expect, test } from "vitest";
import {
	enforcePasswordResetTarget,
	isWebTarget,
} from "./password-reset-policy.ts";

describe("a reset target", () => {
	test.each([
		undefined,
		"",
		"https://app.example.com/reset-password",
		"http://localhost:3000/reset-password?redirect=%2Fchats",
		"/reset-password",
	])("%s passes to the library's own check", (target) => {
		expect(isWebTarget(target)).toBe(true);
	});

	test.each([
		"rowcat://steal",
		"rowcat:///reset-password",
		"rowcat:steal",
		"ROWCAT://steal",
		"  rowcat://steal",
		"exp://192.168.0.2:8081",
		"javascript:alert(1)",
		"data:text/html,x",
		42,
	])("%s is refused", (target) => {
		expect(isWebTarget(target)).toBe(false);
	});
});

describe("the two reset doors", () => {
	test("the request refuses a native redirectTo", () => {
		expect(() =>
			enforcePasswordResetTarget({
				path: "/request-password-reset",
				body: { email: "a@example.test", redirectTo: "rowcat://steal" },
			}),
		).toThrow();
	});

	test("the link refuses a native callbackURL", () => {
		expect(() =>
			enforcePasswordResetTarget({
				path: "/reset-password/:token",
				query: { callbackURL: "rowcat://steal" },
			}),
		).toThrow();
	});

	test("other paths are not this rule's business", () => {
		expect(() =>
			enforcePasswordResetTarget({
				path: "/sign-in/social",
				body: { callbackURL: "rowcat://callback" },
			}),
		).not.toThrow();
		expect(() =>
			enforcePasswordResetTarget({
				path: "/reset-password",
				body: { token: "t", newPassword: "x" },
			}),
		).not.toThrow();
	});
});
