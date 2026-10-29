import { describe, expect, it, vi } from "vitest";
import { recordStoryView, shouldRecordStoryView } from "./record-view.ts";

/**
 * View recording: locks only two things.
 *
 * ```text
 * receiving the data is not the same as a person seeing it
 * a failed record is not a failed work
 * ```
 *
 * Rather than setting up a React renderer harness, these two rules are pulled out as pure
 * functions. Inside an effect, the only way to check them would be the simulator, and a person
 * would have to repeat that check on every regression.
 */

describe("when it sends", () => {
	it("sends only after the lookup succeeded", () => {
		expect(shouldRecordStoryView("success")).toBe(true);
	});

	it.each([
		["Running", "pending" as const],
		["failure", "error" as const],
	])("doesn't send on %s", (_label, status) => {
		/**
		 * Prefetches, revalidations and background refreshes also pass through `pending`. Those runs
		 * record "a request was made", not "a person looked".
		 */
		expect(shouldRecordStoryView(status)).toBe(false);
	});
});

describe("when it fails", () => {
	it("doesn't throw", async () => {
		const record = vi.fn(async () => {
			throw new Error("network down");
		});
		// Throwing would turn a viewable work into an error screen because of one network blip.
		await expect(recordStoryView(record, "story-1")).resolves.toBeUndefined();
	});

	it("doesn't retry", async () => {
		const record = vi.fn(async () => {
			throw new Error("network down");
		});
		await recordStoryView(record, "story-1");
		// Resending gains nothing, and the user may have left the screen by then.
		expect(record).toHaveBeenCalledTimes(1);
	});

	it("doesn't leak a value even on success", async () => {
		const record = vi.fn(async () => {});
		await expect(recordStoryView(record, "story-1")).resolves.toBeUndefined();
		expect(record).toHaveBeenCalledWith("story-1");
	});
});

describe("doesn't deduplicate here", () => {
	it("calling the same story twice sends twice", () => {
		/**
		 * The server already folds (work, viewer, UTC day) and does not count the author's own work. A
		 * copy kept on the client would be a second source of truth, and copies differ per device, so
		 * neither can be trusted.
		 */
		const record = vi.fn(async () => {});
		void recordStoryView(record, "story-1");
		void recordStoryView(record, "story-1");
		expect(record).toHaveBeenCalledTimes(2);
	});
});
