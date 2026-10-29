import { describe, expect, test } from "vitest";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "./errors.ts";
import { RUNTIME_MCP_LIMITS } from "./limits.ts";
import type { RuntimeMcpPreviewStatusView } from "./preview/session.ts";
import type {
	RuntimeMcpTreeNode,
	RuntimeMcpTreeSnapshot,
} from "./preview/tree.ts";
import {
	CHAPTERS,
	CONTROLS,
	COUNTER,
	createHarness,
	createTestClock,
	MIRROR,
	seedProject,
	THROWS,
} from "./test/harness.ts";

/**
 * Preview tests run through the real compiler and the real QuickJS. They verify that the protocol
 * actually holds: pressing yields a commit, the commit applies to the tree, and an operation aimed
 * at a stale node number does not reach a different node. Doubles cannot establish any of that.
 */

const DRAFT = "draft-preview";

const flatten = (node: RuntimeMcpTreeNode): RuntimeMcpTreeNode[] => [
	node,
	...(node.children ?? []).flatMap(flatten),
];

const textOf = (tree: RuntimeMcpTreeSnapshot): string[] =>
	flatten(tree.root)
		.map((node) => node.text)
		.filter((text): text is string => text !== undefined);

const find = (
	tree: RuntimeMcpTreeSnapshot,
	predicate: (node: RuntimeMcpTreeNode) => boolean,
): RuntimeMcpTreeNode => {
	const found = flatten(tree.root).find(predicate);
	if (found === undefined) throw new Error("no such node");
	return found;
};

