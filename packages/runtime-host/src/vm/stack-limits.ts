/**
 * Per-platform stack ceilings. These are internal adapter settings, not creator settings.
 *
 * The QuickJS stack check looks at the C stack in linear memory, but WASM call frames sit on the
 * host thread's native stack. The safe ceiling is therefore a fact of the host thread, not of the
 * engine, and it must be measured on each platform (`docs/creator-runtime/native-vm-host.md`). Each
 * value here is what that platform's harness actually measured, and `validated` records this.
 * Unmeasured platforms inherit the most conservative value and are marked `validated: false`.
 *
 * A commit that raises a value must include a stack probe (`stackProbe` in `runRuntimeVmPoc`) run
 * on that platform. Overflow does not appear as an exception. It appears as a host `RangeError` and
 * runtime corruption, which tests do not catch.
 */

export type RuntimeVmPlatform =
	| "node"
	| "web-worker"
	| "ios-webview"
	| "android-webview";

export interface RuntimeStackLimit {
	ceilingBytes: number;
	validated: boolean;
	/**
	 * Stack size (bytes) where leaking started when measured. This is the reason the ceiling sits
	 * below it. `null` means not measured.
	 */
	leaksAtBytes: number | null;
}

const KIB = 1024;

export const RUNTIME_STACK_LIMITS: Readonly<
	Record<RuntimeVmPlatform, RuntimeStackLimit>
> = Object.freeze({
	/**
	 * Leaked at 256 KiB in the vitest worker (deep host stack). 128 KiB is safe in both environments.
	 */
	node: { ceilingBytes: 128 * KIB, validated: true, leaksAtBytes: 256 * KIB },
	"web-worker": {
		ceilingBytes: 128 * KIB,
		validated: true,
		leaksAtBytes: null,
	},
	"ios-webview": {
		ceilingBytes: 128 * KIB,
		validated: true,
		leaksAtBytes: null,
	},
	"android-webview": {
		ceilingBytes: 128 * KIB,
		validated: true,
		leaksAtBytes: null,
	},
});
