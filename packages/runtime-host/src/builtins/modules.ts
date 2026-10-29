import {
	RUNTIME_SANDBOX_DISPATCHER_ID,
	RUNTIME_SANDBOX_MODULES,
	RUNTIME_SANDBOX_PUBLIC_IDS,
	RUNTIME_SANDBOX_SYMBOLS_ID,
	type RuntimeSandboxModule,
} from "@rowcat/runtime/sandbox";

/**
 * Builtin modules installed into the sandbox. They are no longer hand-written stubs.
 *
 * `rowcat:runtime`, `rowcat:runtime/jsx-runtime`, and `rowcat:internal/*` are JS generated from the
 * `@rowcat/runtime` source (`packages/runtime/src/sandbox/generated.ts`, via `pnpm
 * runtime:sandbox`). In Phase 3 these were stub strings matching the real names, guarded by one
 * test, so a changed prop or validation rule still passed. Now the declarations tooling reads and
 * the modules the VM runs come from the same file list, carry the same digest, and are compared by
 * the host at boot (`bootstrap.ts`).
 *
 * This is not the workspace `@rowcat/runtime`. That package lives in another realm: host symbols
 * such as `RUNTIME_ELEMENT` differ from the VM's symbols, so each side does not recognize the
 * other's elements. The runtime is instantiated inside the VM realm. The host receives only
 * serialized values, handler ids, and opaque tokens, never objects.
 *
 * The host hand-writes two builtins. `rowcat:internal/host` captures the prelude's bridge once at
 * module evaluation and exports a single narrow function; the bridge global is deleted before
 * creator code runs. The runtime source does not import it, since the runtime does not know the
 * host. No large host object is injected into globals; `hostCall(capability, payload)` is the only
 * entry point. `rowcat:internal/host-port-installer` fills the runtime's port slot through the
 * bridge, so it is the only module importing both. The PoC bridge and the `test.echo` and
 * `test.fail` helpers live in `poc/` because they belong to fixtures and the harness. Production
 * boot works without them.
 */

export interface RuntimeBuiltinModule {
	id: string;
	source: string;
	/**
	 * When true, the builtin may import only other builtins. An artifact dependency table that points
	 * at it is rejected during validation, and creator imports do not resolve to it. This matches how
	 * `internal/symbols.ts` in the real package sits outside the allow list. The field is required.
	 * While it was optional, the default let creator code import, and a builtin that omitted the flag
	 * became public vocabulary without breaking any test. The PoC bridge did exactly that. Requiring
	 * an explicit value makes the decision visible in review.
	 */
	internal: boolean;
}

/**
 * Owner of the symbols, and the only module other builtins get identity from. Artifacts cannot
 * reference it.
 */
export const SYMBOLS_BUILTIN_ID = RUNTIME_SANDBOX_SYMBOLS_ID;

/** The module that holds the dispatcher slot. The host's `bindDispatcher` knows this name. */
export const DISPATCHER_BUILTIN_ID = RUNTIME_SANDBOX_DISPATCHER_ID;

export const PUBLIC_BUILTIN_IDS: readonly string[] = RUNTIME_SANDBOX_PUBLIC_IDS;

export const HOST_BRIDGE_BUILTIN_ID = "rowcat:internal/host";

/**
 * The narrow host bridge is the only path from the sandbox to host authority. It exports exactly
 * one function. The bridge object, the serializer, and the limits never leave the module. Creator
 * artifacts cannot import it because it is internal. Only internal modules later in the boot order
 * can import it.
 */
export const HOST_BRIDGE_BUILTIN: RuntimeBuiltinModule = {
	id: HOST_BRIDGE_BUILTIN_ID,
	internal: true,
	source: `const bridge = globalThis.__rowcatBridge;
if (bridge === undefined) throw new Error("rowcat:internal/host must be installed by the host before creator code runs");
const call = bridge.hostCall;
const emit = bridge.emit;
export const internalHostCall = (capability, payload) => call(capability, payload === undefined ? null : payload);
export const internalHostEmit = (channel, json) => emit(channel, json);
`,
};

