import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * Locks, by source shape, that the playback entitlement decision lives in one predicate.
 *
 * The integration test (`playback.test.ts`) says whether current code is right; this file stops the
 * next refactor from writing the decision in a second place. Both are needed: the first cannot say
 * where the predicate lives, the second cannot say whether it is correct.
 *
 * This once locked "playback entitlement does not fall back to catalogue visibility" (while stories
 * were paid, reading the payload through the detail selector bypassed payment). With ownership gone
 * the two axes agree again, but the decision can still drift apart across `/play`, `/playback`, the
 * server-assembled generation of protected stories and telemetry without any error, so what is
 * locked remains the number of places.
 */

/**
 * Comments are stripped before scanning. This guards code, not explanation; the boundaries locked
 * here all document their reasons in headers, so the words necessarily appear in comments, and
 * scanning them would turn the check into "do not explain why" (same judgement as
 * `no-route-db-access.test.ts` reading imports only).
 */
const read = (path: string): string =>
	readFileSync(new URL(path, import.meta.url), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

const routes = read("./index.ts");
/** The file holding the gate, shared by both playback paths and the server-assembled generation of protected stories. */
const gateModule = read("./playback-gate.ts");
const chatRoutes = read("../chat.ts");
const playbackService = read("../../services/story/playback.ts");
const telemetryService = read("../../services/story/telemetry.ts");
const storiesService = read("../../services/story/index.ts");

/**
 * Extracts the single entitlement gate that both playback paths pass through.
 *
 * This used to be the body of the `/:id/play` handler. When playback became two paths (the old chat
 * path and the unified `/playback`) the decision moved into one function and what this file locks
 * moved with it; scanning the handlers would only confirm that neither contains entitlement code,
 * which does not stop a bypass because it never says where that code went.
 */
function playbackGate(): string {
	const start = gateModule.indexOf("async function requirePlayableStory(");
	expect(start).toBeGreaterThan(0);
	const end = gateModule.indexOf("function parseChatSeed(", start);
	expect(end).toBeGreaterThan(start);
	return gateModule.slice(start, end);
}

/** The bodies of both playback paths; the entitlement decision must not reappear here. */
function playbackHandlers(): string {
	const start = routes.indexOf('.get("/:id/play"');
	expect(start).toBeGreaterThan(0);
	const end = routes.indexOf('.post("/:id/view"', start);
	expect(end).toBeGreaterThan(start);
	return routes.slice(start, end);
}

describe("the playback entitlement door", () => {
	const handler = playbackGate();

	/** A path through the entitlement decision really exists; without it the absence checks below are vacuous. */
	test("there is a path that asks for entitlement", () => {
		expect(handler).toMatch(/getPlayableStoryPayload\(/);
	});

	/**
	 * The authentication refusal is inside this gate. A guest cannot be entitled to playback, and that
	 * refusal standing before the lookup is this path's existence hiding.
	 */
	test("refuses guests", () => {
		expect(handler).toMatch(/requireViewer\(/);
	});

	/**
	 * The detail lookup is not on the entitlement path. `getStory` decides by the detail selector; if
	 * its result opened the payload the decision would live in two places, and when either changes
	 * `/play` and the detail diverge.
	 */
	test("doesn't use the catalogue predicate as authorization", () => {
		expect(handler).not.toMatch(/getStory\(/);
		expect(handler).not.toMatch(/galleryWhere/);
	});

	/**
	 * No fallback. An earlier bypass had exactly this shape, `one read ?? another read`: whichever
	 * side comes first, joining two reads with `??` opens the looser gate first.
	 */
	test("one branch reads the payload", () => {
		const payloadReads = handler.match(/get[A-Za-z]*Payload\(/g) ?? [];
		expect(payloadReads).toEqual(["getPlayableStoryPayload("]);
		expect(handler).not.toMatch(/\?\?/);
	});
});

describe("the two playback paths", () => {
	const handlers = playbackHandlers();

	/**
	 * Both paths pass the same gate. If runtime playback grew its own entitlement decision it would
	 * eventually diverge from chat's, and one direction of that divergence sends the code of a story
	 * the viewer cannot see.
	 */
	test("both the old path and the unified path go through the entitlement door", () => {
		const gates =
			handlers.match(/requirePlayableStory\(c, storyIdParam\(c\)\)/g) ?? [];
		expect(gates.length).toBe(2);
	});

	/** Entitlement code does not return to the handlers; the gate alone holds the decision. */
	test("there is no entitlement decision inside the handler", () => {
		expect(handlers).not.toMatch(/get[A-Za-z]*Payload\(/);
		expect(handlers).not.toMatch(/requireViewer\(/);
		expect(handlers).not.toMatch(/getStory\(/);
	});

	/**
	 * The runtime artifact is read only behind the gate. Reading it in front would let an unentitled
	 * request learn whether a story exists, and one mistake would send the code itself.
	 */
	test("reads the runtime artifact behind the door", () => {
		const gate = handlers.indexOf("requirePlayableStory(c, storyIdParam(c))");
		const runtime = handlers.indexOf("getPublishedStoryRuntime(");
		expect(gate).toBeGreaterThan(-1);
		expect(runtime).toBeGreaterThan(gate);
	});

	/**
	 * The client does not choose the playback mode. A query parameter demanding the chat snapshot
	 * would open a path to receive a runtime story's body in another shape, leaving it unanswerable
	 * which of the two that story is.
	 */
	test("the request doesn't decide the playback mode", () => {
		const playback = handlers.slice(handlers.indexOf('.get("/:id/playback"'));
		expect(playback).not.toMatch(/c\.req\.query\(/);
	});
});

/**
 * The server-assembled generation of protected stories passes the same gate. It reads the currently
 * published seed to build the prompt, so a separately written entitlement check there, once
 * loosened, assembles a turn from the manuscript of a story the viewer cannot see; the response
 * shape matches the normal one so nothing breaks.
 */
describe("server-assembled generation", () => {
	const handler = chatRoutes.slice(
		chatRoutes.indexOf('.post("/stories/:storyId/generate"'),
	);

	test("goes through the playback entitlement door", () => {
		expect(handler).toMatch(/requirePlayableStory\(/);
	});

	test("doesn't write the entitlement decision separately", () => {
		expect(handler).not.toMatch(/get[A-Za-z]*Payload\(/);
		expect(handler).not.toMatch(/getStory\(/);
	});
});

describe("playback entitlement service", () => {
	/** Two entitlements, both in the predicate (the creator; a directly openable story). */
	test("asks about creator and viewer through predicates", () => {
		expect(playbackService).toMatch(/eq\(story\.owner, viewerId\)/);
		expect(playbackService).toMatch(
			/inArray\(story\.visibility, \["public", "unlisted"\]\)/,
		);
	});

	/**
	 * The exposure axis is an allowlist. Written negatively (`<> 'archived'`), a value added to the
	 * vocabulary would land on the passing side; private and archived not appearing by name in this
	 * file is that structure.
	 */
	test("doesn't write the visibility axis negatively", () => {
		expect(playbackService).not.toMatch(/ne\(story\.visibility/);
		expect(playbackService).not.toMatch(/"private"/);
		expect(playbackService).not.toMatch(/"archived"/);
	});

	/**
	 * The detail selector is not brought in. If this file started using `galleryWhere` the decision
	 * would have two canonical forms, and when only one is fixed `/play` and the detail diverge.
	 */
	test("doesn't go through the detail's predicate", () => {
		expect(playbackService).not.toMatch(/galleryWhere/);
		expect(playbackService).not.toMatch(/from "\.\/index\.ts"/);
	});

	/**
	 * A guest is not representable. Once `viewerId` is optional a "then public stories only" branch
	 * appears inside this function and the order of authentication refusal before lookup breaks.
	 */
	test("requires the viewer", () => {
		expect(playbackService).toMatch(/\n\tviewerId: string;/);
		expect(playbackService).not.toMatch(/viewerId\?: string/);
		expect(playbackService).not.toMatch(/viewerId: string \| null/);
	});

	/** Operator hiding closes regardless of entitlement; ownership cannot undo enforcement. */
	test("has operator hiding in the predicate", () => {
		expect(playbackService).toMatch(/eq\(story\.hidden, false\)/);
	});

	/**
	 * Blocking does not erase ownerless stories. With only `notInArray(story.owner, …)` the expression
	 * is NULL for rows whose owner is NULL, so a member with any block list loses every story of
	 * departed creators.
	 */
	test("the block axis keeps ownerless stories", () => {
		expect(playbackService).toMatch(
			/or\(isNull\(story\.owner\), notInArray\(story\.owner, blocked\)\)/,
		);
	});

	/**
	 * The lookup that reads the payload and the one that only asks entitlement use the same predicate.
	 * Written apart, telemetry would accept play starts under different rules than playback.
	 */
	test("two lookups share one predicate", () => {
		const uses = playbackService.match(/\.where\(playbackWhere\(input\)\)/g);
		expect(uses).toHaveLength(2);
		expect(telemetryService).toMatch(/hasPlaybackEntitlement\(/);
	});
});

describe("the old passage", () => {
	/**
	 * The detail service does not read the playback payload. `services/story/index.ts` holds the
	 * detail selector, so a second decision is always a few lines away there. It once looked at that
	 * column's null bitmap for the acquisition-capability projection (`purchasable`); with that
	 * projection gone the column name no longer appears at all.
	 */
	test("the stories service doesn't read the playback payload", () => {
		expect(storiesService).not.toMatch(/export .*PlayPayload/);
		expect(storiesService).not.toMatch(/play_payload/);
	});
});
