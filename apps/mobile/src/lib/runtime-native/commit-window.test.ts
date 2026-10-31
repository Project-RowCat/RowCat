import { describe, expect, it } from "vitest";
import {
	createNativeRuntimeCommitWindow,
	NATIVE_RUNTIME_COMMIT_WINDOW,
} from "./commit-window.ts";

const flush = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("commit window", () => {
	it("is open up to the limit", async () => {
		const window = createNativeRuntimeCommitWindow(2);
		window.committed(1);
		window.committed(2);
		let passed = false;
		void window.wait().then(() => {
			passed = true;
		});
		await flush();
		expect(passed).toBe(true);
	});

	it("waits past the limit and opens on acknowledgement", async () => {
		const window = createNativeRuntimeCommitWindow(2);
		for (const revision of [1, 2, 3]) window.committed(revision);
		let passed = false;
		void window.wait().then(() => {
			passed = true;
		});
		await flush();
		expect(passed).toBe(false);
		window.acknowledged(1);
		await flush();
		expect(passed).toBe(true);
	});

	/** A stop must never wait for acknowledgements Hermes will not send. */
	it("release opens it for good", async () => {
		const window = createNativeRuntimeCommitWindow(1);
		for (const revision of [1, 2, 3, 4]) window.committed(revision);
		let passed = false;
		void window.wait().then(() => {
			passed = true;
		});
		window.release();
		await flush();
		expect(passed).toBe(true);
		window.committed(9);
		let again = false;
		void window.wait().then(() => {
			again = true;
		});
		await flush();
		expect(again).toBe(true);
	});

	it("acknowledgements only move forward and never past what was posted", () => {
		const window = createNativeRuntimeCommitWindow();
		window.committed(3);
		window.acknowledged(10);
		expect(window.unacknowledged).toBe(0);
		window.committed(5);
		window.acknowledged(1);
		expect(window.unacknowledged).toBe(2);
		window.acknowledged(Number.NaN);
		expect(window.unacknowledged).toBe(2);
	});

	it("the product window is small and nonzero", () => {
		expect(NATIVE_RUNTIME_COMMIT_WINDOW).toBeGreaterThan(0);
		expect(NATIVE_RUNTIME_COMMIT_WINDOW).toBeLessThanOrEqual(8);
	});
});
