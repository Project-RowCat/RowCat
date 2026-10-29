import { space } from "@rowcat/design";
import { Button, ListRow, ListSection, Text } from "@rowcat/ui-native";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
	createHostTransport,
	describeNativeRuntimeHost,
} from "../../lib/runtime-native/host-bridge.ts";
import { answerHostCall } from "../../lib/runtime-native/protocol.ts";
import { NativeRuntimeHostView } from "../../lib/runtime-native/runtime-host-view.tsx";
import { INITIAL_LAB_STATE, reduceRuntimeVmLab } from "./lab-state.ts";

/**
 * Runtime VM PoC lab. A development diagnostics section, not product UI.
 *
 * ```text
 * Hermes (this component)  ──bridge──▶  trusted runtime WebView (@rowcat/runtime-host)
 *                          ◀────────        └─ QuickJS WASM VM ← creator artifact
 * ```
 *
 * This component starts the harness, answers the PoC capabilities (`test.echo`, `test.fail`)
 * itself, and draws steps and measurements. Creator code never runs in Hermes.
 *
 * The bridge is the same one the production runtime uses, so this lab does not stand up its own
 * WebView. Two bridges would let the PoC run on one path (`WebMessagePort` on Android) and
 * production on another, and then the numbers this screen measures would not belong to the
 * production path.
 */

const format = (value: number): string =>
	value >= 100
		? value.toFixed(0)
		: value >= 10
			? value.toFixed(1)
			: value.toFixed(2);

export function RuntimeVmLab({ autoRun = false }: { autoRun?: boolean }) {
	const [state, dispatch] = useReducer(reduceRuntimeVmLab, INITIAL_LAB_STATE);
	const descriptor = useMemo(() => describeNativeRuntimeHost(), []);
	const transport = useMemo(
		() => createHostTransport(descriptor),
		[descriptor],
	);

	useEffect(() => {
		const unsubscribe = transport.subscribe((event) => {
			if (event.type === "transport-failed") {
				dispatch({ type: "transport-failed", message: event.reason });
				return;
			}
			dispatch({ type: "message", message: event.message });
			if (event.message.type === "host-call") {
				const answer = answerHostCall(event.message);
				if (answer !== null) transport.send(answer);
			}
		});
		return () => {
			unsubscribe();
			transport.close();
		};
	}, [transport]);

	const run = useCallback(() => {
		dispatch({ type: "start" });
		transport.send({
			type: "poc-run",
			platform: `${Platform.OS} ${Platform.Version}`,
		});
	}, [transport]);

	/**
	 * Runs once, when the harness first becomes ready. Reopening does not run it again (true only in
	 * `ready`).
	 */
	useEffect(() => {
		if (!autoRun || state.phase !== "ready") return;
		run();
	}, [autoRun, state.phase, run]);

	const measurements = state.report?.measurements;

	return (
		<ListSection title="Runtime VM PoC (WASM · WebView)">
			<NativeRuntimeHostView descriptor={descriptor} transport={transport} />
			<ListRow label="Bridge" value={transport.bridge} />
			{descriptor.unavailableReason !== null ? (
				<Text variant="label" tone="destructive">
					{descriptor.unavailableReason}
				</Text>
			) : null}
			<View style={lab.actions}>
				<Button
					label={
						state.phase === "loading"
							? "Loading the harness"
							: state.phase === "running"
								? "Running"
								: "Run suite"
					}
					variant="secondary"
					size="sm"
					onPress={run}
					disabled={state.phase === "loading" || state.phase === "running"}
					busy={state.phase === "running"}
				/>
				<Text variant="label" tone="muted">
					{state.report ? (state.report.ok ? "PASS" : "FAIL") : state.phase}
					{autoRun ? " · autorun" : ""}
				</Text>
			</View>
			{state.error ? (
				<Text variant="label" tone="destructive">
					{state.error}
				</Text>
			) : null}
			{state.steps.map((step) => (
				<ListRow
					key={step.name}
					label={`${step.ok ? "PASS" : "FAIL"} · ${step.name}`}
					value={`${format(step.ms)}ms`}
				/>
			))}
			{measurements && state.report ? (
				<>
					<ListRow label="engine" value={state.report.engine} />
					<ListRow
						label="cold session"
						value={`${format(measurements.coldSessionMs)} ms`}
					/>
					<ListRow
						label="warm session"
						value={`${format(measurements.warmSessionMs)} ms`}
					/>
					<ListRow
						label="warm · create vm"
						value={`${format(measurements.warmCreateVmMs)} ms`}
					/>
					<ListRow
						label="warm · bootstrap"
						value={`${format(measurements.warmBootstrapMs)} ms`}
					/>
					<ListRow
						label="warm · evaluate graph"
						value={`${format(measurements.warmEvaluateGraphMs)} ms`}
					/>
					<ListRow
						label="call round trip"
						value={`${format(measurements.callRoundTripUs)} µs`}
					/>
					<ListRow
						label="host round trip (native)"
						value={`${format(measurements.hostRoundTripUs)} µs`}
					/>
					<ListRow
						label="async host round trip"
						value={`${format(measurements.asyncHostRoundTripUs)} µs`}
					/>
					<ListRow
						label="dispose"
						value={`${format(measurements.disposeMs)} ms`}
					/>
					<ListRow
						label="baseline linear memory"
						value={
							measurements.baselineMemoryBytes === null
								? "—"
								: `${(measurements.baselineMemoryBytes / 1048576).toFixed(1)} MiB`
						}
					/>
					{state.report.stackProbe.map((probe) => (
						<ListRow
							key={probe.ceilingBytes}
							label={`stack ${probe.ceilingBytes / 1024} KiB`}
							value={`${probe.outcome}${probe.repeatable ? "" : " (unstable)"}`}
						/>
					))}
					<Text variant="label" tone="muted">
						{state.report.platform}
					</Text>
					{/* Whole report on one line: even if the screen clips it, the accessibility tree carries it in full for the harness to read. */}
					<Text variant="label" tone="muted" selectable>
						{JSON.stringify({
							ok: state.report.ok,
							bridge: transport.bridge,
							measurements: state.report.measurements,
							stackProbe: state.report.stackProbe,
							steps: state.report.steps.map((step) => [
								step.name,
								step.ok,
								Math.round(step.ms),
							]),
						})}
					</Text>
				</>
			) : null}
		</ListSection>
	);
}

const lab = StyleSheet.create({
	actions: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
