import type { Story } from "@rowcat/domain";
import { formatDate } from "#/lib/format/date-time.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Pure rules for which rows the work's secondary-information table shows. The hard part is absence,
 * not layout: three omissions (`Updated` on a work edited the same day it was registered, `Author credit` when
 * it equals the account name, and `Protected prompt` when false) raise no error when wrong. The symptom is a
 * row that repeats a fact or a meaningless `No`. Inline JSX `&&` would make the rule checkable
 * only by opening the screen.
 *
 * Not shown: internal identifiers (work id, creator id, revision, hash), raw bytes, and raw
 * timestamps, since the table is for readers. Metrics (views, downloads, conversation counts) are
 * absent from the public `StoryDto` contract, and this screen is not a reason to add them. The
 * prompt body never reaches this screen. Absent-state rows such as `Protected prompt: No` are not written,
 * because a row given to the non-exception would hide the real exceptions.
 */
export interface StoryProperty {
	label: string;
	value: string;
	/**
	 * Whether the value is read with aligned digits. Dates are excluded: a formatted date (`August
	 * 21, 2026`) is not a number column, and fixed-width digits would spread the letters apart.
	 */
	numeric?: boolean;
}

const SIZE_UNITS = ["KB", "MB", "GB", "TB"] as const;

/**
 * Written inline rather than adding a formatting dependency. The only rule needed is dividing by
 * 1024 until the value is small.
 */
export function formatStorySize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	// One decimal is kept only below 10: `9.7 MB` is informative, but the `.4` in `973.4 KB` is not.
	return `${value.toFixed(value < 10 ? 1 : 0)} ${SIZE_UNITS[unit]}`;
}

/**
 * Returns only the properties this work actually has, in order. Dates are compared as displayed
 * strings, not ISO strings: the table shows the day, so a work posted in the morning and edited in
 * the afternoon of the same day would otherwise show the same date twice.
 *
 * An unreadable timestamp produces no row. A label with an empty value reads as a broken screen,
 * not as "unknown."
 */
export function storyPropertyRows(story: Story): StoryProperty[] {
	const rows: StoryProperty[] = [];

	const created = formatDate(story.createdAt);
	const t = translator("story");
	if (created) rows.push({ label: t("properties.created"), value: created });

	const updated = formatDate(story.updatedAt);
	if (updated && updated !== created)
		rows.push({ label: t("properties.updated"), value: updated });

	// The author label is shown only when it differs from the account nickname. When they match, it
	// just repeats the byline.
	if (story.author && story.author !== story.creator?.nickname)
		rows.push({ label: t("properties.author"), value: story.author });

	rows.push({
		label: t("properties.size"),
		value: formatStorySize(story.sizeBytes),
		numeric: true,
	});

	if (story.promptProtected)
		rows.push({
			label: t("properties.body"),
			value: t("properties.protected"),
		});

	return rows;
}
