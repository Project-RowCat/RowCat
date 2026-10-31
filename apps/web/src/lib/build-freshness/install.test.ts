import type { AnyRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildFreshness } from "./freshness.ts";
import { holdBuildSwitch, installBuildFreshness } from "./index.ts";

/**
 * The router wiring, against a router that records what it was asked. What is pinned is the one place
 * a stale tab changes behaviour: a move to another path goes through the router's own `reloadDocument`
 * (so the draft editor's leave guard still runs), and nothing else does.
 */

function fakeRouter(pathname: string) {
	const navigate = vi.fn(async (_options: Record<string, unknown>) => {});
	const listeners = new Set<() => void>();
	const router = {
		navigate,
		latestLocation: { pathname },
		buildLocation: (options: { to?: string }) => ({
			pathname: options.to ?? pathname,
		}),
		subscribe: (_event: string, listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		router: router as unknown as AnyRouter,
		original: navigate,
		beforeNavigate: () => {
			for (const listener of listeners) listener();
		},
		listenerCount: () => listeners.size,
	};
}

function fakeFreshness(stale: boolean) {
	const check = vi.fn(async (_options?: { force?: boolean }) => stale);
	const freshness: BuildFreshness = { stale: () => stale, check };
	return { freshness, check };
}

function stubBrowser() {
	const win = new EventTarget();
	const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
	vi.stubGlobal(
		"window",
		Object.assign(win, { location: { href: "https://rowcat.test/chats" } }),
	);
	vi.stubGlobal("document", doc);
	return { win, doc };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("installBuildFreshness", () => {
	it("leaves every navigation alone while the tab is current", async () => {
		stubBrowser();
		const { router, original } = fakeRouter("/chats");
		installBuildFreshness(router, fakeFreshness(false).freshness);
		await router.navigate({ to: "/settings" } as never);
		expect(original).toHaveBeenCalledWith({ to: "/settings" });
	});

	it("turns a stale tab's move to another path into a document load", async () => {
		stubBrowser();
		const { router, original } = fakeRouter("/chats");
		installBuildFreshness(router, fakeFreshness(true).freshness);
		await router.navigate({ to: "/settings", replace: true } as never);
		expect(original).toHaveBeenCalledWith({
			to: "/settings",
			replace: true,
			reloadDocument: true,
		});
	});

	it("reads the destination of an href navigation", async () => {
		stubBrowser();
		const { router, original } = fakeRouter("/chats");
		installBuildFreshness(router, fakeFreshness(true).freshness);
		await router.navigate({ href: "/chats?sort=title" } as never);
		expect(original).toHaveBeenLastCalledWith({ href: "/chats?sort=title" });
		await router.navigate({ href: "/create" } as never);
		expect(original).toHaveBeenLastCalledWith({
			href: "/create",
			reloadDocument: true,
		});
	});

	// Password reset strips its token with a same-path replace; a document load would lose it.
	it("keeps a stale tab's same-path navigation a client render", async () => {
		stubBrowser();
		const { router, original } = fakeRouter("/reset-password");
		installBuildFreshness(router, fakeFreshness(true).freshness);
		const options = { to: "/reset-password", search: {}, replace: true };
		await router.navigate(options as never);
		expect(original).toHaveBeenCalledWith(options);
	});

	// A streaming reply, the editor, runtime playback: only their unmount saves what they hold.
	it("stays a client render while work holds the switch, and switches once released", async () => {
		stubBrowser();
		const { router, original } = fakeRouter("/chat/r1");
		installBuildFreshness(router, fakeFreshness(true).freshness);
		const release = holdBuildSwitch();
		await router.navigate({ to: "/chat/r2" } as never);
		expect(original).toHaveBeenLastCalledWith({ to: "/chat/r2" });
		release();
		release();
		await router.navigate({ to: "/chats" } as never);
		expect(original).toHaveBeenLastCalledWith({
			to: "/chats",
			reloadDocument: true,
		});
	});

	// A document load cannot carry history state; the gallery's origin marker rides there.
	it("keeps a navigation that carries history state a client render", async () => {
		stubBrowser();
		const { router, original } = fakeRouter("/");
		installBuildFreshness(router, fakeFreshness(true).freshness);
		const options = { to: "/stories/s1", state: { fromGallery: true } };
		await router.navigate(options as never);
		expect(original).toHaveBeenLastCalledWith(options);
	});

	it("asks on navigation, focus, visibility and reconnect, and at once when a chunk fails", () => {
		const { win, doc } = stubBrowser();
		const { router, beforeNavigate } = fakeRouter("/chats");
		const { freshness, check } = fakeFreshness(false);
		installBuildFreshness(router, freshness);
		beforeNavigate();
		win.dispatchEvent(new Event("focus"));
		win.dispatchEvent(new Event("online"));
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(check).toHaveBeenCalledTimes(4);
		expect(check.mock.calls.every(([options]) => !options?.force)).toBe(true);
		win.dispatchEvent(new Event("vite:preloadError"));
		expect(check).toHaveBeenLastCalledWith({ force: true });
	});

	it("does not ask when the tab is hidden", () => {
		const { doc } = stubBrowser();
		const { router } = fakeRouter("/chats");
		const { freshness, check } = fakeFreshness(false);
		installBuildFreshness(router, freshness);
		doc.visibilityState = "hidden";
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(check).not.toHaveBeenCalled();
	});

	it("undoes itself", () => {
		const { win } = stubBrowser();
		const { router, original, listenerCount } = fakeRouter("/chats");
		const { freshness, check } = fakeFreshness(false);
		const undo = installBuildFreshness(router, freshness);
		undo();
		expect(router.navigate).toBe(original);
		expect(listenerCount()).toBe(0);
		win.dispatchEvent(new Event("focus"));
		expect(check).not.toHaveBeenCalled();
	});
});
