import { afterEach, expect, it, vi } from "vitest";
import { createBrowserMemoryHandle } from "./browser-memory.ts";

class TestWorker extends EventTarget {
	messages: { id: number; op: string; params: object }[] = [];
	terminate = vi.fn();
	postMessage(message: { id: number; op: string; params: object }) {
		this.messages.push(structuredClone(message));
	}
	reply(data: unknown) {
		this.dispatchEvent(new MessageEvent("message", { data }));
	}
}

afterEach(() => vi.restoreAllMocks());

it("loads one worker lazily and correlates concurrent responses by request id", async () => {
	const worker = new TestWorker();
	const create = vi.fn(async () => worker as unknown as Worker);
	const handle = createBrowserMemoryHandle(create);
	expect(create).not.toHaveBeenCalled();
	const first = handle.port.call("status", {});
	const second = handle.port.call("verify", {});
	await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
	worker.reply({ id: 2, ok: true, result: "second" });
	worker.reply({ id: 1, ok: true, result: "first" });
	expect(await first).toBe("first");
	expect(await second).toBe("second");
	expect(create).toHaveBeenCalledTimes(1);
	handle.close();
});

it("a failed operation rejects only its caller and leaves the transport usable", async () => {
	const worker = new TestWorker();
	const handle = createBrowserMemoryHandle(
		async () => worker as unknown as Worker,
	);
	const bad = handle.port.call("ingest", {});
	const rejected = expect(bad).rejects.toThrow("invalid item");
	await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
	worker.reply({ id: 1, ok: false, error: { message: "invalid item" } });
	await rejected;
	const good = handle.port.call("status", {});
	await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
	worker.reply({ id: 2, ok: true, result: "ready" });
	expect(await good).toBe("ready");
	handle.close();
});

it("closing the member scope rejects pending and future calls, including a late worker load", async () => {
	const worker = new TestWorker();
	let finish: (worker: Worker) => void = () => {};
	const handle = createBrowserMemoryHandle(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const pending = handle.port.call("status", {});
	const rejected = expect(pending).rejects.toThrow("closed");
	handle.close();
	finish(worker as unknown as Worker);
	await rejected;
	await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalled());
	expect(worker.messages).toHaveLength(0);
	await expect(handle.port.call("status", {})).rejects.toThrow("closed");
});

it("a crashed or timed-out worker rejects all waiters and is terminated", async () => {
	const deadline = new AbortController();
	vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
	const worker = new TestWorker();
	const handle = createBrowserMemoryHandle(
		async () => worker as unknown as Worker,
	);
	const first = expect(handle.port.call("status", {})).rejects.toThrow(
		"timed out",
	);
	const second = expect(handle.port.call("verify", {})).rejects.toThrow(
		"timed out",
	);
	await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
	deadline.abort();
	await Promise.all([first, second]);
	expect(worker.terminate).toHaveBeenCalledTimes(1);
});
