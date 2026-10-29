import type { RuntimeTemplate } from "@rowcat/authoring";
import { Badge } from "@rowcat/ui-web/components/badge";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Check } from "lucide-react";
import {
	RUNTIME_TEMPLATE_GALLERY,
	runtimeTemplateCategoryLabel,
	runtimeTemplateComplexityLabel,
	runtimeTemplateText,
} from "./runtime-template-copy.ts";
import { RuntimeTemplatePreview } from "./runtime-template-preview.tsx";

/**
 * One card: a picture, a name, one line, and two small facts.
 *
 * Why `<button aria-pressed>`: a single-select list looks better served by `role='radiogroup'`, but
 * that pattern comes as a bundle: roving tabindex, arrow-key focus movement, and the whole group as
 * one Tab stop. Implementing half of it would leave assistive-technology users facing a radio group
 * that does not follow the conventions they know, which is worse than a plain button list. This is
 * the same judgment as not giving the explorer `role='tree'`.
 *
 * So these are plain buttons, and the pressed state is conveyed by `aria-pressed`. Tab moves
 * between cards; Enter and Space select, as the browser provides.
 *
 * The selected state is not conveyed by color alone. A border and ring appear together with a check
 * mark, because a selection marked only by contrast disappears in low-contrast themes and with
 * color-vision deficiency.
 *
 * No technical detail goes on the card: no file lists, import lists, or code fragments (§15). The
 * grid shows the picture and name; the rest belongs to the detail panel.
 */
export function RuntimeTemplateCard({
	template,
	selected,
	onSelect,
}: {
	template: RuntimeTemplate;
	selected: boolean;
	onSelect: () => void;
}) {
	const text = runtimeTemplateText(template);
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"group relative flex flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
				"hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				selected ? "border-primary ring-1 ring-primary" : "border-border/60",
			)}
		>
			<RuntimeTemplatePreview id={template.id} />

			{/*
			 * The selection mark sits over the picture. In the text line it would shorten the name, and the
			 * title would wrap at the moment of selection, making the card height jump.
			 */}
			{selected && (
				<span className="absolute top-5 right-5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
					<Check aria-hidden className="size-3" />
				</span>
			)}

			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">{text.name}</span>
					{template.featured === true && (
						<Badge variant="secondary">
							{RUNTIME_TEMPLATE_GALLERY.featured}
						</Badge>
					)}
				</div>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{text.description}
				</p>
				<p className="mt-0.5 text-[11px] text-muted-foreground/80">
					{runtimeTemplateCategoryLabel(template.category)} ·{" "}
					{runtimeTemplateComplexityLabel(template.complexity)}
				</p>
			</div>
		</button>
	);
}
