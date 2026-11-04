import type { GenerationTarget } from "@rowcat/chat";
import {
	checkOpenRouterModel,
	checkOpenRouterUpstream,
	withOpenRouterUpstream,
} from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Input, Text } from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	OPENROUTER_CUSTOM_MODEL_FIELD,
	OPENROUTER_UPSTREAM_FIELD,
} from "./labels.ts";

type OpenRouterTarget = Extract<
	GenerationTarget,
	{ provider: "openrouter-byo" }
>;

/**
 * Two typed fields under an OpenRouter model select: the model id, and the model provider. Every
 * screen that draws a generation target puts them under its model select — the web's
 * `OpenRouterTargetFields` is the pair.
 *
 * The gateway routes far more models than the catalogue lists, so the model id is editable: it shows
 * the id of whatever is chosen and any `vendor/model` typed there becomes the target's model. The model
 * provider is the gateway's provider slug for that model; empty means the gateway chooses. The rules are
 * `@rowcat/chat`'s (`openrouter.ts`), shared with the web.
 *
 * The caller decides when they stand (`openRouterFieldsStand`). Both save on commit (leaving the field
 * or the keyboard's done key), not per keystroke; a refused value is said under its field and not saved.
 * Changing the model drops the provider (it was pinned for the other model). They never touch a store;
 * they lift a whole target.
 */

/** Whether the fields stand for this layer's own value. One rule for every screen. */
export function openRouterFieldsStand(
	value: GenerationTarget | null,
	connected: readonly string[],
): value is OpenRouterTarget {
	return (
		value?.provider === "openrouter-byo" && connected.includes("openrouter-byo")
	);
}

export function OpenRouterTargetFields({
	label,
	target,
	disabled,
	onChange,
}: {
	/** The outer field title, read with each field's name (`Generation target model ID`). */
	label: string;
	target: OpenRouterTarget;
	disabled?: boolean;
	onChange: (next: GenerationTarget) => void;
}) {
	return (
		<>
			<CommitField
				name={`${label} ${OPENROUTER_CUSTOM_MODEL_FIELD.label}`}
				copy={OPENROUTER_CUSTOM_MODEL_FIELD}
				stored={target.model}
				disabled={disabled}
				commit={(draft) => {
					const checked = checkOpenRouterModel(draft);
					if (!checked.ok) return null;
					if (checked.model !== target.model)
						onChange({ provider: target.provider, model: checked.model });
					return checked.model;
				}}
			/>
			<CommitField
				name={`${label} ${OPENROUTER_UPSTREAM_FIELD.label}`}
				copy={OPENROUTER_UPSTREAM_FIELD}
				stored={target.upstream ?? ""}
				disabled={disabled}
				commit={(draft) => {
					const checked = checkOpenRouterUpstream(draft);
					if (!checked.ok) return null;
					if (checked.upstream !== (target.upstream ?? null))
						onChange(withOpenRouterUpstream(target, checked.upstream));
					return checked.upstream ?? "";
				}}
			/>
		</>
	);
}

/** A text field that commits on blur or done; `commit` returns the text to show, or `null` if refused. */
function CommitField({
	name,
	copy,
	stored,
	disabled,
	commit,
}: {
	name: string;
	copy: {
		label: string;
		placeholder: string;
		hint: string;
		invalid: string;
	};
	stored: string;
	disabled?: boolean;
	commit: (draft: string) => string | null;
}) {
	const [draft, setDraft] = useState(stored);
	const [invalid, setInvalid] = useState(false);
	/**
	 * The draft follows the stored value when it changes underneath (another model picked, the room
	 * inheriting again). Adjusted during render, so the field never draws the old value beside the new.
	 */
	const [seen, setSeen] = useState(stored);
	if (seen !== stored) {
		setSeen(stored);
		setDraft(stored);
		setInvalid(false);
	}

	const submit = (): void => {
		const shown = commit(draft);
		if (shown === null) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		setDraft(shown);
	};

	return (
		<View style={styles.field}>
			<Text variant="caption" tone="muted-foreground">
				{copy.label}
			</Text>
			<Input
				label={name}
				labelHidden
				placeholder={copy.placeholder}
				value={draft}
				onChangeText={(next) => {
					setDraft(next);
					if (invalid) setInvalid(false);
				}}
				onBlur={submit}
				onSubmitEditing={submit}
				returnKeyType="done"
				autoCapitalize="none"
				autoCorrect={false}
				autoComplete="off"
				editable={!disabled}
				invalid={invalid}
			/>
			<Text variant="label" tone="muted-foreground">
				{copy.hint}
			</Text>
			{invalid ? (
				<Text variant="label" tone="destructive" accessibilityRole="alert">
					{copy.invalid}
				</Text>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	field: { gap: space.xs },
});
