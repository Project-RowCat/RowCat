import { featuredRuntimeTemplate, RUNTIME_TEMPLATES } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import {
	initialRuntimeTemplateSelection,
	runtimeTemplateGalleryView,
	selectRuntimeTemplate,
	selectRuntimeTemplateCategory,
} from "./runtime-template-gallery-state.ts";

/**
 * Checks the gallery's rules without rendering. If these rules lived in the component, a wrong rule
 * would fail silently: a filter could make the detail panel draw a template not in the list, and
 * confirming would then create a template the user cannot see.
 */

describe("on first open", () => {
	it("has the one featured template selected", () => {
		const selection = initialRuntimeTemplateSelection();
		expect(selection.category).toBeNull();
		expect(selection.templateId).toBe(featuredRuntimeTemplate()?.id);
	});

	it("has the selection in the list", () => {
		const view = runtimeTemplateGalleryView(initialRuntimeTemplateSelection());
		expect(view.selected).not.toBeNull();
		expect(view.visible).toEqual(RUNTIME_TEMPLATES);
	});
});

describe("changing the category", () => {
	it("keeps a selection that stays visible", () => {
		const start = { category: null, templateId: "messenger" };
		expect(selectRuntimeTemplateCategory(start, "social").templateId).toBe(
			"messenger",
		);
	});

	/**
	 * A stale selection left as is would make the detail panel draw something outside the list, and
	 * the confirm button would create it. The user has no way to trace that action back.
	 */
	it("moves a selection that became hidden to the first item", () => {
		const start = { category: null, templateId: "messenger" };
		const next = selectRuntimeTemplateCategory(start, "story");
		expect(next.category).toBe("story");
		expect(next.templateId).not.toBe("messenger");
		const view = runtimeTemplateGalleryView(next);
		expect(view.visible.map((template) => template.id)).toContain(
			next.templateId,
		);
	});

	it("shows everything again when set back to all", () => {
		const narrowed = selectRuntimeTemplateCategory(
			initialRuntimeTemplateSelection(),
			"basic",
		);
		const all = selectRuntimeTemplateCategory(narrowed, null);
		expect(runtimeTemplateGalleryView(all).visible).toEqual(RUNTIME_TEMPLATES);
	});

	/**
	 * The detail panel is never empty in any category, because the registry does not produce empty
	 * categories.
	 */
	it("has a selection in every category", () => {
		for (const template of RUNTIME_TEMPLATES) {
			const next = selectRuntimeTemplateCategory(
				initialRuntimeTemplateSelection(),
				template.category,
			);
			expect(runtimeTemplateGalleryView(next).selected).not.toBeNull();
		}
	});
});

describe("choosing a card", () => {
	it("keeps the category: choosing does not reset the filter", () => {
		const narrowed = selectRuntimeTemplateCategory(
			initialRuntimeTemplateSelection(),
			"story",
		);
		const picked = selectRuntimeTemplate(narrowed, "relationship-profile");
		expect(picked.category).toBe("story");
		expect(picked.templateId).toBe("relationship-profile");
	});

	/**
	 * Choosing changes one piece of screen state only. With no storage, hook, or async in this module,
	 * nothing is saved until confirm is pressed.
	 */
	it("does not mutate its input", () => {
		const start = initialRuntimeTemplateSelection();
		const before = { ...start };
		selectRuntimeTemplate(start, "blank");
		selectRuntimeTemplateCategory(start, "game");
		expect(start).toEqual(before);
	});
});