describe("preview lifetime", () => {
	test("starting returns the tree the creator drew", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, COUNTER)] });
		const status = (await harness.call("runtime_preview_start", {
			draftId: DRAFT,
		})) as RuntimeMcpPreviewStatusView;
		expect(status.status).toBe("running");
		expect(status.compile?.ok).toBe(true);

		const tree = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(tree.root.type).toBe("#root");
		expect(tree.root.children?.[0]?.type).toBe("Screen");
		expect(textOf(tree)).toContain("0");
		expect(textOf(tree)).toContain("Add");
		await harness.dispose();
	});

	test("does not stand a VM when compilation fails", async () => {
		const harness = createHarness({
			seeds: [seedProject(DRAFT, "export default 123;\n")],
		});
		const status = (await harness.call("runtime_preview_start", {
			draftId: DRAFT,
		})) as RuntimeMcpPreviewStatusView;
		expect(status.status).toBe("compile_failed");
		expect(status.compile?.ok).toBe(false);
		expect(status.compile?.errors).toBeGreaterThan(0);

		/** In that state, asking for the tree reports 'not running', not an empty tree. */
		await expect(
			harness.call("runtime_preview_get_tree"),
		).rejects.toMatchObject({
			code: RUNTIME_MCP_ERROR_CODE.previewNotRunning,
		});
		await harness.dispose();
	});

	test("takes no operations after stopping", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, COUNTER)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const stopped = (await harness.call(
			"runtime_preview_stop",
		)) as RuntimeMcpPreviewStatusView;
		expect(stopped.status).toBe("stopped");
		await expect(
			harness.call("runtime_preview_get_tree"),
		).rejects.toMatchObject({
			code: RUNTIME_MCP_ERROR_CODE.previewNotRunning,
		});
	});

	test("operating a preview that is not running points at starting", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, COUNTER)] });
		await expect(
			harness.call("runtime_preview_get_tree"),
		).rejects.toMatchObject({
			code: RUNTIME_MCP_ERROR_CODE.previewNotRunning,
		});
	});

	/**
	 * Warning: this test catches a defect in the earlier design. It never calls a tool. In that
	 * design, idle cleanup ran only on the next tool call, so nothing happened in this scenario. An
	 * agent that leaves the connection idle while it works elsewhere is the common case, and the cost
	 * is high: the QuickJS/WASM session stays alive for as long as the connection does.
	 */
	test("idle sessions disappear on their own even if nobody calls", async () => {
		const clock = createTestClock();
		const harness = createHarness({
			seeds: [seedProject(DRAFT, COUNTER)],
			clock,
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		expect(harness.preview.current()).not.toBeNull();

		clock.advance(RUNTIME_MCP_LIMITS.previewIdleMs - 1);
		expect(harness.preview.current()).not.toBeNull();

		clock.advance(2);
		expect(harness.preview.current()).toBeNull();
		/**
		 * After the session is released, no timer should remain. Otherwise the process wakes up again.
		 */
		expect(clock.pending()).toBe(0);
		await harness.dispose();
	});

	test("operations extend the lifetime by that much", async () => {
		const clock = createTestClock();
		const harness = createHarness({
			seeds: [seedProject(DRAFT, COUNTER)],
			clock,
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });

		clock.advance(RUNTIME_MCP_LIMITS.previewIdleMs - 1_000);
		await harness.call("runtime_preview_get_tree");

		/**
		 * The first timer wakes at this time. Because an operation happened, it re-measures rather than
		 * killing the session.
		 */
		clock.advance(2_000);
		expect(harness.preview.current()).not.toBeNull();

		clock.advance(RUNTIME_MCP_LIMITS.previewIdleMs);
		expect(harness.preview.current()).toBeNull();
		await harness.dispose();
	});

	/**
	 * Status queries are observation only. If polling alone kept a forgotten VM alive, the state this
	 * limit exists to prevent would persist.
	 */
	test("status lookups do not extend the lifetime", async () => {
		const clock = createTestClock();
		const harness = createHarness({
			seeds: [seedProject(DRAFT, COUNTER)],
			clock,
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		clock.advance(RUNTIME_MCP_LIMITS.previewIdleMs - 1_000);
		await harness.call("runtime_preview_status");
		clock.advance(2_000);
		expect(harness.preview.current()).toBeNull();
		await harness.dispose();
	});

	/**
	 * A stale timer must not kill a new session. Without an identity check, a timer meant to clean up
	 * session A would shut down session B that replaced it in the meantime. The symptom looks like
	 * 'the preview died for no reason', and it cannot be reproduced.
	 */
	test("an earlier timer does not kill the session that replaced it", async () => {
		const clock = createTestClock();
		const harness = createHarness({
			seeds: [seedProject(DRAFT, COUNTER), seedProject("draft-b", COUNTER)],
			clock,
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		clock.advance(RUNTIME_MCP_LIMITS.previewIdleMs - 1_000);
		await harness.call("runtime_preview_start", { draftId: "draft-b" });

		clock.advance(2_000);
		expect(harness.preview.current()?.draftId).toBe("draft-b");
		await harness.dispose();
	});

	test("an explicit stop clears the timer too", async () => {
		const clock = createTestClock();
		const harness = createHarness({
			seeds: [seedProject(DRAFT, COUNTER)],
			clock,
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		await harness.call("runtime_preview_stop");
		expect(clock.pending()).toBe(0);

		/** No timer remains, so advancing the clock does not cause a second disposal. */
		clock.advance(RUNTIME_MCP_LIMITS.previewIdleMs * 2);
		expect(harness.preview.current()).toBeNull();
		await harness.dispose();
	});

	test("when the connection ends the timer disappears and the VM is released", async () => {
		const clock = createTestClock();
		const harness = createHarness({
			seeds: [seedProject(DRAFT, COUNTER)],
			clock,
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		await harness.dispose();
		expect(clock.pending()).toBe(0);
		expect(harness.preview.current()).toBeNull();
		/** Idempotent: calling dispose a second time does nothing. */
		await harness.dispose();
	});
});

describe("structural interaction", () => {
	test("pressing changes state and the tree draws it", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, COUNTER)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const before = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		const button = find(before, (node) => node.type === "Button");
		expect(button.actions).toEqual(["press"]);

		const pressed = (await harness.call("runtime_preview_press", {
			nodeId: button.nodeId,
		})) as { handled: boolean; changed: boolean; revision: number };
		expect(pressed.handled).toBe(true);
		expect(pressed.changed).toBe(true);
		expect(pressed.revision).toBeGreaterThan(before.revision);

		const after = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(textOf(after)).toContain("1");
		expect(textOf(after)).not.toContain("0");
		await harness.dispose();
	});

	/**
	 * Control commands are observed. This is not browser automation, and not pixels. Headless has no
	 * layout, so there is no value to fabricate, and a fabricated number would be unrelated to the
	 * real screen.
	 */
	test("scroll and focus are observed as intents", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, CONTROLS)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const before = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		/** The controller number is host identity, so it never reaches the agent. */
		const scroll = find(before, (node) => node.type === "ScrollView");
		expect(scroll.props?.controller).toBeUndefined();
		expect(before.scroll).toBeUndefined();

		const buttons = flatten(before.root).filter(
			(node) => node.type === "Button",
		);
		const send = buttons[0] as RuntimeMcpTreeNode;
		const focus = buttons[1] as RuntimeMcpTreeNode;
		const blur = buttons[2] as RuntimeMcpTreeNode;

		await harness.call("runtime_preview_press", { nodeId: send.nodeId });
		const grown = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(grown.scroll).toEqual({ nodeId: scroll.nodeId, to: "end" });

		await harness.call("runtime_preview_press", { nodeId: focus.nodeId });
		const focused = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(find(focused, (node) => node.type === "TextInput").focused).toBe(
			true,
		);

		await harness.call("runtime_preview_press", { nodeId: blur.nodeId });
		const blurred = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(
			find(blurred, (node) => node.type === "TextInput").focused,
		).toBeUndefined();
		await harness.dispose();
	});

	test("entering text makes the controlled value follow", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, MIRROR)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const tree = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		const input = find(tree, (node) => node.type === "TextInput");
		expect(input.actions).toEqual(["input", "submit"]);

		await harness.call("runtime_preview_input", {
			nodeId: input.nodeId,
			text: "hello there",
		});
		const typed = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(textOf(typed)).toContain("hello there");
		expect(find(typed, (node) => node.type === "TextInput").props?.value).toBe(
			"hello there",
		);

		/** Submit does not carry text. The earlier input already passed the value. */
		await harness.call("runtime_preview_submit", { nodeId: input.nodeId });
		const sent = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(textOf(sent).join(" ")).toContain("Sent");
		expect(textOf(sent)).toContain("hello there");
		await harness.dispose();
	});

	test("an operation pointing at a vanished node does not go to another node", async () => {
		const harness = createHarness({
			seeds: [
				seedProject(
					DRAFT,
					`import { Button, Screen, Stack, Text, useState } from "@rowcat/runtime";

export default function App() {
	const [open, setOpen] = useState(true);
	return (
		<Screen>
			<Stack>
				{open ? <Button onPress={() => setOpen(false)}>Close</Button> : <Text>closed</Text>}
				<Button onPress={() => setOpen(true)}>Open</Button>
			</Stack>
		</Screen>
	);
}
`,
				),
			],
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const tree = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		const close = find(
			tree,
			(node) => node.type === "Button" && node.text === "Close",
		);
		await harness.call("runtime_preview_press", { nodeId: close.nodeId });

		try {
			await harness.call("runtime_preview_press", { nodeId: close.nodeId });
			throw new Error("a stale number passed");
		} catch (error) {
			expect(error).toBeInstanceOf(RuntimeMcpError);
			const failure = error as RuntimeMcpError;
			expect(failure.code).toBe(RUNTIME_MCP_ERROR_CODE.staleNode);
			expect(failure.details?.currentRevision).toBeTypeOf("number");
		}
		await harness.dispose();
	});

	test("a number that never existed is not stale", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, COUNTER)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		await expect(
			harness.call("runtime_preview_press", { nodeId: 9_999 }),
		).rejects.toMatchObject({ code: RUNTIME_MCP_ERROR_CODE.nodeNotFound });
		await harness.dispose();
	});

	test("a node that cannot be pressed says so", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, COUNTER)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const tree = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		const text = find(tree, (node) => node.type === "Text");
		await expect(
			harness.call("runtime_preview_press", { nodeId: text.nodeId }),
		).rejects.toMatchObject({
			code: RUNTIME_MCP_ERROR_CODE.nodeNotInteractable,
		});
		await harness.dispose();
	});

	test("a disabled button has an empty action list and cannot be pressed", async () => {
		const harness = createHarness({
			seeds: [
				seedProject(
					DRAFT,
					`import { Button, Screen, Stack } from "@rowcat/runtime";

export default function App() {
	return (
		<Screen>
			<Stack>
				<Button disabled onPress={() => {}}>Locked</Button>
			</Stack>
		</Screen>
	);
}
`,
				),
			],
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const tree = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		const button = find(tree, (node) => node.type === "Button");
		expect(button.actions).toBeUndefined();
		await expect(
			harness.call("runtime_preview_press", { nodeId: button.nodeId }),
		).rejects.toMatchObject({
			code: RUNTIME_MCP_ERROR_CODE.nodeNotInteractable,
		});
		await harness.dispose();
	});
});

describe("the weight of failures", () => {
	test("a creator's render exception does not kill the session", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, THROWS)] });
		const status = (await harness.call("runtime_preview_start", {
			draftId: DRAFT,
		})) as RuntimeMcpPreviewStatusView;
		expect(status.status).toBe("running");
		expect(status.creatorError?.kind).toBe("creator");
		expect(status.creatorError?.message).toContain(
			"an error the author raised",
		);
		expect(status.failure).toBeNull();
		await harness.dispose();
	});

	test("the console reads on by sequence number", async () => {
		const harness = createHarness({
			seeds: [
				seedProject(
					DRAFT,
					`import { Screen, Text } from "@rowcat/runtime";

console.log("first line", 1);
console.warn("second line");

export default function App() {
	return (
		<Screen>
			<Text>hello</Text>
		</Screen>
	);
}
`,
				),
			],
		});
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const first = (await harness.call("runtime_preview_get_console", {
			limit: 1,
		})) as {
			entries: { seq: number; text: string; level: string }[];
			nextCursor: number;
			more: boolean;
		};
		expect(first.entries[0]?.text).toContain("first line");
		expect(first.more).toBe(true);
		const next = (await harness.call("runtime_preview_get_console", {
			since: first.nextCursor,
		})) as { entries: { text: string; level: string }[] };
		expect(next.entries[0]?.level).toBe("warn");
		expect(next.entries[0]?.text).toContain("second line");
		await harness.dispose();
	});
});

