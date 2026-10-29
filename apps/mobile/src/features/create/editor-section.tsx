import { space } from "@rowcat/design";
import { Icon, Separator, Text, touchTarget } from "@rowcat/ui-native";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * One section of the editor, the counterpart of `AccountSection` on the account screen.
 * - Lives in this feature, not `@rowcat/ui-native`: it holds the editor's vertical rhythm, which
 *   is not a platform primitive.
 * - Not wrapped in `Card`: sections are separated by their titles, and nested borders only lower
 *   density.
 *
 * Collapsible sections use `summary` as the switch. Lore, start scenes and scene images start
 * closed and show their count (`World · 4`). Basics, prompt and publish stay open, since collapsing
 * publish would hide the publish button. Order is not enforced, and opening or closing touches no
 * storage.
 *
 * Collapsed bodies stay mounted (display none, not unmounted). Unmounting would drop debounced
 * typing, card-local input state and focus. Their child counts are capped (`STORY_PUBLISH_LIMITS`),
 * which is cheap next to losing edits.
 *
 * No collapse animation: a height-measuring animation would fight children that resize themselves
 * (`docs/motion/ARCHITECTURE.md`).
 *
 * Collapse state is screen state. It is not saved to the draft, storage or the address, because it
 * describes what is on screen now, not the work.
 */
export function EditorSection({
	title,
	description,
	action,
	alert,
	summary,
	first,
	children,
}: {
	title: string;
	/** One line on what this section decides. Omitted when absent, so no empty space is left. */
	description?: string;
	/**
	 * An action on the title row (for example `Add lore`).
	 *
	 * Not drawn while collapsed. Pressing it would create an item inside the hidden body, so the
	 * button would look like it did nothing. Opening the section first is the natural step.
	 */
	action?: ReactNode;
	/**
	 * A line that must stay visible even when collapsed (over-limit, duplicate triggers).
	 *
	 * Inside the body, a collapsed section's problem would be hidden until the creator published, and
	 * only then would they learn of it. The line exists to tell them before publishing.
	 */
	alert?: ReactNode;
	/**
	 * The line shown while collapsed. **Its presence makes the section collapsible.**
	 *
	 * Taking a summary rather than a boolean is the point. With only `collapsible`, a closed section
	 * would show the title alone, and the user would have to open it to learn what is inside. That
	 * reduces information rather than density.
	 */
	summary?: string;
	/** The first section: no divider is drawn above it. */
	first?: boolean;
	children: ReactNode;
}) {
	/**
	 * Collapsible sections start closed. Opening them when they have content would tie the screen's
	 * length to the data: someone with four lore entries already knows the section, and a first-time
	 * user sees it empty anyway.
	 */
	const [expanded, setExpanded] = useState(false);
	const collapsible = summary !== undefined;
	const open = !collapsible || expanded;

	return (
		<View style={section.root}>
			{first ? null : <Separator />}
			<View style={section.head}>
				<View style={section.headRow}>
					<SectionHead
						title={title}
						summary={summary}
						collapsible={collapsible}
						expanded={open}
						onToggle={() => setExpanded((value) => !value)}
					/>
					{/** The action is shown only while open (see `action`). */}
					{open ? action : null}
				</View>
				{/**
				 * The description shows only while open. The collapsed line already carries the summary, and with
				 * both, a collapsed section would be two lines tall, nearly as tall as the open one.
				 */}
				{open && description ? (
					<Text variant="label" tone="muted-foreground">
						{description}
					</Text>
				) : null}
			</View>
			{/** The alert shows regardless of collapse (see `alert`). */}
			{alert}
			{/**
			 * Hidden, not unmounted (see the header). `children` always renders; only the `display` of the wrapper
			 * changes. Conditional rendering would drop pending typing, card-local state and focus on collapse.
			 * `display: "none"` also leaves layout, so the parent's `gap` does not count this child.
			 */}
			<View style={open ? section.body : section.hidden}>{children}</View>
		</View>
	);
}

/**
 * Title row. In a non-collapsible section the title stays plain, unpressable text.
 *
 * Only a collapsible section becomes a `Pressable`. If the title were always pressable, an open
 * section's title would be a button that does nothing, and assistive technology would read it as a
 * control.
 */
function SectionHead({
	title,
	summary,
	collapsible,
	expanded,
	onToggle,
}: {
	title: string;
	summary?: string;
	collapsible: boolean;
	expanded: boolean;
	onToggle: () => void;
}) {
	if (!collapsible)
		return (
			<View style={section.headText}>
				<Text accessibilityRole="header" variant="title">
					{title}
				</Text>
			</View>
		);

	return (
		<Pressable
			accessibilityRole="button"
			/**
			 * The name is the title, plus the summary when there is one: the count is a value, not a state.
			 * Open and closed are conveyed by `expanded`. Writing "expand" in the label would eventually
			 * disagree with that state.
			 */
			accessibilityLabel={summary ? `${title}, ${summary}` : title}
			accessibilityState={{ expanded }}
			onPress={onToggle}
			style={section.trigger}
		>
			<View style={section.headText}>
				<Text variant="title">{title}</Text>
				{/**
				 * The summary shown while collapsed, e.g. `World · 4`. It stays when open too: the count is a fact,
				 * not a state (it is still true when open), and removing it would change the title row's height on open.
				 */}
				{summary ? (
					<Text variant="caption" tone="muted-foreground" numberOfLines={1}>
						{summary}
					</Text>
				) : null}
			</View>
			{/**
			 * The chevron is decoration. Its state is announced by `accessibilityState` above, so it has no name of
			 * its own and is not a separate press target: the whole row is the target.
			 */}
			<Icon
				name={expanded ? "chevron-up" : "chevron-down"}
				size="md"
				tone="muted-foreground"
			/>
		</Pressable>
	);
}

const section = StyleSheet.create({
	root: { gap: space.md },
	head: { gap: space.xs },
	headRow: { alignItems: "center", flexDirection: "row", gap: space.sm },
	/**
	 * The whole row is the trigger, which keeps it at the minimum touch height.
	 *
	 * Not widened with `hitSlop`: this row sits directly above and below sibling sections. Overlapping
	 * touch areas go to whichever sibling RN drew later, so the section under the finger and the one
	 * that opens can differ (`metrics.ts` in `@rowcat/ui-native` records the same rule). Width is
	 * already the full canvas, so only height can grow.
	 */
	trigger: {
		alignItems: "center",
		flex: 1,
		flexDirection: "row",
		gap: space.sm,
		minHeight: touchTarget,
		minWidth: 0,
	},
	/** The title is always the side that shrinks, so the action does not get pushed off screen. */
	headText: { flex: 1, gap: space.px, minWidth: 0 },
	/** Spacing between children belongs to the children; this box only switches visibility. */
	body: { gap: space.md },
	/**
	 * Removed from layout. `opacity: 0` or zero height would keep the box in the parent's `gap`,
	 * leaving an empty band between collapsed sections.
	 */
	hidden: { display: "none" },
});
