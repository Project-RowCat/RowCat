import type { UpdateNote, UpdateNoteSectionId } from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import { updateNoteTitle } from "./update-note-copy.ts";
import { UpdateNoteText } from "./update-note-text.tsx";

/**
 * Section-to-icon table for this screen only. It does not belong in `@rowcat/domain`. The domain
 * carries section identity and label. Each surface decorates the label differently: Lucide here,
 * emoji prefixes in Discord output. An `icon` field on the projection would import screen-library
 * vocabulary into the domain and add a value mobile never uses. `satisfies` makes missing and extra
 * entries both compile errors, so a new section breaks this dialog at once. The icons are chosen by
 * meaning. Mobile's registry (`update-*` in `packages/ui-native/src/icon.tsx`) picks the same four,
 * so one release looks the same in both apps.
 */
const SECTION_ICON = {
	/** Newly available capabilities. Shares its icon with the auto-created memory indicator. */
	additions: Sparkles,
	/**
	 * Existing features that got better. The check sits inside a circle, because a bare check reads as
	 * the result of an action.
	 */
	improvements: CircleCheck,
	fixes: Wrench,
	/** Facts the user must know. Same icon as the warning in `gallery-error.tsx`. */
	notices: TriangleAlert,
} satisfies Record<UpdateNoteSectionId, LucideIcon>;

/**
 * Update note dialog: it is for reading, not a dashboard.
 *
 * - Draws four things only: the title (date-derived; it is the dialog's accessible name), the
 *   lead paragraph (omitted when absent), non-empty sections in shared order, and one close action.
 * - Section order, labels, and empty-section removal come from the `UpdateNote.sections`
 *   projection in `@rowcat/domain`. Re-implementing them here would let web and mobile order the
 *   same release differently.
 * - Only the icon is decided here (`SECTION_ICON`). Emoji used to be part of the label string, so
 *   the title icon depended on each platform's emoji font. Labels are plain words now; icons are
 *   chosen in this file.
 * - No card per item. A box per item would turn a four-section note into a list screen. Use type
 *   hierarchy and spacing only: no borders, badges, gradients, or nested surfaces.
 * - Icons follow the same rule: all sections share one tone. Per-section colors would make the
 *   note read as a status dashboard.
 * - Every close path (action, close button, Esc, outside click) goes to one handler. Management
 *   dialogs block outside clicks (`shouldCloseDialog`) to protect half-written forms and
 *   irreversible confirmations. This dialog has nothing to lose, and blocking closes would make it
 *   a nuisance to someone who has finished reading.
 * - Closing records nothing. The read state is written when the row that opened the dialog is
 *   pressed (`update-notes-list.tsx`). Recording it here too would create two owners of one fact.
 * - Dialog length belongs to the author. Without `DIALOG_VIEWPORT_BOUND`, a long note is clipped
 *   at the top and bottom, because `position: fixed` cannot be reached by page scroll. The clipping
 *   usually cuts the last section (`Notes`) and the confirm button.
 */
export function UpdateNoteDialog({
	note,
	open,
	onDismiss,
}: {
	note: UpdateNote;
	/**
	 * The component stays mounted after closing so the primitive can play its exit transition to the
	 * end. Unmounting right away makes the dialog vanish instead of animating out.
	 */
	open: boolean;
	onDismiss: () => void;
}) {
	const { t } = useTranslation("shell");
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onDismiss();
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-lg`}>
				<DialogHeader>
					<DialogTitle>{updateNoteTitle(note)}</DialogTitle>
					{/*
					 * The lead paragraph is the dialog's description. It is not rendered when absent: an
					 * empty paragraph only widens the gap between the title and the first section, and
					 * assistive tech would read an extra unnamed description.
					 */}
					{note.intro ? (
						<DialogDescription>
							<UpdateNoteText text={note.intro} />
						</DialogDescription>
					) : null}
				</DialogHeader>

				<div className="flex flex-col gap-6 text-sm">
					{note.sections.map((section) => {
						const SectionIcon = SECTION_ICON[section.id];
						return (
							<section key={section.id} className="flex flex-col gap-2">
								<h3 className="flex items-center gap-2 font-medium">
									{/*
									 * Decorative icon. The adjacent word already gives the name; a second name would make
									 * screen readers read the section twice (e.g. `Sparkles, New features`).
									 *
									 * Sized `size-3.5`, the inline-icon scale this repo uses beside `text-sm` (the exit arrow
									 * in `settings-navigation.tsx`, the warning line in `room-settings-parts.tsx`, sidebar
									 * `All conversations`). `size-4` would draw a glyph taller than the text, so the icon would
									 * be read before the word.
									 *
									 * Mobile uses 16px, but its title is 17px. What must match across apps is the
									 * icon-to-text ratio, not the pixel size.
									 *
									 * `items-center` aligns vertically. Text sits near the middle of the line box, so no
									 * optical offset is needed. A fixed value such as `mt-[1px]` would go stale when the font
									 * size changes.
									 */}
									<SectionIcon
										aria-hidden="true"
										className="size-3.5 shrink-0"
									/>
									<span>{t(`updates.section.${section.id}`)}</span>
								</h3>
								{/*
								 * Use a real list. Bullet characters in a `<div>` stop assistive tech from announcing the
								 * item count, and the section reads as one run-on sentence. `list-outside` keeps wrapped
								 * lines from tucking under the bullet.
								 *
								 * Bullets are not replaced with icons. A glyph on every line would turn the note into a
								 * list screen.
								 */}
								<ul className="list-outside list-disc space-y-1.5 pl-5 leading-6 text-muted-foreground">
									{section.items.map((item) => (
										<li key={item}>
											<UpdateNoteText text={item} />
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>

				<DialogFooter>
					<Button onClick={onDismiss}>{t("updates.ok")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
