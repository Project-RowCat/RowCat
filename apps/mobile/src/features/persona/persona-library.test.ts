import { personaSnapshotOf } from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	LocalScopeController,
	MobileLocalScope,
} from "../../lib/local-data/activation.ts";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import { resolvePersonaLibraryState } from "./persona-library-state.ts";
import {
	createManagedPersona,
	deleteManagedPersona,
	updateManagedPersona,
} from "./persona-mutations.ts";

/**
 * CRUD for the persona library, **on real SQLite.**
 *
 * It is not replaced with mocks because of what this file defends: whether deleting leaves already
 * started conversations untouched is a question answered only by **re-reading the room record**,
 * and whether the ownership check actually blocks a write needs two store instances to answer.
 */

const ALICE = "alice-viewer-id";
const BOB = "bob-viewer-id";

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let scope: MobileLocalScope;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	scope = await controller.activate(ALICE);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

/** Goes through the **same composition** as the product; the test does not take a shortcut calling the store directly. */
const owned = () => ({
	store: scope.stores.chat,
	owns: (candidate: typeof scope.stores.chat) =>
		controller.current()?.stores.chat === candidate,
});

describe("create · edit · delete", () => {
	it("a created role stays in the list", async () => {
		const outcome = await createManagedPersona(owned(), {
			name: "Detective",
			description: "Someone who observes",
		});
		expect(outcome.status).toBe("done");

		const list = await scope.stores.chat.listPersonas();
		expect(list.map((persona) => persona.name)).toEqual(["Detective"]);
	});

	it("the edited value is saved", async () => {
		const created = await createManagedPersona(owned(), {
			name: "Detective",
			description: "",
		});
		if (created.status !== "done") throw new Error("wasn't created");

		expect(
			await updateManagedPersona(owned(), created.persona.id, {
				name: "Police detective",
				description: "A rewritten description",
			}),
		).toBe("done");

		const list = await scope.stores.chat.listPersonas();
		expect(list.map((persona) => [persona.name, persona.description])).toEqual([
			["Police detective", "A rewritten description"],
		]);
	});

	it("a deleted role disappears from the list", async () => {
		const created = await createManagedPersona(owned(), {
			name: "Detective",
			description: "",
		});
		if (created.status !== "done") throw new Error("wasn't created");

		expect(await deleteManagedPersona(owned(), created.persona.id)).toBe(
			"done",
		);
		expect(await scope.stores.chat.listPersonas()).toEqual([]);
	});
});

describe("deletion doesn't touch conversations already started", () => {
	/**
	 * **P0.** A room holds a **copy of the value**, not the library id (`@rowcat/chat`'s
	 * `persona.ts`). So deleting a library row leaves conversations that ran on that role continuing
	 * with their own copy. Sweeping rooms to clean them up would cause a change the user never asked
	 * for (the conversation's speaker disappearing).
	 */
	it("the room's persona snapshot stays as is", async () => {
		const created = await createManagedPersona(owned(), {
			name: "Detective",
			description: "Someone who observes",
		});
		if (created.status !== "done") throw new Error("wasn't created");

		const room = await scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Case one"),
			title: "Case one",
			persona: personaSnapshotOf(created.persona),
		});
		expect((await scope.stores.chat.getRoom(room.id))?.persona).toEqual({
			name: "Detective",
			description: "Someone who observes",
		});

		await deleteManagedPersona(owned(), created.persona.id);

		/** The library is empty, but the conversation's speaker is unchanged. */
		expect(await scope.stores.chat.listPersonas()).toEqual([]);
		expect((await scope.stores.chat.getRoom(room.id))?.persona).toEqual({
			name: "Detective",
			description: "Someone who observes",
		});
	});

	/**
	 * Editing is the same: to apply an edited value to this conversation the user must **pick it
	 * again**. If editing the library changed the speaker of an old conversation, a conversation the
	 * user never touched would silently change.
	 */
	it("editing leaves the old room's copy as is", async () => {
		const created = await createManagedPersona(owned(), {
			name: "Detective",
			description: "",
		});
		if (created.status !== "done") throw new Error("wasn't created");

		const room = await scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Case two"),
			title: "Case two",
			persona: personaSnapshotOf(created.persona),
		});
		await updateManagedPersona(owned(), created.persona.id, {
			name: "Police detective",
			description: "",
		});

		expect((await scope.stores.chat.getRoom(room.id))?.persona?.name).toBe(
			"Detective",
		);
	});
});

