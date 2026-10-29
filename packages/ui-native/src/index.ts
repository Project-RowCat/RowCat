/**
 * `@rowcat/ui-native` is the presentation layer only: reusable primitives whose colors, spacing,
 * type and radii come from `@rowcat/design`. It does not own product concepts (stories, chat rooms,
 * viewers), data access, or navigation. Feature assembly lives in `apps/mobile/src/features/`.
 *
 * Web and native share decisions (color meaning, radius, type hierarchy, spacing rhythm, control
 * hierarchy, state vocabulary, icon meaning), not render code. A single Button for both DOM and RN
 * would lower quality on both.
 *
 * This list of presentation containers is the policy. Feature code may only use these:
 * - Trigger-bound action menu: DropdownMenu, MenuItem, MenuSeparator.
 * - Trigger-bound single value: Select, SelectOption, SelectGroupLabel.
 * - Trigger-bound axis choice: MenuLabel, MenuRadioGroup, MenuRadioItem, MenuCheckboxItem.
 * - One-field form or read-only detail: Dialog. Long form or small management screen: Dialog
 *   size="full".
 * - Narrow-screen panel anchored to the bottom: Dialog placement="adaptive".
 * - Irreversible confirmation: AlertDialog.
 * - Short single choice as a sheet: ChoiceSheet, which takes no children.
 * - Inline pick list inside a form: ChoiceGroup and ChoiceOption, only for a few ordered values.
 * - Global left-edge navigation: NavigationDrawer.
 *
 * The general Sheet is internal and not exported. Anchoring to the bottom is not what makes
 * something a sheet; the question is whether the upward motion adds value to the interaction.
 * NavigationDrawer takes no placement, size or snapPoints arguments, because fixing edge, height
 * and maximum width is what keeps it outside the Sheet category. Re-exporting Sheet, opening a
 * subpath such as `@rowcat/ui-native/sheet`, or letting ChoiceSheet accept arbitrary nodes is an
 * architecture change, not a component addition. public-api.test.ts and boundaries.test.ts lock
 * these points.
 *
 * Styling uses StyleSheet with typed tokens, not NativeWind (rationale in
 * docs/design/ARCHITECTURE.md).
 */

export { AlertDialog } from "./alert-dialog.tsx";
export { AppBar } from "./app-bar.tsx";
export { Avatar } from "./avatar.tsx";
export { Badge, type BadgeVariant } from "./badge.tsx";
export type { BrandName } from "./brand-mark.tsx";
export {
	Button,
	type ButtonVariant,
	IconButton,
	LinkButton,
} from "./button.tsx";
export { ChoiceGroup, ChoiceOption } from "./choice.tsx";
export {
	ChoiceSheet,
	type ChoiceSheetOption,
	type ChoiceSheetProps,
} from "./choice-sheet.tsx";
export { ComposerArea } from "./composer-area.tsx";
export { Dialog, DialogActions } from "./dialog.tsx";
export type { DialogPlacement } from "./dialog-placement.ts";
export { Icon, type IconName, type IconSize } from "./icon.tsx";
export {
	BareInput,
	Input,
	Textarea,
	type TextareaGrowth,
	type TextFieldHandle,
	type TextFieldSelectionEvent,
} from "./input.tsx";
export { ListRow, ListSection } from "./list.tsx";
export {
	DropdownMenu,
	MenuCheckboxItem,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
} from "./menu.tsx";
export {
	appBarHeight,
	type ControlSize,
	controlHeight,
	targetSlop,
	touchTarget,
} from "./metrics.ts";
export { NavigationDrawer } from "./navigation-drawer.tsx";
export { PortalOutlet } from "./portal.tsx";
export { RemoteImage } from "./remote-image.tsx";
export {
	CenteredArea,
	KeyboardLayout,
	Screen,
	ScrollScreen,
	screenPadding,
} from "./screen.tsx";
export {
	Select,
	SelectGroupLabel,
	SelectOption,
} from "./select.tsx";
export { SelectionFeedbackProvider } from "./selection-feedback.tsx";
export { EmptyState, ErrorState, Notice, Spinner } from "./state.tsx";
export { Card, Panel, Separator } from "./surface.tsx";
export { Switch } from "./switch.tsx";
export { Text, type TextVariant } from "./text.tsx";
export {
	type Theme,
	ThemeColorOverrideProvider,
	type ThemePreference,
	ThemeProvider,
	useBaseTheme,
	useTheme,
} from "./theme.tsx";
