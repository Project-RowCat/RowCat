import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **A new room is a new screen instance** — the room route's twin of `runtime-chat-route.test.ts`.
 * The screen holds per-room state (the composer draft, search, the generation hook) that must not
 * carry from one room to the next, and this app's tests do not render, so the key is pinned by value.
 */
const route = readFileSync(
	fileURLToPath(new URL("../../app/chat/[roomId].tsx", import.meta.url)),
	"utf8",
);

describe("conversation route", () => {
	it("keys the screen on the room id", () => {
		expect(route).toMatch(/<ChatScreen\s+key=\{id\}\s+roomId=\{id\}\s*\/>/);
	});
});
