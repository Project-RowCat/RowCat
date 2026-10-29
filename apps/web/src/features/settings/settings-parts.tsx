import { Label } from "@rowcat/ui-web/components/label";
import { cn } from "@rowcat/ui-web/lib/utils";
import type { ReactNode, RefObject } from "react";

/**
 * Typographic vocabulary for settings: layout and hierarchy only.
 *
 * This file holds no storage and no rules. Each setting asks its own owner for its value and saves
 * to it: theme from the theme provider, generation defaults from the preference store, provider
 * connections from the credential store. This file only defines what a setting looks like. Adding
 * storage here would turn it into a form framework, and each new setting would widen that
 * framework's types. This is the same boundary that keeps a SettingsProvider out.
 *
 * This vocabulary is not moved to @rowcat/ui-web. Shared packages would let other features build
 * settings-style screens; the account screen keeps its own section components for the same reason.
 */

/**
 * Control column width is one value for every row. Per-row widths misalign the left edges, which
 * makes the whole screen look unaligned. On narrow screens the control takes the full row: beside
 * the label at 390px, both would be truncated.
 *
 * Rows that draw their own control (the two generation-default controls) receive only the width,
 * through SETTINGS_CONTROL_WIDTH, because they already include `w-full shrink-0`.
 */
export const SETTINGS_CONTROL_WIDTH = "sm:w-56";
export const SETTINGS_CONTROL_COLUMN = `w-full shrink-0 ${SETTINGS_CONTROL_WIDTH}`;

/**
 * The large `Settings` title is not drawn here. Its identity lives in the navigation list (the small
 * label there). This header says where within settings the user is. Stacking two large titles would
 * use half the first screen to name itself.
 */
export function SettingsPageHeader({
	title,
	description,
}: {
	title: string;
	/**
	 * One line describing what the screen decides. Omitted when absent, so no empty space is left.
	 */
	description?: string;
}) {
	return (
		<header>
			<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
			{description && (
				<p className="mt-1 text-sm leading-6 text-muted-foreground">
					{description}
				</p>
			)}
		</header>
	);
}

/**
 * Groups are separated by a hairline. The first group has no line above it, because the category
 * title already provides the separation.
 */
export function SettingsGroup({
	title,
	description,
	headingRef,
	children,
}: {
	title: string;
	description?: string;
	/**
	 * Landing point when navigating here from elsewhere: the group title. Moving focus here matters,
	 * since scrolling alone does nothing for users who are not looking at the screen. The heading is
	 * focusable but not in the tab order (tabIndex -1): it is not a control, and Tab should not stop
	 * on it.
	 */
	headingRef?: RefObject<HTMLHeadingElement | null>;
	children: ReactNode;
}) {
	return (
		<section className="border-t py-6 first:border-t-0 first:pt-0">
			<h2
				ref={headingRef}
				tabIndex={headingRef ? -1 : undefined}
				className="text-sm font-semibold outline-none"
			>
				{title}
			</h2>
			{description && (
				<p className="mt-1 text-sm leading-6 text-muted-foreground">
					{description}
				</p>
			)}
			<div className="mt-4">{children}</div>
		</section>
	);
}

/**
 * The class is exported separately for list rows. Provider lists are `<ul>`/`<li>`, which this
 * wrapper cannot enclose: a `div` inside each `li` would be the first child in every row, so
 * `first:` rules would match all rows and no divider would be drawn. Rows that draw their own
 * internals use this class instead, so the spacing and dividers are not written in two places.
 */
export const SETTINGS_ROW_FRAME_CLASS =
	"border-t py-4 first:border-t-0 first:pt-0 last:pb-0";

export function SettingsRowFrame({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn(SETTINGS_ROW_FRAME_CLASS, className)}>{children}</div>
	);
}

/**
 * Name, description, and control in one row. On narrow screens they stack (the control takes the
 * full width); wider, the control moves to the right edge.
 *
 * The description sits above the control, not below, because the reading order is: what the setting
 * decides, then the choice. Reversing that makes people choose before they read.
 */
export function SettingsRow({
	label,
	htmlFor,
	description,
	descriptionId,
	control,
}: {
	label: string;
	/**
	 * Id of the control. When provided, the label becomes a real `<label>`.
	 *
	 * Settings with more than one control (generation target: provider and model) do not use this row
	 * and do their own layout. Attaching `label` to only one of two controls would leave the other
	 * control without a name.
	 */
	htmlFor?: string;
	description?: string;
	descriptionId?: string;
	control: ReactNode;
}) {
	return (
		<SettingsRowFrame>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div className="min-w-0">
					{htmlFor ? (
						<Label htmlFor={htmlFor} className="text-sm font-medium">
							{label}
						</Label>
					) : (
						<span className="text-sm font-medium">{label}</span>
					)}
					{description && (
						<p
							id={descriptionId}
							className="mt-1 text-sm leading-6 text-muted-foreground"
						>
							{description}
						</p>
					)}
				</div>
				<div className={SETTINGS_CONTROL_COLUMN}>{control}</div>
			</div>
		</SettingsRowFrame>
	);
}
