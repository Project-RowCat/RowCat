import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	type ChatPersonaSnapshot,
	effectiveChatPersona,
	openingMessage,
} from "@rowcat/chat";
import { describe, expect, it } from "vitest";

/**
 * The opening's `{{user}}` and `{{char}}` resolve to the same names in both apps.
 *
 * `openingMessage(seed, userPersona = seed.persona)` defaults to the playback session's value
 * (playtest has no room override, so the work's suggested counterpart is right there). The default
 * stays and the call sites are what must pass the argument; a site that omits it is silent: the
 * first line alone uses a different name in a conversation started with a chosen role
 * (`packages/chat/src/persona.ts` warns about this). The cast list is the same axis: `{{char}}`
 * comes from characters added to this room (v2 seed characters are always empty), and the assembler
 * substitutes them for the model while a site that omits the list shows the literal placeholder on
 * screen. So both arguments are pinned together.
 *
 * ```text
 * value   an overridden room's opening uses the overridden name, not the work's suggestion
 * parity  all four call sites (two per app) pass the effective persona and the room's cast;
 *         if one drops out, the same room draws a different first line per app, visible only
 *         with the two screens side by side
 * ```
 *
 * Like `runtime-player-copy-parity.test.ts`, the web source is read, never imported; a bundle that
 * knows the other app's module is a dependency, not a parity check.
 */

const SUGGESTED: ChatPersonaSnapshot = { name: "Visitor", description: "" };
const CHOSEN: ChatPersonaSnapshot = { name: "Alex", description: "" };

/** The room shape the screen receives, reduced to the axes needed to answer the effective persona. */
const room = (persona?: ChatPersonaSnapshot | null) => ({
	...(persona === undefined ? {} : { persona }),
	seed: {
		firstScene: "{{user}} opened the door.",
		startScenes: [],
		persona: SUGGESTED,
		characters: [],
	},
});

describe("the opening's effective role", () => {
	it("with a room override, that name stands and the story's suggestion doesn't", () => {
		const target = room(CHOSEN);
		const opening = openingMessage(
			target.seed,
			effectiveChatPersona(target),
			[],
		);
		expect(opening?.content).toBe("Alex opened the door.");
		expect(opening?.content).not.toContain("Visitor");
	});

	/** A `null` override means "use the work's default", not "no role"; passing the effective persona does not overwrite the suggestion. */
	it("without an override, the counterpart the story suggested stands as is", () => {
		for (const target of [room(), room(null)])
			expect(
				openingMessage(target.seed, effectiveChatPersona(target))?.content,
			).toBe("Visitor opened the door.");
	});
});

const CALL_SITES = [
	"./chat-screen.tsx",
	"./suggestion/use-reply-suggestion.ts",
	"../../../../web/src/features/chat/chat-page.tsx",
	"../../../../web/src/features/chat/suggestion/use-reply-suggestion.ts",
] as const;

/** Comments are stripped because the two screens' headers state this rule in prose; mixing that text into the check would report comment edits as parity failures. */
const code = (specifier: string): string =>
	readFileSync(fileURLToPath(new URL(specifier, import.meta.url)), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/.*$/gm, "$1")
		.replace(/\s+/g, " ");

describe("the call sites in both apps", () => {
	it.each(
		CALL_SITES,
	)("%s passes the effective role and the cast list", (specifier) => {
		const source = code(specifier);
		expect(source).toContain(
			"openingMessage(room.seed, effectiveChatPersona(room), characters)",
		);
		expect(source).not.toContain("openingMessage(room.seed)");
		/* Persona passed but cast dropped: exactly the silent divergence. */
		expect(source).not.toContain(
			"openingMessage(room.seed, effectiveChatPersona(room))",
		);
	});

	/** The seed is fixed after acquisition but the role is not; a memo depending on the seed alone would never pick up a just-chosen role, with no error. */
	it.each(CALL_SITES)("%s doesn't memoize on the seed alone", (specifier) => {
		expect(code(specifier)).not.toContain("[room.seed]");
	});
});
