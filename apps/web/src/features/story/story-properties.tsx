import type { Story } from "@rowcat/domain";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { storyPropertyRows } from "./story-properties.ts";

/**
 * The secondary information of a work, shown after the hero has said everything. Registration,
 * edit, and size are not put in separate boxes, which would look like a metrics dashboard. These
 * values should be easy to scan and easy to ignore, so they are one rhythm of lines with no boxes,
 * grid, or icons.
 *
 * The label is quieter than the value, so the eye reads `August 21, 2026`, not `Posted`. A single rule
 * above the section marks the boundary. There are no rules between rows; four rules across five
 * rows would be noise.
 */
export function StoryProperties({ story }: { story: Story }) {
	const { t } = useTranslation("story");
	const rows = storyPropertyRows(story);
	// Size is always present, so this list is never empty in practice. A heading must still not be
	// drawn over an empty table.
	if (rows.length === 0) return null;

	return (
		<section
			aria-labelledby="story-properties-heading"
			/*
			 * The top margin does the separating work; the rule only confirms the boundary. Removing the
			 * line must still leave the section pushed down.
			 */
			className="mt-2 border-t pt-6"
		>
			{/*
			 * The heading is the quietest text in the section, smaller than the table labels,
			 * because it is a signpost rather than content.
			 */}
			<h2
				id="story-properties-heading"
				className="text-xs font-medium tracking-wide text-muted-foreground"
			>
				{t("info")}
			</h2>

			{/*
			 * `minmax(0,1fr)` is used instead of `1fr`. A `1fr` track's minimum is `auto`, so the
			 * value column cannot shrink below its min-content. The author label is free text and
			 * can hold a long unbroken name, which would widen the grid and collapse the label
			 * column one character per line (`A/u/t/h/o/r`).
			 *
			 * The label column is `whitespace-nowrap`, which makes that collapse impossible;
			 * overflow goes to the value column, which handles it with `break-words`. The label
			 * column is `auto` rather than a fixed width, since a fixed width would push values away
			 * from their labels on works without the longest label.
			 */}
			<dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm [&>dd]:break-words [&>dt]:whitespace-nowrap [&>dt]:text-muted-foreground">
				{rows.map((row) => (
					/*
					 * `<dt>` and `<dd>` are direct children of `<dl>`, not wrapped, so they sit in the grid's two
					 * columns. Extra `<div>`s inside `<dl>` would also make the list structure differ across
					 * assistive technology.
					 */
					<Fragment key={row.label}>
						<dt>{row.label}</dt>
						<dd className={row.numeric ? "tabular-nums" : undefined}>
							{row.value}
						</dd>
					</Fragment>
				))}
			</dl>
		</section>
	);
}
