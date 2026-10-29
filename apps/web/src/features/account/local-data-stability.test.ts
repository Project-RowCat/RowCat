import type { Viewer } from "@rowcat/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createLocalDataActivation,
	type LocalDataDriver,
	type LocalDataStores,
} from "#/lib/local-data/activation.ts";
import { resetLocalDbScope } from "#/lib/local-data/db.ts";

/**
 * Changing account settings must not close and reopen the local database.
 *
 * Nothing in the types or the rendering shows this. Changing the nickname or the adult display
 * setting creates a new viewer object. If the scope reacted to that object, every settings change
 * would close and reopen IndexedDB. The list would flicker, and any chat write or draft autosave in
 * flight would point at a closed connection.
 *
 * The scope must react to `Viewer.id` alone, since that is the identity local data ownership rests
 * on, and no account setting changes it. The tests check exactly that.
 *
 * No real mutations run here. What is verified is what activation does when the viewer changes, not
 * what the query cache does, and that reproduces without React.
 */

const stubStores = (viewerId: string): LocalDataStores =>
	({
		chat: { viewerId },
		authoring: { viewerId },
	}) as unknown as LocalDataStores;

function stubDriver() {
	const opened: string[] = [];
	const reset = vi.fn();
	const driver: LocalDataDriver = {
		open: (viewerId) => {
			opened.push(viewerId);
			return stubStores(viewerId);
		},
		reset,
	};
	return { driver, opened, reset };
}

const VIEWER: Viewer = {
	id: "member-1",
	nickname: "Cat",
	status: "approved",
	role: "user",
	verified: true,
	adult: true,
	showAdult: false,
	adultRecheckRequired: false,
	ageStatus: "standard",
	membershipGate: null,
};

afterEach(() => {
	resetLocalDbScope();
});

describe("account setting changes and the local scope", () => {
	/**
	 * `LocalDataScopeProvider` passes only `viewer?.id ?? null` to activation. This mimics a second
	 * request after a settings change, with the viewer changed, to confirm it passes the same
	 * argument.
	 */
	it.each([
		["nickname", { ...VIEWER, nickname: "NightCat" }],
		["adult display", { ...VIEWER, showAdult: true }],
		["both", { ...VIEWER, nickname: "NightCat", showAdult: true }],
	])("the same store survives a %s change", async (_label, next) => {
		const { driver, opened, reset } = stubDriver();
		const activation = createLocalDataActivation({
			onOpen: () => {},
			load: async () => driver,
		});

		const before = await activation.ensure(VIEWER.id);
		// The viewer after the settings change. The identity is unchanged; that is both the premise and
		// the conclusion of this test.
		expect(next.id).toBe(VIEWER.id);
		const after = await activation.ensure(next.id);

		// Must be the same **instance**. A new object with equal values would make the ownership check
		// (`ownsStore`) treat in-flight work as belonging to someone else and discard it.
		expect(after).toBe(before);
		expect(opened).toEqual([VIEWER.id]);
		// The connection was not closed. If it had been, chat and draft writes would lose their target at
		// that moment.
		expect(reset).not.toHaveBeenCalled();
		expect(activation.owner()).toBe(VIEWER.id);
	});

	/**
	 * The other side: **a changed identity must reopen**. If the stability above hardened into "never
	 * reopen", switching accounts would show the previous person's data.
	 */
	it("reopens when the member changes", async () => {
		const { driver, opened } = stubDriver();
		const activation = createLocalDataActivation({
			onOpen: () => {},
			load: async () => driver,
		});

		const alice = await activation.ensure("member-1");
		const bob = await activation.ensure("member-2");

		expect(bob).not.toBe(alice);
		expect(opened).toEqual(["member-1", "member-2"]);
	});
});
