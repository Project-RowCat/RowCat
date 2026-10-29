import { describe, expect, it } from "vitest";
import { CHAT_MARKDOWN_FIXTURE } from "./fixture.ts";
import { CHAT_MARKDOWN_NODE_TYPES, collectNodeTypes } from "./nodes.ts";
import { parseChatMarkdown } from "./parse.ts";

/**
 * First piece of parity: does the fixture produce the whole vocabulary? The other two pieces live
 * in each app (the web component table and the mobile renderer table must cover the same
 * vocabulary). All three must hold for the same text to arrive with the same meaning on both
 * platforms; if one is missing, the other two are consistent only with themselves.
 */
describe("the fixture covers both renderers' contract", () => {
	const seen = collectNodeTypes(parseChatMarkdown(CHAT_MARKDOWN_FIXTURE));

	it("produces every kind in the vocabulary", () => {
		for (const type of CHAT_MARKDOWN_NODE_TYPES)
			expect(seen, `the fixture has no text producing ${type}`).toContain(type);
	});

	/**
	 * The reverse direction matters more. If a node kind outside the vocabulary survives folding, both
	 * renderers will not know it and the text silently disappears, with no error or warning.
	 */
	it("leaves no kind outside the vocabulary", () => {
		for (const type of seen)
			expect(
				CHAT_MARKDOWN_NODE_TYPES as readonly string[],
				`${type} survived folding`,
			).toContain(type);
	});

	it("the vocabulary has no duplicates and is sorted", () => {
		const sorted = [...CHAT_MARKDOWN_NODE_TYPES].sort();
		expect([...CHAT_MARKDOWN_NODE_TYPES]).toEqual(sorted);
		expect(new Set(CHAT_MARKDOWN_NODE_TYPES).size).toBe(
			CHAT_MARKDOWN_NODE_TYPES.length,
		);
	});
});
