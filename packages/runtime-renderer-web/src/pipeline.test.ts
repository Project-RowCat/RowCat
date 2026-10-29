// @vitest-environment jsdom
import type {
	RuntimeRootDiagnostic,
	RuntimeVmSession,
} from "@rowcat/runtime-host";
import { createRuntimeVmSession } from "@rowcat/runtime-host";
import { compiled, testEngine } from "@rowcat/runtime-host/test/fixtures";
import { afterEach, describe, expect, it } from "vitest";
import {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
} from "./renderer.ts";

/**
 * The real pipeline: TSX → compiler → artifact → QuickJS → reconciler → patch batch → DOM.
 *
 * No hand-written batch appears in this file. It checks that the batches the reconciler actually
 * emits are rendered with browser semantics by this renderer. It does so without the worker or
 * React shell, which the browser journey covers.
 */

const IMPORTS = `import { Button, Screen, Stack, Text, color, useState } from "@rowcat/runtime";`;

const COUNTER = `${IMPORTS}
export default function App() {
	const [count, setCount] = useState(0);
	return (
		<Screen background={color("#111111")}>
			<Stack gap={12} style={{ padding: 16 }}>
				<Text style={{ color: color("#ffffff"), fontSize: 20, fontWeight: "bold" }}>Count: {count}</Text>
				<Button tone="primary" onPress={() => setCount((value) => value + 1)}>Increment</Button>
			</Stack>
		</Screen>
	);
}`;

interface Mounted {
	session: RuntimeVmSession;
	renderer: WebRuntimeRenderer;
	container: HTMLElement;
	diagnostics: RuntimeRootDiagnostic[];
	rootErrors: string[];
	logs: unknown[][];
	press(label: string): Promise<void>;
	/**
	 * The first text input on screen. The controlled value is owned by the author's state in the VM.
	 */
	input(): HTMLInputElement;
	/** Simulates typing. The browser writes the value first, then fires `input`. */
	typeText(value: string): Promise<void>;
	/** Presses Enter once. Returns false if the press was blocked, such as during composition. */
	enter(): Promise<boolean>;
	compose(steps: readonly string[]): Promise<void>;
	compositionEnd(value: string): Promise<void>;
	/**
	 * Composes without waiting for each answer. Real round trips work this way: preview goes through
	 * the worker and playback through the bridge, so an answer arrives at best a turn later. A compose
	 * that settles at every step never shows the state where a commit arrives behind the screen.
	 */
	composeWithoutSettling(steps: readonly string[], final: string): void;
	settle(): Promise<void>;
}

const live: RuntimeVmSession[] = [];

