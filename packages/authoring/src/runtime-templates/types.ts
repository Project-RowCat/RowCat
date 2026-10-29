/**
 * Vocabulary for runtime starter templates. This is authoring source, not a kind of work. This file
 * defines one thing: which files are created when the runtime is first turned on.
 * - A template is not a runtime dependency. There is no axis such as story.runtimeTemplateId. If
 *   there were, playback and compile would have to ask whether the template still exists, and
 *   deleting a template would break published works.
 * - There are no versions. A new template version does not change projects already created;
 *   instantiation copies values (§49).
 * - Not here: React, icons, color tokens (card art lives in web
 *   features/runtime-templates/previews/), preview image paths (§17), record ids (the store issues
 *   identity), apiVersion (compatibility is answered by tests that run the compiler, §48).
 */

/**
 * Template identity is a stable, machine-readable string. It is not derived from the translated
 * name (§14). Analytics, onboarding, and a later `New from Template` refer to this value; names can
 * change.
 */
export const RUNTIME_TEMPLATE_IDS = [
	"blank",
	"idol-debut",
	"visual-novel",
	"messenger",
	"investigation",
	"relationship-profile",
] as const;
export type RuntimeTemplateId = (typeof RUNTIME_TEMPLATE_IDS)[number];

/**
 * Gallery categories are filter vocabulary, not the kind of work. `basic` comes first so Blank
 * always shows easily (§23). Adding a value means updating the gallery's filter row too.
 */
export const RUNTIME_TEMPLATE_CATEGORIES = [
	"basic",
	"story",
	"social",
	"game",
] as const;
export type RuntimeTemplateCategory =
	(typeof RUNTIME_TEMPLATE_CATEGORIES)[number];

/** How much reading the template expects. This describes an expectation, not a prerequisite. */
export const RUNTIME_TEMPLATE_COMPLEXITIES = [
	"beginner",
	"intermediate",
	"advanced",
] as const;
export type RuntimeTemplateComplexity =
	(typeof RUNTIME_TEMPLATE_COMPLEXITIES)[number];

export interface RuntimeTemplateFile {
	/** Path relative to the normalized project root, for example src/main.tsx. */
	path: string;
	content: string;
}

export interface RuntimeTemplate {
	id: RuntimeTemplateId;
	name: string;
	description: string;
	category: RuntimeTemplateCategory;
	complexity: RuntimeTemplateComplexity;
	/**
	 * The detail panel's list. It names what opening this code teaches, not marketing copy. Entries
	 * must be names of APIs that actually run now (§7). Listing unbuilt features would turn the list
	 * into a promise it cannot keep.
	 */
	demonstrates: readonly string[];
	files: readonly RuntimeTemplateFile[];
	/** Path of the entry file. It must be one of `files`; the registry test enforces this. */
	entry: string;
	/**
	 * Only one template is featured: the flagship, not every template (§22). The test pins that
	 * exactly one is. The others each teach one technique; the recommendation shows how all of them
	 * hold together in one work.
	 */
	featured?: boolean;
}
