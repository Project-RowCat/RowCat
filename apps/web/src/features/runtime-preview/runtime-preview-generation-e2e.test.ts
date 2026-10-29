import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { compileRuntimeProject } from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import {
	createRuntimeVmSession,
	handlerIdOf,
	RuntimeGenerationError,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { testEngine } from "@rowcat/runtime-host/test/fixtures";
import {
	type TestHostNode,
	TestHostTree,
} from "@rowcat/runtime-host/testing/host-tree";
import { afterEach, describe, expect, it } from "vitest";
import type {
	PreviewGeneration,
	PreviewGenerationRequest,
	PreviewGenerationResult,
} from "./protocol.ts";
import {
	PREVIEW_GENERATION_FAILURE,
	toPreviewGenerationFailure,
} from "./runtime-preview-generation-failure.ts";
import { createPreviewGenerationRouter } from "./runtime-preview-generation-router.ts";

/**
 * Tests the boundary end to end, where creator code actually holds values. The chain runs from
 * creator TSX through the compiler and QuickJS, a button event, useGeneration(), the generation
 * capability, RuntimeGenerationPort (reproduced in the same shape the worker uses), the preview
 * router, the trusted adapter's sanitizer, a provider-like exception, the host completion queue,
 * and back into QuickJS's catch. A helper-level test cannot prove this property. The defect existed
 * because of a combination across layers: once the adapter attached a named reason, the host's
 * general sanitizer treated the sentence as trusted vocabulary. So the layers are joined for real
 * and the text inside the VM is read. This folder is the only assembly point that can import the
 * preview sanitizer together with the compiler and VM (runtime-template-runtime.test.ts sits here
 * for the same reason). Its boundary check does not scan test files. It guards that the screen
 * never loads the compiler or VM, and this file is not the screen.
 */

const environment = nodeRuntimeEnvironment();
const live: RuntimeVmSession[] = [];

afterEach(async () => {
	for (const session of live.splice(0, live.length)) await session.dispose();
});

/**
 * Fragments an incident-like message might contain. None may appear anywhere in the text the VM
 * sees.
 */
const SENSITIVE = [
	"401",
	"api.example.internal",
	"sk-live-secret",
	"Authorization",
	"Bearer",
	"anthropic",
	"internal-model",
	"/srv/",
	"provider.ts",
	"https://",
] as const;

const HOSTILE = new Error(
	[
		"401 from https://api.example.internal/v1/messages",
		"Authorization: Bearer sk-live-secret",
		"provider=anthropic model=internal-model",
		"at /srv/rowcat/provider.ts:42",
	].join("\n"),
);

/**
 * An app that writes both the code and the sentence onto the screen, so the values creator code
 * actually holds stay visible in the test tree.
 */
const APP = `import { Button, RuntimeError, Stack, Text, useGeneration, useState } from "@rowcat/runtime";

export default function App() {
	const [result, setResult] = useState("idle");
	const generation = useGeneration();

	async function send() {
		try {
			await generation.generate({ messages: [{ role: "user", content: "hello" }] });
			setResult("unexpected-success");
		} catch (error) {
			if (error instanceof RuntimeError) setResult(error.code + "|" + error.message);
			else setResult("unknown");
		}
	}

	return (
		<Stack>
			<Text>{result}</Text>
			<Button onPress={send}>Send</Button>
		</Stack>
	);
}`;

interface Vm {
	press(): Promise<void>;
	line(): string;
}

/**
 * Same shape as the worker's generation port: on `ok` it yields the text, otherwise it throws a
 * named `RuntimeGenerationError` (runtime-preview.worker.ts). The conversion is the core of the
 * defect, so it is reproduced exactly rather than imitated: once a reason gets a name, the host's
 * general sanitizer reads its sentence as trusted vocabulary.
 */
const portFrom = (
	settle: (
		request: PreviewGenerationRequest,
	) => Promise<PreviewGenerationResult>,
) => ({
	generate: async (request: {
		readonly messages: readonly {
			role: "user" | "assistant";
			content: string;
		}[];
		readonly instructions: string;
		readonly maxOutputCharacters: number;
	}): Promise<string> => {
		const result = await settle({
			messages: request.messages.map((message) => ({
				role: message.role,
				content: message.content,
			})),
			instructions: request.instructions,
			maxOutputCharacters: request.maxOutputCharacters,
		});
		if (result.ok) return result.text;
		throw new RuntimeGenerationError(result.reason, result.message);
	},
});

async function boot(
	settle: (
		request: PreviewGenerationRequest,
	) => Promise<PreviewGenerationResult>,
): Promise<Vm> {
	const compiled = compileRuntimeProject(
		{
			apiVersion: RUNTIME_API_VERSION,
			entry: "src/main.tsx",
			files: [{ path: "src/main.tsx", content: APP }],
		},
		environment,
	);
	if (!compiled.ok)
		throw new Error(
			compiled.diagnostics.map((diagnostic) => diagnostic.message).join(" / "),
		);
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled.artifact,
		generation: { port: portFrom(settle) },
	});
	live.push(session);
	const tree = new TestHostTree();
	const mounted = await session.mountRoot({ onCommit: (b) => tree.apply(b) });
	if (!mounted.ok) throw mounted.error;

	/**
	 * Generation is a host call awaited outside the commit queue, so this helper yields until commits
	 * stop arriving (up to a bounded number of rounds).
	 */
	const quiesce = async (): Promise<void> => {
		for (let round = 0; round < 20; round += 1) {
			const before = tree.batches.length;
			await session.settle();
			await new Promise((resolve) => setTimeout(resolve, 0));
			await session.settle();
			if (tree.batches.length === before) return;
		}
	};
	await quiesce();

	const collect = (node: TestHostNode, out: string[]): string[] => {
		if (node.kind === "#text" && typeof node.text === "string")
			out.push(node.text);
		for (const child of node.children) collect(child, out);
		return out;
	};

	return {
		line: () => collect(tree.root, []).join(" "),
		press: async () => {
			const button = tree.findByText("Send");
			if (button === null) throw new Error("no Send button");
			const handler = handlerIdOf(button.props.onPress ?? null);
			if (handler === null) throw new Error("Send has no onPress");
			const outcome = await session.dispatchEvent(handler);
			if (!outcome.ok) throw outcome.error;
			await quiesce();
		},
	};
}

