/**
 * The main window's preload: exposes the local afterstate index to the RowCat web app as
 * `window.rowcatAfterstate` (the web side's desktop port, `apps/web/src/lib/afterstate/`).
 *
 * Narrow on purpose: one function, `call(memberKey, op, params)`, answered by the main process only
 * for this stack's web origin and only for the protocol's operations (`afterstate-host.ts`). No
 * Node API, no file path and no process handle reaches the page. Sandboxed preload: only `electron`'s
 * renderer modules are available here.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rowcatAfterstate", {
	protocol: "afterstate-bridge/1",
	call: (memberKey: string, op: string, params: object): Promise<unknown> =>
		ipcRenderer.invoke("afterstate:call", memberKey, op, params),
	release: (memberKey: string): Promise<void> =>
		ipcRenderer.invoke("afterstate:release", memberKey),
	/** Deletes the member's index files (account deletion, local reset). */
	destroy: (memberKey: string): Promise<void> =>
		ipcRenderer.invoke("afterstate:destroy", memberKey),
});
