import { isRecord } from "./is-record.ts";
/**
 * Control command protocol: the host-neutral vocabulary the VM root emits and the renderer
 * receives.
 *
 * Flow: QuickJS emits `scroll.scrollToEnd()` as `{ revision, commands: [{ op: "scroll", control: 7,
 * to: "end" }] }`. The host validates it and passes it to `onCommands`. The renderer maps the
 * controller id to the host node it knows and performs the platform action.
 *
 * Why not patches: scroll position and focus are not tree state. As patches, a `set-prop
 * scrollTop=240` would become a value the reconciler compares on every commit, so an unrelated
 * later commit would reset a position the user scrolled by hand. A command happens once, and that
 * nature decides the channel.
 *
 * What this channel does not carry: host node ids, DOM selectors, method names, coordinate objects,
 * animation curves, or durations. It carries one controller id and a finite discriminating
 * vocabulary. The renderer answers which node that controller is from its own table, which ordinary
 * `set-prop` fills.
 *
 * Ordering: `revision` is the version of the tree the command targets. A command sent with a commit
 * carries that commit's revision; a command sent without one carries the current revision. The
 * renderer compares it with its own revision, so out-of-order delivery shows up immediately rather
 * than silently controlling the wrong node.
 */

export type RuntimeHostCommand =
	| {
			readonly op: "scroll";
			readonly control: number;
			readonly to: "start" | "end";
	  }
	| {
			readonly op: "scroll";
			readonly control: number;
			readonly to: "offset";
			readonly offset: number;
	  }
	| { readonly op: "focus"; readonly control: number }
	| { readonly op: "blur"; readonly control: number };

export interface RuntimeCommandBatch {
	readonly revision: number;
	readonly commands: readonly RuntimeHostCommand[];
}

const isControl = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value > 0;

function checkCommand(value: unknown): string | null {
	if (!isRecord(value)) return "command is not an object";
	if (!isControl(value.control)) return "invalid control id";
	switch (value.op) {
		case "scroll":
			if (value.to === "start" || value.to === "end") return null;
			if (value.to !== "offset")
				return `scroll: unknown target ${String(value.to)}`;
			return typeof value.offset === "number" &&
				Number.isFinite(value.offset) &&
				value.offset >= 0
				? null
				: "scroll: offset must be a finite non-negative number";
		case "focus":
		case "blur":
			return null;
		default:
			return `unknown op ${String(value.op)}`;
	}
}

export type CommandBatchValidation =
	| { ok: true; batch: RuntimeCommandBatch }
	| { ok: false; reason: string; limit: boolean };

/**
 * Parses a command batch from JSON emitted by the VM. The input is not trusted: check the length
 * first, then parse, then walk it one entry at a time. Same reasoning as patch batch validation.
 * The VM already validates with the same rules, but that code runs in the creator's realm, so this
 * realm is the final authority.
 */
export function validateCommandBatch(
	json: string,
	limits: { maxCommandsPerBatch: number; maxCommandBytes: number },
	options: { revision?: number } = {},
): CommandBatchValidation {
	if (json.length > limits.maxCommandBytes)
		return {
			ok: false,
			reason: `command batch exceeds ${limits.maxCommandBytes} bytes`,
			limit: true,
		};
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, reason: "malformed json", limit: false };
	}
	if (!isRecord(parsed))
		return { ok: false, reason: "batch is not an object", limit: false };
	const { revision, commands } = parsed;
	if (
		typeof revision !== "number" ||
		!Number.isInteger(revision) ||
		revision < 0
	)
		return { ok: false, reason: "invalid revision", limit: false };
	/**
	 * Commands target the currently committed tree. If the revision differs from the one the host
	 * knows, the batch belongs to a tree that is either stale or not yet arrived. Either way, nothing
	 * guarantees that the target is the node the sender intended.
	 */
	if (options.revision !== undefined && revision !== options.revision)
		return {
			ok: false,
			reason: `commands target revision ${revision}, host is at ${options.revision}`,
			limit: false,
		};
	if (!Array.isArray(commands))
		return { ok: false, reason: "commands is not an array", limit: false };
	if (commands.length === 0)
		return { ok: false, reason: "commands is empty", limit: false };
	if (commands.length > limits.maxCommandsPerBatch)
		return {
			ok: false,
			reason: `batch has ${commands.length} commands, limit is ${limits.maxCommandsPerBatch}`,
			limit: true,
		};
	for (let index = 0; index < commands.length; index += 1) {
		const problem = checkCommand(commands[index]);
		if (problem !== null)
			return {
				ok: false,
				reason: `command ${index}: ${problem}`,
				limit: false,
			};
	}
	return {
		ok: true,
		batch: { revision, commands: commands as RuntimeHostCommand[] },
	};
}