describe("sync records", () => {
	/**
	 * Personas are **synced** local records (this is where they differ from device preferences). The
	 * only added type is `chat.persona`; this checks by value that the settings slice does not create
	 * new types such as `settings.*`.
	 */
	it("writing a persona creates only chat.persona", async () => {
		await createManagedPersona(owned(), { name: "Detective", description: "" });

		const outbound = await scope.stores.sync.collectOutbound({ limit: 50 });
		expect(outbound.records.map((record) => record.type)).toEqual([
			"chat.persona",
		]);
		for (const record of outbound.records)
			expect(record.type).not.toMatch(/^settings\./);
	});
});

describe("account boundary", () => {
	/**
	 * **P0.** The account can change while the form is open. The store captured by that closure is
	 * then someone else's or a closed connection; swapping in the currently open scope would make a
	 * save started on Alice's screen finish in Bob's database.
	 */
	it("a write after an account switch is foreign", async () => {
		const stale = owned();
		await controller.activate(BOB);

		expect(
			(
				await createManagedPersona(stale, {
					name: "Detective",
					description: "",
				})
			).status,
		).toBe("foreign");
		expect(
			await updateManagedPersona(stale, "id", { name: "x", description: "" }),
		).toBe("foreign");
		expect(await deleteManagedPersona(stale, "id")).toBe("foreign");

		/** Nothing was written to Bob's database. */
		expect(await controller.current()?.stores.chat.listPersonas()).toEqual([]);
	});

	/**
	 * **Not judged by member id.** In `Alice → sign out → Alice` the id is the same, but the
	 * connection was closed and reopened in between, and a write aimed at the old instance goes to the
	 * closed connection.
	 */
	it("even for the same member, an old instance is someone else", async () => {
		const stale = owned();
		await controller.release();
		await controller.activate(ALICE);

		expect(
			(
				await createManagedPersona(stale, {
					name: "Detective",
					description: "",
				})
			).status,
		).toBe("foreign");
		expect(await controller.current()?.stores.chat.listPersonas()).toEqual([]);
	});
});

describe("screen state", () => {
	const input = (
		phase: Parameters<typeof resolvePersonaLibraryState>[0]["phase"],
		status: "loading" | "ready" | "error",
		total: number,
	) => resolvePersonaLibraryState({ phase, personas: { status, total } });

	/**
	 * **Storage still opening is not an empty library.** Merging the two would show a person who has
	 * saved roles the "no saved personas" text for one frame every time the screen opens.
	 */
	it("opening and an empty library are different screens", () => {
		expect(input("ready", "loading", 0).kind).toBe("loading");
		expect(input("ready", "ready", 0).kind).toBe("empty");
	});

	/** Identity and storage come **before list results**: this order blocks the frame where the account changes. */
	it("identity comes before the list", () => {
		expect(input("guest", "ready", 3).kind).toBe("guest");
		expect(input("unavailable", "ready", 3).kind).toBe("unavailable");
		expect(input("local-error", "ready", 3).kind).toBe("storage-error");
	});

	/** If a value is held, draw it even when a background refresh fails; clearing it would read as the roles being gone. */
	it("with a held value it's the list even on failure", () => {
		expect(input("ready", "error", 2).kind).toBe("list");
		expect(input("ready", "error", 0).kind).toBe("read-error");
	});
});
