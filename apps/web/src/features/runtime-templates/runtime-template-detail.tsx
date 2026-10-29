import {
	instantiateRuntimeTemplate,
	type RuntimeTemplate,
} from "@rowcat/authoring";
import { Badge } from "@rowcat/ui-web/components/badge";
import * as m from "motion/react-m";
import { contentEnter } from "#/lib/motion/surface-content.ts";
import {
	RUNTIME_TEMPLATE_GALLERY,
	runtimeTemplateCategoryLabel,
	runtimeTemplateComplexityLabel,
	runtimeTemplateText,
} from "./runtime-template-copy.ts";

/**
 * Shows what a template teaches and what it builds, on one screen. A second screen would turn
 * comparing templates into a round trip. Wide screens place it beside the grid; narrow screens
 * place it below.
 *
 * Only file names are listed, not file bodies (§20). Confirming opens the studio, which is where
 * code is read. Showing code here would make this window a second editor that cannot edit.
 *
 * There is no exit animation. The replacing content arrives at once and is the answer to the press;
 * a 120ms exit would delay it (see docs/motion/ARCHITECTURE.md).
 *
 * No AnimatePresence. With mode="wait" the detail panel lagged one selection behind, because the
 * new child did not mount until the old one left. A changing key remounts the panel and replays the
 * enter motion.
 */
export function RuntimeTemplateDetail({
	template,
}: {
	template: RuntimeTemplate;
}) {
	const plan = instantiateRuntimeTemplate(template);
	const text = runtimeTemplateText(template);

	return (
		<m.div
			key={template.id}
			initial={contentEnter.initial}
			animate={contentEnter.animate}
			transition={contentEnter.transition}
			className="flex flex-col gap-4"
		>
			<div className="flex flex-col gap-1.5">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="text-base font-semibold">{text.name}</h3>
					{template.featured === true && (
						<Badge variant="secondary">
							{RUNTIME_TEMPLATE_GALLERY.featured}
						</Badge>
					)}
				</div>
				<p className="text-sm leading-relaxed text-muted-foreground">
					{text.description}
				</p>
				<p className="text-xs text-muted-foreground/80">
					{runtimeTemplateCategoryLabel(template.category)} ·{" "}
					{runtimeTemplateComplexityLabel(template.complexity)} ·{" "}
					{RUNTIME_TEMPLATE_GALLERY.fileCount(plan.files.length)}
				</p>
			</div>

			<section className="flex flex-col gap-2">
				<h4 className="text-xs font-medium text-muted-foreground">
					{RUNTIME_TEMPLATE_GALLERY.demonstrates}
				</h4>
				<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
					{text.demonstrates.map((item) => (
						<li key={item} className="flex gap-1.5">
							<span aria-hidden>·</span>
							{item}
						</li>
					))}
				</ul>
			</section>

			<section className="flex flex-col gap-2">
				<h4 className="text-xs font-medium text-muted-foreground">
					{RUNTIME_TEMPLATE_GALLERY.files}
				</h4>
				{/*
				 * Lists file paths as written. A tree view would make this window imitate a file explorer, and
				 * that explorer could not open anything.
				 */}
				<ul className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground/90">
					{plan.files.map((file) => (
						<li key={file.path}>{file.path}</li>
					))}
				</ul>
			</section>
		</m.div>
	);
}
