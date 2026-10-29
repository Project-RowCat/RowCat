import type { ChatPersona } from "@rowcat/chat";
import { CHAT_PERSONA_NAME_MAX_LENGTH } from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	Button,
	DialogActions,
	Input,
	Notice,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	PERSONA_DELETE_FAILURE_MESSAGE,
	PERSONA_DELETE_NOTICE,
	PERSONA_NAME_COUNTER_THRESHOLD,
	PERSONA_SAVE_FAILURE_MESSAGE,
	personaTextLength,
	planPersonaSave,
} from "./persona-form.ts";

/**
 * The **surface** that creates or edits a persona, not a dialog.
 *
 * This is what separates it from `PersonaFormDialog`. That one opens its own dialog; this one is
 * entered as a **surface of a dialog that is already open** (the persona surface of room settings,
 * and the pick-before-start dialog on the work detail screen). Stacking dialogs on native gives two
 * owners of accessibility focus, and it becomes unpredictable which one Android's back gesture
 * closes. The web app also swaps content rather than stacking dialogs in the same spot
 * (`features/persona/persona-editor.tsx`).
 *
 * ## Why it came out of the conversation folder
 *
 * While room settings was the only consumer, the location was right. The pick-before-start dialog
 * on the work detail screen became a second consumer, and the work folder then imported a form from
 * the conversation folder. That import direction says "the library is a child of conversation", but
 * this value is the opposite: a persona library entry is an **account asset** (`@rowcat/chat`'s
 * `persona.ts`). The mutations already live here for the same reason (`persona-mutations.ts`).
 */

/**
 * The surface for **creating or editing a persona**.
 *
 * On a successful save, the value is **applied to this conversation right away** (`onSaved`). A
 * flow that creates it and then makes the user pick it again repeats what they just did, with an
 * extra screen in between that does nothing.
 *
 * Deletion ends in **one confirmation inside the row** (the memory list reached the same decision).
 * A second dialog would blur which target Android's back gesture acts on, and this surface is
 * already inside a dialog.
 */
export function PersonaEditor({
	persona,
	onSave,
	onDelete,
	onCancel,
}: {
	/** The persona to edit. `null` creates a new one. */
	persona: ChatPersona | null;
	onSave: (input: { name: string; description: string }) => Promise<unknown>;
	/** Nothing to delete while creating; not passed in that case. */
	onDelete?: (() => Promise<unknown>) | undefined;
	onCancel: () => void;
}) {
	const [name, setName] = useState(persona?.name ?? "");
	const [description, setDescription] = useState(persona?.description ?? "");
	const [error, setError] = useState<string | null>(null);
	const [invalidField, setInvalidField] = useState<
		"name" | "description" | null
	>(null);
	const [pending, setPending] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const pendingRef = useRef(false);

	const nameLength = personaTextLength(name);

	const submit = () => {
		if (pendingRef.current) return;
		const plan = planPersonaSave(
			{ name, description },
			persona ? { name: persona.name, description: persona.description } : null,
		);
		if (plan.kind === "invalid") {
			setInvalidField(plan.field);
			return setError(plan.message);
		}
		/** If nothing changed, **return without writing** so no revision is spent. */
		if (plan.kind === "unchanged") return onCancel();

		pendingRef.current = true;
		setPending(true);
		setError(null);
		setInvalidField(null);
		void onSave({ name: plan.name, description: plan.description }).catch(
			() => {
				pendingRef.current = false;
				setPending(false);
				setError(PERSONA_SAVE_FAILURE_MESSAGE);
			},
		);
	};

	return (
		<View style={styles.root}>
			<Input
				label="Name"
				value={name}
				onChangeText={(next) => {
					setName(next);
					setError(null);
					setInvalidField(null);
				}}
				autoFocus
				/*
				 * No `maxLength`. With one, exceeding the limit is never expressed, so the guidance sentence is
				 * never drawn and the user sees a field where characters silently vanish.
				 */
				invalid={invalidField === "name"}
			/>
			{nameLength >= PERSONA_NAME_COUNTER_THRESHOLD ? (
				<Text variant="caption" tone="muted-foreground">
					{nameLength} / {CHAT_PERSONA_NAME_MAX_LENGTH}
				</Text>
			) : null}

			<Textarea
				label="Description"
				value={description}
				onChangeText={(next) => {
					setDescription(next);
					setError(null);
					setInvalidField(null);
				}}
				invalid={invalidField === "description"}
				style={styles.description}
			/>

			{error ? <Notice tone="destructive" message={error} /> : null}

			<DialogActions>
				<Button
					label="Cancel"
					variant="outline"
					fullWidth
					onPress={onCancel}
					style={styles.action}
				/>
				<Button
					label="Save"
					fullWidth
					onPress={submit}
					busy={pending}
					style={styles.action}
				/>
			</DialogActions>

			{onDelete ? (
				confirming ? (
					<View style={styles.confirm}>
						<Text
							accessibilityRole="alert"
							variant="label"
							tone="muted-foreground"
							style={styles.confirmText}
						>
							{PERSONA_DELETE_NOTICE}
						</Text>
						<Button
							label="Cancel"
							variant="outline"
							size="sm"
							onPress={() => setConfirming(false)}
						/>
						<Button
							label="Delete"
							variant="destructive"
							size="sm"
							onPress={() => {
								setConfirming(false);
								void onDelete().catch(() =>
									setError(PERSONA_DELETE_FAILURE_MESSAGE),
								);
							}}
						/>
					</View>
				) : (
					<Button
						label="Delete this persona"
						variant="ghost"
						fullWidth
						onPress={() => setConfirming(true)}
					/>
				)
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md },
	description: { minHeight: 120 },
	/** Fills the row in the vertically stacked action group; replaces `flex: 1` of a horizontal row. */
	action: { alignSelf: "stretch" },
	confirm: { flexDirection: "row", alignItems: "center", gap: space.xs },
	confirmText: { flex: 1 },
});