/** Port slot in the generated runtime. The installer module fills it. */
export const HOST_PORT_BUILTIN_ID = "rowcat:internal/host-port";

/**
 * Capability slot in the generated runtime, filled by the same installer module. It is separate
 * from the port because direction and nature differ. The port is a synchronous channel that runtime
 * infrastructure emits through (commit batches, work requests, diagnostics). The capability slot is
 * asynchronous: creator code requests capabilities through it. Folding both into one slot would
 * push the atomicity check for commits behind a promise (see `internal/host-capability.ts`).
 */
export const HOST_CAPABILITY_BUILTIN_ID = "rowcat:internal/host-capability";

/**
 * Root host entry point. The exports the session calls for mount, render, effects, and events live
 * here.
 */
export const RUNTIME_ROOT_BUILTIN_ID = "rowcat:internal/runtime-root";

/**
 * Story-state engine. The session calls it to hydrate. It is a separate module from the root
 * because the lifetimes differ. Hydration runs once, after creator module evaluation and before the
 * first mount, and the registry is sealed at that point. The root may mount and unmount many times
 * after that.
 */
export const STORY_STATE_BUILTIN_ID = "rowcat:internal/story-state";

/**
 * Hydrates both lifetimes in one call. The session calls this entry point. It is not called once
 * per scope because of the sealing window. If the playthrough is hydrated and persistent state is
 * not yet hydrated, the persistent registry is still open. A definition registered in that window
 * would show values on screen without being part of this session's snapshot. A single call closes
 * that window.
 */
/** Persistent-state engine. Its registry is separate from the playthrough's registry. */
export const PERSISTENT_STATE_BUILTIN_ID = "rowcat:internal/persistent-state";

export const DURABLE_STATE_BUILTIN_ID = "rowcat:internal/durable-hydrate";

export const HOST_PORT_INSTALLER_BUILTIN_ID =
	"rowcat:internal/host-port-installer";

/**
 * Port installer: the second builtin the host writes by hand. Runtime source does not import the
 * bridge, because the runtime does not know the host. But the root must emit commit batches, and
 * that channel is the slot in the runtime source (`rowcat:internal/host-port`). This module fills
 * that slot with the bridge, so it is the only module that imports both. It must evaluate before
 * the bridge globals are deleted, so it has its own stage in the boot plan (`bootstrap.ts`).
 */
export const HOST_PORT_INSTALLER_BUILTIN: RuntimeBuiltinModule = {
	id: HOST_PORT_INSTALLER_BUILTIN_ID,
	internal: true,
	source: `import { internalHostCall, internalHostEmit } from ${JSON.stringify(HOST_BRIDGE_BUILTIN_ID)};
import { setRuntimeHostPort } from ${JSON.stringify(HOST_PORT_BUILTIN_ID)};
import { setRuntimeHostCapability } from ${JSON.stringify(HOST_CAPABILITY_BUILTIN_ID)};
setRuntimeHostPort(Object.freeze({ emit: (channel, json) => internalHostEmit(channel, json) }));
setRuntimeHostCapability((capability, payload) => internalHostCall(capability, payload));
`,
};

const fromSandbox = (module: RuntimeSandboxModule): RuntimeBuiltinModule => ({
	id: module.id,
	source: module.source,
	internal: module.internal,
});

/**
 * All generated runtime modules, as a table rather than an install order. Order is decided by
 * `planRuntimeBootstrap` in `bootstrap.ts`. This table only says which modules exist; the list
 * comes straight from the generated output.
 */
export const RUNTIME_SANDBOX_BUILTINS: readonly RuntimeBuiltinModule[] =
	RUNTIME_SANDBOX_MODULES.map(fromSandbox);
