import { randomBytes, randomUUID } from "node:crypto";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
	authoringSyncCodecs,
	createDraftRuntimeFileRecord,
	createDraftRuntimeProjectRecord,
	createStoryDraftRecord,
} from "@rowcat/authoring";
import { createRowCatClient } from "@rowcat/sdk";
import {
	bytesToB64,
	createKeyring,
	decryptRecord,
	encryptRecord,
	nobleAead,
} from "@rowcat/sync";

/**
 * Runs one authoring loop through the installed executable, with a real account, real API and real
 * QuickJS. `verify-package.ts` only answers whether the installed copy stands; this answers what
 * the product actually does.
 *
 * Flow: this script (acting as the other device) creates an account, sets up the keyring and plants
 * a runtime draft on the server; it then starts the installed `rowcat-mcp serve` and drives it over
 * MCP JSON-RPC through list, read, write, compile, preview, tree, press, console/state and stop;
 * the other device downloads again to see that the edit really came through the server; and a write
 * with a stale fingerprint must get `file_conflict`.
 *
 * This script plays the other device because an E2EE round trip only holds when two devices go
 * through the same server. Writing and reading inside one process passes values through memory and
 * says nothing about whether the server kept the ciphertext or whether another device can open it.
 * So this process goes through the envelope crypto directly on both the planting and verifying
 * sides, and only the middle operations are done by the installed copy.
 *
 * It is not run automatically: it creates an account on a live RowCat API, and `pnpm test` running
 * it would make CI create accounts. A person invokes it:
 *
 * ```bash
 * ROWCAT_API_BASE_URL=http://localhost:3001/v2 \
 *   tsx apps/mcp/scripts/verify-installed-loop.ts [executable path]
 * ```
 */

const BASE = process.env.ROWCAT_API_BASE_URL ?? "http://localhost:3001/v2";
const BIN = process.argv[2] ?? "rowcat-mcp";

const say = (line: string): void => {
	process.stderr.write(`${line}\n`);
};

const failures: string[] = [];
const check = (ok: boolean, label: string, detail?: string): void => {
	say(
		`  ${ok ? "✓" : "✗"} ${label}${detail === undefined ? "" : ` — ${detail}`}`,
	);
	if (!ok) failures.push(label);
};

const cookieOf = (response: Response): string =>
	(response.headers.getSetCookie?.() ?? [])
		.map((line) => line.split(";")[0] ?? "")
		.filter((pair) => pair.includes("="))
		.join("; ");

async function createAccount(): Promise<{ cookie: string; id: string }> {
	const email = `mcp-canary-${Date.now()}@rowcat.test`;
	const password = `canary-${randomUUID().slice(0, 12)}`;
	/** States the origin for the same reason the product's `signIn` does; Node's fetch gets a 403 without it. */
	const origin = new URL(BASE).origin;
	const signUp = await fetch(`${BASE}/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: origin },
		body: JSON.stringify({ email, password, name: "MCP Canary" }),
	});
	if (!signUp.ok) throw new Error(`sign-up failed HTTP ${signUp.status}`);
	let cookie = cookieOf(signUp);
	if (cookie === "") {
		const signIn = await fetch(`${BASE}/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: origin },
			body: JSON.stringify({ email, password }),
		});
		if (!signIn.ok) throw new Error(`sign-in failed HTTP ${signIn.status}`);
		cookie = cookieOf(signIn);
	}
	if (cookie === "")
		throw new Error(
			"No session was created: the deployment may require email verification.",
		);
	const me = await fetch(`${BASE}/me`, { headers: { Cookie: cookie } });
	const viewer = (await me.json()) as { id?: string };
	if (typeof viewer.id !== "string") throw new Error("/me returned no member");
	return { cookie, id: viewer.id };
}

const codecFor = (type: string) => {
	const codec = authoringSyncCodecs.find((entry) => entry.type === type);
	if (codec === undefined) throw new Error(`no codec: ${type}`);
	return codec;
};

const REV = { t: 1, c: 0, d: "canary" };
const NOW = new Date().toISOString();

