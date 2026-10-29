/**
 * The error the runtime throws: one class, with a code.
 *
 * It is not a plain `Error` because these errors will cross the VM boundary someday. The host needs
 * a value to answer what went wrong. Messages change with translation and rewording; codes do not.
 *
 * The message is not shown to users as is. The error reaches the creator, not the viewer, and no
 * surface exists yet.
 *
 * There are three weights (see `RUNTIME_ERROR_KIND`):
 * - creator: the creator can fix it. Only that render, effect or event is lost; the session lives
 *   on.
 * - warning: does not block. Reported on the diagnostic channel; execution continues.
 * - limit: a limit was exceeded. That commit is discarded and the session lives on. The host sets
 *   the values.
 *
 * None of these is an engine failure. Budget overruns, memory and engine errors belong to the
 * host's vocabulary (`RuntimeHostError` in `@rowcat/runtime-host`) and must not appear here. If a
 * memory limit error sat beside a creator's `TypeError` in the same shape, the creator would look
 * for the cause in their own code.
 */

export const RUNTIME_ERROR_CODE = {
	hookOutsideRender: "runtime_hook_outside_render",
	hookOrderChanged: "runtime_hook_order_changed",
	stateUpdateDuringRender: "runtime_state_update_during_render",
	asyncComponentUnsupported: "runtime_async_component_unsupported",
	invalidRuntimeNode: "runtime_invalid_runtime_node",
	/** Duplicate key among siblings (warning). The later element is matched by position instead. */
	duplicateKey: "runtime_duplicate_key",
	/**
	 * The host sent a handler id that is not in the registry. This is a stale event, not a failure.
	 */
	handlerNotFound: "runtime_handler_not_found",
	/** Setter called after the component unmounted. Logged as a warning and ignored. */
	updateAfterUnmount: "runtime_update_after_unmount",
	/** An effect returned a promise (warning). It is not read as a cleanup function. */
	effectReturnedPromise: "runtime_effect_returned_promise",
	/** An effect or its cleanup threw. Diagnostic only: that effect is lost. */
	effectFailed: "runtime_effect_failed",
	invalidHostProp: "runtime_invalid_host_prop",
	treeDepthExceeded: "runtime_tree_depth_exceeded",
	hostNodeLimitExceeded: "runtime_host_node_limit_exceeded",
	patchLimitExceeded: "runtime_patch_limit_exceeded",
	/** The host did not accept the commit bundle. The previous commit remains authoritative. */
	commitRejected: "runtime_commit_rejected",
	/** The host port was not installed. This is a boot-order problem, not the creator's. */
	hostPortMissing: "runtime_host_port_missing",
	rootEntryInvalid: "runtime_root_entry_invalid",
	rootDisposed: "runtime_root_disposed",
	hostComponentCalled: "runtime_host_component_called",
	invalidStoryState: "runtime_invalid_story_state",
	/** `defineStoryState` was called after module evaluation ended and the registry was sealed. */
	storyStateDefinitionLate: "runtime_story_state_definition_late",
	/** Two definitions share one storage key. The key is the identity of the stored value. */
	storyStateDuplicateKey: "runtime_story_state_duplicate_key",
	storyStateHookChanged: "runtime_story_state_hook_changed",
	storyStateValueInvalid: "runtime_story_state_value_invalid",
	storyStateLimitExceeded: "runtime_story_state_limit_exceeded",
	/** Migration threw, or the stored version is older and no migration exists. */
	storyStateMigrationFailed: "runtime_story_state_migration_failed",
	storyStateMigrationInvalid: "runtime_story_state_migration_invalid",
	/** The stored version is higher than this code's version: old code is opening new storage. */
	storyStateVersionNewer: "runtime_story_state_version_newer",
	storyStateSnapshotInvalid: "runtime_story_state_snapshot_invalid",
	/**
	 * Persistent-state error codes. They are not shared with story state. The two lifetimes mean
	 * different things to the player. Folding the codes together would hide which lifetime failed, and
	 * the creator would then reset the playthrough. That cannot fix a persistent-state failure.
	 */
	invalidPersistentState: "runtime_invalid_persistent_state",
	persistentStateDefinitionLate: "runtime_persistent_state_definition_late",
	persistentStateDuplicateKey: "runtime_persistent_state_duplicate_key",
	persistentStateHookChanged: "runtime_persistent_state_hook_changed",
	persistentStateValueInvalid: "runtime_persistent_state_value_invalid",
	persistentStateLimitExceeded: "runtime_persistent_state_limit_exceeded",
	persistentStateMigrationFailed: "runtime_persistent_state_migration_failed",
	persistentStateMigrationInvalid: "runtime_persistent_state_migration_invalid",
	persistentStateVersionNewer: "runtime_persistent_state_version_newer",
	persistentStateSnapshotInvalid: "runtime_persistent_state_snapshot_invalid",
	/** A generation was requested during render. Rendering the same tree twice would charge twice. */
	generationDuringRender: "runtime_generation_during_render",
	/**
	 * The generation request does not match the contract (empty message, unknown role, over the
	 * limit).
	 */
	generationInvalidRequest: "runtime_generation_invalid_request",
	/**
	 * No generation capability is installed for this session: AI is off in preview, or the playback
	 * surface did not provide one.
	 */
	generationUnavailable: "runtime_generation_unavailable",
	/**
	 * The host did not authorize generation for this run. The request did not start from a user
	 * interaction.
	 */
	generationNotAuthorized: "runtime_generation_not_authorized",
	/** Kept from when managed generation had a balance. The balance is never sent to the creator. */
	generationInsufficientBalance: "runtime_generation_insufficient_balance",
	/** A generation is already running. One per session. */
	generationBusy: "runtime_generation_busy",
	/** Generation was cancelled because the session or preview stopped. */
	generationCancelled: "runtime_generation_cancelled",
	/** The provider or network failed. The provider's original error never reaches here. */
	generationFailed: "runtime_generation_failed",
	/**
	 * The value given to `asset()` is neither a logical asset path nor a public HTTPS image URL.
	 * Rejected forms include `http:`, `data:`, credentials, parent traversal, and empty values.
	 */
	invalidAssetRef: "runtime_invalid_asset_ref",
	/** The value given to `color()` is not `#rgb`, `#rrggbb` or `#rrggbbaa`. */
	invalidColor: "runtime_invalid_color",
	/**
	 * Control commands (scroll, focus) were called during render. This is the same position as a
	 * rejected setState during render: a re-render would send the command twice, and the target tree
	 * is not committed yet.
	 */
	hostCommandInvalidPhase: "runtime_host_command_invalid_phase",
	/** The controller is not attached to any node right now (warning). The command is not sent. */
	hostControlUnbound: "runtime_host_control_unbound",
	/**
	 * The controller was given to a primitive that does not accept it, for example a scroll controller
	 * on `<View>`.
	 */
	hostControlWrongKind: "runtime_host_control_wrong_kind",
	/**
	 * The same controller is attached to two live nodes, so there is no answer for which one to
	 * control.
	 */
	hostControlAlreadyBound: "runtime_host_control_already_bound",
	/** The `scrollTo({ offset })` value must be a finite number greater than or equal to 0. */
	scrollInvalidOffset: "runtime_scroll_invalid_offset",
	hostCommandLimitExceeded: "runtime_host_command_limit_exceeded",
} as const;

