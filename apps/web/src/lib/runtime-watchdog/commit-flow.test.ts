import {
	createRuntimeVmSession,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { defaultSchedulerClock } from "@rowcat/runtime-host/scheduler/clock";
import { compiled, testEngine } from "@rowcat/runtime-host/test/fixtures";
import { afterEach, describe, expect, it } from "vitest";
import {
	createRuntimeCommitFlow,
	RUNTIME_MAX_UNACKNOWLEDGED_COMMITS,
} from "./commit-flow.ts";

/**
 * The flow gate on real QuickJS. A creator effect that sets state on every render commits as fast
 * as the scheduler lets it; the question is whether commits stop when main stops answering, start
 * again when it answers, and whether the session can still be stopped while main is silent.
 *
 * `main` below stands in for the main thread: it receives commits and acknowledges them only when
 * the test says so. The worker would post them; here onCommit is the post.
 */

const LOOP = compiled([
	{
		path: "src/main.tsx",
		content: `import { Text, useEffect, useState } from "@rowcat/runtime";
export default function App() {
	const [n, setN] = useState(0);
	useEffect(() => { setN((value) => value + 1); });
	return <Text>{String(n)}</Text>;
}`,
	},
]);

/**
 * Each press starts a short burst that fits in one slice: the drain ends with the queue empty, so it
 * never reaches the gated yield. Only the next press starts another drain.
 */
const BURST = compiled([
	{
		path: "src/main.tsx",
		content: `import { Button, Text, useCallback, useEffect, useState } from "@rowcat/runtime";
export default function App() {
	const [left, setLeft] = useState(0);
	useEffect(() => { if (left > 0) setLeft(left - 1); }, [left]);
	const press = useCallback(() => setLeft(3), []);
	return <Button onPress={press}><Text>{String(left)}</Text></Button>;
}`,
	},
]);

/** The most a slice may emit before it reaches the gated yield (DEFAULT_BUDGET_POLICY). */
const MAX_TURNS_PER_SLICE = 32;

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Disposal waits for the scheduler to go idle, so a session parked on the gate must be released
 * first or this hook hangs — the very hang release() exists for.
 */
let open: {
	session: RuntimeVmSession;
	flow: ReturnType<typeof createRuntimeCommitFlow>;
} | null = null;
afterEach(async () => {
	open?.flow.release();
	await open?.session.dispose();
	open = null;
});

async function mount(gated: boolean) {
	const flow = createRuntimeCommitFlow(defaultSchedulerClock());
	const revisions: number[] = [];
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: LOOP,
		scheduling: { clock: gated ? flow.clock : defaultSchedulerClock() },
	});
	open = { session, flow };
	const mounted = await session.mountRoot({
		onCommit: (batch) => {
			flow.committed(batch.revision);
			revisions.push(batch.revision);
		},
	});
	expect(mounted.ok).toBe(true);
	return { flow, session, revisions };
}

describe("commit flow on a live session", () => {
	it("an unanswered main thread stops the commits, not the session", async () => {
		const { session, revisions } = await mount(true);
		await wait(150);
		const parked = revisions.length;
		expect(parked).toBeLessThanOrEqual(
			RUNTIME_MAX_UNACKNOWLEDGED_COMMITS + MAX_TURNS_PER_SLICE + 1,
		);
		await wait(150);
		expect(revisions.length).toBe(parked);
		expect(session.state).not.toBe("failed");
	});

	it("without the gate the same work keeps committing (the finding)", async () => {
		const { revisions } = await mount(false);
		await wait(150);
		expect(revisions.length).toBeGreaterThan(
			RUNTIME_MAX_UNACKNOWLEDGED_COMMITS + MAX_TURNS_PER_SLICE + 1,
		);
	});

	it("acknowledging lets the work continue at main's pace", async () => {
		const { flow, revisions } = await mount(true);
		await wait(50);
		const before = revisions.length;
		for (let round = 0; round < 5; round += 1) {
			flow.acknowledged(revisions.at(-1) ?? 0);
			await wait(20);
		}
		expect(revisions.length).toBeGreaterThan(before);
		expect(flow.unacknowledged).toBeLessThanOrEqual(
			RUNTIME_MAX_UNACKNOWLEDGED_COMMITS + MAX_TURNS_PER_SLICE + 1,
		);
	});

	it("a session parked on the gate still stops once released", async () => {
		const { flow, session } = await mount(true);
		await wait(50);
		flow.release();
		const unmounted = await session.unmountRoot();
		expect(unmounted.ok).toBe(true);
		await session.settle();
		await session.dispose();
		open = null;
		expect(session.state).toBe("disposed");
	});
});