async function main(): Promise<void> {
	say("");
	say(`One authoring loop with the installed RowCat MCP: ${BASE}`);
	say("");
	say("① Account and keyring");
	const account = await createAccount();
	const client = createRowCatClient({
		baseUrl: BASE,
		headers: { Cookie: account.cookie },
	});
	const dek = new Uint8Array(randomBytes(32));
	const created = await createKeyring(account.id, dek, nobleAead);
	await client.sync.setupKeyring({
		keyring: created.keyring,
		authKey: created.authKey,
	});
	check(true, "created an account and set up the sync keyring", account.id);

	say("");
	say("② Another device plants a runtime draft on the server");
	const draftId = randomUUID().replace(/-/g, "");
	const fileId = randomUUID().replace(/-/g, "");
	const ORIGINAL = `import { Screen, Text } from "@rowcat/runtime";

export default function App() {
	return (
		<Screen>
			<Text>First screen</Text>
		</Screen>
	);
}
`;
	const envelope = async (
		type: string,
		record: { readonly id: string },
	): Promise<string> => {
		const codec = codecFor(type);
		return encryptRecord(
			dek,
			{ owner: account.id, recordId: record.id, type },
			{
				schemaVersion: codec.schemaVersion,
				rev: REV,
				deletedAt: null,
				data: codec.encode(record as never),
			},
			nobleAead,
		);
	};
	const draft = createStoryDraftRecord(
		{ title: "MCP canary" },
		{ id: draftId, now: NOW, rev: REV },
	);
	/**
	 * The project record is planted with the identity the product creates
	 * (`authoring-runtime:<draft>`). The contract once rejected colons and this changed the id as a
	 * workaround; leaving that in would mean this check never sends the shape the product really
	 * uploads to a real server.
	 */
	const project = createDraftRuntimeProjectRecord(
		{ draftId },
		{ now: NOW, rev: REV },
	);
	const file = createDraftRuntimeFileRecord(
		{ draftId, path: "src/main.tsx", content: ORIGINAL },
		{ id: fileId, now: NOW, rev: REV },
	);
	await client.sync.push({
		idempotencyKey: randomUUID(),
		items: [
			{
				id: draft.id,
				type: "authoring.draft",
				baseVersion: 0,
				ciphertext: await envelope("authoring.draft", draft),
				envelope: 1,
				deleted: false,
			},
			{
				id: project.id,
				type: "authoring.runtimeProject",
				baseVersion: 0,
				ciphertext: await envelope("authoring.runtimeProject", project),
				envelope: 1,
				deleted: false,
			},
			{
				id: file.id,
				type: "authoring.runtimeFile",
				baseVersion: 0,
				ciphertext: await envelope("authoring.runtimeFile", file),
				envelope: 1,
				deleted: false,
			},
		],
	});
	check(true, "uploaded the draft, runtime project and src/main.tsx", draftId);

	say("");
	say(`③ Launch the installed executable: ${BIN} serve`);
	const mcp = new McpProcess(BIN, {
		ROWCAT_API_BASE_URL: BASE,
		ROWCAT_SESSION_COOKIE: account.cookie,
		ROWCAT_SYNC_KEY: bytesToB64(dek),
	});
	try {
		const init = await mcp.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "rowcat-canary", version: "0" },
		});
		mcp.notify("notifications/initialized", {});
		check(
			(init as { serverInfo?: { name?: string } }).serverInfo?.name ===
				"rowcat-runtime",
			"MCP initialize",
			(init as { serverInfo?: { version?: string } }).serverInfo?.version,
		);

		const listed = (await mcp.request("tools/list", {})) as {
			tools: { name: string }[];
		};
		const names = new Set(listed.tools.map((tool) => tool.name));
		check(listed.tools.length > 0, "the client discovers tools", `${listed.tools.length}`);
		check(
			[...names].every((name) => /^[A-Za-z0-9_-]+$/.test(name)),
			"tool names have no dots",
		);

		say("");
		say("④ One authoring loop");
		const projects = (await mcp.call("runtime_list_projects", {})) as {
			projects: { draftId: string }[];
		};
		check(
			projects.projects.some((entry) => entry.draftId === draftId),
			"runtime_list_projects sees this draft",
		);

		await mcp.call("runtime_get_project", { draftId });
		const files = (await mcp.call("runtime_list_files", { draftId })) as {
			files: { path: string }[];
		};
		check(
			files.files.some((entry) => entry.path === "src/main.tsx"),
			"runtime_list_files",
		);

		const read = (await mcp.call("runtime_read_file", {
			draftId,
			path: "src/main.tsx",
		})) as { content: string; hash: string };
		check(read.content === ORIGINAL, "runtime_read_file equals the original");

		const EDITED = ORIGINAL.replace(
			"<Text>First screen</Text>",
			`<Button onPress={() => setCount(count + 1)}>Press me {count}</Button>`,
		)
			.replace(
				'import { Screen, Text } from "@rowcat/runtime";',
				'import { Button, Screen, useState } from "@rowcat/runtime";',
			)
			.replace(
				"export default function App() {",
				"export default function App() {\n\tconst [count, setCount] = useState(0);",
			);
		const written = (await mcp.call("runtime_write_file", {
			draftId,
			path: "src/main.tsx",
			content: EDITED,
			expectedHash: read.hash,
		})) as { hash: string };
		check(
			typeof written.hash === "string" && written.hash !== read.hash,
			"runtime_write_file (with expectedHash)",
		);

		const compiled = (await mcp.call("runtime_compile", { draftId })) as {
			ok: boolean;
			errors: number;
			diagnostics: { message: string }[];
		};
		check(
			compiled.ok,
			"runtime_compile",
			compiled.ok ? undefined : compiled.diagnostics[0]?.message,
		);

		const started = (await mcp.call("runtime_preview_start", { draftId })) as {
			status: string;
		};
		check(
			started.status === "running",
			"runtime_preview_start (QuickJS)",
			started.status,
		);

		const tree = (await mcp.call("runtime_preview_get_tree", {})) as {
			root?: unknown;
		};
		const flat = JSON.stringify(tree);
		check(flat.includes("Press me"), "runtime_preview_get_tree returns the screen");

		const button = findPressable(tree);
		check(
			button !== null,
			"found a pressable node in the tree",
			button === null ? undefined : String(button),
		);
		if (button !== null) {
			await mcp.call("runtime_preview_press", { nodeId: button });
			const after = JSON.stringify(
				await mcp.call("runtime_preview_get_tree", {}),
			);
			check(
				after.includes("1") && after !== flat,
				"runtime_preview_press changes the screen",
			);
		}

		await mcp.call("runtime_preview_get_console", {});
		await mcp.call("runtime_preview_get_state", {});
		check(true, "runtime_preview_get_console · runtime_preview_get_state");

		const stopped = (await mcp.call("runtime_preview_stop", {})) as {
			status: string;
		};
		check(stopped.status !== "running", "runtime_preview_stop", stopped.status);

		say("");
		say("⑤ Another device sees that edit (E2EE round trip)");
		const pulled = await client.sync.pull({ since: 0, limit: 200 });
		let seen: string | null = null;
		for (const row of pulled.records) {
			if (row.type !== "authoring.runtimeFile" || row.ciphertext === null)
				continue;
			const opened = (await decryptRecord(
				dek,
				{ owner: account.id, recordId: row.id, type: row.type },
				row.ciphertext,
				nobleAead,
			)) as Record<string, unknown>;
			const envelopeBody = opened as {
				schemaVersion: number;
				rev: unknown;
				deletedAt: string | null;
				data: unknown;
			};
			const decoded = codecFor("authoring.runtimeFile").decode({
				id: row.id,
				schemaVersion: envelopeBody.schemaVersion,
				rev: envelopeBody.rev,
				deletedAt: envelopeBody.deletedAt,
				data: envelopeBody.data,
			} as never) as { content?: string } | null;
			if (typeof decoded?.content === "string") seen = decoded.content;
		}
		check(
			seen === EDITED,
			"the studio-side device receives the MCP edit as is",
			seen === null ? "could not open the record" : undefined,
		);

		say("");
		say("⑥ Writing with a stale fingerprint is a conflict");
		const stale = await mcp.callRaw("runtime_write_file", {
			draftId,
			path: "src/main.tsx",
			content: "// overwrite attempt\n",
			expectedHash: read.hash,
		});
		check(
			stale.isError === true && JSON.stringify(stale).includes("file_conflict"),
			"file_conflict",
			stale.isError === true ? undefined : "it was not a conflict",
		);
	} finally {
		await mcp.stop();
	}

	say("");
	if (failures.length > 0) {
		say(`✗ ${failures.length} failed`);
		for (const failure of failures) say(`   ${failure}`);
		process.exit(1);
	}
	say("✓ The installed executable completed one authoring loop.");
}

