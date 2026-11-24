import {
	activeUserTools,
	buildChatToolFile,
	ChatUserToolError,
	chatToolImportWrites,
	planChatToolImport,
	readChatToolFile,
	serializeChatToolFile,
} from "@rowcat/chat";
import type { ChatCustomToolDto } from "@rowcat/contracts/chat";
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
import { setManagedRoomToolOverride } from "../chat/room/mutations.ts";
import { resolveToolLibraryState } from "./tool-library-state.ts";
import {
	applyManagedToolImport,
	createManagedTool,
	deleteManagedTool,
	updateManagedTool,
} from "./tool-mutations.ts";

/**
 * The tool library and a room's tool overrides, **on real SQLite**, for the persona library test's
 * reason: whether deleting a tool leaves rooms alone, whether an override survives the room column
 * round trip, and whether the ownership check blocks a write are answered only by re-reading what
 * was committed.
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

const owned = () => ({
	store: scope.stores.chat,
	owns: (candidate: typeof scope.stores.chat) =>
		controller.current()?.stores.chat === candidate,
});

/** The scope shape room mutations take; only the chat store and the predicate are read here. */
const roomScope = () => ({
	...owned(),
	preferences: scope.stores.generation,
	eraseMemory: async () => {},
});

const template = (name: string, body = "Hello {{who}}"): ChatCustomToolDto => ({
	declaration: {
		name,
		description: `The ${name} tool`,
		parameters: [
			{
				name: "who",
				type: "string",
				description: "",
				required: true,
				choices: [],
			},
		],
	},
	action: { kind: "template", template: body },
});

const http = (name: string, key: string): ChatCustomToolDto => ({
	declaration: { name, description: "Looks something up", parameters: [] },
	action: {
		kind: "http",
		url: "https://tools.example.test/lookup",
		method: "POST",
		headers: [{ name: "Authorization", value: key }],
	},
});

const newRoom = () =>
	scope.stores.chat.createRoom({
		originStoryId: null,
		seed: seed("Room"),
		title: "Room",
	});

describe("create · edit · delete", () => {
	it("a created tool stays in the list with its definition", async () => {
		const outcome = await createManagedTool(owned(), {
			tool: template("greet"),
		});
		expect(outcome.status).toBe("done");

		const list = await scope.stores.chat.listUserTools();
		expect(list.map((tool) => tool.tool)).toEqual([template("greet")]);
		/* Omitted means on everywhere: a person who writes a tool wants to use it. */
		expect(list[0]?.enabledByDefault).toBe(true);
	});

	it("the edited definition and default are saved", async () => {
		const created = await createManagedTool(owned(), {
			tool: template("greet"),
		});
		if (created.status !== "done") throw new Error("wasn't created");

		expect(
			await updateManagedTool(owned(), created.tool.id, {
				tool: template("greet", "Hi {{who}}"),
				enabledByDefault: false,
			}),
		).toBe("done");

		const stored = await scope.stores.chat.getUserTool(created.tool.id);
		expect(stored?.tool).toEqual(template("greet", "Hi {{who}}"));
		expect(stored?.enabledByDefault).toBe(false);
	});

	/** Storage does not trust the form: the same gate (`requireUserToolDefinition`) runs on write. */
	it("an invalid definition is refused with its issues, and nothing is written", async () => {
		const created = await createManagedTool(owned(), {
			tool: template("greet"),
		});
		if (created.status !== "done") throw new Error("wasn't created");

		await expect(
			scope.stores.chat.updateUserTool(created.tool.id, {
				tool: template("Not A Name"),
			}),
		).rejects.toBeInstanceOf(ChatUserToolError);
		await expect(
			scope.stores.chat.createUserTool({ tool: template("lore_search") }),
		).rejects.toBeInstanceOf(ChatUserToolError);
		expect(
			(await scope.stores.chat.listUserTools()).map(
				(tool) => tool.tool.declaration.name,
			),
		).toEqual(["greet"]);
	});

	it("a deleted tool disappears and can't be revived by an edit", async () => {
		const created = await createManagedTool(owned(), {
			tool: template("greet"),
		});
		if (created.status !== "done") throw new Error("wasn't created");

		expect(await deleteManagedTool(owned(), created.tool.id)).toBe("done");
		await updateManagedTool(owned(), created.tool.id, {
			enabledByDefault: false,
		});
		expect(await scope.stores.chat.listUserTools()).toEqual([]);
		expect(await scope.stores.chat.getUserTool(created.tool.id)).toBeNull();
	});

	/** Header values are the user's credentials: they are stored as written, on this device. */
	it("http header values round-trip through the column", async () => {
		const created = await createManagedTool(owned(), {
			tool: http("lookup", "Bearer secret-1"),
		});
		if (created.status !== "done") throw new Error("wasn't created");
		const stored = await scope.stores.chat.getUserTool(created.tool.id);
		expect(stored?.tool).toEqual(http("lookup", "Bearer secret-1"));
	});
});

