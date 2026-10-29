import {
	instantiateRuntimeTemplate,
	type RuntimeTemplate,
} from "@rowcat/authoring";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { compileRuntimeProject } from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import {
	createRuntimeVmSession,
	handlerIdOf,
	RuntimeGenerationError,
	type RuntimeGenerationHostRequest,
	type RuntimePersistentStateSnapshot,
	type RuntimeRootDiagnostic,
	type RuntimeStoryStateSnapshot,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { testEngine } from "@rowcat/runtime-host/test/fixtures";
import {
	type TestHostNode,
	TestHostTree,
} from "@rowcat/runtime-host/testing/host-tree";

/**
 * Shared chain for tests that run real starter templates: compiler, artifact, QuickJS, reconciler,
 * then the test host tree.
 *
 * Two test files use it (runtime-template-runtime.test.ts and runtime-template-flagship.test.ts).
 * One shared copy stops them drifting apart, e.g. one learning persistentState and the other not.
 *
 * The file sits in src/test/, not the template folder: the template boundary check scans every
 * non-.test. file there, and this wiring pulls in the compiler and VM.
 *
 * The app's tests have no DOM, so scenarios assert on the host tree instead of the browser
 * renderer. The renderer pipeline is covered separately under jsdom.
 */

const environment = nodeRuntimeEnvironment();

/** Live sessions. Any session left here keeps its WASM instance pinned in memory. */
const live: RuntimeVmSession[] = [];

/** Called from the test files' afterEach hook; disposes every live session. */
export async function disposeMountedTemplates(): Promise<void> {
	for (const session of live.splice(0, live.length)) await session.dispose();
}

export interface MountedTemplate {
	session: RuntimeVmSession;
	tree: TestHostTree;
	diagnostics: RuntimeRootDiagnostic[];
	rootErrors: string[];
	/** Presses the first onPress handler found by walking up from the node holding this text. */
	press(text: string): Promise<void>;
	/** Whether a pressable node holds this text. Asks without pressing, unlike press(). */
	pressable(text: string): boolean;
	/** Types text into the input as one event, shaped like the event the renderer produces. */
	type(text: string): Promise<void>;
	/**
	 * Submits the single-line input (Enter). Same spot as keydown on web and onSubmitEditing on
	 * native.
	 */
	submit(): Promise<void>;
	/**
	 * Current text in the input. The input is controlled, so the value lives in props, not saved
	 * state.
	 */
	draft(): string;
	/** Saved playthrough. A restart picks up from this value. */
	story(): RuntimeStoryStateSnapshot;
	/** Saved persistent progress. Resetting play does not reach this part. */
	progress(): RuntimePersistentStateSnapshot;
	/** Whether the input is disabled. Read straight from the tree, since it is a controlled prop. */
	entryDisabled(): boolean;
	/**
	 * Waits until the queue is empty. Call it after releasing any generation held open from outside.
	 */
	quiesce(): Promise<void>;
	/** All text in the tree, so tests can compare state before and after an interaction. */
	text(): string;
}

/** What the AI will answer in this run. Never calls a real provider. */
export interface FakeGeneration {
	reply: (request: RuntimeGenerationHostRequest) => string | Promise<string>;
	/** When true, the request fails. Lets a test check that the scripted reply survives a failure. */
	fail?: boolean;
	/**
	 * Requests that actually reached the host. Lets tests assert that no provider or model is sent.
	 */
	seen: RuntimeGenerationHostRequest[];
}

export const fakeGeneration = (
	reply: string,
	fail = false,
): FakeGeneration => ({
	reply: () => reply,
	fail,
	seen: [],
});

export interface MountTemplateOptions {
	generation?: FakeGeneration;
	/** Carries over the playthrough snapshot from an earlier session, as a restart does. */
	storyState?: RuntimeStoryStateSnapshot;
	/**
	 * Carries over the persistent snapshot from an earlier session, as a play reset does. The
	 * playthrough itself is cleared.
	 */
	persistentState?: RuntimePersistentStateSnapshot;
}

export function compileTemplate(template: RuntimeTemplate) {
	const plan = instantiateRuntimeTemplate(template);
	return compileRuntimeProject(
		{
			apiVersion: RUNTIME_API_VERSION,
			entry: plan.entry,
			files: plan.files.map((file) => ({
				path: file.path,
				content: file.content,
			})),
		},
		environment,
	);
}

export async function mountTemplate(
	template: RuntimeTemplate,
	options: MountTemplateOptions = {},
): Promise<MountedTemplate> {
	const result = compileTemplate(template);
	if (!result.ok)
		throw new Error(
			`${template.id} does not compile: ${result.diagnostics
				.map((diagnostic) => diagnostic.message)
				.join(" / ")}`,
		);
	const fake = options.generation;
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: result.artifact,
		/**
		 * Turns off the session budget. This is a limit of the measurement method, not a tolerance for
		 * slow templates.
		 *
		 * The production default is 250ms per 1-second window, which assumes a person pressing buttons.
		 * The harness presses dozens of buttons back to back, fills that window quickly, and fails with
		 * `execution exceeded its budget` at arbitrary points in a scenario. That failure reflects the
		 * harness being faster than a person, not a template defect, and it would make long scenarios
		 * fail with no visible cause.
		 *
		 * The per-execution budget (1 second) stays on, so a runaway render or effects that call each
		 * other still fail. Turning off the session budget only changes how often work runs, not how long
		 * one run takes.
		 */
		scheduling: { policy: { session: null } },
		...(options.storyState === undefined
			? {}
			: { storyState: options.storyState }),
		...(options.persistentState === undefined
			? {}
			: { persistentState: options.persistentState }),
		/**
		 * Capabilities sit behind one injected port. This is why tests never call a real provider. In
		 * production the same slot is the trusted host. The VM does not know which one it is using.
		 */
		...(fake === undefined
			? {}
			: {
					generation: {
						port: {
							generate: async (request) => {
								fake.seen.push(request);
								if (fake.fail === true)
									throw new RuntimeGenerationError(
										"failed",
										"provider refused",
									);
								return fake.reply(request);
							},
						},
					},
				}),
	});
	live.push(session);
	const tree = new TestHostTree();
	const diagnostics: RuntimeRootDiagnostic[] = [];
	const rootErrors: string[] = [];
	const outcome = await session.mountRoot({
		onCommit: (batch) => tree.apply(batch),
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		onRootError: (error) => rootErrors.push(`${error.name}: ${error.message}`),
	});
	if (!outcome.ok) throw outcome.error;
	await session.settle();

	const collect = (node: TestHostNode, out: string[]): string[] => {
		if (node.kind === "#text" && typeof node.text === "string")
			out.push(node.text);
		for (const child of node.children) collect(child, out);
		return out;
	};

	const findKind = (kind: string): TestHostNode | null => {
		const walk = (node: TestHostNode): TestHostNode | null => {
			if (node.kind === kind) return node;
			for (const child of node.children) {
				const found = walk(child);
				if (found !== null) return found;
			}
			return null;
		};
		return walk(tree.root);
	};

	const entry = (): TestHostNode => {
		const node = findKind("text-input");
		if (node === null) throw new Error("no text-input in the tree");
		return node;
	};

	/**
	 * Waits until the queue is really empty; settle() alone is not enough. A generation is a host
	 * call, so its run waits outside the queue (`waiting`). settle() can return during that wait, and
	 * the run re-enters the queue only after the answer arrives. The loop yields one macrotask and
	 * settles again, repeating until commits stop. It stands in for the time a person waits on screen.
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

	const fire = async (handler: number, payload?: string): Promise<void> => {
		const outcome =
			payload === undefined
				? await session.dispatchEvent(handler)
				: await session.dispatchEvent(handler, payload);
		if (!outcome.ok) throw outcome.error;
		await quiesce();
	};

	/**
	 * Walks up from the node holding the text to find the first handler. `Button` holds its text
	 * directly, but `Pressable` wraps a `Text` one level down. Writing the two separately would break
	 * this test whenever the template's structure changes. The question here is what pressing this
	 * text does, and that answer is the same on screen.
	 */
	const handlerAbove = (text: string): number | null => {
		let node = tree.findByText(text);
		if (node === null) return null;
		let handler = handlerIdOf(node.props.onPress ?? null);
		while (handler === null && node.parent !== null) {
			node = node.parent;
			handler = handlerIdOf(node.props.onPress ?? null);
		}
		return handler;
	};

	return {
		session,
		tree,
		diagnostics,
		rootErrors,
		text: () => collect(tree.root, []).join(" "),
		draft: () => {
			const value = entry().props.value;
			return typeof value === "string" ? value : "";
		},
		story: () => session.storyStateSnapshot(),
		progress: () => session.persistentStateSnapshot(),
		entryDisabled: () => entry().props.disabled === true,
		quiesce,
		type: async (text: string) => {
			const handler = handlerIdOf(entry().props.onChangeText ?? null);
			if (handler === null) throw new Error("text-input has no onChangeText");
			await fire(handler, text);
		},
		submit: async () => {
			const handler = handlerIdOf(entry().props.onSubmit ?? null);
			if (handler === null) throw new Error("text-input has no onSubmit");
			await fire(handler);
		},
		pressable: (text: string) => handlerAbove(text) !== null,
		press: async (text: string) => {
			const handler = handlerAbove(text);
			if (handler === null) throw new Error(`no onPress above text ${text}`);
			await fire(handler);
		},
	};
}