/**
 * The first pressable node, found by reading the tree's own `actions`. It does not look for the
 * component name (`Button`) because that is product vocabulary this check does not ask about; an
 * agent makes the same judgment: does this node carry `press`.
 */
function findPressable(node: unknown): number | null {
	if (typeof node !== "object" || node === null) return null;
	const row = node as {
		nodeId?: unknown;
		actions?: unknown;
		children?: unknown;
	};
	if (
		Array.isArray(row.actions) &&
		row.actions.includes("press") &&
		typeof row.nodeId === "number"
	)
		return row.nodeId;
	if (Array.isArray(row.children))
		for (const child of row.children) {
			const found = findPressable(child);
			if (found !== null) return found;
		}
	for (const value of Object.values(row))
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			const found = findPressable(value);
			if (found !== null) return found;
		}
	return null;
}

/**
 * A minimal MCP client: line-delimited JSON-RPC is all there is. The SDK client is not used because
 * this check asks about the installed process, not the protocol; connecting with this repository's
 * SDK would be a conversation between versions we know, not the same conditions as someone else's
 * client launching it.
 */
class McpProcess {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	private buffer = "";
	private nextId = 1;

	constructor(bin: string, env: Record<string, string>) {
		this.child = spawn(bin, ["serve"], {
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		}) as ChildProcessWithoutNullStreams;
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
		this.child.stderr.setEncoding("utf8");
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let index = this.buffer.indexOf("\n");
		while (index !== -1) {
			const line = this.buffer.slice(0, index).trim();
			this.buffer = this.buffer.slice(index + 1);
			if (line !== "") this.onLine(line);
			index = this.buffer.indexOf("\n");
		}
	}

