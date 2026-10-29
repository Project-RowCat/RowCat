import {
	type RuntimeTemplateCategory,
	runtimeTemplateCategories,
} from "@rowcat/authoring";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useState } from "react";
import { RuntimeDocsEntryLink } from "#/features/docs/runtime-docs-entry.tsx";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { RUNTIME_BETA } from "#/lib/runtime-beta.ts";
import { RuntimeTemplateCard } from "./runtime-template-card.tsx";
import {
	RUNTIME_TEMPLATE_GALLERY,
	runtimeTemplateCategoryLabel,
	runtimeTemplateText,
} from "./runtime-template-copy.ts";
import { RuntimeTemplateDetail } from "./runtime-template-detail.tsx";
import {
	initialRuntimeTemplateSelection,
	runtimeTemplateGalleryView,
	selectRuntimeTemplate,
	selectRuntimeTemplateCategory,
} from "./runtime-template-gallery-state.ts";
import { useCreateRuntimeProject } from "./use-create-runtime-project.ts";

/**
 * The template gallery opens only on first creation.
 * - A draft that already has a project does not open it, and neither does re-enabling a
 *   turned-off runtime. There, picking a template could overwrite existing files, and even without
 *   an overwrite the user would have to check whether their code disappeared. The gate is decided
 *   by the caller (`runtime-section.tsx`), and the condition for opening this window is that gate.
 * - Choosing saves nothing. The draft is untouched until the bottom confirm button, so cancelling
 *   leaves no trace.
 * - One screen. Wide screens put details beside the grid and narrow screens below it. A second
 *   screen would turn comparison into round trips.
 */
export function RuntimeTemplateGallery({
	draftId,
	open,
	onOpenChange,
}: {
	draftId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [selection, setSelection] = useState(initialRuntimeTemplateSelection);
	const { visible, selected } = runtimeTemplateGalleryView(selection);
	const creation = useCreateRuntimeProject(draftId);
	const categories = runtimeTemplateCategories();

	const filter = (category: RuntimeTemplateCategory | null): void => {
		creation.reset();
		setSelection((current) => selectRuntimeTemplateCategory(current, category));
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				/**
				 * Does not close while creating. Closing here would leave the user either in a studio with no
				 * files yet, or in the editor without having seen the transaction finish. Either way they
				 * cannot tell what they made.
				 */
				if (creation.pending) return;
				onOpenChange(next);
			}}
		>
			<DialogContent className={cn(DIALOG_VIEWPORT_BOUND, "sm:max-w-4xl")}>
				<DialogHeader>
					<div className="flex items-center gap-2">
						<DialogTitle>{RUNTIME_TEMPLATE_GALLERY.title}</DialogTitle>
						{/*
						 * This status word is cheapest to read right before creating. If learned here, the user can still
						 * back out; if learned days later after writing code, they cannot. Card copy does not include this
						 * word: mixing status into the cards would make all six repeat the same disclaimer line. A test
						 * holds that value.
						 */}
						<span className="rounded-full border border-border px-1.5 py-px text-[0.6875rem] font-medium leading-4 text-muted-foreground">
							<span className="sr-only">{RUNTIME_BETA.srPrefix}</span>
							{RUNTIME_BETA.label}
						</span>
					</div>
					<DialogDescription>
						{RUNTIME_TEMPLATE_GALLERY.description}
					</DialogDescription>
				</DialogHeader>

				{/*
				 * The filter row has no search box. With six items, scanning is faster than searching. Search
				 * belongs only where the list outgrows scanning.
				 */}
				{/*
				 * `fieldset` is chosen for meaning, not styling. It is the semantic element for a named group of
				 * controls; a `div` with role="group" imitates it. `min-w-0` stops the element's min-content width
				 * from overflowing the dialog on narrow screens.
				 */}
				<fieldset
					aria-label={RUNTIME_TEMPLATE_GALLERY.filterLabel}
					className="flex min-w-0 flex-wrap gap-1.5"
				>
					<FilterChip
						active={selection.category === null}
						label={RUNTIME_TEMPLATE_GALLERY.all}
						onSelect={() => filter(null)}
					/>
					{categories.map((category) => (
						<FilterChip
							key={category}
							active={selection.category === category}
							label={runtimeTemplateCategoryLabel(category)}
							onSelect={() => filter(category)}
						/>
					))}
				</fieldset>

				<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
					<fieldset
						aria-label={RUNTIME_TEMPLATE_GALLERY.listLabel}
						className="grid min-w-0 gap-3 sm:grid-cols-2"
					>
						{visible.map((template) => (
							<RuntimeTemplateCard
								key={template.id}
								template={template}
								selected={template.id === selection.templateId}
								onSelect={() => {
									creation.reset();
									setSelection((current) =>
										selectRuntimeTemplate(current, template.id),
									);
								}}
							/>
						))}
					</fieldset>

					{selected !== null && (
						<div className="lg:border-l lg:pl-5">
							<RuntimeTemplateDetail template={selected} />
						</div>
					)}
				</div>

				{/*
				 * Failures stay inside this window. A toast would close the window and lose the selected template,
				 * so the user would have to choose again from scratch.
				 */}
				{creation.failed && (
					<p role="alert" className="text-sm text-destructive">
						{RUNTIME_TEMPLATE_GALLERY.failed}
					</p>
				)}

				<DialogFooter>
					{/*
					 * A way to open the docs while choosing. It opens in a new tab so the selected card stays.
					 * `me-auto` pushes it to the left edge: it shares a row with the cancel and confirm pair on the
					 * right without reading as part of that pair.
					 */}
					<RuntimeDocsEntryLink className="me-auto self-center" />
					<Button
						variant="outline"
						disabled={creation.pending}
						onClick={() => onOpenChange(false)}
					>
						{RUNTIME_TEMPLATE_GALLERY.cancel}
					</Button>
					<Button
						disabled={creation.pending || selected === null}
						onClick={() => {
							if (selected === null) return;
							void creation.create(selected);
						}}
					>
						{creation.pending
							? RUNTIME_TEMPLATE_GALLERY.creating
							: selected === null
								? RUNTIME_TEMPLATE_GALLERY.cancel
								: creation.failed
									? RUNTIME_TEMPLATE_GALLERY.retry
									: RUNTIME_TEMPLATE_GALLERY.confirm(
											runtimeTemplateText(selected).name,
										)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * A plain button with `aria-pressed`, not role="radiogroup". The reason matches the cards: that
 * pattern requires roving tabindex and arrow keys, and implementing half of it would break the
 * conventions assistive-technology users expect.
 */
function FilterChip({
	active,
	label,
	onSelect,
}: {
	active: boolean;
	label: string;
	onSelect: () => void;
}) {
	return (
		<Button
			type="button"
			size="sm"
			variant={active ? "secondary" : "ghost"}
			aria-pressed={active}
			onClick={onSelect}
		>
			{label}
		</Button>
	);
}
