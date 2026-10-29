/**
 * `@rowcat/runtime-renderer-web`: the platform adapter that draws patch batches to the DOM.
 * - Does not depend on React, React DOM, Monaco, the authoring repo, Dexie, the query layer, the
 *   API client, the router, the studio UI, or Node. It takes only two contract shapes: the patch
 *   vocabulary (@rowcat/runtime-host/patches) and color judgment (@rowcat/runtime/color). So the
 *   studio preview and a later web playback surface can share the same code.
 * - React holds the outer shell. Below the element this renderer attaches, nothing belongs to
 *   React.
 * - Owns: host node id to DOM node, revision, phase, event delegation, default styles, lifetime.
 *   Does not own: the VM, the compiler, the scheduler, creator state, hook state, artifacts, asset
 *   resolution.
 * - Isolation: creator JavaScript runs inside QuickJS/WASM. Shadow DOM is a style boundary and
 *   the worker is a responsiveness boundary; neither is isolation. This package takes JSON batches
 *   and emits one integer (a handler number).
 */

export { applyCommandBatch } from "./commands.ts";
export {
	WEB_RENDERER_ERROR_CODE,
	type WebRendererErrorCode,
	WebRuntimeRendererError,
} from "./errors.ts";
export type {
	PressDispatcher,
	RuntimeEventDispatcher,
	RuntimeEventPayload,
} from "./events.ts";
export type { WebRuntimeAssetResolver } from "./props.ts";
export {
	createWebRuntimeRenderer,
	type WebRuntimeRenderer,
	type WebRuntimeRendererOptions,
} from "./renderer.ts";
export {
	WEB_RUNTIME_BASE_CSS,
	WEB_RUNTIME_THEME_VARIABLES,
	type WebRuntimeThemeVariable,
} from "./theme.ts";
