import {
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	CHAT_PERSONA_NAME_MAX_LENGTH,
	type ChatPersonaSnapshot,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Input } from "@rowcat/ui-web/components/input";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import {
	PERSONA_DESCRIPTION_COUNTER_THRESHOLD,
	PERSONA_NAME_COUNTER_THRESHOLD,
	type PersonaFormField,
	personaTextLength,
	planPersonaSave,
} from "./persona-form.ts";

/**
 * PersonaEditor is the same form for create and edit. Two versions would diverge on limits,
 * counting, validation timing and focus rules, and each divergence would show on only one path (the
 * memory form made the same decision). Only the button label differs, so it is passed in.
 *
 * There are two consumers: the library dialog and room settings. The form therefore does not draw a
 * container. The window and its title belong to the caller. This component is two fields and two
 * buttons.
 *
 * Failures stay inside the form, not in a toast. The form stays open after a failure with the text
 * intact, and the next action is on this screen. Sending the message out would show the same
 * failure in two places (inline and toast), or only after closing the window
 * (docs/design/FAILURE-FEEDBACK.md).
 *
 * There is no success toast. Closing the window and the list change already say that it worked.
 */

export function PersonaEditor({
	initial,
	submitLabel,
	pending,
	failure,
	onCancel,
	onSubmit,
}: {
	/**
	 * The current value of the item being edited. Null means create, in which case `unchanged` never
	 * occurs.
	 */
	initial: ChatPersonaSnapshot | null;
	submitLabel: string;
	pending: boolean;
	/**
	 * A save failure is a message owned by the caller. The form does not set it, because save failures
	 * differ by caller (saving in the library, applying to a room). Validation failures belong to the
	 * form, because the check happens here.
	 */
	failure: string | null;
	onCancel: () => void;
	onSubmit: (value: { name: string; description: string }) => void;
}) {
	const { t } = useTranslation(["persona", "common"]);
	const [name, setName] = useState(initial?.name ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [invalid, setInvalid] = useState<{
		field: PersonaFormField;
		message: string;
	} | null>(null);

	const nameId = useId();
	const descriptionId = useId();
	const errorId = useId();
	const nameRef = useRef<HTMLInputElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	/** Blocks a second submit within the same tick. Double-pressing a button really happens. */
	const pendingRef = useRef(false);

	useEffect(() => {
		const frame = requestAnimationFrame(() => nameRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);

	const nameLength = personaTextLength(name);
	const descriptionLength = personaTextLength(description);

	const submit = (): void => {
		if (pendingRef.current || pending) return;
		const plan = planPersonaSave({ name, description }, initial);
		if (plan.kind === "invalid") {
			setInvalid({ field: plan.field, message: plan.message });
			/*
			 * Focus moves to the field that is wrong. Which field that is was already answered by the pure
			 * plan (PersonaPlan.field), so it is not judged again here. Judging it in two places would
			 * eventually send focus to a correct field.
			 */
			(plan.field === "name" ? nameRef : descriptionRef).current?.focus();
			return;
		}
		/** If nothing changed, close without saving. An edit issues a new revision. */
		if (plan.kind === "unchanged") {
			onCancel();
			return;
		}

		pendingRef.current = true;
		setInvalid(null);
		try {
			onSubmit({ name: plan.name, description: plan.description });
		} finally {
			pendingRef.current = false;
		}
	};

	const clearInvalid = (): void => {
		if (invalid) setInvalid(null);
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				{/* The label is a real <label>. A placeholder alone would make the name disappear while typing. */}
				<label htmlFor={nameId} className="font-medium text-sm">
					{t("editor.name")}
				</label>
				<Input
					id={nameId}
					ref={nameRef}
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						clearInvalid();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submit();
						}
					}}
					/*
					 * No maxLength attribute. Setting it would stop input at the limit, so the over-limit message
					 * would never appear, and the user would see characters silently vanish.
					 */
					aria-invalid={invalid?.field === "name"}
					aria-describedby={invalid?.field === "name" ? errorId : undefined}
					disabled={pending}
					placeholder={t("editor.namePlaceholder")}
				/>
				{nameLength > PERSONA_NAME_COUNTER_THRESHOLD && (
					<span
						className={`self-end text-xs tabular-nums ${
							nameLength > CHAT_PERSONA_NAME_MAX_LENGTH
								? "text-destructive"
								: "text-muted-foreground"
						}`}
					>
						<AnimatedCount value={String(nameLength)} cadence="continuous" />/
						{CHAT_PERSONA_NAME_MAX_LENGTH}
					</span>
				)}
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor={descriptionId} className="font-medium text-sm">
					{t("editor.description")}
				</label>
				<Textarea
					id={descriptionId}
					ref={descriptionRef}
					rows={5}
					value={description}
					onChange={(event) => {
						setDescription(event.target.value);
						clearInvalid();
					}}
					onKeyDown={(event) => {
						/**
						 * Enter inserts a newline, because role settings are text where lines are items. Saving is
						 * Ctrl or Cmd + Enter, or the button.
						 */
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							submit();
						}
					}}
					aria-invalid={invalid?.field === "description"}
					aria-describedby={
						invalid?.field === "description" ? errorId : undefined
					}
					disabled={pending}
					placeholder={t("editor.descriptionPlaceholder")}
				/>
				{descriptionLength > PERSONA_DESCRIPTION_COUNTER_THRESHOLD && (
					<span
						className={`self-end text-xs tabular-nums ${
							descriptionLength > CHAT_PERSONA_DESCRIPTION_MAX_LENGTH
								? "text-destructive"
								: "text-muted-foreground"
						}`}
					>
						<AnimatedCount
							value={String(descriptionLength)}
							cadence="continuous"
						/>
						/{CHAT_PERSONA_DESCRIPTION_MAX_LENGTH}
					</span>
				)}
			</div>

			{/*
			 * One message per window. Validation and save failures are mutually exclusive, but the point is
			 * that
			 * they appear in the same place. Split across two places, the user may miss one of them.
			 */}
			{(invalid ?? failure) && (
				<p id={errorId} role="alert" className="text-destructive text-sm">
					{invalid?.message ?? failure}
				</p>
			)}

			<div className="flex justify-end gap-2">
				<Button variant="outline" onClick={onCancel} disabled={pending}>
					{t("common:actions.cancel")}
				</Button>
				<Button onClick={submit} disabled={pending}>
					{pending ? t("editor.saving") : submitLabel}
				</Button>
			</div>
		</div>
	);
}
