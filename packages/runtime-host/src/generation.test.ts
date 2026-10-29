import { describe, expect, it } from "vitest";
import type {
	RuntimeCapabilityHandler,
	RuntimeHostCallContext,
	RuntimeHostCallOrigin,
} from "./capabilities.ts";
import { RUNTIME_HOST_ERROR_CODE, RuntimeHostError } from "./errors.ts";
import {
	createGenerationCapability,
	RUNTIME_GENERATION_CAPABILITY_NAME,
	RuntimeGenerationError,
	type RuntimeGenerationHostRequest,
	type RuntimeGenerationPort,
} from "./generation.ts";
import { handlerIdOf } from "./patches.ts";
import { createRuntimeVmSession } from "./session.ts";
import { compiled, testEngine } from "./test/fixtures.ts";
import { TestHostTree } from "./testing/host-tree.ts";
import type { RuntimeWireValue } from "./wire.ts";

/**
 * Generation capability: authorization, validation, limits, and error translation are pinned here
 * as values. There are two layers:
 * - Unit checks call one capability directly and check whether the port was reached and which
 *   code rejected the call.
 * - Checks through real QuickJS. The execution origin (`RuntimeHostCallOrigin`) is a name the
 *   host attaches, so it cannot be told apart from a forgery without a session. That authorization
 *   is the billing invariant for this slice (§14).
 *
 * No real provider is called. The port is injected, and that is the boundary: this file contains no
 * SDK, `fetch`, or credentials.
 */

const call = (capability: {
	readonly capabilities: Record<string, unknown>;
}): RuntimeCapabilityHandler =>
	capability.capabilities[
		RUNTIME_GENERATION_CAPABILITY_NAME
	] as RuntimeCapabilityHandler;

const context = (
	origin: RuntimeHostCallOrigin = "event",
	signal: AbortSignal = new AbortController().signal,
): RuntimeHostCallContext => ({
	sessionId: "test-session",
	callId: 1,
	signal,
	origin,
});

const payload = (
	overrides: Record<string, RuntimeWireValue> = {},
): RuntimeWireValue => ({
	messages: [{ role: "user", content: "hello" }],
	instructions: "You are Sena.",
	maxOutputCharacters: 600,
	...overrides,
});

/**
 * A fake that counts the requests that actually reach the port. No real provider appears anywhere
 * in this file.
 */
function recordingPort(
	reply: (
		request: RuntimeGenerationHostRequest,
	) => Promise<string> | string = () => "Yeah.",
): RuntimeGenerationPort & { seen: RuntimeGenerationHostRequest[] } {
	const seen: RuntimeGenerationHostRequest[] = [];
	return {
		seen,
		generate: async (request) => {
			seen.push(request);
			return reply(request);
		},
	};
}

const codeOf = async (outcome: unknown): Promise<string> => {
	try {
		await outcome;
	} catch (error) {
		if (error instanceof RuntimeHostError) return error.code;
		return `not-a-host-error: ${String(error)}`;
	}
	return "resolved";
};

describe("authorization: only from user interaction", () => {
	/**
	 * Only `event` counts as interaction. The test lists every other origin and checks that each is
	 * blocked. Missing a single one would let `useEffect` create a charge on every mount.
	 */
	it.each<RuntimeHostCallOrigin>([
		"mount",
		"render",
		"effects",
		"unmount",
		"call",
		"graph",
		"bind",
	])("requests from the %s origin are not authorized: they never reach the port", async (origin) => {
		const port = recordingPort();
		const capability = createGenerationCapability({ port });
		expect(await codeOf(call(capability)(payload(), context(origin)))).toBe(
			RUNTIME_HOST_ERROR_CODE.generationNotAuthorized,
		);
		expect(port.seen).toEqual([]);
		expect(capability.metrics().rejectedByPolicy).toBe(1);
		expect(capability.metrics().issued).toBe(0);
	});

	it("the event origin passes", async () => {
		const port = recordingPort(() => "hello!");
		const capability = createGenerationCapability({ port });
		await expect(call(capability)(payload(), context())).resolves.toEqual({
			text: "hello!",
		});
		expect(port.seen).toHaveLength(1);
	});

	/**
	 * Authorization runs before validation. If it ran after, an unauthorized request would get
	 * different errors depending on its shape, and that difference would work as a probe.
	 */
	it("unauthorized executions get the same code even with a broken request", async () => {
		const capability = createGenerationCapability({ port: recordingPort() });
		const broken = await codeOf(
			call(capability)({ messages: [] }, context("effects")),
		);
		const fine = await codeOf(call(capability)(payload(), context("effects")));
		expect(broken).toBe(fine);
		expect(broken).toBe(RUNTIME_HOST_ERROR_CODE.generationNotAuthorized);
	});

	/**
	 * Only harnesses and tests turn this off. The default being true is the premise for every check
	 * above it.
	 */
	it("requireInteraction: false opens only when explicitly opened", async () => {
		const port = recordingPort();
		const capability = createGenerationCapability({
			port,
			requireInteraction: false,
		});
		await expect(
			call(capability)(payload(), context("effects")),
		).resolves.toBeDefined();
		expect(port.seen).toHaveLength(1);
	});
});

