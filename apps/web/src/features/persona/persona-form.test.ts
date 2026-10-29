import type { ChatSeed } from "@rowcat/chat";
import {
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	CHAT_PERSONA_NAME_MAX_LENGTH,
	createRoomRecord,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	personaApplyFailureMessage,
	personaDeleteFailureMessage,
	personaDeleteNotice,
	personaEmptyBody,
	personaNoneLabel,
	personaRowSummary,
	personaSaveFailureMessage,
	personaStoryDefaultHint,
	personaStoryDefaultLabel,
	planPersonaSave,
} from "./persona-form.ts";

/**
 * Tests for the persona form's decisions and wording, without rendering the screen. This app's
 * tests do not render React (vitest.config.ts), so what the form saves and which field gets focus
 * is checked through pure functions. The rule itself lives in @rowcat/chat (planPersonaSave); this
 * file locks where that reason turns into sentences and fields.
 */

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const seed = (persona: ChatSeed["persona"] = null): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
		persona,
	});

const room = (
	persona?: { name: string; description: string } | null,
	storyPersona: ChatSeed["persona"] = null,
) =>
	createRoomRecord(
		{
			originStoryId: "story-1",
			seed: seed(storyPersona),
			...(persona !== undefined ? { persona } : {}),
		},
		{
			id: "room-1",
			routingSessionId: "0f1e2d3c-4b5a",
			now: "2026-01-01T00:00:00.000Z",
			rev: REV,
		},
	);

describe("save plan", () => {
	it("a value that passes validation comes out trimmed", () => {
		expect(
			planPersonaSave({ name: "  Alex  ", description: "  A student.  " }),
		).toEqual({ kind: "save", name: "Alex", description: "A student." });
	});

	it("writes nothing when nothing changed", () => {
		expect(
			planPersonaSave(
				{ name: "Alex", description: "A student." },
				{ name: "Alex", description: "A student." },
			),
		).toEqual({ kind: "unchanged" });
	});

	/**
	 * The reason arrives together with the field it belongs to. If the form recomputed that answer,
	 * the verdict would exist in two places and could drift apart, and focus would then land on a
	 * field that is fine.
	 */
	it("an empty name fails on the name field", () => {
		const plan = planPersonaSave({ name: "  ", description: "" });
		expect(plan).toEqual({
			kind: "invalid",
			field: "name",
			message: expect.stringContaining("name"),
		});
	});

	it("a long description fails on the description field and names the limit", () => {
		const plan = planPersonaSave({
			name: "Alex",
			description: "a".repeat(CHAT_PERSONA_DESCRIPTION_MAX_LENGTH + 1),
		});
		expect(plan.kind).toBe("invalid");
		if (plan.kind === "invalid") {
			expect(plan.field).toBe("description");
			expect(plan.message).toContain(
				String(CHAT_PERSONA_DESCRIPTION_MAX_LENGTH),
			);
		}
	});

	it("the name limit message also names the number", () => {
		const plan = planPersonaSave({
			name: "a".repeat(CHAT_PERSONA_NAME_MAX_LENGTH + 1),
			description: "",
		});
		expect(plan.kind).toBe("invalid");
		if (plan.kind === "invalid")
			expect(plan.message).toContain(String(CHAT_PERSONA_NAME_MAX_LENGTH));
	});
});

describe("one line on the settings home", () => {
	/**
	 * Three states are not folded into one sentence. A role the user chose and a role the story
	 * suggested cannot be told apart by name alone. Without that distinction the user cannot answer
	 * 'did I choose this?'.
	 */
	it("a role I chose says only the name", () => {
		expect(
			personaRowSummary(room({ name: "Alex", description: "A student." })),
		).toBe("Alex");
	});

	it("a story-suggested role says so too", () => {
		const summary = personaRowSummary(
			room(undefined, { name: "Visitor", description: "" }),
		);
		expect(summary).toContain("Visitor");
		expect(summary).toContain(personaStoryDefaultLabel());
	});

	it("neither means not set", () => {
		expect(personaRowSummary(room())).toBe(personaNoneLabel());
	});

	it("a room whose override was cleared reads as the story default again", () => {
		const target = { ...room(null, { name: "Visitor", description: "" }) };
		expect(personaRowSummary(target)).toContain(personaStoryDefaultLabel());
	});
});

describe("copy", () => {
	/**
	 * The delete confirmation also states what deleting does not do. Deleting from the library changes
	 * nothing for conversations already started with the persona. If that is not said, people hold off
	 * deleting for fear the conversation breaks, and people who deleted read a working conversation as
	 * a failed delete.
	 */
	it("the delete confirmation says conversations stay", () => {
		expect(personaDeleteNotice()).toContain("Conversations");
		expect(personaDeleteNotice()).toContain("stay");
	});

	it("the empty state explains the feature", () => {
		expect(personaEmptyBody()).toContain("role");
		expect(personaEmptyBody().length).toBeGreaterThan(30);
	});

	/**
	 * Before the name is known, the hint must not say the 'none' label. The story may already suggest
	 * a role, so 'none' would be a wrong value, which is worse than a missing one.
	 */
	it("the pre-start hint does not assert there is none", () => {
		expect(personaStoryDefaultHint()).not.toContain(personaNoneLabel());
		expect(personaStoryDefaultHint()).toContain("story");
	});

	/**
	 * Failure sentences say what the user should do. No internal structure (Dexie, transactions,
	 * scopes) appears in any message.
	 */
	it("failure sentences carry no implementation terms", () => {
		for (const message of [
			personaSaveFailureMessage(),
			personaDeleteFailureMessage(),
			personaApplyFailureMessage(),
		])
			for (const absent of [
				"IndexedDB",
				"Dexie",
				"scope",
				"transaction",
				"sync",
			])
				expect(message, absent).not.toContain(absent);
	});
});
