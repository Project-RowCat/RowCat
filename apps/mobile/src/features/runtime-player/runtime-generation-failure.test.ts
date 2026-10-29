import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { ChatStreamFailure } from "../chat/generation/error.ts";
import {
	NATIVE_GENERATION_FAILURE,
	toNativeGenerationFailure,
} from "./runtime-generation-failure.ts";

/**
 * Being outside the managed allowlist is **the same reason as having no connection** — what to do is connect
 * your own key. The original text reaches creator code on no branch.
 */
describe("outside the managed allowlist", () => {
	it.each([
		[
			"envelope",
			new RowCatApiError({
				status: 403,
				code: "chat_managed_not_allowed",
				message: "member=abc not allowed",
			}),
		],
		["frame", new ChatStreamFailure("chat_managed_not_allowed", "member=abc")],
	] as const)("even arriving as %s it folds to not-authorized", (_, error) => {
		expect(toNativeGenerationFailure(error)).toEqual({
			ok: false,
			reason: "not-authorized",
			message: NATIVE_GENERATION_FAILURE["not-authorized"],
		});
	});

	it("an unknown failure folds to failed and carries no raw text", () => {
		const result = toNativeGenerationFailure(new Error("Bearer sk-live-x"));
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message: NATIVE_GENERATION_FAILURE.failed,
		});
	});
});
