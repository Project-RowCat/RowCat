import { randomBytes } from "node:crypto";
import {
	APP_SESSION_HANDOFF_BINDING_PARAM,
	APP_SESSION_HANDOFF_CODE_PARAM,
	AppSessionHandoffToken,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	base64url,
	handoffBindingOf,
	handoffCodeFrom,
	newHandoffVerifier,
	withHandoffBinding,
} from "./app-session-handoff.ts";

/**
 * The app's half of the browser sign-in hand-off. The binding must be the server's derivation byte
 * for byte, or every redeem fails — and that failure would read as "sign-in didn't complete", with
 * nothing pointing at the cause. The vector below is pinned in the server's test too
 * (`apps/api/src/auth/app-session-handoff.test.ts`).
 */

const VERIFIER = "rowcat-handoff-vector-000000000000000000000";
const BINDING = "kVe-8O8aO_XML_891NDAxPQetGGbese5IqpcOZvaeys";

describe("derivations", () => {
	it("base64url matches the platform encoder for every tail length", () => {
		for (let length = 0; length < 40; length++) {
			const bytes = randomBytes(length);
			expect(base64url(bytes)).toBe(bytes.toString("base64url"));
		}
	});

	it("the binding is the shared vector", () => {
		expect(handoffBindingOf(VERIFIER)).toBe(BINDING);
	});

	it("a verifier is 32 bytes in the contract's token shape, fresh each time", () => {
		const one = newHandoffVerifier();
		const two = newHandoffVerifier();
		expect(AppSessionHandoffToken.safeParse(one).success).toBe(true);
		expect(
			AppSessionHandoffToken.safeParse(handoffBindingOf(one)).success,
		).toBe(true);
		expect(one).not.toBe(two);
	});
});

describe("URLs", () => {
	it("the binding rides the callback without disturbing its own query", () => {
		const url = new URL(
			withHandoffBinding("rowcat:///account?email=changed", BINDING),
		);
		expect(url.searchParams.get(APP_SESSION_HANDOFF_BINDING_PARAM)).toBe(
			BINDING,
		);
		expect(url.searchParams.get("email")).toBe("changed");
	});

	it("reads the code off the redirect, and nothing when there is none", () => {
		expect(
			handoffCodeFrom(
				`rowcat:///account?${APP_SESSION_HANDOFF_CODE_PARAM}=abc`,
			),
		).toBe("abc");
		expect(handoffCodeFrom("rowcat:///account?error=access_denied")).toBeNull();
		expect(handoffCodeFrom("not a url")).toBeNull();
	});
});
