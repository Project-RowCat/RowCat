import { describe, expect, it } from "vitest";
import {
	ABSOLUTE_GUARD,
	ADULT_GUARD,
	applyPlatformSafetyPolicy,
	conversationSafetyPolicy,
	deliveredChatSystem,
	MINOR_PRESENT_GUARD,
	runtimeGenerationSafety,
} from "./guards.ts";

const MINOR_INSTRUCTIONS =
	"너는 세나다. 세나는 열일곱 살 고등학생이고, 플레이어와 같은 반이다.";
const ADULT_INSTRUCTIONS = "너는 세나다. 세나는 서른두 살 변호사다.";

const occurrences = (haystack: string, needle: string): number =>
	haystack.split(needle).length - 1;

describe("runtimeGenerationSafety: the minor guard on runtime generation", () => {
	it("stands the minor guard once for an adult request whose instructions describe a minor", () => {
		const { system, context } = runtimeGenerationSafety(
			MINOR_INSTRUCTIONS,
			false,
		);
		expect(context).toEqual({
			requestedMode: "adult",
			minorCharacterPresent: true,
		});
		expect(occurrences(system, MINOR_PRESENT_GUARD)).toBe(1);
		// Before the creator's text, so recency does not bury it.
		expect(system.indexOf(MINOR_PRESENT_GUARD)).toBeLessThan(
			system.indexOf(MINOR_INSTRUCTIONS),
		);
	});

	it("survives the re-wrap on both doors without doubling", () => {
		const request = runtimeGenerationSafety(MINOR_INSTRUCTIONS, false);
		// Managed: the server wraps again with the policy the context declares (routes/chat.ts).
		expect(
			applyPlatformSafetyPolicy(
				request.system,
				conversationSafetyPolicy(request.context),
			),
		).toBe(request.system);
		// BYO: the router delivers through the same function.
		expect(deliveredChatSystem(request)).toBe(request.system);
		expect(occurrences(deliveredChatSystem(request), MINOR_PRESENT_GUARD)).toBe(
			1,
		);
	});

	it("leaves the guard off when nothing reads as a minor", () => {
		const { system, context } = runtimeGenerationSafety(
			ADULT_INSTRUCTIONS,
			false,
		);
		expect(context.minorCharacterPresent).toBe(false);
		expect(system).not.toContain(MINOR_PRESENT_GUARD);
		expect(system.startsWith(`${ABSOLUTE_GUARD}\n\n${ADULT_GUARD}`)).toBe(true);
	});

	it("never stands it at all-ages, where sexual content is already refused", () => {
		const { system, context } = runtimeGenerationSafety(
			MINOR_INSTRUCTIONS,
			true,
		);
		expect(context.requestedMode).toBe("all-ages");
		expect(system).not.toContain(MINOR_PRESENT_GUARD);
	});
});
