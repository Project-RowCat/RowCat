import { space } from "@rowcat/design";
import { NativeRuntimeSurface } from "@rowcat/runtime-renderer-native";
import { Button, ListRow, ListSection, Text } from "@rowcat/ui-native";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { StyleSheet, View } from "react-native";
import { RUNTIME_COUNTER_FIXTURE } from "../../lib/runtime-native/fixture.generated.ts";
import {
	createHostTransport,
	describeNativeRuntimeHost,
} from "../../lib/runtime-native/host-bridge.ts";
import { RUNTIME_VM_WASM_BYTES } from "../../lib/runtime-native/runtime-assets.generated.ts";
import { NativeRuntimeHostView } from "../../lib/runtime-native/runtime-host-view.tsx";
import { createNativeRuntimeSession } from "../../lib/runtime-native/session.ts";
import { nativeRuntimeControls } from "../../lib/runtime-native/session-state.ts";
import { firstPressHandler, runInteractionBenchmark } from "./benchmark.ts";

/**
 * Native runtime lab: a development diagnostic section, not product UI.
 *
 * Fixture artifact → session → bridge → QuickJS/WASM → reconciler → one patch bundle → host tree
 * store → NativeRuntimeSurface (RN).
 *
 * It runs the acceptance scenario (0 → 1 → 2 → restart at 0), measures interaction latency, and
 * reports which bridge the run used. The artifact is committed by the repository and is never
 * compiled on the device; mobile is the playback side only.
 */

/** Iterations including warmup; the summary discards the warmup samples. */
const BENCH_WARMUP = 30;
const BENCH_ITERATIONS = BENCH_WARMUP + 300;
const BENCH_TIMEOUT_MS = 5_000;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const ms = (value: number): string =>
	value >= 100 ? value.toFixed(0) : value.toFixed(1);

export function RuntimeNativeLab() {
	const descriptor = useMemo(() => describeNativeRuntimeHost(), []);
	const transport = useMemo(
		() => createHostTransport(descriptor),
		[descriptor],
	);
	const session = useMemo(
		() => createNativeRuntimeSession({ transport }),
		[transport],
	);

	useEffect(() => () => session.dispose(), [session]);

	const state = useSyncExternalStore(session.subscribe, session.getState);
	const controls = nativeRuntimeControls(state);
	const [bench, setBench] = useState<string | null>(null);

	const start = useCallback(() => {
		setBench(null);
		session.start(RUNTIME_COUNTER_FIXTURE);
	}, [session]);

	const runBench = useCallback(async () => {
		session.resetMetrics();
		setBench("Running…");
		const outcome = await runInteractionBenchmark({
			target: session,
			// Re-read the press handler from the current tree each iteration; it changes on every commit.
			handlerFor: (target) => firstPressHandler(target.store),
			iterations: BENCH_ITERATIONS,
			timeoutMs: BENCH_TIMEOUT_MS,
			delay: sleep,
			yieldTurn: () => sleep(0),
			onProgress: (completed) => {
				if (completed % 50 === 0) setBench(`${completed} runs`);
			},
		});
		setBench(
			outcome.ok
				? `${outcome.completed} runs done`
				: `${outcome.reason} · stopped at ${outcome.completed} runs`,
		);
	}, [session]);

	const latency = session.latency(BENCH_WARMUP);
	const console_ = session.console();

	return (
		<ListSection title="Creator runtime (native playback)">
			<NativeRuntimeHostView descriptor={descriptor} transport={transport} />

			<ListRow label="Bridge" value={transport.bridge} />
			<ListRow label="Status" value={state.status} />
			<ListRow
				label="WASM asset"
				value={`${(RUNTIME_VM_WASM_BYTES / 1024).toFixed(0)} KiB`}
			/>
			{descriptor.unavailableReason !== null ? (
				<Text variant="label" tone="destructive">
					{descriptor.unavailableReason}
				</Text>
			) : null}

			<View style={lab.actions}>
				<Button
					label={controls.restart ? "Restart" : "Run"}
					variant="secondary"
					size="sm"
					onPress={start}
					disabled={!controls.start && !controls.restart}
				/>
				<Button
					label="Stop"
					variant="outline"
					size="sm"
					onPress={() => session.stop()}
					disabled={!controls.stop}
				/>
				<Button
					label="benchmarking"
					variant="outline"
					size="sm"
					onPress={() => void runBench()}
					disabled={state.status !== "running"}
				/>
			</View>

			{state.status === "running" ? (
				<ListRow label="Revision" value={String(state.revision)} />
			) : null}
			{state.status === "running" && state.rootError !== null ? (
				<Text variant="label" tone="destructive">
					{state.rootError.work}: {state.rootError.error.name} —{" "}
					{state.rootError.error.message}
				</Text>
			) : null}
			{state.status === "failed" ? (
				<Text variant="label" tone="destructive">
					{state.failure.stage}:{" "}
					{"message" in state.failure
						? state.failure.message
						: state.failure.error.message}
				</Text>
			) : null}

			{/* The creator's screen. Everything under this box belongs to the runtime renderer; no component drawn here is RowCat's. */}
			<View style={lab.surface}>
				<NativeRuntimeSurface
					store={session.store}
					dispatchEvent={(handlerId, payload) =>
						session.dispatchEvent(handlerId, payload ?? undefined)
					}
					resolveAsset={() => null}
					controls={session.controls}
					style={lab.surfaceInner}
				/>
			</View>

			{bench !== null ? <ListRow label="benchmarking" value={bench} /> : null}
			{latency !== null ? (
				<>
					<ListRow label="Samples" value={String(latency.samples)} />
					<ListRow label="Median" value={`${ms(latency.medianMs)} ms`} />
					<ListRow label="p95" value={`${ms(latency.p95Ms)} ms`} />
					<ListRow label="p99" value={`${ms(latency.p99Ms)} ms`} />
					<ListRow
						label="min · max"
						value={`${ms(latency.minMs)} · ${ms(latency.maxMs)} ms`}
					/>
					{/* One-line report; even if clipped on screen it stays whole in the accessibility tree. */}
					<Text variant="label" tone="muted" selectable>
						{JSON.stringify({
							bridge: transport.bridge,
							warmup: BENCH_WARMUP,
							...latency,
						})}
					</Text>
				</>
			) : null}

			{console_.slice(-5).map((line, index) => (
				<ListRow
					// biome-ignore lint/suspicious/noArrayIndexKey: console lines have no identity; their position is the identity.
					key={`${index}-${line.level}`}
					label={line.level}
					value={line.args.map((arg) => JSON.stringify(arg)).join(" ")}
				/>
			))}
		</ListSection>
	);
}

const lab = StyleSheet.create({
	actions: { flexDirection: "row", alignItems: "center", gap: space.sm },
	/** Creator-surface box: sets only the size; the visuals inside belong to the runtime renderer. */
	surface: { height: 180 },
	surfaceInner: { flex: 1 },
});