async function mount(source: string): Promise<Mounted> {
	const logs: unknown[][] = [];
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([{ path: "src/main.tsx", content: source }]),
		onConsole: (_level, args) => logs.push([...args]),
	});
	live.push(session);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const pending: Promise<unknown>[] = [];
	const renderer = createWebRuntimeRenderer({
		container,
		dispatchEvent: (handler, payload) => {
			pending.push(
				payload === undefined || payload === null
					? session.dispatchEvent(handler)
					: session.dispatchEvent(handler, payload),
			);
		},
		/**
		 * Same shape as the resolver the host builds. Remote assets map to RowCat's proxy address.
		 * Logical references resolve to null because this harness keeps no asset table; in the product,
		 * the playback surface fills that table per session. The author's own address never comes back
		 * through either branch.
		 */
		resolveAsset: (target) =>
			target.kind === "remote"
				? `https://api.rowcat.test/v2/runtime/assets/remote?url=${encodeURIComponent(target.url)}`
				: null,
	});
	const diagnostics: RuntimeRootDiagnostic[] = [];
	const rootErrors: string[] = [];
	const mounted = await session.mountRoot({
		onCommit: (batch) => renderer.apply(batch),
		/** Same wiring as the product: it runs after the commit, and the renderer checks the revision. */
		onCommands: (batch) => renderer.applyCommands(batch),
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		onRootError: (error) => rootErrors.push(error.message),
	});
	if (!mounted.ok) throw mounted.error;
	await session.settle();
	const root = container.shadowRoot?.querySelector(
		'[data-rc="root"]',
	) as HTMLElement;
	/** Runs until the queue is empty, since one event can start a chain of renders and effects. */
	const flush = async (): Promise<void> => {
		for (let round = 0; round < 10; round += 1) {
			if (pending.length === 0) break;
			await Promise.all(pending.splice(0, pending.length));
			await session.settle();
		}
		await session.settle();
	};
	const press = async (label: string): Promise<void> => {
		const button = [...root.querySelectorAll("button")].find(
			(candidate) => candidate.textContent === label,
		);
		if (button === undefined) throw new Error(`no button ${label}`);
		button.click();
		await flush();
	};
	const input = (): HTMLInputElement => {
		const found = root.querySelector("input");
		if (found === null) throw new Error("no input in the tree");
		return found;
	};
	return {
		session,
		renderer,
		container,
		diagnostics,
		rootErrors,
		logs,
		press,
		input,
		typeText: async (value) => {
			const element = input();
			element.value = value;
			element.dispatchEvent(new Event("input", { bubbles: true }));
			await flush();
		},
		enter: async () => {
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			});
			input().dispatchEvent(event);
			await flush();
			return event.defaultPrevented;
		},
		compose: async (steps) => {
			const element = input();
			element.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
			for (const step of steps) {
				element.value = step;
				element.dispatchEvent(new Event("input", { bubbles: true }));
				await flush();
			}
		},
		compositionEnd: async (value) => {
			const element = input();
			element.value = value;
			element.dispatchEvent(
				new CompositionEvent("compositionend", { bubbles: true, data: value }),
			);
			await flush();
		},
		composeWithoutSettling: (steps, final) => {
			const element = input();
			element.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
			for (const step of steps) {
				element.value = step;
				element.dispatchEvent(new Event("input", { bubbles: true }));
			}
			element.value = final;
			element.dispatchEvent(
				new CompositionEvent("compositionend", { bubbles: true, data: final }),
			);
		},
		settle: flush,
	};
}

afterEach(async () => {
	for (const session of live.splice(0, live.length)) await session.dispose();
	document.body.innerHTML = "";
});

describe("core acceptance scenario", () => {
	it("Count: 0 → press Increment → revision 2 → set-text → Count: 1", async () => {
		const m = await mount(COUNTER);
		const root = m.renderer.node(0) as HTMLElement;
		expect(m.renderer.revision).toBe(1);
		const screen = root.firstElementChild as HTMLElement;
		expect(screen.dataset.rc).toBe("screen");
		expect(screen.style.backgroundColor).toBe("rgb(17, 17, 17)");
		const stack = screen.firstElementChild as HTMLElement;
		expect(stack.style.gap).toBe("12px");
		expect(stack.style.padding).toBe("16px");
		const text = stack.firstElementChild as HTMLElement;
		expect(text.textContent).toBe("Count: 0");
		expect(text.style.fontWeight).toBe("700");
		const textNode = text.firstChild;

		await m.press("Increment");
		expect(m.renderer.revision).toBe(2);
		expect(text.textContent).toBe("Count: 1");
		/** Same Text node. The update was a single `set-text` patch, not a re-creation. */
		expect(text.firstChild).toBe(textNode);
		expect(m.renderer.size).toBe(6);
		expect(m.rootErrors).toEqual([]);
	});

	it("a button with focus keeps it after a state update elsewhere", async () => {
		const m = await mount(COUNTER);
		const root = m.renderer.node(0) as HTMLElement;
		const button = root.querySelector("button") as HTMLButtonElement;
		button.focus();
		expect(m.container.shadowRoot?.activeElement).toBe(button);
		await m.press("Increment");
		expect(root.querySelector("button")).toBe(button);
		expect(m.container.shadowRoot?.activeElement).toBe(button);
	});
});

