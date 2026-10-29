import { ChoiceGroup, ChoiceOption } from "./choice.tsx";
import { Sheet } from "./sheet.tsx";

/**
 * A short single-choice bottom sheet, and the only sheet capability this package exports.
 * - Why a capability rather than a container: Sheet was once a public API. Exporting a container
 *   means exporting 'anything can go inside', and the app's surfaces all became bottom sheets:
 *   overflow menus, one-field forms, read-only details, long report forms, memory management. Each
 *   time, the rule was written into docs and static scans, and each time it was broken again. Docs
 *   bind only their reader, and an exception-list scan passes whenever a name is added.
 * - So the policy moved into the types. With no `children`, this does not compile:
 *   `<ChoiceSheet><RoomSettings /></ChoiceSheet>`. Only option rows fit, built from `value` and
 *   `label`. Forms, list screens, and action groups have their own containers (`Dialog`, `Dialog
 *   size='full'`, `AlertDialog`, `DropdownMenu`).
 * - No escape hatches such as `content`, `renderContent`, `body`, or `footer`. Any argument that
 *   accepts arbitrary nodes turns this into a narrower Sheet, and the file would lose its reason to
 *   exist.
 * - When it fits: one value is picked, then the sheet closes at once. The current consumer is the
 *   filter pick on the `Discover` screen. The chips sit near the top, so the list is close to the thumb,
 *   and the list is short, so it does not cover the screen. A long list uses `Select`, whose closed
 *   trigger shows the current value. A choice that is one field inside a form uses a `ChoiceGroup`
 *   placed in that form, as the report reason does.
 * - Wiring: `sheet.tsx` (internal to this package) owns geometry, the four dismissal paths, safe
 *   area, keyboard, and the portal. `choice.tsx` owns `role='radiogroup'`, counting and position
 *   reading, and the selected display. Neither's props leak out. Pulling the sheet's axis props
 *   such as `scroll` up to this level would make callers aware of sheet internals, and the next
 *   request would be for `children`.
 */

export interface ChoiceSheetOption<T extends string> {
	value: T;
	label: string;
	/**
	 * The extra fact about this row, usually why it cannot be picked. It pairs with `disabled`. A
	 * dimmed row with no reason is just a row that does not respond, and users cannot tell what would
	 * unlock it.
	 */
	note?: string;
	/**
	 * Rows that cannot be picked are dimmed, not hidden. Removing them from the list means the
	 * option's existence is never communicated. The primitive in `choice.tsx` reads the dimming as a
	 * state, not only a color.
	 */
	disabled?: boolean;
}

export interface ChoiceSheetProps<T extends string> {
	/** Read first by screen readers when the sheet opens. It is also used as the dialog's name. */
	title: string;
	open: boolean;
	/**
	 * The currently selected value. Selection is decided by this, and each row's display derives from
	 * it.
	 */
	value: T;
	options: readonly ChoiceSheetOption<T>[];
	onValueChange: (value: T) => void;
	/**
	 * All four dismissal paths (background tap, close button, Android back, screen reader escape)
	 * converge on this one callback.
	 */
	onOpenChange: (open: boolean) => void;
}

export function ChoiceSheet<T extends string>({
	title,
	open,
	value,
	options,
	onValueChange,
	onOpenChange,
}: ChoiceSheetProps<T>) {
	return (
		<Sheet title={title} open={open} onOpenChange={onOpenChange}>
			<ChoiceGroup value={value} onValueChange={onValueChange}>
				{options.map((option) => (
					<ChoiceOption
						key={option.value}
						label={option.label}
						note={option.note}
						value={option.value}
						selected={option.value === value}
						disabled={option.disabled}
					/>
				))}
			</ChoiceGroup>
		</Sheet>
	);
}
