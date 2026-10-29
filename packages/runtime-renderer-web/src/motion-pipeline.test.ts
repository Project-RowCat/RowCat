// @vitest-environment jsdom

import type { RuntimeVmSession } from "@rowcat/runtime-host";
import { createRuntimeVmSession } from "@rowcat/runtime-host";
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import { compiled, testEngine } from "@rowcat/runtime-host/test/fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { createWebRuntimeRenderer } from "./renderer.ts";

/**
 * The real transition pipeline: TSX → compiler → artifact → QuickJS → reconciler → batch → DOM. No
 * hand-written batch is used. This file answers two questions:
 * - Do transition, translateY and scale, as the creator wrote them, survive compilation and the
 *   VM to become the screen?
 * - Does a 200 ms transition avoid becoming 60 VM turns? One press is one batch. A design that
 *   gave creators frames would grow this count with the frame count, and on native each frame would
 *   cross the bridge.
 */

const SOURCE = `import { Button, Screen, Stack, Text, View, useState } from "@rowcat/runtime";

export default function App() {
	const [open, setOpen] = useState(false);

	return (
		<Screen>
			<Stack gap={12}>
				<Button onPress={() => setOpen((value) => !value)}>Toggle</Button>
				<View
					transition={{ duration: 200, easing: "ease-out" }}
					style={{
						opacity: open ? 1 : 0.25,
						translateY: open ? 0 : 12,
						scale: open ? 1 : 0.96,
					}}
				>
					<Text>Motion</Text>
				</View>
			</Stack>
		</Screen>
	);
}`;

const live: RuntimeVmSession[] = [];

interface Mounted {
	batches: RuntimePatchBatch[];
	root: HTMLElement;
	moved(): HTMLElement;
	press(label: string): Promise<void>;
}

async function mount(source: string): Promise<Mounted> {
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([{ path: "src/main.tsx", content: source }]),
	});
	live.push(session);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const pending: Promise<unknown>[] = [];
	const batches: RuntimePatchBatch[] = [];
	const renderer = createWebRuntimeRenderer({
		container,
		dispatchEvent: (handler, payload) => {
			pending.push(
				payload === undefined || payload === null
					? session.dispatchEvent(handler)
					: session.dispatchEvent(handler, payload),
			);
		},
		resolveAsset: () => null,
	});
	const mounted = await session.mountRoot({
		onCommit: (batch) => {
			batches.push(batch);
			renderer.apply(batch);
		},
	});
	if (!mounted.ok) throw mounted.error;
	await session.settle();
	const root = container.shadowRoot?.querySelector(
		'[data-rc="root"]',
	) as HTMLElement;
	const flush = async (): Promise<void> => {
		for (let round = 0; round < 10; round += 1) {
			if (pending.length === 0) break;
			await Promise.all(pending.splice(0, pending.length));
			await session.settle();
		}
		await session.settle();
	};
	return {
		batches,
		root,
		moved: () => root.querySelector('[data-rc="view"]') as HTMLElement,
		press: async (label) => {
			const button = [...root.querySelectorAll("button")].find(
				(candidate) => candidate.textContent === label,
			);
			if (button === undefined) throw new Error(`no button ${label}`);
			button.click();
			await flush();
		},
	};
}

afterEach(async () => {
	for (const session of live.splice(0, live.length)) await session.dispose();
	document.body.innerHTML = "";
});

describe("transitions the creator wrote become the screen", () => {
	it("the first screen stands at the target with the transition armed", async () => {
		const m = await mount(SOURCE);
		const view = m.moved();
		expect(view.style.opacity).toBe("0.25");
		expect(view.style.transform).toBe(
			"translateX(0px) translateY(12px) scale(0.96)",
		);
		expect(view.style.getPropertyValue("transition-property")).toBe(
			"opacity, transform",
		);
		expect(view.style.getPropertyValue("transition-duration")).toBe("200ms");
		expect(view.style.getPropertyValue("transition-timing-function")).toBe(
			"cubic-bezier(0, 0, 0.58, 1)",
		);
	});

	it("pressing changes the target: three axes together", async () => {
		const m = await mount(SOURCE);
		await m.press("Toggle");
		const view = m.moved();
		expect(view.style.opacity).toBe("1");
		expect(view.style.transform).toBe(
			"translateX(0px) translateY(0px) scale(1)",
		);
	});

	it("reverting goes back", async () => {
		const m = await mount(SOURCE);
		await m.press("Toggle");
		await m.press("Toggle");
		expect(m.moved().style.opacity).toBe("0.25");
	});
});

describe("the VM makes no frames", () => {
	/**
	 * This count is the evidence for the design. One press is one commit, and for 200 ms the VM is not
	 * called again: interpolation all happens in the browser's realm.
	 */
	it("one press is one bundle, even for a 200ms transition", async () => {
		const m = await mount(SOURCE);
		const before = m.batches.length;
		await m.press("Toggle");
		expect(m.batches.length).toBe(before + 1);
	});

	/**
	 * The batch also carries one operation. A design that carried frames as patches would have a
	 * set-prop per frame here.
	 */
	it("that bundle has only one style operation", async () => {
		const m = await mount(SOURCE);
		await m.press("Toggle");
		const last = m.batches[m.batches.length - 1] as RuntimePatchBatch;
		const styles = last.patches.filter(
			(patch) => patch.op === "set-prop" && patch.name === "style",
		);
		expect(styles).toHaveLength(1);
		/**
		 * The rest are unrelated existing operations (new handler numbers from each render's onPress).
		 * The point is that no frames exist, so the bound is set generously and pinned. A frame-carrying
		 * design would have exceeded 60.
		 */
		expect(last.patches.length).toBeLessThanOrEqual(4);
	});

	/**
	 * The transition policy is the same object value on each render, so set-prop transition is not
	 * sent again. Equality is judged on the serialized shape, not object identity (host-props.ts).
	 */
	it("an unchanged transition policy is not sent again", async () => {
		const m = await mount(SOURCE);
		await m.press("Toggle");
		const last = m.batches[m.batches.length - 1] as RuntimePatchBatch;
		expect(
			last.patches.some(
				(patch) => patch.op === "set-prop" && patch.name === "transition",
			),
		).toBe(false);
	});

	it("the transition crosses as one ordinary prop", async () => {
		const m = await mount(SOURCE);
		const first = m.batches[0] as RuntimePatchBatch;
		const transition = first.patches.find(
			(patch) => patch.op === "set-prop" && patch.name === "transition",
		);
		expect(transition).toMatchObject({
			op: "set-prop",
			value: { duration: 200, easing: "ease-out" },
		});
	});
});

describe("the VM refuses values off contract", () => {
	/**
	 * Even if the creator bypasses types with `as`, the failure stops inside the VM and never reaches
	 * the renderer or fails the batch. A rejected run produces no commit from the reconciler, so the
	 * previous screen remains.
	 */
	it("easings outside the vocabulary are refused at run time", async () => {
		const source = `import { Screen, View } from "@rowcat/runtime";
export default function App() {
	return (
		<Screen>
			<View transition={{ easing: "spring" } as never} style={{ opacity: 1 }} />
		</Screen>
	);
}`;
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([{ path: "src/main.tsx", content: source }]),
		});
		live.push(session);
		const mounted = await session.mountRoot({ onCommit: () => {} });
		expect(mounted.ok).toBe(false);
	});
});