describe("keyed moves", () => {
	it("the DOM node is preserved and hook state follows the key: a move operation", async () => {
		const m = await mount(`${IMPORTS}
function Item({ label }: { label: string }) {
	const [n, setN] = useState(0);
	return <Button onPress={() => setN(n + 1)}>{label}:{n}</Button>;
}
export default function App() {
	const [order, setOrder] = useState(["a", "b", "c"]);
	return (
		<Stack>
			{order.map((id) => <Item key={id} label={id} />)}
			<Button onPress={() => setOrder([...order].reverse())}>reverse</Button>
		</Stack>
	);
}`);
		const root = m.renderer.node(0) as HTMLElement;
		const stack = root.firstElementChild as HTMLElement;
		const buttons = () => [...stack.querySelectorAll("button")];
		const [a, b, c] = buttons();
		await m.press("a:0");
		await m.press("a:1");
		expect(a?.textContent).toBe("a:2");

		await m.press("reverse");
		expect(buttons().slice(0, 3)).toEqual([c, b, a]);
		/** a's state of 2 followed `a` when it moved. Identity comes from the key, not from position. */
		expect(a?.textContent).toBe("a:2");
		expect(c?.textContent).toBe("c:0");
		expect(m.renderer.ids()).toHaveLength(m.renderer.size);
	});
});

describe("two kinds of failure", () => {
	it("when an event makes the render throw, the previous DOM stays and the session lives", async () => {
		const m = await mount(`${IMPORTS}
export default function App() {
	const [boom, setBoom] = useState(false);
	if (boom) throw new Error("oops");
	return <Button onPress={() => setBoom(true)}>explode</Button>;
}`);
		const root = m.renderer.node(0) as HTMLElement;
		await m.press("explode");
		expect(root.textContent).toBe("explode");
		expect(m.renderer.revision).toBe(1);
		expect(m.rootErrors).toEqual(["oops"]);
		expect(m.session.state).toBe("ready");
	});

	it("an effect's console.log comes after the first commit and cleanup exactly once at unmount", async () => {
		const m = await mount(`${IMPORTS}
import { useEffect } from "@rowcat/runtime";
export default function App() {
	useEffect(() => {
		console.log("mounted");
		return () => { console.log("cleanup"); };
	}, []);
	return <Text>hi</Text>;
}`);
		expect(m.logs).toEqual([["mounted"]]);
		const unmounted = await m.session.unmountRoot();
		expect(unmounted.ok).toBe(true);
		expect(m.logs).toEqual([["mounted"], ["cleanup"]]);
		expect(m.renderer.size).toBe(0);
		expect((m.renderer.node(0) as HTMLElement).childNodes).toHaveLength(0);
	});

	it("asset references pass the resolver, with a placeholder when absent", async () => {
		const m = await mount(`${IMPORTS}
import { Image, asset } from "@rowcat/runtime";
export default function App() {
	return <Image source={asset("characters/sena/smile")} alt="Sena" fit="cover" />;
}`);
		const image = (m.renderer.node(0) as HTMLElement).querySelector(
			"img",
		) as HTMLImageElement;
		expect(image.hasAttribute("src")).toBe(false);
		expect(image.getAttribute("alt")).toBe("Sena");
		expect(image.dataset.rcMissing).toBe("");
	});

	/**
	 * A remote reference traveling from the VM to the DOM: `asset("https://…")` → wire `{ $asset }` →
	 * classification → resolver → `src`. That the final address is RowCat's is the point of this
	 * slice.
	 */
	it("remote assets are drawn via RowCat's proxy address and the creator's address is not in the DOM", async () => {
		const m = await mount(`${IMPORTS}
import { Image, asset } from "@rowcat/runtime";
export default function App() {
	return <Image source={asset("https://cdn.example.com/sena.webp?v=2")} alt="Sena" />;
}`);
		const image = (m.renderer.node(0) as HTMLElement).querySelector(
			"img",
		) as HTMLImageElement;
		expect(image.getAttribute("src")).toBe(
			"https://api.rowcat.test/v2/runtime/assets/remote?url=https%3A%2F%2Fcdn.example.com%2Fsena.webp%3Fv%3D2",
		);
		expect(image.dataset.rcMissing).toBeUndefined();
		expect(
			(m.renderer.node(0) as HTMLElement).innerHTML.includes(
				'src="https://cdn.example.com',
			),
		).toBe(false);
	});
});

