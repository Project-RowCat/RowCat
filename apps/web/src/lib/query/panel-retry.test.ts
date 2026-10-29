import {
	onlineManager,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PanelRetryPort, runPanelRetry } from "./panel-retry.ts";

/**
 * Checks that retry really retries.
 *
 * The defect this file targets is hard to see. The button is pressed, no error appears, and the
 * screen stays on the paused message. For a paused query with no held value, refetch() just returns
 * the existing promise (query.fetch returns early), so no request goes out.
 *
 * The opposite side matters too: does it avoid restarting when a value exists? Getting that wrong
 * is quieter. A user who pressed retry sees their metric vanish once and come back.
 */

const port = (patch: Partial<PanelRetryPort> = {}): PanelRetryPort => ({
	isPaused: false,
	hasData: false,
	syncOnline: vi.fn(),
	restart: vi.fn(async () => undefined),
	refetch: vi.fn(async () => undefined),
	...patch,
});

describe("when paused with no held value", () => {
	it("it restarts from scratch rather than refetching", async () => {
		const p = port({ isPaused: true, hasData: false });

		await runPanelRetry(p);

		expect(p.restart).toHaveBeenCalledTimes(1);
		expect(p.refetch).not.toHaveBeenCalled();
	});

	/**
	 * Recovers the connection state before restarting. A restart would pause again if the cache layer
	 * still believes it is offline.
	 */
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

		await runPanelRetry(p);

		expect(order).toEqual(["sync", "restart"]);
	});
});

describe("when a value is held", () => {
	/**
	 * The reset clears the value on screen. Even when paused, if a value exists, query.fetch takes
	 * another branch and the refetch runs normally, so there is no reason to clear it.
	 */
	it("does not restart even when paused; does not erase the value", async () => {
		const p = port({ isPaused: true, hasData: true });

		await runPanelRetry(p);

		expect(p.refetch).toHaveBeenCalledTimes(1);
		expect(p.restart).not.toHaveBeenCalled();
	});
});

describe("when not paused", () => {
	it("a failure is an ordinary refetch", async () => {
		const p = port({ isPaused: false, hasData: false });

		await runPanelRetry(p);

		expect(p.refetch).toHaveBeenCalledTimes(1);
		expect(p.restart).not.toHaveBeenCalled();
	});

	/** Recovering the connection state must not be skipped in any branch. */
	it("still regains the connection state", async () => {
		const p = port();

		await runPanelRetry(p);

		expect(p.syncOnline).toHaveBeenCalledTimes(1);
	});
});

/**
 * The rule above rests on one library behavior: refetch() on a paused query with no held value
 * makes no request. If that changes (or is wrongly believed not to hold), this file's rule becomes
 * an unfounded workaround, so it is checked by running code rather than by a comment.
 *
 * This kind of fact can change silently in a version bump. If it breaks, the rule may be simpler
 * than written, but the expected values here should not be edited to match. The test touches the
 * global onlineManager, but vitest splits processes per file (isolate: true).
 */

const KEY = ["panel-retry", "paused"];

afterEach(() => {
	onlineManager.setOnline(true);
});

/**
 * Recreates the reported state: the query is paused, but the cache layer already believes it is
 * online. setOnline notifies only when the value changes, so while that belief holds, firing an
 * online event again wakes nothing and the paused retrier stays stuck.
 */
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

	/** The connection returns while no listener is attached, which is a lost online signal. */
	client.unmount();
	onlineManager.setOnline(true);
	client.mount();
	await tick();

	expect(onlineManager.isOnline()).toBe(true);
	expect(observer.getCurrentResult().isPaused).toBe(true);
	queryFn.mockClear();
	return { client, observer, queryFn, unsubscribe };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("when the connection is back but the query stays paused", () => {
	it("`refetch()` makes no request; its promise never settles", async () => {
		const { client, observer, queryFn, unsubscribe } = await stuckPausedQuery();

		/**
		 * Drops the promise the same way the screen does. This is why the button looks like it does
		 * nothing: no error appears either.
		 */
		let settled = false;
		const mark = () => {
			settled = true;
		};
		void observer.refetch().then(mark, mark);
		/** Does what window's online listener does. The value is unchanged, so no one is notified. */
		onlineManager.setOnline(true);
		await tick();

		expect(queryFn).not.toHaveBeenCalled();
		expect(settled).toBe(false);
		expect(observer.getCurrentResult().isPaused).toBe(true);
		expect(observer.getCurrentResult().data).toBeUndefined();

		unsubscribe();
		client.unmount();
	});

	it("restarting from scratch sends the request and the value arrives", async () => {
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
