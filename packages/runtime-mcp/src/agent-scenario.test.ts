import { describe, expect, test } from "vitest";
import type { RuntimeMcpCompileResult } from "./compile.ts";
import type { RuntimeMcpPreviewStatusView } from "./preview/session.ts";
import type {
	RuntimeMcpTreeNode,
	RuntimeMcpTreeSnapshot,
} from "./preview/tree.ts";
import { createHarness, seedProject } from "./test/harness.ts";

/**
 * Acceptance scenario: one agent pass without a browser.
 *
 * Flow: find project, read file, search docs, fix, compile, fix the intentionally introduced
 * diagnostic, start preview, read tree, press, enter text, read tree again, check state, fix once
 * more, restart, verify, clean up.
 *
 * The file proves that the cycle actually closes, not the behavior of each tool. Each tool's
 * contract is covered by other tests. Here the agent only walks the sequence it really takes. There
 * is no DOM automation and no human-visible screen.
 */

const DRAFT = "draft-scenario";

/** Starting state: one screen whose counter goes up on press. */
const START = `import { Button, Screen, Stack, Text, useState } from "@rowcat/runtime";

export default function App() {
	const [count, setCount] = useState(0);
	return (
		<Screen>
			<Stack>
				<Text>{count}</Text>
				<Button onPress={() => setCount(count + 1)}>Add</Button>
			</Stack>
		</Screen>
	);
}
`;

/**
 * A common agent mistake: using a name that does not exist in this language, taken from React's
 * memory.
 */
const BROKEN = `import { Screen, Stack, Text, TextInput, useState } from "@rowcat/runtime";
import { useContext } from "@rowcat/runtime";

export default function App() {
	const [name, setName] = useState("");
	useContext();
	return (
		<Screen>
			<Stack>
				<TextInput value={name} onChangeText={setName} />
				<Text>{name}</Text>
			</Stack>
		</Screen>
	);
}
`;

/** After the fix: a screen that asks for a name and calls it back by that name. */
const FIXED = `import {
	Button,
	Screen,
	Stack,
	Text,
	TextInput,
	useState,
} from "@rowcat/runtime";

export default function App() {
	const [name, setName] = useState("");
	const [greeted, setGreeted] = useState("");
	return (
		<Screen>
			<Stack>
				<TextInput value={name} onChangeText={setName} />
				<Button onPress={() => setGreeted(name)}>Greet</Button>
				<Text>{greeted === "" ? "Tell me your name" : greeted + ", nice to meet you"}</Text>
			</Stack>
		</Screen>
	);
}
`;

const flatten = (node: RuntimeMcpTreeNode): RuntimeMcpTreeNode[] => [
	node,
	...(node.children ?? []).flatMap(flatten),
];

const find = (
	tree: RuntimeMcpTreeSnapshot,
	type: string,
): RuntimeMcpTreeNode => {
	const found = flatten(tree.root).find((node) => node.type === type);
	if (found === undefined) throw new Error(`no ${type} node`);
	return found;
};

const texts = (tree: RuntimeMcpTreeSnapshot): string =>
	flatten(tree.root)
		.map((node) => node.text ?? "")
		.join(" ");