/**
 * Finding: the gate sat only in the yield between slices, and a drain that empties its queue ends
 * without yielding. Every press therefore started a fresh drain whose first slice nobody gated, and
 * a person pressing while main was behind added a slice of commits per press. Wakes from main now
 * pass through admit().
 */
describe("commit flow across drains", () => {
	async function mountBurst() {
		const flow = createRuntimeCommitFlow(defaultSchedulerClock());
		const revisions: number[] = [];
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: BURST,
			scheduling: { clock: flow.clock },
		});
		open = { session, flow };
		const mounted = await session.mountRoot({
			onCommit: (batch) => {
				flow.committed(batch.revision);
				revisions.push(batch.revision);
			},
		});
		expect(mounted.ok).toBe(true);
		/** The press handler's number: the first handler the tree registered (useCallback keeps it). */
		const press = (): void => {
			flow.admit(() => void session.dispatchEvent(1));
		};
		return { flow, session, revisions, press };
	}

	it("presses while main is silent do not each add a slice", async () => {
		const { revisions, press } = await mountBurst();
		for (let round = 0; round < 30; round += 1) {
			press();
			await wait(5);
		}
		await wait(50);
		expect(revisions.length).toBeLessThanOrEqual(
			RUNTIME_MAX_UNACKNOWLEDGED_COMMITS + MAX_TURNS_PER_SLICE + 1,
		);
	});

	it("held presses run in order once main answers, and release lets them all through", async () => {
		const { flow, revisions, press } = await mountBurst();
		press();
		await wait(30);
		const afterFirst = revisions.length;
		press();
		press();
		await wait(30);
		expect(revisions.length).toBe(afterFirst);
		flow.acknowledged(revisions.at(-1) ?? 0);
		await wait(30);
		expect(revisions.length).toBeGreaterThan(afterFirst);
		const afterAck = revisions.length;
		press();
		flow.release();
		await wait(30);
		expect(revisions.length).toBeGreaterThan(afterAck);
	});
});

describe("commit flow rules", () => {
	const manual = () => {
		let ticks: (() => void)[] = [];
		return {
			clock: {
				now: () => 0,
				yield: () =>
					new Promise<void>((resolve) => {
						ticks.push(resolve);
					}),
			},
			tick() {
				const ready = ticks;
				ticks = [];
				for (const resolve of ready) resolve();
			},
		};
	};

	it("yield returns while at most the bound is unanswered", async () => {
		const base = manual();
		const flow = createRuntimeCommitFlow(base.clock, 2);
		flow.committed(2);
		let returned = false;
		void flow.clock.yield().then(() => {
			returned = true;
		});
		base.tick();
		await Promise.resolve();
		await Promise.resolve();
		expect(returned).toBe(true);
	});

	it("past the bound it waits for an acknowledgement", async () => {
		const base = manual();
		const flow = createRuntimeCommitFlow(base.clock, 2);
		flow.committed(5);
		let returned = false;
		void flow.clock.yield().then(() => {
			returned = true;
		});
		base.tick();
		await wait(0);
		expect(returned).toBe(false);
		flow.acknowledged(2);
		await wait(0);
		expect(returned).toBe(false);
		flow.acknowledged(3);
		await wait(0);
		expect(returned).toBe(true);
	});

	it("an acknowledgement beyond what was posted does not open future commits", () => {
		const flow = createRuntimeCommitFlow(manual().clock, 2);
		flow.committed(1);
		flow.acknowledged(100);
		flow.committed(5);
		expect(flow.unacknowledged).toBe(4);
	});

	it("admit runs at once while open, holds in order while shut, and release runs the rest", async () => {
		const flow = createRuntimeCommitFlow(manual().clock, 2);
		const ran: string[] = [];
		flow.admit(() => ran.push("a"));
		expect(ran).toEqual(["a"]);
		flow.committed(3);
		flow.admit(() => ran.push("b"));
		flow.admit(() => ran.push("c"));
		expect(ran).toEqual(["a"]);
		flow.acknowledged(1);
		expect(ran).toEqual(["a", "b", "c"]);
		flow.committed(10);
		flow.admit(() => ran.push("d"));
		flow.release();
		expect(ran).toEqual(["a", "b", "c", "d"]);
		flow.admit(() => ran.push("e"));
		expect(ran).toEqual(["a", "b", "c", "d", "e"]);
	});

	it("release opens it for good", async () => {
		const base = manual();
		const flow = createRuntimeCommitFlow(base.clock, 0);
		flow.committed(10);
		const parked = flow.clock.yield();
		base.tick();
		flow.release();
		await parked;
		flow.committed(20);
		const next = flow.clock.yield();
		base.tick();
		await next;
	});
});