describe("story state", () => {
	test("restart carries the run over and reset clears it", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, CHAPTERS)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const tree = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		await harness.call("runtime_preview_press", {
			nodeId: find(tree, (node) => node.type === "Button").nodeId,
		});
		expect(
			textOf(
				(await harness.call(
					"runtime_preview_get_tree",
				)) as RuntimeMcpTreeSnapshot,
			).join(""),
		).toContain("2");

		await harness.call("runtime_preview_restart", {});
		expect(
			textOf(
				(await harness.call(
					"runtime_preview_get_tree",
				)) as RuntimeMcpTreeSnapshot,
			).join(""),
		).toContain("2");

		await harness.call("runtime_preview_restart", { resetStory: true });
		expect(
			textOf(
				(await harness.call(
					"runtime_preview_get_tree",
				)) as RuntimeMcpTreeSnapshot,
			).join(""),
		).toContain("1");
		await harness.dispose();
	});

	test("state snapshots return the two lifetimes separately", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, CHAPTERS)] });
		await harness.call("runtime_preview_start", { draftId: DRAFT });
		const state = (await harness.call("runtime_preview_get_state")) as {
			story: { entries: unknown };
			persistent: { entries: unknown };
		};
		expect(JSON.stringify(state.story)).toContain("chapter");
		expect(state.persistent).toBeDefined();
		await harness.dispose();
	});
});
