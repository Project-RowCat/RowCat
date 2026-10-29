import { describe, expect, it } from "vitest";
import { type RuntimeCommandBatch, validateCommandBatch } from "./commands.ts";
import {
	controlIdOf,
	DEFAULT_ROOT_LIMITS,
	handlerIdOf,
	type RuntimePatchBatch,
} from "./patches.ts";
import {
	createRuntimeVmSession,
	type RuntimeRootDiagnostic,
} from "./session.ts";
import { compiled, testEngine } from "./test/fixtures.ts";
import { TestHostTree } from "./testing/host-tree.ts";

/**
 * What a control command becomes after crossing the VM boundary. The in-process tests in
 * `@rowcat/runtime` cover the rule matrix. This file covers what only the boundary can answer: when
 * creator TSX is compiled and runs inside QuickJS, do commands arrive after the commit, does the
 * revision match, and what does validation reject?
 */

const IMPORTS = `import { Button, ScrollView, Stack, Text, TextInput, useScrollController, useState, useTextEntryController } from "@rowcat/runtime";`;

interface Mounted {
	session: Awaited<ReturnType<typeof createRuntimeVmSession>>;
	tree: TestHostTree;
	commits: RuntimePatchBatch[];
	commands: RuntimeCommandBatch[];
	/**
	 * The order in which channel messages arrived. Commit and command ordering is checked here as
	 * values.
	 */
	order: string[];
	diagnostics: RuntimeRootDiagnostic[];
	press(text: string): Promise<void>;
	dispose(): Promise<void>;
}

async function mount(source: string): Promise<Mounted> {
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([
			{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
		]),
	});
	const tree = new TestHostTree();
	const commits: RuntimePatchBatch[] = [];
	const commands: RuntimeCommandBatch[] = [];
	const order: string[] = [];
	const diagnostics: RuntimeRootDiagnostic[] = [];
	const outcome = await session.mountRoot({
		onCommit: (batch) => {
			order.push("commit");
			commits.push(batch);
			tree.apply(batch);
		},
		onCommands: (batch) => {
			order.push("commands");
			commands.push(batch);
		},
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	if (!outcome.ok) throw new Error(`mount failed: ${outcome.error.message}`);
	const press = async (text: string): Promise<void> => {
		const button = tree.findByText(text);
		if (button === null) throw new Error(`no node with text ${text}`);
		const handler = handlerIdOf(button.props.onPress ?? null);
		if (handler === null) throw new Error(`node ${button.id} has no onPress`);
		const result = await session.dispatchEvent(handler);
		if (!result.ok) throw result.error;
		await session.settle();
	};
	return {
		session,
		tree,
		commits,
		commands,
		order,
		diagnostics,
		press,
		dispose: () => session.dispose(),
	};
}

const MESSENGER = `
export default function App() {
	const scroll = useScrollController();
	const reply = useTextEntryController();
	const [rows, setRows] = useState<string[]>(["A"]);
	const [draft, setDraft] = useState("");
	return (
		<Stack>
			<ScrollView controller={scroll}>
				{rows.map((row) => <Text key={row}>{row}</Text>)}
			</ScrollView>
			<TextInput controller={reply} value={draft} onChangeText={setDraft} />
			<Button onPress={() => {
				setRows((current) => [...current, "Row " + String(current.length)]);
				scroll.scrollToEnd();
			}}>Add</Button>
			<Button onPress={() => reply.focus()}>Focus</Button>
			<Button onPress={() => scroll.scrollTo({ offset: 120 })}>Jump</Button>
		</Stack>
	);
}`;

describe("control commands cross the VM", () => {
	it("controller becomes an ordinary prop value, and commands carry only the controller number", async () => {
		const m = await mount(MESSENGER);
		try {
			const scroll = m.tree.root.children[0]?.children[0];
			expect(scroll?.kind).toBe("scroll");
			const control = controlIdOf(scroll?.props.controller ?? null);
			expect(control).toBeTypeOf("number");

			await m.press("Jump");
			expect(m.commands).toHaveLength(1);
			expect(m.commands[0]?.commands).toEqual([
				{ op: "scroll", control, to: "offset", offset: 120 },
			]);
			expect(JSON.stringify(m.commands[0])).not.toContain(`"node"`);
		} finally {
			await m.dispose();
		}
	});

	it("growing the list and scrolling to the end: **the commit arrives first** and the command targets that revision", async () => {
		const m = await mount(MESSENGER);
		try {
			m.order.length = 0;
			await m.press("Add");
			expect(m.order).toEqual(["commit", "commands"]);
			const commit = m.commits.at(-1) as RuntimePatchBatch;
			expect(m.commands[0]?.revision).toBe(commit.revision);
			expect(m.tree.root.children[0]?.children[0]?.children).toHaveLength(2);
		} finally {
			await m.dispose();
		}
	});

	it("commands that change no state come at the current revision without a commit", async () => {
		const m = await mount(MESSENGER);
		try {
			const revision = (m.commits.at(-1) as RuntimePatchBatch).revision;
			const commits = m.commits.length;
			await m.press("Focus");
			expect(m.commits).toHaveLength(commits);
			expect(m.commands).toHaveLength(1);
			expect(m.commands[0]?.revision).toBe(revision);
			expect(m.commands[0]?.commands[0]?.op).toBe("focus");
		} finally {
			await m.dispose();
		}
	});

	it("a command for an unbound controller becomes one warning and does not reach the host", async () => {
		const m = await mount(`
export default function App() {
	const reply = useTextEntryController();
	const [open, setOpen] = useState(false);
	return (
		<Stack>
			{open ? <TextInput controller={reply} value="" /> : null}
			<Button onPress={() => reply.focus()}>Focus</Button>
		</Stack>
	);
}`);
		try {
			await m.press("Focus");
			expect(m.commands).toHaveLength(0);
			expect(m.diagnostics.map((d) => d.code)).toContain(
				"runtime_host_control_unbound",
			);
		} finally {
			await m.dispose();
		}
	});

	it("the session is fine without a consumer: headless does not fail creator code", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([
				{ path: "src/main.tsx", content: `${IMPORTS}\n${MESSENGER}` },
			]),
		});
		const tree = new TestHostTree();
		try {
			const outcome = await session.mountRoot({
				onCommit: (batch) => tree.apply(batch),
			});
			expect(outcome.ok).toBe(true);
			const button = tree.findByText("Focus");
			const handler = handlerIdOf(button?.props.onPress ?? null) as number;
			const result = await session.dispatchEvent(handler);
			expect(result).toEqual({ ok: true, handled: true });
			await session.settle();
			expect(session.state).toBe("ready");
		} finally {
			await session.dispose();
		}
	});
});