describe("validation comes before the port", () => {
	const bad: [string, RuntimeWireValue][] = [
		["not an object", "hello"],
		["no messages", { instructions: "x", maxOutputCharacters: 10 }],
		["messages is empty", payload({ messages: [] })],
		[
			"role is off the vocabulary",
			payload({ messages: [{ role: "system", content: "x" }] }),
		],
		[
			"content is not a string",
			payload({ messages: [{ role: "user", content: 1 }] }),
		],
		["instructions is not a string", payload({ instructions: 7 })],
		[
			"maxOutputCharacters is not finite",
			payload({ maxOutputCharacters: null }),
		],
	];

	it.each(bad)("%s: refused, never reaching the port", async (_why, value) => {
		const port = recordingPort();
		const capability = createGenerationCapability({ port });
		expect(await codeOf(call(capability)(value, context()))).toBe(
			RUNTIME_HOST_ERROR_CODE.generationInvalidRequest,
		);
		expect(port.seen).toEqual([]);
		expect(capability.metrics().rejectedByLimits).toBe(1);
	});

	it("requests over the limit never reach the provider", async () => {
		const port = recordingPort();
		const capability = createGenerationCapability({
			port,
			limits: { maxMessages: 2, maxMessageCharacters: 4 },
		});
		const many = payload({
			messages: [
				{ role: "user", content: "a" },
				{ role: "assistant", content: "b" },
				{ role: "user", content: "c" },
			],
		});
		expect(await codeOf(call(capability)(many, context()))).toBe(
			RUNTIME_HOST_ERROR_CODE.generationInvalidRequest,
		);
		const long = payload({
			messages: [{ role: "user", content: "12345" }],
		});
		expect(await codeOf(call(capability)(long, context()))).toBe(
			RUNTIME_HOST_ERROR_CODE.generationInvalidRequest,
		);
		expect(port.seen).toEqual([]);
	});

	/** Unknown keys are dropped silently. The allow list means a creator cannot add an extra axis. */
	it("keys outside the allowlist never arrive at the port", async () => {
		const port = recordingPort();
		const capability = createGenerationCapability({ port });
		await call(capability)(
			payload({ provider: "anthropic", model: "claude", apiKey: "sk-x" }),
			context(),
		);
		expect(Object.keys(port.seen[0] ?? {}).sort()).toEqual([
			"instructions",
			"maxOutputCharacters",
			"messages",
		]);
	});

	it("the output cap is clamped to the host's cap", async () => {
		const port = recordingPort();
		const capability = createGenerationCapability({
			port,
			limits: { maxOutputCharacters: 100 },
		});
		await call(capability)(payload({ maxOutputCharacters: 9_000 }), context());
		expect(port.seen[0]?.maxOutputCharacters).toBe(100);
	});
});

describe("concurrency and session budget", () => {
	it("with a generation running, the second is busy: the second request never goes out", async () => {
		let release: (text: string) => void = () => {};
		/**
		 * Only the first request is held. Later ones reply immediately; this checks that the slot
		 * reopens.
		 */
		let held = false;
		const port = recordingPort(() => {
			if (held) return "reopened";
			held = true;
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		});
		const capability = createGenerationCapability({ port });
		const first = call(capability)(payload(), context());
		expect(await codeOf(call(capability)(payload(), context()))).toBe(
			RUNTIME_HOST_ERROR_CODE.generationBusy,
		);
		expect(port.seen).toHaveLength(1);
		release("Yeah.");
		await expect(first).resolves.toEqual({ text: "Yeah." });
		/** The slot reopens after completion. Busy is a state, not a lock. */
		await expect(call(capability)(payload(), context())).resolves.toEqual({
			text: "reopened",
		});
		expect(capability.metrics().maxConcurrent).toBe(1);
	});

	it("sends no more past the session budget", async () => {
		const port = recordingPort();
		const capability = createGenerationCapability({
			port,
			limits: { maxPerSession: 2 },
		});
		await call(capability)(payload(), context());
		await call(capability)(payload(), context());
		expect(await codeOf(call(capability)(payload(), context()))).toBe(
			RUNTIME_HOST_ERROR_CODE.generationNotAuthorized,
		);
		expect(port.seen).toHaveLength(2);
		expect(capability.metrics()).toMatchObject({
			issued: 2,
			completed: 2,
			rejectedByPolicy: 1,
		});
	});

	it("a closing session starts no new generation", async () => {
		const controller = new AbortController();
		controller.abort();
		const port = recordingPort();
		const capability = createGenerationCapability({ port });
		expect(
			await codeOf(
				call(capability)(payload(), context("event", controller.signal)),
			),
		).toBe(RUNTIME_HOST_ERROR_CODE.generationCancelled);
		expect(port.seen).toEqual([]);
	});
});

