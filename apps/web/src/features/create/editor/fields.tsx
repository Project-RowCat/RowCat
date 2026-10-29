import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Switch } from "@rowcat/ui-web/components/switch";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import * as m from "motion/react-m";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "#/lib/i18n/format.ts";
import { layoutTransition } from "#/lib/motion/transitions.ts";
import { useEditedValue } from "./edited-value.ts";

/**
 * A single input field in the editor.
 *
 * The layer is thin on purpose: it handles only layout and accessibility wiring (labels,
 * descriptions, character counts). Where a value is stored and when it is saved are decided by the
 * caller (useDraftAutosave). If this layer learned about saving, every field would need its own
 * save rules and the layer would have to be torn out.
 *
 * Values are controlled because the local record also changes off-screen (edits from another tab,
 * later sync). An uncontrolled input would not reflect those changes.
 *
 * The record itself is not drawn directly. Autosave updates it 500ms later, so typing in that gap
 * is not yet in the record. Using the record as the value would move the caret to the end on every
 * save, erase characters typed in the gap, and break Korean composition. The rule where the screen
 * leads and the record follows lives in edited-value.ts.
 */

export interface FieldFrameProps {
	label: string;
	/**
	 * One line below the label, for saying why the value is needed. Without it, inputs appear with no
	 * explanation.
	 */
	hint?: string;
	count?: { length: number; max: number };
	htmlFor: string;
	/**
	 * Root id for the descriptions this field draws. The caller computes the value the control points
	 * to with aria-describedby (see fieldDescribedBy) and passes it in, because the frame cannot
	 * attach it to the control itself: children may be any node.
	 */
	hintId: string;
	overflowId: string;
	/**
	 * One action at the right end of the label row. Only actions that change how the field is viewed
	 * belong here, such as `Edit full screen`.
	 *
	 * Actions that change the value do not belong here. They go on the control itself or in the
	 * section header. A value-changing button in the label row would read as part of the field's name.
	 */
	action?: ReactNode;
	children: ReactNode;
}

/**
 * Label, control and description as one unit.
 *
 * An overflow is not reported by the number alone. Going over the limit used to turn the character
 * count red, a signal that a user who does not look at the screen never receives. This editor has
 * no maxLength (so pasted text is not silently cut), which meant over-limit values could reach
 * publication. Three things now appear together: the red count, one sentence, and aria-invalid on
 * the control.
 *
 * The sentence does not decide publication. The final check stays with publication validation and
 * the server (prepareStoryPublication); this only states a fact about the current value. The limit
 * is the value the caller reads from the contract.
 */
export function FieldFrame({
	label,
	hint,
	count,
	htmlFor,
	hintId,
	overflowId,
	action,
	children,
}: FieldFrameProps) {
	const { t } = useTranslation("create");
	const over = count ? count.length > count.max : false;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<Label htmlFor={htmlFor}>{label}</Label>
				{/*
				 * The right end is a single unit. The character count and an action can both sit there, but they
				 * stay together as one group on the opposite side of the label. As separate justify-between
				 * children, all three would spread evenly and pull the action next to the label.
				 */}
				{(count || action) && (
					<div className="flex shrink-0 items-center gap-2">
						{count && (
							<span
								className={
									over
										? "text-xs font-medium text-destructive"
										: "text-xs text-muted-foreground"
								}
							>
								{formatNumber(count.length)} / {formatNumber(count.max)}
							</span>
						)}
						{action}
					</div>
				)}
			</div>
			{children}
			{/*
			 * The overflow sentence comes first: it is the fact that needs fixing now, and the hint stays
			 * below it. The control points to both, so the reading order matches.
			 *
			 * No role="alert" here. The sentence flips true and false with every keystroke near the limit, so
			 * announcing it each time would be disruptive rather than informative. aria-invalid already speaks
			 * when focus reaches the control (the overlap warning on situation images made the same call).
			 */}
			{count && over && (
				<p id={overflowId} className="text-xs font-medium text-destructive">
					{t("fields.overflow", {
						count: formatNumber(count.length - count.max),
					})}
				</p>
			)}
			{hint && (
				<p id={hintId} className="text-xs text-muted-foreground">
					{hint}
				</p>
			)}
		</div>
	);
}

/**
 * Points only at the descriptions that are rendered right now.
 *
 * The conditions are counted in one place so they cannot drift from the render conditions. If they
 * did, an id would point at a missing element, which assistive technology hears as the description
 * disappearing entirely, with no visible difference. The intro field on the account screen uses the
 * same function.
 */
export function fieldDescribedBy(
	parts: readonly (string | false | null | undefined)[],
): string | undefined {
	const shown = parts.filter((part): part is string => Boolean(part));
	return shown.length > 0 ? shown.join(" ") : undefined;
}

export interface TextFieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	hint?: string;
	placeholder?: string;
	max?: number;
}

export function TextField({
	label,
	value,
	onChange,
	hint,
	placeholder,
	max,
}: TextFieldProps) {
	const id = useId();
	const hintId = `${id}-hint`;
	const overflowId = `${id}-overflow`;
	const [text, edit] = useEditedValue(value, onChange);
	const over = max !== undefined && text.length > max;
	return (
		<FieldFrame
			label={label}
			hint={hint}
			htmlFor={id}
			hintId={hintId}
			overflowId={overflowId}
			/**
			 * The count also uses the on-screen value. A number taken from the record, which waits on
			 * autosave, would not count the character just typed.
			 */
			count={max ? { length: text.length, max } : undefined}
		>
			<Input
				id={id}
				value={text}
				placeholder={placeholder}
				aria-invalid={over || undefined}
				aria-describedby={fieldDescribedBy([
					over && overflowId,
					hint && hintId,
				])}
				onChange={(event) => edit(event.target.value)}
			/>
		</FieldFrame>
	);
}

