import { authoringSyncCodecs } from "@rowcat/authoring";
import { chatSyncCodecs } from "@rowcat/chat";
import type { Rev } from "@rowcat/contracts/sync";
import { runtimePersistenceSyncCodecs } from "@rowcat/runtime-persistence";
import { compareRev } from "@rowcat/sync";
import { describe, expect, it } from "vitest";

/**
 * Locks in that all four copies of compareRev pick the same winner.
 *
 * Why four copies: @rowcat/chat, @rowcat/authoring and @rowcat/runtime-persistence do not import
 * @rowcat/sync (layer rule). If domain codecs depended on the protocol package, that package would
 * become a hub that knows every domain, so this boundary is intentional and stays.
 *
 * The cost is this file. With four copies, someone eventually fixes only one. The symptom is not a
 * compile error but two devices reaching different winners, on user devices, long afterwards, in
 * the hardest form to reproduce. Types cannot catch that drift, so a test does.
 *
 * This is the test's home because only the assembly point (apps/web) can import all four packages
 * at once. compareRev is module-private, so the test checks the winner through merge, the one
 * exposed window. A mismatch there is also what the user would see.
 */

const rev = (t: number, c = 0, d = "device-a"): Rev => ({ t, c, d });

/**
 * Matrix of only the places where the comparison actually diverges. The last four matter most. The
 * Rev contract requires non-negative integers, but local storage rows skip that check: damaged
 * rows, old fixtures, and unparseable timestamps arrive as they are. An ungrounded comparison is
 * then not a total order (NaN !== NaN), and a non-total order flips its answer when only the
 * argument order changes.
 */
const REVS: Rev[] = [
	rev(0),
	rev(1),
	rev(1, 1),
	rev(1, 2),
	rev(2),
	rev(1_000),
	rev(1_000, 0, "device-b"),
	rev(1_000, 5, "device-b"),
	rev(Number.NaN),
	rev(-1),
	rev(1.5),
	rev(1, Number.NaN),
];

/**
 * Minimal shape shared by all fixtures. Merge reads only the winner, so the other fields are
 * constants.
 */
const BASE = {
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const seed = () => ({
	version: 1,
	storyId: "story-1",
	title: "Snapshot",
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

/**
 * Minimal record per type. Codecs select by the `type` string, so one table covers both packages.
 * It also picks the mutable field whose winning value shows whether the remote won: if that field
 * took the remote value, the remote won.
 */
const FIXTURES: Record<
	string,
	{ record: (rev: Rev, mark: string) => unknown; field: string }
> = {
	"chat.room": {
		record: (rev, mark) => ({
			...BASE,
			id: "room-1",
			originStoryId: "story-1",
			title: mark,
			adult: false,
			promptProtected: false,
			seed: seed(),
			rev,
		}),
		field: "title",
	},
	"chat.memory": {
		record: (rev, mark) => ({
			...BASE,
			id: "memory-1",
			roomId: "room-1",
			content: mark,
			pinned: false,
			position: 0,
			rev,
		}),
		field: "content",
	},
	/**
	 * Runtime-persistence set. Merge does not read the snapshot contents, so they are empty. The
	 * winner is read from the save timestamp (playthrough and permanent records) and from the title
	 * (library row). Both are whole-record, last-writer-wins.
	 */
	"runtime.playthrough": {
		record: (rev, mark) => ({
			...BASE,
			id: "runtime-playthrough:story-1:default",
			storyId: "story-1",
			slot: "default",
			snapshot: { formatVersion: 1, entries: {} },
			updatedAt: mark,
			rev,
		}),
		field: "updatedAt",
	},
	"runtime.persistent": {
		record: (rev, mark) => ({
			...BASE,
			id: "runtime-persistent:story-1",
			storyId: "story-1",
			snapshot: { formatVersion: 1, entries: {} },
			updatedAt: mark,
			rev,
		}),
		field: "updatedAt",
	},
	"runtime.conversation": {
		record: (rev, mark) => ({
			...BASE,
			id: "runtime-conversation:story-1:default",
			storyId: "story-1",
			slot: "default",
			title: mark,
			removedAt: null,
			rev,
		}),
		field: "title",
	},
	"authoring.lore": {
		record: (rev, mark) => ({
			...BASE,
			id: "lore-1",
			draftId: "draft-1",
			keys: [],
			content: mark,
			position: 0,
			rev,
		}),
		field: "content",
	},
};

const codecs = [
	...chatSyncCodecs,
	...authoringSyncCodecs,
	...runtimePersistenceSyncCodecs,
].filter((codec) => codec.type in FIXTURES);

describe("domain codec revision order = @rowcat/sync compareRev", () => {
	/**
	 * An empty table would make this file guard nothing. If a codec name changes, this test fails
	 * first.
	 */
	it("the codecs under test are really collected", () => {
		expect(codecs.map((c) => c.type).sort()).toEqual(
			Object.keys(FIXTURES).sort(),
		);
	});

	for (const codec of codecs) {
		const fixture = FIXTURES[codec.type];
		if (!fixture) continue;

		it(`${codec.type} — picks the same winner for every revision pair`, () => {
			for (const localRev of REVS) {
				for (const remoteRev of REVS) {
					const local = fixture.record(localRev, "local");
					const remote = fixture.record(remoteRev, "remote");
					const merged = (
						codec as unknown as {
							merge: (
								l: unknown,
								r: unknown,
								ctx: { note: () => void },
							) => { record: Record<string, unknown> };
						}
					).merge(local, remote, { note: () => {} });

					/**
					 * A codec's child rule is >= 0 (equal goes to remote), and a room uses > 0. Both rest on the
					 * same comparison function, so the test checks only the strict cases: when remote is strictly
					 * later, remote must win; when local is strictly later, local must win. Ties are a separate
					 * rule per type and are left alone.
					 */
					const order = compareRev(remoteRev, localRev);
					if (order > 0)
						expect({
							type: codec.type,
							localRev,
							remoteRev,
							won: merged.record[fixture.field],
						}).toEqual({
							type: codec.type,
							localRev,
							remoteRev,
							won: "remote",
						});
					if (order < 0)
						expect({
							type: codec.type,
							localRev,
							remoteRev,
							won: merged.record[fixture.field],
						}).toEqual({
							type: codec.type,
							localRev,
							remoteRev,
							won: "local",
						});
				}
			}
		});

		it(`${codec.type} — the merged revision is at least both inputs`, () => {
			for (const localRev of REVS) {
				for (const remoteRev of REVS) {
					const merged = (
						codec as unknown as {
							merge: (
								l: unknown,
								r: unknown,
								ctx: { note: () => void },
							) => { record: { rev: Rev } };
						}
					).merge(
						fixture.record(localRev, "local"),
						fixture.record(remoteRev, "remote"),
						{ note: () => {} },
					);
					/**
					 * If this invariant breaks, two devices overwrite each other forever. The loser reads the
					 * result as a replay and uploads its own version again.
					 */
					expect(
						compareRev(merged.record.rev, localRev),
					).toBeGreaterThanOrEqual(0);
					expect(
						compareRev(merged.record.rev, remoteRev),
					).toBeGreaterThanOrEqual(0);
				}
			}
		});
	}
});
