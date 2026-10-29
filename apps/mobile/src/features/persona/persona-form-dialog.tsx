import type { ChatPersona } from "@rowcat/chat";
import {
	CHAT_PERSONA_DESCRIPTION_MAX_LENGTH,
	CHAT_PERSONA_NAME_MAX_LENGTH,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Input,
	Notice,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	PERSONA_DESCRIPTION_COUNTER_THRESHOLD,
	PERSONA_NAME_COUNTER_THRESHOLD,
	PERSONA_SAVE_FAILURE_MESSAGE,
	personaTextLength,
	planPersonaSave,
} from "./persona-form.ts";
import type { PersonaWriteOutcome } from "./persona-mutations.ts";

/**
 * The **form for creating or editing a persona**. It has two fields, so it is a `Dialog` (the slot
 * in the presentation table).
 *
 * It is not `size="full"` because the content is short (a name line and a description box). On a
 * short device, when the keyboard rises, `KeyboardLayout` already adjusts the dialog geometry. This
 * differs from places like the report form, which holds an eleven-row list.
 *
 * ## Validation is done by `@rowcat/chat`; the copy lives in `persona-form.ts`
 *
 * Length is not counted again here. `planPersonaSave` alone judges the empty name, the name limit
 * and the description limit, and it also says which field gets the guidance. If this file rewrote
 * that judgement, the web and this app would disagree about what "too long a name" means.
 *
 * ## `maxLength` is not set
 *
 * With it, exceeding the limit is never expressed, so the guidance sentence is never drawn and the
 * user sees a field where the end of a pasted sentence silently disappears. Instead, the character
 * count appears only when the limit is near.
 *
 * ## A second submit in the same tick is rejected
 *
 * `pending` is true only after a render has arrived. If two fingers hit the button in the same
 * frame, both checks see false, and the same persona would be created twice, so the guard is a ref.
 */
export function PersonaFormDialog({
	persona,
	pending,
	onSave,
	onCancel,
}: {
	/** The persona to edit. `null` creates a new one. */
	persona: ChatPersona | null;
	pending: boolean;
	/**
	 * Saves. **A rejection is a failure**, and only then does this form draw a message.
	 *
	 * `foreign` is not a failure: the viewer changed and nothing happened, so the caller closes
	 * quietly (this form does not draw that value differently).
	 */
	onSave: (input: {
		name: string;
		description: string;
	}) => Promise<PersonaWriteOutcome>;
	onCancel: () => void;
}) {
	const [name, setName] = useState(persona?.name ?? "");
	const [description, setDescription] = useState(persona?.description ?? "");
	const [error, setError] = useState<string | null>(null);
	const [invalidField, setInvalidField] = useState<
		"name" | "description" | null
	>(null);
	const submittingRef = useRef(false);

	const nameLength = personaTextLength(name);
	const descriptionLength = personaTextLength(description);

	const submit = (): void => {
		if (submittingRef.current) return;
		const plan = planPersonaSave(
			{ name, description },
			persona ? { name: persona.name, description: persona.description } : null,
		);
		if (plan.kind === "invalid") {
			setInvalidField(plan.field);
			setError(plan.message);
			return;
		}
		/** If nothing changed, **close without writing**: an edit issues a revision. */
		if (plan.kind === "unchanged") {
			onCancel();
			return;
		}

		submittingRef.current = true;
		setError(null);
		setInvalidField(null);
		void onSave({ name: plan.name, description: plan.description })
			.then(() => {
				submittingRef.current = false;
			})
			.catch(() => {
				submittingRef.current = false;
				setError(PERSONA_SAVE_FAILURE_MESSAGE);
			});
	};

	return (
		<Dialog
			open
			title={persona ? "Edit persona" : "New persona"}
			onOpenChange={(next) => {
				if (!next && !pending) onCancel();
			}}
		>
			<View style={form.root}>
				<Input
					label="Name"
					value={name}
					onChangeText={(next) => {
						setName(next);
						setError(null);
						setInvalidField(null);
					}}
					autoFocus
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
					style={form.description}
				/>
				{descriptionLength >= PERSONA_DESCRIPTION_COUNTER_THRESHOLD ? (
					<Text variant="caption" tone="muted-foreground">
						{descriptionLength} / {CHAT_PERSONA_DESCRIPTION_MAX_LENGTH}
					</Text>
				) : null}

				{/** Failures stay **inside the dialog**: reporting after closing could not say what was not saved. */}
				{error ? <Notice tone="destructive" message={error} /> : null}

				<DialogActions>
					<Button
						label="Cancel"
						variant="outline"
						fullWidth
						onPress={onCancel}
						style={form.action}
					/>
					<Button
						label="Save"
						fullWidth
						busy={pending}
						onPress={submit}
						style={form.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const form = StyleSheet.create({
	root: { gap: space.md },
	description: { minHeight: 120 },
	/** Fills the row in the vertically stacked action group; replaces `flex: 1` of a horizontal row. */
	action: { alignSelf: "stretch" },
});