describe("the failure the creator actually receives", () => {
	/**
	 * The value passes through the trusted adapter's sanitizer unchanged and reaches the VM. The test
	 * checks, through the text creator code writes, that no part of this chain can carry the original
	 * sentence.
	 */
	it("a provider-looking exception arrives only as a safe failed", async () => {
		const vm = await boot(async () => toPreviewGenerationFailure(HOSTILE));
		expect(vm.line()).toContain("idle");
		await vm.press();

		const line = vm.line();
		expect(line).toContain("runtime_generation_failed");
		expect(line).toContain(PREVIEW_GENERATION_FAILURE.failed);
		expect(line).not.toContain("unexpected-success");
		for (const secret of SENSITIVE) expect(line).not.toContain(secret);
	});

	/**
	 * A refusal by the adapter, folded by the router, must also reach the same safe failure. Whichever
	 * door is used, the creator sees the same result.
	 */
	it("a path the adapter refused becomes the same safe failure", async () => {
		const vm = await boot(
			(request) =>
				new Promise<PreviewGenerationResult>((resolve) => {
					const router = createPreviewGenerationRouter({
						adapter: () => async () => {
							throw HOSTILE;
						},
						currentGeneration: () => 1 as PreviewGeneration,
						send: (_generation, _requestId, result) => resolve(result),
					});
					router.handle({
						generation: 1 as PreviewGeneration,
						requestId: 1,
						request,
					});
				}),
		);
		await vm.press();

		const line = vm.line();
		expect(line).toContain("runtime_generation_failed");
		expect(line).toContain(PREVIEW_GENERATION_FAILURE.failed);
		for (const secret of SENSITIVE) expect(line).not.toContain(secret);
	});

	/**
	 * Not every reason folds to `failed`. Deliberately public reasons arrive as they are, and even
	 * then the sentence is ours, not the original.
	 */
	it.each([
		["unavailable", "runtime_generation_unavailable"],
		["not-authorized", "runtime_generation_not_authorized"],
		["insufficient-balance", "runtime_generation_insufficient_balance"],
		["cancelled", "runtime_generation_cancelled"],
	] as const)("reason %s arrives as %s", async (reason, code) => {
		const vm = await boot(async () => ({
			ok: false,
			reason,
			message: PREVIEW_GENERATION_FAILURE[reason],
		}));
		await vm.press();
		const line = vm.line();
		expect(line).toContain(code);
		expect(line).toContain(PREVIEW_GENERATION_FAILURE[reason]);
		for (const secret of SENSITIVE) expect(line).not.toContain(secret);
	});

	/** The success path is unchanged. Sanitizing must not alter a normal answer. */
	it("a successful generation's text arrives as is", async () => {
		const vm = await boot(async () => ({ ok: true, text: "nice to meet you" }));
		await vm.press();
		expect(vm.line()).toContain("unexpected-success");
	});
});
