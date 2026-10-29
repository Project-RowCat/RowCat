import { describe, expect, it } from "vitest";
import { createStoryDraftRecord, DRAFT_FIELD_GROUPS } from "./model.ts";
import { prepareStoryPublication } from "./publication.ts";

/**
 * The authoring `suggestedPersona` is not revived, and tests pin that as values. User personas
 * (@rowcat/chat persona.ts) will make the word common again, which creates pressure to restore the
 * v2 field. The names match, but the things differ:
 * - User persona: a role the user plays, a user asset reused across chats.
 * - Authoring suggestedPersona: a role the creator suggested, folded into `prompt` in v2.
 * - Seed persona of a published work: a published copy, immutable inside the play snapshot.
 *   Reviving it means raising AUTHORING_SCHEMA_VERSION, writing an inverse of folding (which does
 *   not exist), and migrating drafts already on devices. Comments alone will not hold: breaking it
 *   takes one added field, and compile and other tests still pass.
 */

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const draft = () =>
	createStoryDraftRecord(
		{ title: "Draft" },
		{ id: "draft-1", now: "2026-01-01T00:00:00.000Z", rev: REV },
	);

describe("an authoring v2 body is one field", () => {
	it("the draft has no `suggestedPersona`", () => {
		const record = draft();
		expect(record).not.toHaveProperty("suggestedPersona");
		expect(record).toHaveProperty("prompt");
	});

	/**
	 * The four v1 field names are checked together. Checking only one would let the other three return
	 * silently.
	 */
	it("none of v1's four fields is on the draft", () => {
		const keys = Object.keys(draft());
		for (const absent of [
			"scenario",
			"playGuide",
			"suggestedPersona",
			"characters",
		])
			expect(keys, absent).not.toContain(absent);
	});

	it("the sync field groups have no persona", () => {
		expect([...DRAFT_FIELD_GROUPS]).not.toContain("persona");
		expect(DRAFT_FIELD_GROUPS).toHaveLength(5);
	});
});

describe("the publication contract did not change by a character", () => {
	/**
	 * `play.persona` stays in the contract, and the assembler always sends it empty. Deleting it is
	 * tempting, but decoding of already-published runtime snapshots would break. A shape the authoring
	 * tool no longer produces must still be readable by play. User personas must never fill this slot.
	 * That value belongs to the user, not to the work the creator publishes. If it flowed here, one
	 * person's role would become the default for everyone who opens the work.
	 */
	it("the publish payload's counterpart is always empty", () => {
		const { publication } = prepareStoryPublication({
			draft: draft(),
			lore: [],
			startScenes: [],
			sceneImages: [],
		});
		expect(publication.play.persona).toBeNull();
		expect(publication.play.playGuide).toBe("");
		expect(publication.play.characters).toEqual([]);
	});
});