export type RuntimeErrorCode =
	(typeof RUNTIME_ERROR_CODE)[keyof typeof RUNTIME_ERROR_CODE];

export type RuntimeErrorKind = "creator" | "warning" | "limit";

/**
 * Code to weight. This table is the classification for the diagnostic channel; the host does not
 * recompute it. `Record` is used so that a commit adding a code without a weight fails to compile.
 */
export const RUNTIME_ERROR_KIND: Readonly<
	Record<RuntimeErrorCode, RuntimeErrorKind>
> = Object.freeze({
	runtime_hook_outside_render: "creator",
	runtime_hook_order_changed: "creator",
	runtime_state_update_during_render: "creator",
	runtime_async_component_unsupported: "creator",
	runtime_invalid_runtime_node: "creator",
	runtime_duplicate_key: "warning",
	runtime_handler_not_found: "warning",
	runtime_update_after_unmount: "warning",
	runtime_effect_returned_promise: "warning",
	runtime_effect_failed: "creator",
	runtime_invalid_host_prop: "creator",
	runtime_tree_depth_exceeded: "limit",
	runtime_host_node_limit_exceeded: "limit",
	runtime_patch_limit_exceeded: "limit",
	runtime_commit_rejected: "limit",
	runtime_host_port_missing: "creator",
	runtime_root_entry_invalid: "creator",
	runtime_root_disposed: "creator",
	runtime_host_component_called: "creator",
	runtime_invalid_story_state: "creator",
	runtime_story_state_definition_late: "creator",
	runtime_story_state_duplicate_key: "creator",
	runtime_story_state_hook_changed: "creator",
	runtime_story_state_value_invalid: "creator",
	runtime_story_state_limit_exceeded: "limit",
	runtime_story_state_migration_failed: "creator",
	runtime_story_state_migration_invalid: "creator",
	runtime_story_state_version_newer: "creator",
	runtime_story_state_snapshot_invalid: "creator",
	runtime_invalid_persistent_state: "creator",
	runtime_persistent_state_definition_late: "creator",
	runtime_persistent_state_duplicate_key: "creator",
	runtime_persistent_state_hook_changed: "creator",
	runtime_persistent_state_value_invalid: "creator",
	runtime_persistent_state_limit_exceeded: "limit",
	runtime_persistent_state_migration_failed: "creator",
	runtime_persistent_state_migration_invalid: "creator",
	runtime_persistent_state_version_newer: "creator",
	runtime_persistent_state_snapshot_invalid: "creator",
	runtime_generation_during_render: "creator",
	runtime_generation_invalid_request: "creator",
	runtime_generation_unavailable: "creator",
	runtime_generation_not_authorized: "creator",
	runtime_generation_insufficient_balance: "limit",
	runtime_generation_busy: "limit",
	runtime_generation_cancelled: "creator",
	runtime_generation_failed: "creator",
	runtime_invalid_asset_ref: "creator",
	runtime_invalid_color: "creator",
	runtime_host_command_invalid_phase: "creator",
	runtime_host_control_unbound: "warning",
	runtime_host_control_wrong_kind: "creator",
	runtime_host_control_already_bound: "creator",
	runtime_scroll_invalid_offset: "creator",
	runtime_host_command_limit_exceeded: "limit",
});

export class RuntimeError extends Error {
	readonly code: RuntimeErrorCode;

	constructor(code: RuntimeErrorCode, message: string) {
		super(message);
		this.name = "RuntimeError";
		this.code = code;
	}
}
