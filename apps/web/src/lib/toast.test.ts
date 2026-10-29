import { describe, expect, test } from "vitest";
import { errorToastOptions } from "./toast.ts";

/**
 * Tests only the promises of the toast layer. Whether a toast actually appears is the browser's
 * job, which the primitive handles. This file locks the two things callers must not be able to
 * change.
 */

describe("errorToastOptions", () => {
	/**
	 * Errors do not dismiss themselves. The messages here usually contain something to do. If they
	 * vanished after a few seconds, a person who missed them would have no place in this app to see
	 * them again. The user closes them.
	 */
	test("does not close by itself", () => {
		expect(errorToastOptions("Something failed").timeout).toBe(0);
	});

	/** Failures are not delayed to be announced. They go to assistive technology immediately. */
	test("announces immediately", () => {
		expect(errorToastOptions("Something failed").priority).toBe("high");
	});

	/**
	 * The layer does not produce copy. The message passed in must arrive unchanged, so each feature's
	 * pure module remains the single source of the copy text.
	 */
	test("leaves the sentence alone", () => {
		const message = "Couldn't start Google sign-in.";
		expect(errorToastOptions(message).description).toBe(message);
		expect(errorToastOptions(message).type).toBe("error");
	});
});
