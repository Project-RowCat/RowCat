import { space } from "@rowcat/design";
import type { UpdateNote, UpdateNoteSectionId } from "@rowcat/domain";
import type { IconName } from "@rowcat/ui-native";
import { Button, Dialog, DialogActions, Icon, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { UpdateNoteText } from "./update-note-text.tsx";

/**
 * Section → icon, by **semantic name**, not glyph name.
 *
 * This app's screens cannot import `lucide-react-native` directly (`lib/boundaries.test.ts`). The
 * only path is `<Icon name="…" />` from `@rowcat/ui-native`, which receives a meaning, not a
 * picture. This table answers only what the section means; the registry maps that meaning to a
 * Lucide component (`packages/ui-native/src/icon.tsx`).
 *
 * The table does not move up into `@rowcat/domain`, for the same two-layer reason. The domain
 * carries a section's identity and its words; how those words are decorated differs per surface.
 * The web picks Lucide components directly, while text sent to Discord gets an emoji prefix. An
 * `icon` field in the projection would give the domain the vocabulary of one screen library, and
 * its shape would fit only one of the two apps.
 *
 * `satisfies` makes both a missing and an extra key a compile error: adding a section breaks this
 * window at compile time instead of silently drawing a heading with no icon.
 */
const SECTION_ICON = {
	additions: "update-addition",
	improvements: "update-improvement",
	fixes: "update-fix",
	notices: "update-notice",
} satisfies Record<UpdateNoteSectionId, IconName>;

/**
 * The update-note window — **a text to read, not a dashboard.**
 *
 * ## It draws only four things
 *
 * ```text
 * title     `2026.08.30 update note` — derived from the date; it is the window's accessible name
 * intro     omitted when absent
 * sections  non-empty only, in the shared order
 * dismiss   one close action
 * ```
 *
 * This file does not decide what to draw. Section order, labels, and dropping empty sections all
 * happen in the `@rowcat/domain` projection (`UpdateNote.sections`). If the screen restated those
 * rules, the web and this app would draw the same release in different orders, and only a
 * side-by-side comparison would reveal the difference.
 *
 * ## No card per entry
 *
 * One box per item would turn a four-section note into ten surfaces, and the window would stop
 * being prose and become a list screen. Only type hierarchy and spacing are used here: no borders,
 * badges, gradients, or nested surfaces.
 *
 * ## Why `Dialog`, and why it scrolls
 *
 * This interaction is a **read-only detail** (the presentation table is in
 * `docs/design/ARCHITECTURE.md`). `placement="adaptive"` is the same product decision as room
 * settings: on a handheld it rises from the bottom, on a tablet it sits centered. Only the
 * coordinates change.
 *
 * `scroll` is on because the author decides this window's length. If content cut at the height cap
 * (82–85% of the screen) stayed truncated, the cut would appear first on devices with large
 * accessibility text, and since the last section is usually `Notes`, a line that must be read would
 * disappear. The way to close is always available regardless of scroll: the primitive's close
 * button is pinned to the header, and the Android back gesture and backdrop tap still work.
 */
export function UpdateNoteDialog({
	note,
	open,
	onDismiss,
}: {
	note: UpdateNote;
	/**
	 * The component stays mounted after closing so the primitive can finish its exit animation.
	 * Unmounting immediately would make the window vanish abruptly instead of animating out.
	 */
	open: boolean;
	/**
	 * Every dismiss path (confirm, close, back gesture, backdrop tap) funnels through this one
	 * callback.
	 *
	 * **Closing records nothing.** The seen fact was already written by the row that opened the window
	 * (`update-notes-list.tsx`). Recording it here too would give the same fact two owners, and a
	 * future change would fix only one of them.
	 */
	onDismiss: () => void;
}) {
	return (
		<Dialog
			title={note.title}
			open={open}
			onOpenChange={(next) => {
				if (!next) onDismiss();
			}}
			placement="adaptive"
			scroll
			headerDivider
		>
			<View style={styles.body}>
				{note.intro ? (
					<Text tone="muted-foreground" leading="reading">
						<UpdateNoteText text={note.intro} />
					</Text>
				) : null}

				{note.sections.map((section) => (
					<View key={section.id} style={styles.section}>
						<View style={styles.sectionTitle}>
							{/**
							 * The icon is **decoration.** It has no `label`, so screen readers hide it (the `Icon` default),
							 * and the section reads as `New features` once; adding a name would make it `Sparkles, New features`.
							 *
							 * The icon used to be an emoji inside the label string, and the device's emoji font drew it, so the
							 * same release looked different on each platform. Emoji now appear only in the text sent to Discord.
							 *
							 * Sections are not color-coded. If the four sections used four colors, the body would start to read
							 * like a status dashboard, and those colors are not an axis this repository gives meaning to.
							 */}
							<Icon name={SECTION_ICON[section.id]} size="md" />
							<Text variant="title" style={styles.sectionTitleText}>
								{section.label}
							</Text>
						</View>
						{section.items.map((item) => (
							<View key={item} style={styles.item}>
								{/**
								 * The bullet and the text are siblings. A single `"• " + item` string would wrap the second
								 * line under the bullet, and short test sentences would hide that misalignment.
								 */}
								<Text tone="muted-foreground">•</Text>
								<Text style={styles.itemText} leading="reading">
									<UpdateNoteText text={item} />
								</Text>
							</View>
						))}
					</View>
				))}
			</View>

			<DialogActions>
				{/**
				 * This is the only action, so it fills the row. `DialogActions` is a horizontal row, so `fullWidth`
				 * (`alignSelf: stretch`) only grows it vertically; filling the width takes `flex: 1`. The rename dialog
				 * uses the same pairing.
				 */}
				<Button
					label="OK"
					fullWidth
					style={styles.action}
					onPress={onDismiss}
				/>
			</DialogActions>
		</Dialog>
	);
}

const styles = StyleSheet.create({
	body: { gap: space.xl },
	section: { gap: space.sm },
	/**
	 * The icon and the text are siblings. Spacing comes from the shared scale, and vertically they
	 * align to the **baseline of the first line**.
	 *
	 * Three candidates each fix one thing and break another:
	 *
	 * ```text
	 * center      perfect for one line; when wrapped, the icon sits **between** two lines and does not clearly belong
	 *             to either
	 * flex-start  fixes the wrap but **breaks at large accessibility text**: the first line grows with the text while
	 *             the icon keeps its size and sticks to the top of the line (seen in the simulator at
	 *             `accessibility-extra-large`)
	 * baseline    the icon's bottom sits on the **baseline of the first line**, the line the Korean glyphs sit on
	 * ```
	 *
	 * Only the third takes no font-size argument. The baseline is set by the font, so it lowers with
	 * the accessibility setting by itself. That is why this line has no fixed height and no
	 * `fontScale`, which also keeps it clear of the boundary that forbids reading window size here
	 * (`lib/presentation-policy.test.ts`). The icon gets no slot wrapper either: the icon itself owns
	 * the baseline.
	 */
	sectionTitle: {
		flexDirection: "row",
		alignItems: "baseline",
		gap: space.sm,
	},
	/** When the title wraps, it shrinks beside the icon; the icon keeps only its own width. */
	sectionTitleText: { flex: 1, minWidth: 0 },
	item: { flexDirection: "row", gap: space.sm },
	/** Text takes the remaining width; the bullet keeps only its own. */
	itemText: { flex: 1, minWidth: 0 },
	/** Fills the row in a column of stacked actions; stands in for the row's `flex: 1`. */
	action: { alignSelf: "stretch" },
});