export interface TextAreaFieldProps extends TextFieldProps {
	/** Minimum number of rows. Growth with the content is left to the component. */
	rows?: number;
}

export function TextAreaField({
	label,
	value,
	onChange,
	hint,
	placeholder,
	max,
	rows = 4,
}: TextAreaFieldProps) {
	const id = useId();
	const hintId = `${id}-hint`;
	const overflowId = `${id}-overflow`;
	const [text, edit] = useEditedValue(value, onChange);
	const over = max !== undefined && text.length > max;
	return (
		<FieldFrame
			label={label}
			hint={hint}
			htmlFor={id}
			hintId={hintId}
			overflowId={overflowId}
			count={max ? { length: text.length, max } : undefined}
		>
			<Textarea
				id={id}
				rows={rows}
				value={text}
				placeholder={placeholder}
				aria-invalid={over || undefined}
				aria-describedby={fieldDescribedBy([
					over && overflowId,
					hint && hintId,
				])}
				onChange={(event) => edit(event.target.value)}
			/>
		</FieldFrame>
	);
}

export interface SwitchFieldProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	hint?: string;
	disabled?: boolean;
	/**
	 * The reason the control cannot be changed. When present it is shown in place of `hint`, so a
	 * locked control always says why.
	 */
	disabledReason?: string;
}

export function SwitchField({
	label,
	checked,
	onChange,
	hint,
	disabled,
	disabledReason,
}: SwitchFieldProps) {
	const id = useId();
	/**
	 * Same rule as the text box: the screen leads and the record follows.
	 *
	 * The switch is also a controlled component, so `checked` comes from the record, which autosave
	 * updates 500ms later. Drawing it straight from the record would make it move when the save
	 * arrives instead of when the user presses it. The first press would look ignored, the user would
	 * press again, and that second press would turn off what the first one had just turned on. Typing
	 * hid this for a long time only because no caret or composition was involved; the cause is the
	 * same.
	 */
	const [on, toggle] = useEditedValue(checked, onChange);
	const noteId = `${id}-note`;
	const note = disabled && disabledReason ? disabledReason : hint;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor={id}>{label}</Label>
				{/*
				 * The description is attached to the switch, especially when it is locked. A grey sentence next to
				 * a locked switch is effectively absent for a user who does not see the screen, which would leave
				 * only a control that will not turn on, with no reason given.
				 */}
				<Switch
					id={id}
					checked={on}
					disabled={disabled}
					aria-describedby={note ? noteId : undefined}
					onCheckedChange={toggle}
				/>
			</div>
			{note && (
				<p id={noteId} className="text-xs text-muted-foreground">
					{note}
				</p>
			)}
		</div>
	);
}

/**
 * One section of the editor. The title and description sit in the same place, so long forms do not
 * lose the user.
 */
export function EditorSection({
	title,
	description,
	action,
	layoutDependency,
	children,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	/**
	 * Marks the section's structure: geometry is re-measured only when this value changes. Without it,
	 * Motion re-measures on every render, so typing (growing text boxes, autosave arrivals) would
	 * trigger layout work and sections sliding down 0.5 seconds after typing stops. The value should
	 * be what actually relays the section out (item count, order, presence), not the character count.
	 * Sections whose structure never changes pass a fixed value, and they still flow with their
	 * siblings via LayoutGroup.
	 */
	layoutDependency?: unknown;
	children: ReactNode;
}) {
	return (
		/*
		 * Animates only a section's change of position, not its size; animating size would scale the text
		 * inside during the 180ms transition. Structural changes (adding a lore entry pushes the sections
		 * below down, deleting pulls them up) are linked to the button press that caused them. Typing is
		 * excluded: layoutDependency is what keeps the growing text box from triggering the same
		 * movement.
		 */
		<m.section
			layout="position"
			layoutDependency={layoutDependency}
			transition={layoutTransition}
			className="rounded-lg border bg-card p-4 sm:p-5"
		>
			<header className="mb-4 flex items-start justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold">{title}</h2>
					{description && (
						<p className="mt-0.5 text-xs text-muted-foreground">
							{description}
						</p>
					)}
				</div>
				{action}
			</header>
			<div className="flex flex-col gap-4">{children}</div>
		</m.section>
	);
}

/**
 * Placeholder for a section that has not opened yet: the card shell, title and description are
 * real, and only the action slot and body are grey. It replaces one oversized grey box that was the
 * most conspicuous element on the screen. The add button is deliberately not drawn: pressing it
 * before storage opens would act on nothing, and a disabled button could not explain why it is
 * locked. There is no layout or layoutDependency. The skeleton is swapped for the real section, and
 * the editor's LayoutGroup carries that swap into the flow.
 */
export function EditorSectionSkeleton({
	title,
	description,
	action = true,
	children,
}: {
	title: string;
	description: string;
	/** Whether the header carries an action such as `Add`. If not, no space is reserved for one. */
	action?: boolean;
	/**
	 * Body. When omitted, only one line's height is reserved: child lists are usually empty (a draft
	 * can be published with no lore or start scenes), and what actually shows is a single hint line.
	 * Imitating several cards would make the section shrink when the real values arrive.
	 */
	children?: ReactNode;
}) {
	return (
		<section
			className="rounded-lg border bg-card p-4 sm:p-5"
			aria-hidden="true"
		>
			<header className="mb-4 flex items-start justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold">{title}</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
				</div>
				{/* Space of a size="sm" button (h-8). The width matches a single `+ Add` label. */}
				{action && <Skeleton className="h-8 w-20 shrink-0" />}
			</header>
			{children ?? <Skeleton className="h-5 w-2/3 max-w-md" />}
		</section>
	);
}