describe("one agent loop", () => {
	test("find · edit · compile · run · press to confirm", async () => {
		const harness = createHarness({ seeds: [seedProject(DRAFT, START)] });

		const projects = (await harness.call("runtime_list_projects")) as {
			projects: { draftId: string; entry: string }[];
		};
		expect(projects.projects).toHaveLength(1);
		const draftId = projects.projects[0]?.draftId ?? "";
		expect(draftId).toBe(DRAFT);

		const files = (await harness.call("runtime_list_files", { draftId })) as {
			entry: string;
			files: { path: string; hash: string }[];
		};
		expect(files.entry).toBe("src/main.tsx");

		const read = (await harness.call("runtime_read_file", {
			draftId,
			path: "src/main.tsx",
		})) as { content: string; hash: string };
		expect(read.content).toContain("useState");

		/* Look up an unfamiliar API instead of inventing it. */
		const found = (await harness.call("runtime_search_docs", {
			query: "TextInput text input",
		})) as { results: { slug: string }[] };
		expect(found.results.length).toBeGreaterThan(0);

		const reference = (await harness.call("runtime_get_api_reference", {
			name: "TextInput",
		})) as { symbols: { name: string; signature?: string }[] };
		expect(reference.symbols[0]?.signature).toContain("TextInputProps");

		/*
		 * Submit a version that uses an existing name incorrectly first. This is what an agent actually
		 * does.
		 */
		await harness.call("runtime_write_file", {
			draftId,
			path: "src/main.tsx",
			content: BROKEN,
			expectedHash: read.hash,
		});

		const failed = (await harness.call("runtime_compile", {
			draftId,
		})) as RuntimeMcpCompileResult;
		expect(failed.ok).toBe(false);
		expect(failed.errors).toBeGreaterThan(0);
		expect(
			failed.diagnostics.some((entry) => entry.message.includes("useContext")),
		).toBe(true);
		/**
		 * No infrastructure failure is mixed in. This is a problem in the code, which the creator can
		 * fix.
		 */
		expect(failed.infrastructureFailure).toBe(false);

		const broken = (await harness.call("runtime_read_file", {
			draftId,
			path: "src/main.tsx",
		})) as { hash: string };
		await harness.call("runtime_write_file", {
			draftId,
			path: "src/main.tsx",
			content: FIXED,
			expectedHash: broken.hash,
		});
		const passed = (await harness.call("runtime_compile", {
			draftId,
		})) as RuntimeMcpCompileResult;
		expect(passed.ok).toBe(true);
		expect(passed.artifact?.modules).toBe(1);

		const started = (await harness.call("runtime_preview_start", {
			draftId,
		})) as RuntimeMcpPreviewStatusView;
		expect(started.status).toBe("running");

		const first = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(texts(first)).toContain("Tell me your name");

		await harness.call("runtime_preview_input", {
			nodeId: find(first, "TextInput").nodeId,
			text: "Sena",
		});
		const typed = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		await harness.call("runtime_preview_press", {
			nodeId: find(typed, "Button").nodeId,
		});

		const greeted = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		expect(texts(greeted)).toContain("Sena, nice to meet you");

		/* Check the console for anything unexplained. */
		const console = (await harness.call("runtime_preview_get_console")) as {
			entries: { level: string }[];
		};
		expect(console.entries.filter((entry) => entry.level === "error")).toEqual(
			[],
		);
		const status = (await harness.call("runtime_preview_status")) as {
			preview: RuntimeMcpPreviewStatusView | null;
		};
		expect(status.preview?.creatorError).toBeNull();
		expect(status.preview?.failure).toBeNull();

		const current = (await harness.call("runtime_read_file", {
			draftId,
			path: "src/main.tsx",
		})) as { content: string; hash: string };
		await harness.call("runtime_write_file", {
			draftId,
			path: "src/main.tsx",
			content: current.content.replace(", nice to meet you", ", welcome"),
			expectedHash: current.hash,
		});
		await harness.call("runtime_preview_restart", {});
		const restarted = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		/** The new VM starts `useState` from scratch, so the greeting is still empty. */
		expect(texts(restarted)).toContain("Tell me your name");
		await harness.call("runtime_preview_input", {
			nodeId: find(restarted, "TextInput").nodeId,
			text: "Sena",
		});
		const again = (await harness.call(
			"runtime_preview_get_tree",
		)) as RuntimeMcpTreeSnapshot;
		await harness.call("runtime_preview_press", {
			nodeId: find(again, "Button").nodeId,
		});
		expect(
			texts(
				(await harness.call(
					"runtime_preview_get_tree",
				)) as RuntimeMcpTreeSnapshot,
			),
		).toContain("Sena, welcome");

		const stopped = (await harness.call(
			"runtime_preview_stop",
		)) as RuntimeMcpPreviewStatusView;
		expect(stopped.status).toBe("stopped");
	});
});