/**
 * A minimal app that accumulates sent messages. The owner of the controlled value is the `useState`
 * inside QuickJS, and the browser `<input>` only depicts that value. This file asks whether that
 * round trip actually runs.
 */
const COMPOSER = `import { Button, Stack, Text, TextInput, useState } from "@rowcat/runtime";
export default function App() {
	const [draft, setDraft] = useState("");
	const [sent, setSent] = useState<string[]>([]);
	function send() {
		const text = draft.trim();
		if (text.length === 0) return;
		setSent((current) => [...current, text]);
		setDraft("");
	}
	return (
		<Stack gap={8}>
			<Text>{"Messages sent: " + String(sent.length)}</Text>
			{sent.map((line: string, index: number) => (
				<Text key={String(index)}>{line}</Text>
			))}
			<TextInput value={draft} onChangeText={setDraft} onSubmit={send} />
			<Button onPress={send}>Send</Button>
		</Stack>
	);
}`;

describe("text input: browser → reconciler → browser", () => {
	it("typed text becomes VM state and that state becomes the field's value again", async () => {
		const m = await mount(COMPOSER);
		await m.typeText("a");
		await m.typeText("ab");
		expect(m.input().value).toBe("ab");
		await m.press("Send");
		expect(m.input().value).toBe("");
		const texts = [
			...(m.renderer.node(0) as HTMLElement).querySelectorAll(
				'[data-rc="text"]',
			),
		];
		expect(texts.map((node) => node.textContent)).toContain("ab");
		expect(m.rootErrors).toEqual([]);
	});

	/**
	 * §41: Korean composition. Pressing Enter while composing `\u314e` → `\ud558` → `\ud55c` confirms the candidate
	 * and does not submit. If that judgment is wrong, the user would send `ㅎ`, which they never typed
	 * as a message.
	 */
	it("Enter during composition is not submit, and the one confirmed character is sent once", async () => {
		const m = await mount(COMPOSER);
		await m.compose(["\u314e", "\ud558", "\ud55c"]);
		expect(await m.enter()).toBe(false);
		await m.compositionEnd("\ud55c");
		expect(await m.enter()).toBe(true);

		const root = m.renderer.node(0) as HTMLElement;
		const texts = [...root.querySelectorAll('[data-rc="text"]')].map(
			(node) => node.textContent,
		);
		expect(texts[0]).toBe("Messages sent: 1");
		expect(texts).toContain("\ud55c");
		/** `\u314e` and `\ud558` are intermediate composition states and must not be sent. */
		expect(texts).not.toContain("ㅎ");
		expect(texts).not.toContain("\ud558");
		expect(m.input().value).toBe("");
		expect(m.rootErrors).toEqual([]);
	});

	/**
	 * §3: a late answer must not erase confirmed text.
	 *
	 * In Korean, the moment one composition ends is also the moment the next begins. Assigning a
	 * controlled value that is one character behind at that point makes the IME redraw its composition
	 * range over the erased text, so the screen shows missing or duplicated jamo. The test
	 * deliberately does not wait for answers; settling at every step would keep this defect from ever
	 * appearing.
	 */
	it("the confirmed character stays when composing without waiting for the answer", async () => {
		const m = await mount(COMPOSER);
		m.composeWithoutSettling(["\u314e", "\ud558", "\ud55c"], "\ud55c");
		expect(m.input().value).toBe("\ud55c");
		await m.settle();
		expect(m.input().value).toBe("\ud55c");
		/** The text is also VM state, not only what the screen shows. */
		expect(await m.enter()).toBe(true);
		const texts = [
			...(m.renderer.node(0) as HTMLElement).querySelectorAll(
				'[data-rc="text"]',
			),
		].map((node) => node.textContent);
		expect(texts).toContain("\ud55c");
		expect(texts[0]).toBe("Messages sent: 1");
		expect(m.rootErrors).toEqual([]);
	});

	/**
	 * §26: one Enter sends one message.
	 *
	 * In a browser, the same Enter can be read along two paths: `keydown` and form submission. The
	 * renderer blocking the default action removes the second path. The test checks the outcome: one
	 * more list item and an emptied input.
	 */
	it("one Enter is one message", async () => {
		const m = await mount(COMPOSER);
		await m.typeText("just once");
		expect(await m.enter()).toBe(true);
		const texts = () =>
			[
				...(m.renderer.node(0) as HTMLElement).querySelectorAll(
					'[data-rc="text"]',
				),
			].map((node) => node.textContent);
		expect(texts()[0]).toBe("Messages sent: 1");
		expect(texts()).toContain("just once");
		expect(m.input().value).toBe("");
		/** A second Enter on the cleared input must not add an empty message. */
		expect(await m.enter()).toBe(true);
		expect(texts()[0]).toBe("Messages sent: 1");
	});
});

