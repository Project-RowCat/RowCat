import {
	featuredRuntimeTemplate,
	RUNTIME_TEMPLATES,
	type RuntimeTemplate,
	type RuntimeTemplateCategory,
	runtimeTemplateById,
	runtimeTemplatesIn,
} from "@rowcat/authoring";

/**
 * The gallery's pure rules: what is visible and what is selected. Conditions are not stacked inside
 * the component, because this repo has paid for that before (creator-analytics-state.ts,
 * runtime-compile-view.ts). A mistake here fails silently: a filter makes the detail panel draw a
 * template outside the list, or picking `Blank` and then changing category clears the selection. It
 * must be checkable without rendering.
 *
 * There is no storage here. Picking a card writes nothing to the draft. A record is created only
 * after the user confirms, so this file has no store, hook, or async.
 */

export interface RuntimeTemplateGallerySelection {
	/** `null` means all categories. Uses the category vocabulary as is. */
	category: RuntimeTemplateCategory | null;
	/** What the detail panel currently draws. There is always one, unless the list is empty. */
	templateId: string;
}

/**
 * On first open, one template is already selected. Opening with nothing selected leaves the detail
 * panel empty, and that gap fills with a "choose one" sentence that repeats what the cards
 * already say. Without a recommendation, the first template (`Blank`) is selected.
 */
export function initialRuntimeTemplateSelection(): RuntimeTemplateGallerySelection {
	const featured = featuredRuntimeTemplate();
	return {
		category: null,
		templateId: featured?.id ?? RUNTIME_TEMPLATES[0].id,
	};
}

/**
 * Changing category moves a selection that became invisible to the first visible template.
 * Otherwise the detail panel draws something outside the list, and confirm creates it. A user
 * cannot trace an action that creates something they cannot see.
 */
export function selectRuntimeTemplateCategory(
	current: RuntimeTemplateGallerySelection,
	category: RuntimeTemplateCategory | null,
): RuntimeTemplateGallerySelection {
	const visible = runtimeTemplatesIn(category);
	const kept = visible.some((template) => template.id === current.templateId);
	if (kept) return { category, templateId: current.templateId };
	return {
		category,
		/**
		 * The registry does not produce empty categories (`runtimeTemplateCategories`), but a caller may
		 * not know that. Falls back to the current selection when the list is empty.
		 */
		templateId: visible[0]?.id ?? current.templateId,
	};
}

/**
 * Picks a card. The category stays as is. If picking a card also reset the filter, the next card
 * would be harder to find.
 */
export function selectRuntimeTemplate(
	current: RuntimeTemplateGallerySelection,
	templateId: string,
): RuntimeTemplateGallerySelection {
	return { category: current.category, templateId };
}

export interface RuntimeTemplateGalleryView {
	visible: readonly RuntimeTemplate[];
	/** What the detail panel draws. `null` when the list is empty. */
	selected: RuntimeTemplate | null;
}

/** Maps one state to the values the screen draws, so components do not query the registry twice. */
export function runtimeTemplateGalleryView(
	selection: RuntimeTemplateGallerySelection,
): RuntimeTemplateGalleryView {
	const visible = runtimeTemplatesIn(selection.category);
	const selected = runtimeTemplateById(selection.templateId);
	return {
		visible,
		/**
		 * Does not draw a selection outside the list. The rules above prevent this state, but a caller
		 * may not know that.
		 */
		selected:
			selected !== null &&
			visible.some((template) => template.id === selected.id)
				? selected
				: null,
	};
}