describe("translating failures", () => {
	it.each([
		["unavailable", RUNTIME_HOST_ERROR_CODE.generationUnavailable],
		["not-authorized", RUNTIME_HOST_ERROR_CODE.generationNotAuthorized],
		[
			"insufficient-balance",
			RUNTIME_HOST_ERROR_CODE.generationInsufficientBalance,
		],
		["cancelled", RUNTIME_HOST_ERROR_CODE.generationCancelled],
		["failed", RUNTIME_HOST_ERROR_CODE.generationFailed],
	] as const)("reason %s becomes %s", async (reason, code) => {
		const capability = createGenerationCapability({
			port: {
				generate: async () => {
					throw new RuntimeGenerationError(reason, "a reason the port stated");
				},
			},
		});
		expect(await codeOf(call(capability)(payload(), context()))).toBe(code);
	});

	/**
	 * Provider internals never reach the creator. Failures without a stated reason are all `failed`,
	 * and the message is our own text. If a stack, URL, secret, or file path ended up in that message,
	 * creator code would gain a window into our infrastructure.
	 */
	it("exceptions without a reason are failed and their content does not leak", async () => {
		const capability = createGenerationCapability({
			port: {
				generate: async () => {
					throw new Error(
						"401 from https://api.example.com/v1/messages key=sk-live-secret at /srv/app/provider.ts:42",
					);
				},
			},
		});
		try {
			await call(capability)(payload(), context());
			throw new Error("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(RuntimeHostError);
			const message = (error as RuntimeHostError).message;
			expect((error as RuntimeHostError).code).toBe(
				RUNTIME_HOST_ERROR_CODE.generationFailed,
			);
			expect(message).toBe("generation failed");
			for (const secret of [
				"sk-live-secret",
				"api.example.com",
				"/srv/app",
				"401",
			])
				expect(message).not.toContain(secret);
		}
	});

	it("non-text answers are failed", async () => {
		const capability = createGenerationCapability({
			port: { generate: async () => 7 as unknown as string },
		});
		expect(await codeOf(call(capability)(payload(), context()))).toBe(
			RUNTIME_HOST_ERROR_CODE.generationFailed,
		);
	});

	it("the slot is released even on failure: the next request is not busy", async () => {
		const capability = createGenerationCapability({
			port: {
				generate: async () => {
					throw new RuntimeGenerationError("failed", "x");
				},
			},
		});
		await codeOf(call(capability)(payload(), context()));
		expect(capability.active()).toBe(0);
		expect(capability.metrics()).toMatchObject({ issued: 1, failed: 1 });
	});
});

/* Real VM. The origin is a name the host attaches, so it can be checked only with a session. */

const IMPORTS = `import { Button, RuntimeError, Stack, Text, useEffect, useGeneration, useState } from "@rowcat/runtime";`;

/**
 * Fixture app. Pressing a button starts a generation and writes the result or error code to the
 * screen.
 */
const ON_PRESS = `${IMPORTS}
export default function App() {
	const [line, setLine] = useState("idle");
	const generation = useGeneration();
	return (
		<Stack>
			<Text>{line}</Text>
			<Button onPress={async () => {
				try {
					const result = await generation.generate({ messages: [{ role: "user", content: "hello" }] });
					setLine("ok:" + result.text);
				} catch (error) {
					setLine("err:" + (error instanceof RuntimeError ? error.code : "unknown"));
				}
			}}>Send</Button>
		</Stack>
	);
}`;

/** Generates from a mount effect. This is the case that must not be authorized. */
const ON_EFFECT = `${IMPORTS}
export default function App() {
	const [line, setLine] = useState("idle");
	const generation = useGeneration();
	useEffect(() => {
		generation
			.generate({ messages: [{ role: "user", content: "hello" }] })
			.then((result) => setLine("ok:" + result.text))
			.catch((error) => setLine("err:" + (error instanceof RuntimeError ? error.code : "unknown")));
	}, []);
	return <Text>{line}</Text>;
}`;

interface Vm {
	tree: TestHostTree;
	press(): Promise<void>;
	line(): string;
	dispose(): Promise<void>;
	metrics(): unknown;
	/** Raises the same handler the way a sound reaching its end does (`source: "media"`). */
	raise(): Promise<void>;
}

async function boot(source: string, port: RuntimeGenerationPort): Promise<Vm> {
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([{ path: "src/main.tsx", content: source }]),
		generation: { port },
	});
	const tree = new TestHostTree();
	const mounted = await session.mountRoot({ onCommit: (b) => tree.apply(b) });
	if (!mounted.ok) throw mounted.error;
	/**
	 * Waits until the queue is really empty. Generation is a host call, so that execution waits
	 * outside the queue. A single `settle()` would read the gap as idle.
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
	const line = (): string => {
		const first = tree.find((node) => node.kind === "text");
		return first?.children[0]?.text ?? "";
	};
	return {
		tree,
		line,
		metrics: () => session.metrics().generation,
		press: async () => {
			const button = tree.findByText("Send");
			if (button === null) throw new Error("no Send button");
			const handler = handlerIdOf(button.props.onPress ?? null);
			if (handler === null) throw new Error("Send has no onPress");
			const outcome = await session.dispatchEvent(handler);
			if (!outcome.ok) throw outcome.error;
			await quiesce();
		},
		raise: async () => {
			const button = tree.findByText("Send");
			const handler = handlerIdOf(button?.props.onPress ?? null);
			if (handler === null) throw new Error("Send has no onPress");
			const outcome = await session.dispatchEvent(handler, null, "media");
			if (!outcome.ok) throw outcome.error;
			await quiesce();
		},
		dispose: () => session.dispose(),
	};
}

describe("authorization across the VM", () => {
	it("generation called from a button succeeds and its text stays in the tree", async () => {
		const port = recordingPort(() => "nice to meet you");
		const vm = await boot(ON_PRESS, port);
		try {
			expect(vm.line()).toBe("idle");
			await vm.press();
			expect(vm.line()).toBe("ok:nice to meet you");
			expect(port.seen).toEqual([
				{
					messages: [{ role: "user", content: "hello" }],
					instructions: "",
					maxOutputCharacters: 4_000,
				},
			]);
			expect(vm.metrics()).toMatchObject({ issued: 1, completed: 1 });
		} finally {
			await vm.dispose();
		}
	});

	/**
	 * The same handler raised by the platform rather than a person (`<Audio onEnded>`): it is the event
	 * path, but nobody pressed anything, so generation refuses it. Folded into an interaction, a sound
	 * that restarts itself on end could generate up to the session budget with no one touching the
	 * screen.
	 */
	it("generation called from a media event is refused", async () => {
		const port = recordingPort(() => "must not be called");
		const vm = await boot(ON_PRESS, port);
		try {
			await vm.raise();
			expect(vm.line()).toBe("err:runtime_generation_not_authorized");
			expect(port.seen).toEqual([]);
		} finally {
			await vm.dispose();
		}
	});

	/**
	 * A generation called from an effect is rejected without reaching the port, and the creator sees
	 * the error code unchanged.
	 */
	it("generation called from an effect is refused and never reaches the provider", async () => {
		const port = recordingPort(() => "must not be called");
		const vm = await boot(ON_EFFECT, port);
		try {
			expect(vm.line()).toBe("err:runtime_generation_not_authorized");
			expect(port.seen).toEqual([]);
			expect(vm.metrics()).toMatchObject({
				issued: 0,
				rejectedByPolicy: 1,
			});
		} finally {
			await vm.dispose();
		}
	});

	/**
	 * `useGeneration()` still exists in a session without the capability; the failure happens at the
	 * call site.
	 */
	it("without the capability it is unavailable: the public API does not disappear", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([{ path: "src/main.tsx", content: ON_PRESS }]),
		});
		const tree = new TestHostTree();
		const mounted = await session.mountRoot({ onCommit: (b) => tree.apply(b) });
		if (!mounted.ok) throw mounted.error;
		await session.settle();
		try {
			const button = tree.findByText("Send");
			const handler = handlerIdOf(button?.props.onPress ?? null);
			if (handler === null) throw new Error("no handler");
			const outcome = await session.dispatchEvent(handler);
			if (!outcome.ok) throw outcome.error;
			for (let round = 0; round < 5; round += 1) {
				await session.settle();
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			await session.settle();
			expect(tree.find((node) => node.kind === "text")?.children[0]?.text).toBe(
				"err:runtime_generation_unavailable",
			);
			expect(session.metrics().generation).toBeNull();
		} finally {
			await session.dispose();
		}
	});
});
