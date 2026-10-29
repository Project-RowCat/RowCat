/**
 * Public API inventory of `@rowcat/runtime`: the names the docs own.
 * - Why hand-written: the names could be extracted from `index.ts`, and the tests do exactly that
 *   and compare against this list. The list is written by hand for classification. Whether a name
 *   is a building block or a low-level predicate is not derivable from code, and the classification
 *   decides which page explains the name.
 * - A new export makes `runtime-api-inventory.test.ts` fail with its name. The fixer picks a
 *   category here and adds the name to that page's `symbols`. No public API goes out without
 *   documentation.
 * - Classification is the page mapping: `RUNTIME_API_CATEGORY_PAGE` links each category to a docs
 *   slug, and the tests check that the page's front matter lists each name. Every export has a
 *   category and every category has a page, so no name is ownerless.
 * - `kind` says whether a name is a value or a type. Types do not exist at runtime and are
 *   invisible to `import * as`, so the tests compare two ways: values against the real module
 *   object, and all names against the `index.ts` syntax tree.
 */

export const RUNTIME_API_CATEGORIES = [
	"components",
	"hooks",
	"state",
	"generation",
	"styling",
	"assets",
	"errors",
	"types",
	"advanced",
] as const;

export type RuntimeApiCategory = (typeof RUNTIME_API_CATEGORIES)[number];

export interface RuntimeApiSymbol {
	name: string;
	kind: "value" | "type";
	category: RuntimeApiCategory;
}

export const RUNTIME_API_CATEGORY_PAGE: Readonly<
	Record<RuntimeApiCategory, string>
> = {
	components: "reference/components",
	hooks: "reference/hooks",
	state: "reference/state",
	generation: "reference/generation",
	styling: "reference/styling",
	assets: "reference/assets",
	errors: "reference/errors-and-limits",
	types: "reference/types",
	advanced: "reference/advanced",
};

const value = (
	category: RuntimeApiCategory,
	...names: string[]
): RuntimeApiSymbol[] =>
	names.map((name) => ({ name, kind: "value", category }));
const type = (
	category: RuntimeApiCategory,
	...names: string[]
): RuntimeApiSymbol[] =>
	names.map((name) => ({ name, kind: "type", category }));

export const RUNTIME_PUBLIC_API: readonly RuntimeApiSymbol[] = [
	...value(
		"components",
		"Screen",
		"View",
		"Stack",
		"Row",
		"ScrollView",
		"Text",
		"Image",
		"Button",
		"Pressable",
		"TextInput",
		"TextArea",
		"Progress",
		"Audio",
	),
	...value(
		"hooks",
		"useState",
		"useReducer",
		"useMemo",
		"useCallback",
		"useRef",
		"useEffect",
		"useStoryState",
		"usePersistentState",
		"useGeneration",
		"useScrollController",
		"useTextEntryController",
	),
	...value("state", "defineStoryState", "definePersistentState"),
	...value("generation", "RUNTIME_GENERATION_LIMITS"),
	...type(
		"generation",
		"RuntimeGeneration",
		"RuntimeGenerationMessage",
		"RuntimeGenerationRequest",
		"RuntimeGenerationResult",
	),
	...value(
		"styling",
		"color",
		"isRuntimeColor",
		"RUNTIME_EASINGS",
		"RUNTIME_TRANSITION_DEFAULT_DURATION_MS",
		"RUNTIME_TRANSITION_DEFAULT_EASING",
		"RUNTIME_TRANSITION_MAX_DURATION_MS",
	),
	...type(
		"styling",
		"RuntimeColor",
		"RuntimeStyle",
		"RuntimeTextStyle",
		"RuntimeLength",
		"RuntimeAlign",
		"RuntimeJustify",
		"RuntimeTransition",
		"RuntimeEasing",
	),
	...value("assets", "asset"),
	...type("assets", "AssetRef"),
	...value("errors", "RuntimeError", "RUNTIME_ERROR_CODE"),
	...type("errors", "RuntimeErrorCode"),
	...type(
		"types",
		"AudioProps",
		"ButtonProps",
		"ImageProps",
		"PressableProps",
		"ProgressProps",
		"RowProps",
		"ScreenProps",
		"ScrollViewProps",
		"StackProps",
		"TextAreaProps",
		"TextInputProps",
		"TextProps",
		"ViewProps",
		"RuntimePressable",
		"RuntimeTextEntry",
		"RuntimeTransitionable",
		"RuntimeScrollController",
		"RuntimeScrollTo",
		"RuntimeTextEntryController",
		"RuntimeCleanup",
		"RuntimeRef",
		"RuntimeSetState",
		"RuntimeStateAction",
		"RuntimeApp",
		"RuntimeChildren",
		"RuntimeComponent",
		"RuntimeElement",
		"RuntimeNode",
		"RuntimePrimitive",
		"StoryStateDefinition",
		"StoryStateInput",
		"StoryStateInputChecked",
		"StoryStateMigration",
		"PersistentStateDefinition",
		"PersistentStateInput",
		"PersistentStateInputChecked",
		"PersistentStateMigration",
		"Serializable",
		"SerializableShape",
	),
	...value(
		"advanced",
		"isRuntimeHostComponent",
		"runtimeHostKindOf",
		"isRuntimeElement",
		"isStoryStateDefinition",
		"isPersistentStateDefinition",
		"isSerializable",
		"STORY_STATE_VERSION_MAX",
		"PERSISTENT_STATE_VERSION_MAX",
	),
	...type("advanced", "RuntimeHostComponent", "RuntimeHostKind"),
];
