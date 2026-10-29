import { DEFAULT_DEBUG_TRACE_LIMITS } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import type { PreviewWorkerMessage } from "./protocol.ts";
import {
	emptyRuntimeDebugState,
	type RuntimeDebugState,
	reduceRuntimeDebug,
	runtimeDebugGenerationResult,
	runtimeDebugRun,
} from "./runtime-preview-debug.ts";

/**
 * Rules for runtime observation: honesty is the whole point. If these are wrong, the screen is
 * wrong while looking plausible. That means hydration recorded as a change, an uncommitted value
 * drawn as committed, or an old session's value attached as the new session's previous value.
 */

const limits = DEFAULT_DEBUG_TRACE_LIMITS;
const options = (at = 1) => ({ at, limits });

const GENERATION = 1;

const storySnapshot = (
	entries: { key: string; version: number; value: unknown }[],
) =>
	({
		type: "story-state",
		generation: GENERATION,
		snapshot: { formatVersion: 1, entries },
	}) as unknown as PreviewWorkerMessage;

const persistentSnapshot = (
	entries: { key: string; version: number; value: unknown }[],
) =>
	({
		type: "persistent-state",
		generation: GENERATION,
		snapshot: { formatVersion: 1, entries },
	}) as unknown as PreviewWorkerMessage;

const commit = (revision: number, patches = 1) =>
	({
		type: "commit",
		generation: GENERATION,
		batch: { revision, patches: Array.from({ length: patches }, () => ({})) },
	}) as unknown as PreviewWorkerMessage;

const started = (): RuntimeDebugState =>
	reduceRuntimeDebug(
		runtimeDebugRun(
			emptyRuntimeDebugState(),
			{ generation: GENERATION, resetStory: false, resetPersistent: false },
			options(),
		),
		{
			type: "started",
			generation: GENERATION,
			remoteAssets: [],
		} as PreviewWorkerMessage,
		options(2),
	);

const kinds = (state: RuntimeDebugState) =>
	state.log.entries.map((event) => event.kind);

describe("durable state", () => {
	it("the first snapshot is hydration, not a change", () => {
		const state = reduceRuntimeDebug(
			started(),
			storySnapshot([{ key: "week", version: 1, value: 1 }]),
			options(3),
		);
		expect(kinds(state)).toEqual(["run-requested", "session-started"]);
		expect(state.story.hydrated).toBe(true);
		expect(state.story.rows[0]).toMatchObject({
			key: "week",
			version: 1,
			previous: null,
			changedAtLastCommit: false,
		});
	});

	it("before and after are recorded from the second snapshot", () => {
		let state = reduceRuntimeDebug(
			started(),
			storySnapshot([{ key: "week", version: 1, value: 1 }]),
			options(3),
		);
		state = reduceRuntimeDebug(state, commit(1), options(4));
		state = reduceRuntimeDebug(
			state,
			storySnapshot([{ key: "week", version: 1, value: 2 }]),
			options(5),
		);
		expect(state.story.rows[0]).toMatchObject({
			previous: "1",
			text: "2",
			changedAtLastCommit: true,
		});
		const event = state.log.entries[state.log.entries.length - 1];
		expect(event?.kind === "durable-commit" && event.data).toEqual({
			scope: "story",
			entries: 1,
			changedKeys: ["week"],
			revision: 1,
		});
	});

	it("a value that did not move **keeps its last change**", () => {
		let state = reduceRuntimeDebug(
			started(),
			storySnapshot([{ key: "week", version: 1, value: 1 }]),
			options(3),
		);
		state = reduceRuntimeDebug(
			state,
			storySnapshot([{ key: "week", version: 1, value: 2 }]),
			options(4),
		);
		state = reduceRuntimeDebug(
			state,
			storySnapshot([{ key: "week", version: 1, value: 2 }]),
			options(5),
		);
		expect(state.story.rows[0]).toMatchObject({
			previous: "1",
			text: "2",
			changedAtLastCommit: false,
		});
	});

	it("the two lifetimes do not mix", () => {
		let state = reduceRuntimeDebug(
			started(),
			storySnapshot([{ key: "week", version: 1, value: 1 }]),
			options(3),
		);
		state = reduceRuntimeDebug(
			state,
			persistentSnapshot([{ key: "endings", version: 1, value: [] }]),
			options(4),
		);
		expect(state.story.rows.map((row) => row.key)).toEqual(["week"]);
		expect(state.persistent.rows.map((row) => row.key)).toEqual(["endings"]);
	});

	it("a key whose version rose stays as a migration", () => {
		let state = reduceRuntimeDebug(
			started(),
			storySnapshot([{ key: "week", version: 1, value: 1 }]),
			options(3),
		);
		state = reduceRuntimeDebug(
			state,
			storySnapshot([{ key: "week", version: 2, value: { n: 1 } }]),
			options(4),
		);
		const migration = state.log.entries.find(
			(event) => event.kind === "migration",
		);
		expect(migration?.kind === "migration" && migration.data).toEqual({
			scope: "story",
			key: "week",
			from: 1,
			to: 2,
		});
	});

	it("pressing Run again leaves no previous values", () => {
		let state = reduceRuntimeDebug(
			started(),
			storySnapshot([{ key: "week", version: 1, value: 1 }]),
			options(3),
		);
		state = reduceRuntimeDebug(
			state,
			storySnapshot([{ key: "week", version: 1, value: 5 }]),
			options(4),
		);
		expect(state.story.rows[0]?.previous).toBe("1");

		state = runtimeDebugRun(
			state,
			{ generation: GENERATION, resetStory: false, resetPersistent: false },
			options(5),
		);
		expect(state.story.hydrated).toBe(false);
		expect(state.story.rows).toEqual([]);
	});

	/**
	 * Resetting the playthrough must not look like it erased long progress. Observation cannot disturb
	 * execution, so this test checks one thing: when execution restarts, both lists are left empty and
	 * then refilled from the snapshots the worker sends. Marking the state as erased in advance would
	 * make the screen report a fact that has not arrived yet.
	 */
	it("after Reset play, long progress is what the worker says", () => {
		let state = reduceRuntimeDebug(
			started(),
			storySnapshot([{ key: "week", version: 1, value: 3 }]),
			options(3),
		);
		state = reduceRuntimeDebug(
			state,
			persistentSnapshot([{ key: "endings", version: 1, value: ["a"] }]),
			options(4),
		);

		state = runtimeDebugRun(
			state,
			{ generation: GENERATION, resetStory: true, resetPersistent: false },
			options(5),
		);
		expect(state.story.hydrated).toBe(false);
		expect(state.persistent.hydrated).toBe(false);

		state = reduceRuntimeDebug(state, storySnapshot([]), options(6));
		state = reduceRuntimeDebug(
			state,
			persistentSnapshot([{ key: "endings", version: 1, value: ["a"] }]),
			options(7),
		);
		expect(state.story.rows).toEqual([]);
		expect(state.persistent.rows.map((row) => row.key)).toEqual(["endings"]);
		/** Hydration is not a change, so long progress must not be marked as having just changed. */
		expect(state.persistent.rows[0]?.changedAtLastCommit).toBe(false);
	});
});