/**
 * jsdom does not compute layout, so content size is measured by child count. This file checks when
 * the renderer measures, not how the browser scrolls, and child count is enough for that.
 */
function measureByChildren(element: HTMLElement): { top: number } {
	const position = { top: 0 };
	Object.defineProperty(element, "clientHeight", {
		value: 100,
		configurable: true,
	});
	/** Each child counts as 100, so the scroll end is `(child count - 1) * 100`. */
	Object.defineProperty(element, "scrollHeight", {
		get: () => element.children.length * 100,
		configurable: true,
	});
	Object.defineProperty(element, "scrollTo", {
		value: (options: ScrollToOptions) => {
			if (options.top !== undefined) position.top = options.top;
		},
		configurable: true,
	});
	return position;
}

const MESSENGER = `import { Button, Screen, ScrollView, Stack, Text, TextInput, useScrollController, useState, useTextEntryController } from "@rowcat/runtime";
export default function App() {
	const scroll = useScrollController();
	const reply = useTextEntryController();
	const [rows, setRows] = useState<string[]>(["A"]);
	const [draft, setDraft] = useState("");
	return (
		<Screen>
			<Stack>
				<ScrollView controller={scroll}>
					{rows.map((row) => <Text key={row}>{row}</Text>)}
				</ScrollView>
				<TextInput controller={reply} value={draft} onChangeText={setDraft} />
				<Button onPress={() => {
					setRows((current) => [...current, "Row " + String(current.length)]);
					scroll.scrollToEnd();
				}}>Send</Button>
				<Button onPress={() => reply.focus()}>Reply</Button>
			</Stack>
		</Screen>
	);
}`;

describe("scroll and focus", () => {
	/**
	 * §12's guarantee, checked in the DOM. If a command arrives before the commit, the count is the
	 * end before the content grew. That defect raises no error, so the test pins a value.
	 */
	it("scrollToEnd after appending measures the end **after growing**", async () => {
		const m = await mount(MESSENGER);
		const box = m.container.shadowRoot?.querySelector(
			'[data-rc="scroll"]',
		) as HTMLElement;
		const position = measureByChildren(box);

		expect(box.children).toHaveLength(1);
		await m.press("Send");
		expect(box.children).toHaveLength(2);
		expect(position.top).toBe(100);

		await m.press("Send");
		expect(position.top).toBe(200);
	});

	it("focus called by the creator reaches the real input", async () => {
		const m = await mount(MESSENGER);
		const input = m.input();
		const scope = input.getRootNode() as ShadowRoot;
		expect(scope.activeElement).not.toBe(input);
		await m.press("Reply");
		expect(scope.activeElement).toBe(input);
	});
});
