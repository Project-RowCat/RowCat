import { describe, expect, it } from "vitest";
import type { ConnectProviderOutcome } from "./connect-provider.ts";
import { connectFailureScope } from "./provider-feedback.ts";

/**
 * Which failure marks the API key field invalid. This must be checkable without rendering, because
 * the symptom of getting it wrong is visible only to assistive technology. The sentences are
 * correct, since connectProvider already gives each kind different copy. Only aria-invalid would
 * lie: a user without a network reads that the key cannot be verified right now while the field is
 * marked invalid, and discards a valid key. The sentences are checked in connect-provider.test.ts;
 * this file checks placement.
 */

describe("where connect failures attach", () => {
	it("a rejected key is a field failure", () => {
		expect(connectFailureScope("rejected")).toBe("field");
	});

	it("failures unrelated to the key are form failures", () => {
		expect(connectFailureScope("failed")).toBe("form");
		expect(connectFailureScope("not_permitted")).toBe("form");
	});

	/**
	 * Failure categories are enumerated as a list of values, and the list must grow when a category is
	 * added. The direction of error is why. If a new category silently fell into the field scope, that
	 * failure would mark the field's value invalid, which is exactly the mistake this module exists to
	 * prevent. Whoever edits the list must choose a placement for the new category.
	 */
	it("three failure branches, each with a place", () => {
		const failures = [
			"not_permitted",
			"rejected",
			"failed",
		] as const satisfies readonly Exclude<
			ConnectProviderOutcome["status"],
			"connected" | "busy"
		>[];
		expect(failures.map(connectFailureScope)).toEqual([
			"form",
			"field",
			"form",
		]);
	});
});
