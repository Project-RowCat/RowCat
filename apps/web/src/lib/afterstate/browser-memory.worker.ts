import init, { Afterstate } from "afterstate-wasm";
import wasmUrl from "afterstate-wasm/afterstate_wasm_bg.wasm?url";
import { createMemoryWorkerHandler } from "./memory-worker.ts";

/** SQLite and its JS host hooks live only in this worker, never on the UI or SSR thread. */
const handle = createMemoryWorkerHandler(async () => {
	await init({ module_or_path: wasmUrl });
	return new Afterstate();
});

self.addEventListener("message", (event: MessageEvent) => {
	void handle(event.data).then((response) => self.postMessage(response));
});
