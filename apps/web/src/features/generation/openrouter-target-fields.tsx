import type { GenerationTarget } from "@rowcat/chat";
import {
	checkOpenRouterModel,
	checkOpenRouterUpstream,
	withOpenRouterUpstream,
} from "@rowcat/chat";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SELECT_TRIGGER_HEIGHT } from "#/lib/control-geometry.ts";

type OpenRouterTarget = Extract<
	GenerationTarget,
	{ provider: "openrouter-byo" }
>;

/**
 * Two typed fields under an OpenRouter model select: the model id, and the model provider.
 *
 * The gateway routes far more models than the catalogue lists, so the model id is editable: it shows
 * the id of whatever is chosen (a catalogue pick shows its slug) and any `vendor/model` typed there
 * becomes the target's model. The model provider is the gateway's provider slug for that model; empty
 * means the gateway chooses. The rules are `@rowcat/chat`'s (`openrouter.ts`), the same ones the mobile
 * fields call.
 *
 * Drawn by `ModelTargetField` only for an OpenRouter target this layer chose (an inherited target is
 * the parent's) and only while OpenRouter is connected.
 *
 * Both save on commit (leaving the field or Enter), not per keystroke: a half-typed id or slug would be
 * stored for the instant before the next character. A value the rule refuses is said under its field
 * and not saved. Changing the model drops the provider (it was pinned for the other model). Like the
 * other columns they never touch a store; they lift a whole target.
 */
export function OpenRouterTargetFields({
	target,
	titleId,
	describedBy,
	disabled,
	onChange,
}: {
	target: OpenRouterTarget;
	/** The row title's id, so each field's name reads `Generation target Model ID`. */
	titleId: string;
	describedBy: string | undefined;
	disabled?: boolean;
	onChange: (value: GenerationTarget) => void;
}) {
	const { t } = useTranslation("generation");
	return (
		<>
			<CommitField
				id={`${titleId}-custom-model`}
				titleId={titleId}
				describedBy={describedBy}
				disabled={disabled}
				label={t("target.customModel")}
				placeholder="qwen/qwen3-max"
				hint={t("target.customModelHint")}
				invalidMessage={t("target.customModelInvalid")}
				stored={target.model}
				commit={(draft) => {
					const checked = checkOpenRouterModel(draft);
					if (!checked.ok) return null;
					if (checked.model !== target.model)
						onChange({ provider: target.provider, model: checked.model });
					return checked.model;
				}}
			/>
			<CommitField
				id={`${titleId}-upstream`}
				titleId={titleId}
				describedBy={describedBy}
				disabled={disabled}
				label={t("target.upstream")}
				placeholder={t("target.upstreamPlaceholder")}
				hint={t("target.upstreamHint")}
				invalidMessage={t("target.upstreamInvalid")}
				stored={target.upstream ?? ""}
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

/**
 * A text field that commits on blur or Enter. `commit` returns the canonical text to show, or `null`
 * for a refused value (the field then says so and keeps what was typed).
 */
function CommitField({
	id,
	titleId,
	describedBy,
	disabled,
	label,
	placeholder,
	hint,
	invalidMessage,
	stored,
	commit,
}: {
	id: string;
	titleId: string;
	describedBy: string | undefined;
	disabled?: boolean;
	label: string;
	placeholder: string;
	hint: string;
	invalidMessage: string;
	stored: string;
	commit: (draft: string) => string | null;
}) {
	const labelId = `${id}-label`;
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	const [draft, setDraft] = useState(stored);
	const [invalid, setInvalid] = useState(false);
	/**
	 * The draft follows the stored value when it changes underneath (another model picked in the select,
	 * another tab, the room inheriting again). Adjusted during render rather than in an effect, so the
	 * field never draws one frame of the old value beside the new one.
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
		<div className="flex flex-col gap-1">
			<Label
				htmlFor={id}
				id={labelId}
				className="text-xs font-normal text-muted-foreground"
			>
				{label}
			</Label>
			<Input
				id={id}
				value={draft}
				placeholder={placeholder}
				autoComplete="off"
				autoCapitalize="none"
				spellCheck={false}
				disabled={disabled}
				aria-labelledby={`${titleId} ${labelId}`}
				aria-describedby={
					[describedBy, hintId, invalid ? errorId : null]
						.filter(Boolean)
						.join(" ") || undefined
				}
				aria-invalid={invalid || undefined}
				className={cn(SELECT_TRIGGER_HEIGHT, "w-full")}
				onChange={(event) => {
					setDraft(event.target.value);
					if (invalid) setInvalid(false);
				}}
				onBlur={submit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						submit();
					}
				}}
			/>
			<p id={hintId} className="text-xs text-muted-foreground">
				{hint}
			</p>
			{invalid && (
				<p id={errorId} role="alert" className="text-sm text-destructive">
					{invalidMessage}
				</p>
			)}
		</div>
	);
}
