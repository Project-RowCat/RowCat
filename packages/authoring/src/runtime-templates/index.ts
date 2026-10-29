import type { RuntimeStarter } from "../runtime.ts";
import { BLANK_TEMPLATE } from "./blank.ts";
import { IDOL_DEBUT_TEMPLATE } from "./idol-debut/index.ts";
import { INVESTIGATION_TEMPLATE } from "./investigation.ts";
import { MESSENGER_TEMPLATE } from "./messenger.ts";
import { RELATIONSHIP_PROFILE_TEMPLATE } from "./relationship-profile.ts";
import type {
	RuntimeTemplate,
	RuntimeTemplateCategory,
	RuntimeTemplateId,
} from "./types.ts";
import { VISUAL_NOVEL_TEMPLATE } from "./visual-novel.ts";

export type {
	RuntimeTemplate,
	RuntimeTemplateCategory,
	RuntimeTemplateComplexity,
	RuntimeTemplateFile,
	RuntimeTemplateId,
} from "./types.ts";
export {
	RUNTIME_TEMPLATE_CATEGORIES,
	RUNTIME_TEMPLATE_COMPLEXITIES,
	RUNTIME_TEMPLATE_IDS,
} from "./types.ts";

/**
 * Gallery order is the order shown. Blank is first by rule, so someone starting from their own
 * structure does not have to scan every template to find an empty project. The flagship is second.
 * The other four each teach one technique. The order is a recommended sequence, not a
 * classification, and it stays the same under filters. The array is not sorted by name, because
 * translated names would reorder it and erase the recommended sequence.
 */
export const RUNTIME_TEMPLATES: readonly RuntimeTemplate[] = [
	BLANK_TEMPLATE,
	IDOL_DEBUT_TEMPLATE,
	VISUAL_NOVEL_TEMPLATE,
	MESSENGER_TEMPLATE,
	INVESTIGATION_TEMPLATE,
	RELATIONSHIP_PROFILE_TEMPLATE,
];

/**
 * The template for a user who chose nothing. Surfaces without a gallery (mobile's enableRuntime)
 * and the old starter-file path go through it. The starter file has one source, so its name is
 * fixed here.
 */
export const RUNTIME_DEFAULT_TEMPLATE_ID: RuntimeTemplateId = "blank";

/**
 * Looks up by id. An unknown id returns null. An unknown template is never silently replaced by the
 * default.
 */
export function runtimeTemplateById(id: string): RuntimeTemplate | null {
	return RUNTIME_TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * Filters by category; null means all. Filtering keeps the order. If a card moved under each
 * filter, users would have to find it again.
 */
export function runtimeTemplatesIn(
	category: RuntimeTemplateCategory | null,
): readonly RuntimeTemplate[] {
	if (category === null) return RUNTIME_TEMPLATES;
	return RUNTIME_TEMPLATES.filter((template) => template.category === category);
}

/**
 * Returns the one featured template, or null. Only one template may be featured; see `featured` in
 * types.ts.
 */
export function featuredRuntimeTemplate(): RuntimeTemplate | null {
	return (
		RUNTIME_TEMPLATES.find((template) => template.featured === true) ?? null
	);
}

/**
 * Returns only the categories in use. Drawing an empty filter would read as 'coming soon'. The
 * order is the order in which categories first appear in the registry, not the vocabulary order.
 */
export function runtimeTemplateCategories(): readonly RuntimeTemplateCategory[] {
	const seen: RuntimeTemplateCategory[] = [];
	for (const template of RUNTIME_TEMPLATES)
		if (!seen.includes(template.category)) seen.push(template.category);
	return seen;
}

/**
 * Pure conversion from a template to the list of files to create. Nothing is stored. Record ids are
 * not made here; identity is issued by the store (newLocalId). Paths are sorted because the store
 * creates records in that order. The same template then commits in the same order on every device,
 * and tests can pin the values.
 */
export function instantiateRuntimeTemplate(
	template: RuntimeTemplate,
): RuntimeStarter {
	const files = [...template.files].sort((left, right) =>
		left.path < right.path ? -1 : 1,
	);
	return { entry: template.entry, files };
}

/**
 * The starter for a path that chooses nothing. If each call site spelled out its own default, no
 * one could answer which surface creates which starter file.
 */
export function defaultRuntimeStarter(): RuntimeStarter {
	const template = runtimeTemplateById(RUNTIME_DEFAULT_TEMPLATE_ID);
	/** A registry without a default template must be unrepresentable. Tests guard this by value. */
	if (template === null)
		throw new Error(
			`unknown default runtime template: ${RUNTIME_DEFAULT_TEMPLATE_ID}`,
		);
	return instantiateRuntimeTemplate(template);
}