	private onLine(line: string): void {
		let message: { id?: number; result?: unknown; error?: { message?: string } };
		try {
			message = JSON.parse(line) as typeof message;
		} catch {
			throw new Error(`something other than JSON got mixed into stdout: ${line.slice(0, 120)}`);
		}
		if (typeof message.id !== "number") return;
		const waiting = this.pending.get(message.id);
		if (waiting === undefined) return;
		this.pending.delete(message.id);
		if (message.error !== undefined)
			waiting.reject(new Error(message.error.message ?? "unknown error"));
		else waiting.resolve(message.result);
	}

	request(method: string, params: unknown): Promise<unknown> {
		const id = this.nextId++;
		const frame = { jsonrpc: "2.0", id, method, params };
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.child.stdin.write(`${JSON.stringify(frame)}\n`);
			setTimeout(() => {
				if (this.pending.delete(id))
					reject(new Error(`no response to ${method}`));
			}, 60_000).unref();
		});
	}

	notify(method: string, params: unknown): void {
		this.child.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
		);
	}

	async callRaw(
		name: string,
		args: unknown,
	): Promise<{ isError?: boolean; content?: { text?: string }[] }> {
		return (await this.request("tools/call", {
			name,
			arguments: args,
		})) as { isError?: boolean; content?: { text?: string }[] };
	}

	async call(name: string, args: unknown): Promise<unknown> {
		const result = await this.callRaw(name, args);
		const text = result.content?.[0]?.text ?? "null";
		if (result.isError === true) throw new Error(`${name}: ${text}`);
		return JSON.parse(text) as unknown;
	}

	async stop(): Promise<void> {
		this.child.kill("SIGTERM");
		await new Promise((resolve) => this.child.once("exit", resolve));
	}
}

await main();
