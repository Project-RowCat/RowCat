import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans what the playtest must not reach. Behavior tests already guard part of it
 * (playtest-persistence.test.ts checks real storage: rooms, messages and outbound stay empty). The
 * part they cannot guard is paths not yet called. Once a control is attached to a screen, its
 * behavior test does not pass through that path, and it still passes. The mistake happens
 * naturally. 'Carry the test conversation over into a real one' is a reasonable request, and the
 * shortest implementation is ChatStore.createRoom(). That type-checks and renders. What breaks is
 * quiet: the room is marked dirty and rides the next push. This checks policy, not render output
 * (the web tests have no React rendering). Whether the folder imports a given door can be answered
 * from the source alone.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PLAYTEST = HERE;

/**
 * Source with comments removed. This folder's header names what it does not do (for example, that
 * it does not build a room with ChatStore.createRoom() and hide it). If that sentence matched the
 * scan, the explanation would be reported as a violation, and the next person would delete the
 * explanation. Only executed code should be scanned.
 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function* sources(root: string): Generator<string> {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* sources(path);
			continue;
		}
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
		yield path;
	}
}

const files = () =>
	[...sources(PLAYTEST)].map((path) => ({
		name: path.slice(PLAYTEST.length),
		source: stripComments(readFileSync(path, "utf8")),
	}));

/** If a door appears in this folder, a boundary has been crossed. Each entry has its own reason. */
const FORBIDDEN: { door: string; why: string }[] = [
	{
		door: "local-chat",
		why: "test conversations don't persist; a hidden room would ride the next push",
	},
	{ door: "createRoom", why: "a playback session is not a room" },
	{ door: "ChatStore", why: "this screen has no store to write" },
	{ door: "useLocalRoom", why: "the test subscribes to no local room" },
	{
		door: "local-sync",
		why: "test conversations don't know the protocol exists (no codec, no tombstone)",
	},
	{
		door: "publishStory",
		why: "the test uploads nothing; publishing has its own section",
	},
	{
		door: "buildStoryPublication",
		why: "the test does not go through publish validation",
	},
	{ door: "markPublished", why: "the test leaves no publish trace" },
	{ door: "setCover", why: "the cover belongs to the published version" },
	{ door: "recordView", why: "this is not viewing a story" },
	/**
	 * The runtime lane uses the same hook, worker and surface as the studio preview. If this folder
	 * began setting up the compiler, VM or renderer directly, a second execution path would appear,
	 * and a playtest could then behave differently from the studio. The preview worker is the only
	 * place that builds artifacts.
	 */
	{
		door: "compileRuntimeProject",
		why: "the preview worker is the one place that builds artifacts",
	},
	{
		door: "?worker",
		why: "the preview client is the one place that starts the worker",
	},
	{
		door: "createWebRuntimeRenderer",
		why: "the preview hook is the one place that starts the renderer",
	},
	{ door: "@rowcat/runtime-host", why: "the VM stands only inside the worker" },
	{ door: "@jitl/quickjs", why: "the engine stands only inside the worker" },
	{ door: "creator-analytics", why: "the test makes no metrics" },
	{
		door: "stories.play",
		why: "does not fetch the playback payload from the server",
	},
];

describe("story test boundaries", () => {
	it.each(FORBIDDEN)("does not import $door: $why", ({ door }) => {
		const offenders = files()
			.filter((file) => file.source.includes(door))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/** Checks that there are files to scan first. An empty list is a failure, not a pass. */
	it("there are files to scan", () => {
		expect(files().length).toBeGreaterThan(5);
	});
});

/**
 * Prompt assembly must not exist in two copies. If guard text or block assembly appeared in this
 * folder, real conversations and tests would send different prompts, and the difference would
 * surface only after the creator publishes. Assembly lives entirely in buildChatGenerationRequest
 * in @rowcat/chat. This folder does not call it directly; the shared generation hook does.
 */
describe("prompt assembly is not here", () => {
	it.each([
		"ABSOLUTE_GUARD",
		"ADULT_GUARD",
		"ALL_AGES_GUARD",
		"ROLEPLAY_RULES",
		"HOUSE_RULES",
		"selectLore",
		"buildChatGenerationRequest",
		"applyPlatformSafetyPolicy",
	])("%s does not appear", (symbol) => {
		const offenders = files()
			.filter((file) => file.source.includes(symbol))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});

/**
 * Transport is not chosen here. The choice between managed and BYO is made by one router
 * (lib/generation/router.ts), called by the shared generation hook. If a provider name appeared
 * here, a test-only adapter would have started to grow.
 */
describe("transport does not branch here", () => {
	it.each([
		"anthropic",
		"gemini",
		"openrouter",
		"createGenerationTransport",
	])("%s does not appear", (symbol) => {
		const offenders = files()
			.filter((file) => file.source.toLowerCase().includes(symbol))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});
