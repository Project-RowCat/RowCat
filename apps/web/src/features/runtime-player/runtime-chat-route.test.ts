import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

/**
 * Checks that `/chat/runtime/:storyId` is not matched as `/chat/:roomId`, i.e. that the router
 * ranks the static `runtime` segment above the dynamic `$roomId` segment. Two addresses sharing a
 * prefix is a product decision (§5), and it holds only if that ranking holds. The ranking belongs
 * to the router library, so the test builds an equivalent tree rather than importing the real route
 * files, which statically pull in Dexie, the worker and the renderer. If the ranking is wrong the
 * symptom is silent: the page shows `Conversation not found` because no room named `runtime` exists on the
 * device.
 */
describe("runtime playback route ranking", () => {
	const root = createRootRoute();
	const chatRoom = createRoute({
		getParentRoute: () => root,
		path: "/chat/$roomId",
	});
	const chatRuntime = createRoute({
		getParentRoute: () => root,
		path: "/chat/runtime/$storyId",
	});
	const chatLibrary = createRoute({
		getParentRoute: () => root,
		path: "/chats",
	});
	const router = createRouter({
		routeTree: root.addChildren([chatRoom, chatRuntime, chatLibrary]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});

	const leaf = (pathname: string) => {
		const matches = router.matchRoutes(pathname, {});
		const last = matches.at(-1);
		if (!last) throw new Error(`${pathname} matched nothing`);
		return last;
	};

	it("the static segment runtime ranks ahead of the dynamic room id", () => {
		const match = leaf("/chat/runtime/story-1");
		expect(match.routeId).toBe(chatRuntime.id);
		expect(match.params).toEqual({ storyId: "story-1" });
	});

	it("a room id still reads as a room", () => {
		const match = leaf("/chat/room-1");
		expect(match.routeId).toBe(chatRoom.id);
		expect(match.params).toEqual({ roomId: "room-1" });
	});

	/**
	 * A lone `/chat/runtime` address is read as a room address, not as a runtime address missing its
	 * story id. No room has that name, so the screen shows `Not found`. That outcome is accepted: room
	 * ids are hyphen-free hex and can never equal the word runtime. The mobile shell's route check
	 * gives the same answer (features/shell/shell-route.test.ts).
	 */
	it("/chat/runtime alone reads as a room address", () => {
		const match = leaf("/chat/runtime");
		expect(match.routeId).toBe(chatRoom.id);
		expect(match.params).toEqual({ roomId: "runtime" });
	});
});