describe("generation", () => {
	it("a message from another generation makes no state", () => {
		const state = started();
		const stale = reduceRuntimeDebug(
			state,
			{
				...(storySnapshot([{ key: "week", version: 1, value: 1 }]) as object),
				generation: 99,
			} as PreviewWorkerMessage,
			options(9),
		);
		expect(stale).toBe(state);
	});
});

describe("events", () => {
	it("a compile failure records **only the count**, not the diagnostics", () => {
		const state = reduceRuntimeDebug(
			started(),
			{
				type: "failed",
				generation: GENERATION,
				failure: {
					stage: "compile",
					diagnostics: [{ message: "type error" }, { message: "another one" }],
				},
			} as unknown as PreviewWorkerMessage,
			options(3),
		);
		const event = state.log.entries[state.log.entries.length - 1];
		expect(event?.kind === "session-failed" && event.data).toEqual({
			stage: "compile",
			summary: "Compilation did not pass",
			diagnostics: 2,
		});
		expect(JSON.stringify(state.log.entries)).not.toContain("type error");
	});

	it("console lines do not go to the timeline; that list is separate", () => {
		const state = reduceRuntimeDebug(
			started(),
			{
				type: "console",
				generation: GENERATION,
				level: "log",
				args: ["hello"],
			} as PreviewWorkerMessage,
			options(3),
		);
		expect(kinds(state)).toEqual(["run-requested", "session-started"]);
	});

	it("a generation result carries only a named reason", () => {
		const state = runtimeDebugGenerationResult(
			started(),
			{ requestId: 1, ok: false, reason: "insufficient-balance" },
			options(3),
		);
		const event = state.log.entries[state.log.entries.length - 1];
		expect(event?.kind === "generation-result" && event.data).toEqual({
			requestId: 1,
			ok: false,
			reason: "insufficient-balance",
		});
	});

	it("past the cap the oldest are dropped and counted", () => {
		const tight = { at: 1, limits: { ...limits, maxEvents: 2 } };
		let state = started();
		for (let n = 0; n < 5; n += 1)
			state = reduceRuntimeDebug(state, commit(n + 1), tight);
		expect(state.log.entries).toHaveLength(2);
		expect(state.log.dropped).toBeGreaterThan(0);
	});
});
