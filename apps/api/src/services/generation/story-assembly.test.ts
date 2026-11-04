import { ABSOLUTE_GUARD, HOUSE_RULES } from "@rowcat/chat/guards";
import {
	StoryChatGenerationRequest,
	StoryChatSeedDto,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { assembleProtectedStoryGeneration } from "./story.ts";

/** Pure assembly keeps the operator policy covered even when no test database is available. */
describe("protected story prompt guard setting", () => {
	it.each([
		false,
		true,
	])("applies the operator switch: enabled=%s", (promptGuardsEnabled) => {
		const seed = StoryChatSeedDto.parse({
			version: 1,
			storyId: "story",
			title: "Story",
			adult: false,
			promptProtected: true,
			scenario: "MANUSCRIPT_MARKER",
			firstScene: "Opening",
		});
		const request = StoryChatGenerationRequest.parse({
			model: "claude-sonnet-5",
			messages: [{ role: "user", speaker: "Ray", content: "Hi" }],
		});
		const assembled = assembleProtectedStoryGeneration({
			seed,
			request,
			allAges: true,
			promptGuardsEnabled,
		});
		expect(assembled.base.system).toContain("MANUSCRIPT_MARKER");
		expect(assembled.base.system.includes(ABSOLUTE_GUARD)).toBe(
			promptGuardsEnabled,
		);
		expect(assembled.base.system.includes(HOUSE_RULES)).toBe(
			promptGuardsEnabled,
		);
		expect(assembled.firstRequest.system).toBe(assembled.base.system);
	});
});
