import { space } from "@rowcat/design";
import { Separator, Text } from "@rowcat/ui-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
	type MobileSettingsCategory,
	SETTINGS_CATEGORY_DESCRIPTION,
} from "./settings-nav.ts";

/**
 * Vertical rhythm of the settings screen. Same place and same reason as `AccountSection` on the
 * account screen.
 *
 * It belongs to **this feature**, not to `@rowcat/ui-native`, and that is the boundary. What lives
 * here is the settings screen's rhythm (title, description, body, rules between sections), not a
 * platform primitive. Moving it into the UI package would let the next screen inherit a rhythm it
 * does not own under the name "section".
 *
 * **Not every section is wrapped in a `Card`.** A card means "a separate block", but the sections
 * here are already separated by their titles, and stacked borders only lower the density. The
 * account screen and the web's settings screen reached the same decision.
 *
 * ## Rows stack vertically
 *
 * The web puts name and description on the left and the control on the right, stacking on narrow
 * widths. This app has no wide layout, so it is **always the stacked shape**, which matches the
 * web's narrow shape. At large accessibility text sizes the name and the control do not push each
 * other out of place.
 */
export function SettingsSection({
	title,
	description,
	first,
	children,
}: {
	title: string;
	description?: string;
	/** First section: does not draw the rule above it. */
	first?: boolean;
	children: ReactNode;
}) {
	return (
		<View style={parts.section}>
			{first ? null : <Separator />}
			<View style={parts.head}>
				<Text accessibilityRole="header" variant="title">
					{title}
				</Text>
				{description ? (
					<Text variant="label" tone="muted-foreground">
						{description}
					</Text>
				) : null}
			</View>
			{children}
		</View>
	);
}

/**
 * Label and description, with the control below them: one row of a property list.
 *
 * Same shape as `Field` in room settings (`room-settings-generation.tsx`). Like there, the axis is
 * not wrapped in a box: boxing it would make two axes that follow the same rule read as two
 * different forms.
 */
export function SettingsField({
	label,
	description,
	children,
}: {
	label: string;
	/**
	 * One line of description. **A string is drawn by this component; a node is placed as is.**
	 *
	 * There is one reason for the two branches: some descriptions are **state** and must switch in
	 * place when the value changes (a provider connection's `Linked` / `Not connected`, see
	 * `lib/motion/animated-label.tsx`). That transition needs a box, and a box cannot go inside
	 * `Text`.
	 *
	 * It is not split into two props on purpose. With both `description` and `descriptionSlot`
	 * present, a caller passing both would be representable, and this file would have to decide what
	 * is drawn. A caller passing a node supplies its own type hierarchy and color (`variant`, `tone`).
	 */
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<View style={parts.field}>
			<View style={parts.fieldHead}>
				<Text variant="body" weight="medium">
					{label}
				</Text>
				{typeof description === "string" ? (
					<Text variant="label" tone="muted-foreground">
						{description}
					</Text>
				) : (
					(description ?? null)
				)}
			</View>
			{children}
		</View>
	);
}

const parts = StyleSheet.create({
	section: { gap: space.md },
	head: { gap: space.xs },
	field: { gap: space.sm },
	fieldHead: { gap: space.px },
	body: { gap: space.lg },
});

/**
 * The one-line header of a category body, followed by its sections.
 *
 * This container exists because the shell moved up to the layout and the category description lost
 * its place. If it stayed in the shell, switching category would leave the sentence in place next
 * to the navigation row with **only its text changing**, which contradicts the transition's message
 * that another screen has just arrived. The web's page owns that line (`SettingsPageHeader`).
 *
 * So this line sits **inside** `PageEnter` and enters with the category. Only the rhythm lives
 * here; the wording belongs to the navigation model. If this file started to know each category's
 * sentence, editing a description would become editing the presentation layer.
 */
export function SettingsCategoryBody({
	category,
	children,
}: {
	category: MobileSettingsCategory;
	children: ReactNode;
}) {
	return (
		<View style={parts.body}>
			<View style={parts.head}>
				<Text variant="label" tone="muted-foreground">
					{SETTINGS_CATEGORY_DESCRIPTION[category]}
				</Text>
			</View>
			{children}
		</View>
	);
}
