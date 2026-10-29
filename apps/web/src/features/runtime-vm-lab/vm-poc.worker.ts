import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import wasmUrl from "@jitl/quickjs-ng-wasmfile-release-sync/wasm?url";
import type { PocReport, PocStep } from "@rowcat/runtime-host/poc/suite";
import { runRuntimeVmPoc } from "@rowcat/runtime-host/poc/suite";
import { createQuickJsEngine } from "@rowcat/runtime-host/quickjs";
import { workerSchedulerClock } from "#/lib/runtime-vm/worker-clock.ts";

/**
 * The web PoC's worker, where the trusted host runs. The worker is not isolation; it is a second
 * fence. Maker code runs in the WASM VM inside it. The worker is a performance boundary that keeps
 * the VM from blocking the main thread. Running on the main thread would have the same isolation
 * basis, so this file has no `eval`, `Function`, or `import()`. It only wires engine setup and
 * suite execution.
 *
 * WASM is a bundle asset (`?url`), not fetched from a CDN, for the same reason as the Monaco
 * worker: the viewer's IP is not leaked to a host the project does not control.
 *
 * Yielding belongs to the worker. The scheduler core takes one clock port. The worker's yield
 * (`MessageChannel`) comes from `lib/runtime-vm/worker-clock.ts`, plugged in the same way as the
 * preview worker. The native harness plugs in its own.
 */

export type VmPocWorkerMessage =
	| { type: "step"; step: PocStep }
	| { type: "report"; report: PocReport }
	| { type: "error"; message: string };

const post = (message: VmPocWorkerMessage): void => {
	self.postMessage(message);
};

self.addEventListener("message", (event: MessageEvent<{ type: "run" }>) => {
	if (event.data?.type !== "run") return;
	const wasmBinary = (): Promise<ArrayBuffer> =>
		fetch(wasmUrl).then((response) => response.arrayBuffer());
	const engine = createQuickJsEngine(variant, { wasmBinary });
	runRuntimeVmPoc({
		engine,
		platform: `web-worker (${navigator.userAgent})`,
		scheduling: { clock: workerSchedulerClock() },
		/**
		 * Walks the table upward from its first value, and stops at the ceiling where the stack starts to
		 * leak (`vm/stack-limits.ts`).
		 */
		stackProbe: {
			ceilings: [128, 192, 256, 320, 512].map((kib) => kib * 1024),
			engineFor: (stackCeilingBytes) =>
				createQuickJsEngine(variant, { wasmBinary, stackCeilingBytes }),
		},
		onStep: (step) => post({ type: "step", step }),
	}).then(
		(report) => post({ type: "report", report }),
		(cause) =>
			post({
				type: "error",
				message:
					cause instanceof Error
						? `${cause.name}: ${cause.message}`
						: String(cause),
			}),
	);
});