const limits = {
	maxCommandsPerBatch: DEFAULT_ROOT_LIMITS.maxCommandsPerBatch,
	maxCommandBytes: DEFAULT_ROOT_LIMITS.maxCommandBytes,
};

const json = (value: unknown): string => JSON.stringify(value);

describe("command bundle validation", () => {
	it("passes a valid bundle", () => {
		const result = validateCommandBatch(
			json({
				revision: 3,
				commands: [
					{ op: "scroll", control: 1, to: "end" },
					{ op: "scroll", control: 1, to: "offset", offset: 0 },
					{ op: "focus", control: 2 },
					{ op: "blur", control: 2 },
				],
			}),
			limits,
			{ revision: 3 },
		);
		expect(result.ok).toBe(true);
	});

	it.each([
		[
			"unknown operation",
			{ revision: 1, commands: [{ op: "zoom", control: 1 }] },
		],
		[
			"not a controller number",
			{ revision: 1, commands: [{ op: "focus", control: "x" }] },
		],
		["controller 0", { revision: 1, commands: [{ op: "focus", control: 0 }] }],
		[
			"unknown scroll target",
			{ revision: 1, commands: [{ op: "scroll", control: 1, to: "middle" }] },
		],
		[
			"negative offset",
			{
				revision: 1,
				commands: [{ op: "scroll", control: 1, to: "offset", offset: -1 }],
			},
		],
		[
			"no offset",
			{ revision: 1, commands: [{ op: "scroll", control: 1, to: "offset" }] },
		],
		["empty bundle", { revision: 1, commands: [] }],
		["no revision", { commands: [{ op: "focus", control: 1 }] }],
	])("%s is refused", (_label, value) => {
		const result = validateCommandBatch(json(value), limits);
		expect(result.ok).toBe(false);
	});

	it("refused when the revision mismatches", () => {
		const result = validateCommandBatch(
			json({ revision: 2, commands: [{ op: "focus", control: 1 }] }),
			limits,
			{ revision: 3 },
		);
		expect(result).toMatchObject({ ok: false, limit: false });
	});

	it("refused with limit past the cap", () => {
		const commands = Array.from({ length: 5 }, () => ({
			op: "focus",
			control: 1,
		}));
		const result = validateCommandBatch(json({ revision: 1, commands }), {
			maxCommandsPerBatch: 4,
			maxCommandBytes: 4096,
		});
		expect(result).toMatchObject({ ok: false, limit: true });
	});

	it("the byte cap is checked before parsing", () => {
		const result = validateCommandBatch("x".repeat(50), {
			maxCommandsPerBatch: 4,
			maxCommandBytes: 10,
		});
		expect(result).toMatchObject({ ok: false, limit: true });
	});
});
