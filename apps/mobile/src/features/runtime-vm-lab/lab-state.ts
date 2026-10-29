import type { PocReport, PocStep } from "@rowcat/runtime-host/poc/suite";
import type { NativeRuntimeFromVm } from "../../lib/runtime-native/protocol.ts";

/**
 * Screen state of the PoC diagnostic lab, not the protocol. The bridge and its vocabulary live in
 * `lib/runtime-native/`, the same channel the production runtime uses. This file only holds how
 * this screen draws that conversation, so it imports no WebView, Expo module or `Platform`.
 */

export interface RuntimeVmLabState {
	phase: "loading" | "ready" | "running" | "done" | "failed";
	steps: PocStep[];
	report: PocReport | null;
	error: string | null;
}

export const INITIAL_LAB_STATE: RuntimeVmLabState = {
	phase: "loading",
	steps: [],
	report: null,
	error: null,
};

export type RuntimeVmLabEvent =
	| { type: "message"; message: NativeRuntimeFromVm }
	| { type: "start" }
	| { type: "transport-failed"; message: string };

export function reduceRuntimeVmLab(
	state: RuntimeVmLabState,
	event: RuntimeVmLabEvent,
): RuntimeVmLabState {
	switch (event.type) {
		case "start":
			return { ...INITIAL_LAB_STATE, phase: "running" };
		case "transport-failed":
			return { ...state, phase: "failed", error: event.message };
		case "message": {
			const { message } = event;
			switch (message.type) {
				case "ready":
					return state.phase === "loading"
						? { ...state, phase: "ready" }
						: state;
				case "poc-step":
					return { ...state, steps: [...state.steps, message.step] };
				case "poc-report":
					return {
						...state,
						phase: message.report.ok ? "done" : "failed",
						report: message.report,
					};
				case "poc-failure":
					return { ...state, phase: "failed", error: message.message };
				default:
					/** Runtime session traffic; this screen does not draw it. */
					return state;
			}
		}
	}
}
