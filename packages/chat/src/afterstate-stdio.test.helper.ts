import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { AfterstateOp, AfterstatePort } from "./conversation-memory.ts";

/**
 * Test-only client for the `afterstate-bridge` stdio host (the desktop app has its own production
 * client). Tests that use it run the real engine; they are skipped, loudly, when the binary is
 * absent (`AFTERSTATE_BRIDGE_BIN`, or a sibling afterstate checkout's debug build).
 */
export const AFTERSTATE_BRIDGE_BIN =
	process.env.AFTERSTATE_BRIDGE_BIN ??
	fileURLToPath(
		new URL(
			"../../../../../rust/afterstate/target/debug/afterstate-bridge",
			import.meta.url,
		),
	);

export const hasAfterstateBridge = (): boolean =>
	existsSync(AFTERSTATE_BRIDGE_BIN);

export interface StdioAfterstate extends AfterstatePort {
	close(): Promise<void>;
	/** The engine process (resident-memory measurements). */
	readonly pid: number | undefined;
	/** Raw request (for protocol-level assertions). */
	raw(
		op: string,
		params: object,
	): Promise<{ ok: boolean; result?: unknown; error?: { code: string } }>;
}

export async function spawnAfterstate(
	open: object = { store: "memory" },
): Promise<StdioAfterstate> {
	const child = spawn(AFTERSTATE_BRIDGE_BIN, [], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	const { stdin, stdout } = child;
	const pending = new Map<
		number,
		(v: {
			ok: boolean;
			result?: unknown;
			error?: { code: string; message: string };
		}) => void
	>();
	let next = 1;
	const lines = createInterface({ input: stdout });
	lines.on("line", (line) => {
		const v = JSON.parse(line) as { id: number; ok: boolean };
		pending.get(v.id)?.(v);
		pending.delete(v.id);
	});
	const raw = (op: string, params: object) =>
		new Promise<{
			ok: boolean;
			result?: unknown;
			error?: { code: string; message: string };
		}>((resolve) => {
			const id = next++;
			pending.set(id, resolve);
			stdin.write(`${JSON.stringify({ id, op, params })}\n`);
		});
	const opened = await raw("open", open);
	if (!opened.ok)
		throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
	return {
		pid: child.pid,
		raw,
		async call<T>(op: AfterstateOp, params: object): Promise<T> {
			const r = await raw(op, params);
			if (!r.ok) throw new Error(`${op}: ${r.error?.code} ${r.error?.message}`);
			return r.result as T;
		},
		close: () =>
			new Promise<void>((resolve) => {
				child.once("exit", () => resolve());
				stdin.end();
			}),
	};
}
