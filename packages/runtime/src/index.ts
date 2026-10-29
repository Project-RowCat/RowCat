/**
 * The public language contract of `@rowcat/runtime`. Creator TypeScript/TSX can import only the
 * names exported here, so this file defines the whole language.
 *
 * The package has no dependencies (`dependencies` is empty). Its four consumers run in different
 * environments: the creator type check in the compiler's virtual file system, the Monaco language
 * service in a worker, runtime artifact compilation in Node and browsers, and a future WASM runtime
 * in an isolated VM with no `window` or `process`. If any of those globals enter this package, it
 * will not load in that VM.
 *
 * Deliberately not exported:
 * - The reconciler and renderer, and `setRuntimeDispatcher`. Creators must not be able to define
 *   hook semantics.
 * - The snapshot API. The snapshot belongs to the host; exposing it would make the storage format
 *   a creator API.
 * - The declaration text, which lives in `@rowcat/runtime/declarations`. Re-exporting it would
 *   surface tool values in creator autocomplete.
 * - `isAssetRef`, `runtimeAssetPath`, `classifyRuntimeAssetValue`. They open asset references and
 *   are for trusted hosts only (`asset.ts`).
 * - Everything under `internal/runtime-root.ts`. The host calls it inside the VM; it is not
 *   creator vocabulary.
 *
 * Globals are declared in `globals.d.ts`, which the reference directive pulls into the creator
 * program: only `console`, with `log`, `warn` and `error`.
 */

/// <reference path="./globals.d.ts" />

export { type AssetRef, asset } from "./asset.ts";
export { color, isRuntimeColor, type RuntimeColor } from "./color.ts";
export {
	Audio,
	type AudioProps,
	Button,
	type ButtonProps,
	Image,
	type ImageProps,
	isRuntimeHostComponent,
	Pressable,
	type PressableProps,
	Progress,
	type ProgressProps,
	Row,
	type RowProps,
	type RuntimeHostComponent,
	type RuntimeHostKind,
	type RuntimePressable,
	type RuntimeTextEntry,
	type RuntimeTransitionable,
	runtimeHostKindOf,
	Screen,
	type ScreenProps,
	ScrollView,
	type ScrollViewProps,
	Stack,
	type StackProps,
	Text,
	TextArea,
	type TextAreaProps,
	TextInput,
	type TextInputProps,
	type TextProps,
	View,
	type ViewProps,
} from "./component.ts";
export type {
	RuntimeScrollController,
	RuntimeScrollTo,
	RuntimeTextEntryController,
} from "./controller.ts";
export {
	RUNTIME_GENERATION_LIMITS,
	type RuntimeGeneration,
	type RuntimeGenerationMessage,
	type RuntimeGenerationRequest,
	type RuntimeGenerationResult,
} from "./generation.ts";
export {
	type RuntimeCleanup,
	type RuntimeRef,
	type RuntimeSetState,
	type RuntimeStateAction,
	useCallback,
	useEffect,
	useGeneration,
	useMemo,
	usePersistentState,
	useReducer,
	useRef,
	useScrollController,
	useState,
	useStoryState,
	useTextEntryController,
} from "./hooks.ts";
export {
	RUNTIME_ERROR_CODE,
	RuntimeError,
	type RuntimeErrorCode,
} from "./internal/errors.ts";
export {
	isRuntimeElement,
	type RuntimeApp,
	type RuntimeChildren,
	type RuntimeComponent,
	type RuntimeElement,
	type RuntimeNode,
	type RuntimePrimitive,
} from "./node.ts";
export {
	definePersistentState,
	defineStoryState,
	isPersistentStateDefinition,
	isSerializable,
	isStoryStateDefinition,
	PERSISTENT_STATE_VERSION_MAX,
	type PersistentStateDefinition,
	type PersistentStateInput,
	type PersistentStateInputChecked,
	type PersistentStateMigration,
	type Serializable,
	type SerializableShape,
	STORY_STATE_VERSION_MAX,
	type StoryStateDefinition,
	type StoryStateInput,
	type StoryStateInputChecked,
	type StoryStateMigration,
} from "./state.ts";
export type {
	RuntimeAlign,
	RuntimeJustify,
	RuntimeLength,
	RuntimeStyle,
	RuntimeTextStyle,
} from "./style.ts";
/**
 * Only the vocabulary of transitions is exported. `classifyRuntimeTransition` is not here. That
 * function opens values, and trusted hosts (the VM boundary and both renderers) call it. If
 * creators could call it, the verdict would become a branch in creator code, and there would be two
 * answers to who rejects a value. Same rule as `isAssetRef` and `runtimeAssetPath`.
 */
export {
	RUNTIME_EASINGS,
	RUNTIME_TRANSITION_DEFAULT_DURATION_MS,
	RUNTIME_TRANSITION_DEFAULT_EASING,
	RUNTIME_TRANSITION_MAX_DURATION_MS,
	type RuntimeEasing,
	type RuntimeTransition,
} from "./transition.ts";
