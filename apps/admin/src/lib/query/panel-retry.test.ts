import {
	onlineManager,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type QueryRetryPort, runQueryRetry } from "./panel-retry.ts";

/**
 * Whether `Try again` actually retries. The defect is invisible: the button presses, no error appears
 * and the screen stays put, because on a paused query with no data `refetch()` returns the existing
 * promise without issuing a request.
 *
 * The opposite side is locked too: do not restart when data exists, or the operator's value
 * disappears and returns once.
 */

const port = (patch: Partial<QueryRetryPort> = {}): QueryRetryPort => ({
	isPaused: false,
	hasData: false,
	syncOnline: vi.fn(),
	restart: vi.fn(async () => undefined),
	refetch: vi.fn(async () => undefined),
	...patch,
});

describe("when paused with no held value", () => {
	it("restarts from scratch rather than refetching", async () => {
		const p = port({ isPaused: true, hasData: false });

		await runQueryRetry(p);

		expect(p.restart).toHaveBeenCalledTimes(1);
		expect(p.refetch).not.toHaveBeenCalled();
	});

	/** A restart pauses again at once if the cache layer still believes it is offline. */
	it("regains the connection state **before** restarting", async () => {
		const order: string[] = [];
		const p = port({
			isPaused: true,
			hasData: false,
			syncOnline: vi.fn(() => {
				order.push("sync");
			}),
			restart: vi.fn(async () => {
				order.push("restart");
			}),
		});

		await runQueryRetry(p);

		expect(order).toEqual(["sync", "restart"]);
	});
});

describe("when a value is held", () => {
	it("does not restart even when paused: the value is not erased", async () => {
		const p = port({ isPaused: true, hasData: true });

		await runQueryRetry(p);

		expect(p.refetch).toHaveBeenCalledTimes(1);
		expect(p.restart).not.toHaveBeenCalled();
	});
});

describe("when not paused", () => {
	/** The default path here: with `networkMode: "always"` a failure arrives as an error, not a pause. */
	it("failure is an ordinary refetch", async () => {
		const p = port({ isPaused: false, hasData: false });

		await runQueryRetry(p);

		expect(p.refetch).toHaveBeenCalledTimes(1);
		expect(p.restart).not.toHaveBeenCalled();
	});

	it("still regains the connection state", async () => {
		const p = port();

		await runQueryRetry(p);

		expect(p.syncOnline).toHaveBeenCalledTimes(1);
	});
});

/**
 * The paused branch rests on one library behavior: a paused query with no data does not issue a
 * request on `refetch()`. That kind of fact can shift silently on an upgrade, so it is exercised
 * here instead of asserted in a comment. Touches the global `onlineManager`, but vitest isolates
 * each file in its own process.
 */

const KEY = ["admin", "panel-retry", "paused"];
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
	onlineManager.setOnline(true);
});

/** A paused query while the cache layer already believes it is online. */
async function stuckPausedQuery() {
	const queryFn = vi.fn(async () => "ok");
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.mount();

	onlineManager.setOnline(false);
	const observer = new QueryObserver(client, { queryKey: KEY, queryFn });
	const unsubscribe = observer.subscribe(() => {});
	await tick();
	expect(observer.getCurrentResult().isPaused).toBe(true);

	/** Connectivity returns while nobody listens: a lost `online` signal. */
	client.unmount();
	onlineManager.setOnline(true);
	client.mount();
	await tick();

	expect(onlineManager.isOnline()).toBe(true);
	expect(observer.getCurrentResult().isPaused).toBe(true);
	queryFn.mockClear();
	return { client, observer, queryFn, unsubscribe };
}

describe("when the connection came back but the query stayed paused", () => {
	it("`refetch()` makes no request", async () => {
		const { client, observer, queryFn, unsubscribe } = await stuckPausedQuery();

		let settled = false;
		const mark = () => {
			settled = true;
		};
		void observer.refetch().then(mark, mark);
		onlineManager.setOnline(true);
		await tick();

		expect(queryFn).not.toHaveBeenCalled();
		expect(settled).toBe(false);
		expect(observer.getCurrentResult().isPaused).toBe(true);

		unsubscribe();
		client.unmount();
	});

	it("restarting from scratch sends a request and the value arrives", async () => {
		const { client, observer, queryFn, unsubscribe } = await stuckPausedQuery();

		await client.resetQueries({ queryKey: KEY });
		await tick();

		expect(queryFn).toHaveBeenCalledTimes(1);
		expect(observer.getCurrentResult().isPaused).toBe(false);
		expect(observer.getCurrentResult().data).toBe("ok");

		unsubscribe();
		client.unmount();
	});
});
