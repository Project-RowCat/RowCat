import { describe, expect, it } from "vitest";
import { executeScenePlan } from "./run-plan.ts";

describe("executeScenePlan", () => {
	it("writes every set in order, then every removal", async () => {
		const calls: string[] = [];
		await executeScenePlan(
			{
				setScene: async (input) => {
					calls.push(`set:${input.startAt.messageId}:${input.audience.kind}`);
					return null;
				},
				deleteScene: async (id) => {
					calls.push(`remove:${id}`);
				},
			},
			{
				set: [
					{
						roomId: "r",
						startAt: { createdAt: "2026-01-01T00:00:00.000Z", messageId: "a" },
						audience: { kind: "room" },
					},
					{
						roomId: "r",
						startAt: { createdAt: "2026-01-02T00:00:00.000Z", messageId: "~" },
						audience: { kind: "participants", members: ["user"] },
					},
				],
				remove: ["s1", "s2"],
			},
		);
		expect(calls).toEqual([
			"set:a:room",
			"set:~:participants",
			"remove:s1",
			"remove:s2",
		]);
	});

	it("does not start the next write before the previous one settles", async () => {
		let open = 0;
		let overlapped = false;
		const slow = async () => {
			open++;
			if (open > 1) overlapped = true;
			await new Promise((resolve) => setTimeout(resolve, 1));
			open--;
		};
		await executeScenePlan(
			{
				setScene: async () => {
					await slow();
					return null;
				},
				deleteScene: slow,
			},
			{
				set: [
					{
						roomId: "r",
						startAt: { createdAt: "2026-01-01T00:00:00.000Z", messageId: "a" },
						audience: { kind: "narrator" },
					},
				],
				remove: ["s1"],
			},
		);
		expect(overlapped).toBe(false);
	});
});