describe("room overrides", () => {
	it("an override is stored, read back and cleared to no key", async () => {
		const room = await newRoom();
		expect(
			await setManagedRoomToolOverride(roomScope(), room.id, "tool-1", false),
		).toBe("done");
		expect((await scope.stores.chat.getRoom(room.id))?.toolOverrides).toEqual({
			"tool-1": false,
		});

		await setManagedRoomToolOverride(roomScope(), room.id, "tool-1", null);
		/* "No overrides" has one shape: the key is absent, not an empty map. */
		const cleared = await scope.stores.chat.getRoom(room.id);
		expect(cleared && "toolOverrides" in cleared).toBe(false);
	});

	it("the room's choice wins over the tool's default", async () => {
		const room = await newRoom();
		const on = await createManagedTool(owned(), { tool: template("greet") });
		const off = await createManagedTool(owned(), {
			tool: template("farewell"),
			enabledByDefault: false,
		});
		if (on.status !== "done" || off.status !== "done")
			throw new Error("weren't created");

		await scope.stores.chat.setRoomToolOverride(room.id, on.tool.id, false);
		await scope.stores.chat.setRoomToolOverride(room.id, off.tool.id, true);

		const current = await scope.stores.chat.getRoom(room.id);
		if (!current) throw new Error("room missing");
		expect(
			activeUserTools(current, await scope.stores.chat.listUserTools()).map(
				(tool) => tool.declaration.name,
			),
		).toEqual(["farewell"]);
	});

	/**
	 * **Deleting a tool never touches rooms.** The override naming it stays and is inert: generation
	 * reads only live tools, so the deleted tool is not declared.
	 */
	it("deleting a tool leaves the room's override and declares nothing", async () => {
		const room = await newRoom();
		const created = await createManagedTool(owned(), {
			tool: template("greet"),
		});
		if (created.status !== "done") throw new Error("wasn't created");
		await scope.stores.chat.setRoomToolOverride(room.id, created.tool.id, true);

		await deleteManagedTool(owned(), created.tool.id);

		const current = await scope.stores.chat.getRoom(room.id);
		expect(current?.toolOverrides).toEqual({ [created.tool.id]: true });
		expect(
			activeUserTools(current ?? {}, await scope.stores.chat.listUserTools()),
		).toEqual([]);
	});

	it("a deleted room is a no-op", async () => {
		const room = await newRoom();
		await scope.stores.chat.deleteRoom(room.id);
		await scope.stores.chat.setRoomToolOverride(room.id, "tool-1", true);
		expect(await scope.stores.chat.getRoom(room.id)).toBeNull();
	});
});

describe("import", () => {
	/**
	 * A whole file round trip: export strips header values, import starts every tool off, and a name
	 * already in the library is skipped unless replaced, in which case the importer's own header
	 * value for the same URL is kept.
	 */
	it("a file's tools arrive off, and replace keeps my key for the same URL", async () => {
		const mine = await createManagedTool(owned(), {
			tool: http("lookup", "Bearer mine"),
		});
		if (mine.status !== "done") throw new Error("wasn't created");

		const { file, strippedHeaders } = buildChatToolFile([
			http("lookup", "Bearer theirs"),
			template("greet"),
		]);
		expect(strippedHeaders).toEqual([
			{ tool: "lookup", header: "Authorization" },
		]);
		const read = readChatToolFile(serializeChatToolFile(file));
		if (!read.ok) throw new Error("file didn't read");

		const library = await scope.stores.chat.listUserTools();
		const plan = planChatToolImport(read.entries, library);
		expect(plan.map((item) => item.status)).toEqual(["name_taken", "new"]);

		/* The default never replaces. */
		const byDefault = chatToolImportWrites(plan, library);
		expect(byDefault.replace).toEqual([]);

		const writes = chatToolImportWrites(plan, library, { 0: "replace" });
		expect(await applyManagedToolImport(owned(), writes)).toEqual({
			status: "done",
			written: 2,
		});

		const after = await scope.stores.chat.listUserTools();
		const greet = after.find((tool) => tool.tool.declaration.name === "greet");
		expect(greet?.enabledByDefault).toBe(false);
		const lookup = after.find((tool) => tool.id === mine.tool.id);
		expect(lookup?.tool.action).toMatchObject({
			kind: "http",
			headers: [{ name: "Authorization", value: "Bearer mine" }],
		});
		/* Replacing patches the definition only; my default stays mine. */
		expect(lookup?.enabledByDefault).toBe(true);
	});
});

describe("sync records", () => {
	it("writing a tool creates only chat.tool", async () => {
		await createManagedTool(owned(), { tool: template("greet") });
		const outbound = await scope.stores.sync.collectOutbound({ limit: 50 });
		expect(outbound.records.map((record) => record.type)).toEqual([
			"chat.tool",
		]);
	});
});

describe("account boundary", () => {
	it("a write after an account switch is foreign", async () => {
		const stale = owned();
		await controller.activate(BOB);

		expect(
			(await createManagedTool(stale, { tool: template("greet") })).status,
		).toBe("foreign");
		expect(
			await updateManagedTool(stale, "id", { enabledByDefault: false }),
		).toBe("foreign");
		expect(await deleteManagedTool(stale, "id")).toBe("foreign");
		expect(
			await applyManagedToolImport(stale, {
				create: [{ tool: template("greet"), enabledByDefault: false }],
				replace: [],
			}),
		).toEqual({ status: "foreign" });

		expect(await controller.current()?.stores.chat.listUserTools()).toEqual([]);
	});
});

describe("screen state", () => {
	const input = (
		phase: Parameters<typeof resolveToolLibraryState>[0]["phase"],
		status: "loading" | "ready" | "error",
		total: number,
	) => resolveToolLibraryState({ phase, tools: { status, total } });

	it("opening and an empty library are different screens", () => {
		expect(input("ready", "loading", 0).kind).toBe("loading");
		expect(input("ready", "ready", 0).kind).toBe("empty");
	});

	it("identity comes before the list", () => {
		expect(input("guest", "ready", 3).kind).toBe("guest");
		expect(input("unavailable", "ready", 3).kind).toBe("unavailable");
		expect(input("local-error", "ready", 3).kind).toBe("storage-error");
	});

	it("with a held value it's the list even on failure", () => {
		expect(input("ready", "error", 2).kind).toBe("list");
		expect(input("ready", "error", 0).kind).toBe("read-error");
	});
});
