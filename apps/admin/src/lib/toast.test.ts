import { describe, expect, test } from "vitest";
import { errorToastOptions } from "./toast.ts";

/**
 * Locks only the toast layer's promises that call sites must not change; whether it actually
 * appears is the primitive's job. `apps/web/src/lib/toast.test.ts` holds the same checks because
 * the two apps do not import each other — if the values diverge, errors vanish after a few seconds
 * in one app only.
 */

describe("errorToastOptions", () => {
	/**
	 * Worth more in the console than on the web: failures here usually happen during incident
	 * response, when the operator really does look away for a few seconds.
	 */
	test("does not close on its own", () => {
		expect(errorToastOptions("something failed").timeout).toBe(0);
	});

	test("announces immediately", () => {
		expect(errorToastOptions("something failed").priority).toBe("high");
	});

	/** This layer writes no copy; the given sentence must pass through unchanged. */
	test("does not touch the sentence", () => {
		const message = "Couldn't sign out.";
		expect(errorToastOptions(message).description).toBe(message);
		expect(errorToastOptions(message).type).toBe("error");
	});
});
