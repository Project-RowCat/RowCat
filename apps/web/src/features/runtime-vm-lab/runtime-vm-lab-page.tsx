import type { PocReport, PocStep } from "@rowcat/runtime-host/poc/suite";
import { Button } from "@rowcat/ui-web/components/button";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { VmPocWorkerMessage } from "./vm-poc.worker.ts";

/**
 * Runtime VM PoC lab: a development-build harness, not a product screen. It runs the Phase 3 suite
 * inside a worker and shows PASS/FAIL and measurements per step.
 *
 * It is not connected to the studio preview. That connection belongs to Phase 4, and the studio
 * folder's boundary check enforces the absence (`runtime-studio/runtime-boundaries.test.ts`).
 *
 * The worker is created with a `?worker` import, as the Monaco wiring is. This file is the only
 * place that starts the worker, and the reason is to keep the VM host off the main thread, not to
 * run maker code.
 */

interface LabState {
	status: "idle" | "running" | "done" | "failed";
	steps: PocStep[];
	report: PocReport | null;
	error: string | null;
}

const INITIAL: LabState = {
	status: "idle",
	steps: [],
	report: null,
	error: null,
};

const format = (value: number): string =>
	value >= 100
		? value.toFixed(0)
		: value >= 10
			? value.toFixed(1)
			: value.toFixed(2);

export function RuntimeVmLabPage() {
	const [state, setState] = useState<LabState>(INITIAL);
	const workerRef = useRef<Worker | null>(null);

	useEffect(
		() => () => {
			workerRef.current?.terminate();
			workerRef.current = null;
		},
		[],
	);

	const run = useCallback(async () => {
		workerRef.current?.terminate();
		setState({ ...INITIAL, status: "running" });
		const { default: VmPocWorker } = await import("./vm-poc.worker.ts?worker");
		const worker = new VmPocWorker();
		workerRef.current = worker;
		worker.addEventListener(
			"message",
			(event: MessageEvent<VmPocWorkerMessage>) => {
				const message = event.data;
				if (message.type === "step")
					setState((previous) => ({
						...previous,
						steps: [...previous.steps, message.step],
					}));
				else if (message.type === "report")
					setState((previous) => ({
						...previous,
						status: message.report.ok ? "done" : "failed",
						report: message.report,
					}));
				else
					setState((previous) => ({
						...previous,
						status: "failed",
						error: message.message,
					}));
			},
		);
		worker.addEventListener("error", (event) => {
			setState((previous) => ({
				...previous,
				status: "failed",
				error: event.message,
			}));
		});
		worker.postMessage({ type: "run" });
	}, []);

	const measurements = state.report?.measurements;

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
			<header className="flex flex-col gap-2">
				<h1 className="text-xl font-semibold">Runtime VM PoC</h1>
				<p className="text-sm text-muted-foreground">
					Runs a compiled RuntimeArtifact in an isolated WASM JavaScript VM
					inside a worker. It is not connected to the studio preview.
				</p>
				<div>
					<Button
						onClick={() => void run()}
						disabled={state.status === "running"}
					>
						{state.status === "running" ? "Running…" : "Run suite"}
					</Button>
				</div>
			</header>

			<section aria-live="polite" className="flex flex-col gap-1">
				<h2 className="text-sm font-medium">
					Steps {state.steps.length}
					{state.report ? ` · ${state.report.ok ? "PASS" : "FAIL"}` : ""}
				</h2>
				<ol className="flex flex-col gap-1 text-sm">
					{state.steps.map((step) => (
						<li
							key={step.name}
							className="flex flex-col rounded border border-border px-3 py-2"
						>
							<span className="font-mono">
								{step.ok ? "PASS" : "FAIL"} · {step.name} · {format(step.ms)}ms
							</span>
							<span className="break-all text-xs text-muted-foreground">
								{step.detail}
							</span>
						</li>
					))}
				</ol>
				{state.error ? (
					<p className="text-sm text-destructive">{state.error}</p>
				) : null}
			</section>

			{measurements && state.report ? (
				<section className="flex flex-col gap-1 text-sm">
					<h2 className="text-sm font-medium">
						Measurements · {state.report.engine}
					</h2>
					<p className="break-all text-xs text-muted-foreground">
						{state.report.platform}
					</p>
					<dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
						<dt>cold session</dt>
						<dd>{format(measurements.coldSessionMs)} ms</dd>
						<dt>warm session</dt>
						<dd>{format(measurements.warmSessionMs)} ms</dd>
						<dt>warm · create vm</dt>
						<dd>{format(measurements.warmCreateVmMs)} ms</dd>
						<dt>warm · bootstrap</dt>
						<dd>{format(measurements.warmBootstrapMs)} ms</dd>
						<dt>warm · evaluate graph</dt>
						<dd>{format(measurements.warmEvaluateGraphMs)} ms</dd>
						<dt>call round trip</dt>
						<dd>{format(measurements.callRoundTripUs)} µs</dd>
						<dt>host round trip</dt>
						<dd>{format(measurements.hostRoundTripUs)} µs</dd>
						<dt>async host round trip</dt>
						<dd>{format(measurements.asyncHostRoundTripUs)} µs</dd>
						<dt>dispose</dt>
						<dd>{format(measurements.disposeMs)} ms</dd>
						<dt>baseline linear memory</dt>
						<dd>
							{measurements.baselineMemoryBytes === null
								? "—"
								: `${(measurements.baselineMemoryBytes / 1048576).toFixed(1)} MiB`}
						</dd>
						{state.report.stackProbe.map((probe) => (
							<Fragment key={probe.ceilingBytes}>
								<dt>stack {probe.ceilingBytes / 1024} KiB</dt>
								<dd>
									{probe.outcome}
									{probe.repeatable ? "" : " (unstable)"}
								</dd>
							</Fragment>
						))}
					</dl>
				</section>
			) : null}
		</main>
	);
}
