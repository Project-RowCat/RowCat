import type { ResponseLength } from "@rowcat/chat";
import { RESPONSE_LENGTHS } from "@rowcat/chat";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SELECT_TRIGGER_HEIGHT } from "#/lib/control-geometry.ts";
import { translator } from "#/lib/i18n/current.ts";
import { INHERIT_VALUE } from "./model-options.ts";

/**
 * A single row for choosing response length, shared by global settings and room settings.
 *
 * It is not placed separately on each screen because of the meaning of 'inherit'. In either place
 * the first item is 'not chosen', and choosing it clears the override rather than copying the
 * parent's value. If that rule lives in one component, the two screens have no room to diverge.
 * When they do diverge, the symptom appears later: the global changes, but a room left on 'use
 * default' does not follow.
 *
 * This component does not save either. It receives values, draws them, and lifts changes up. Each
 * screen decides which store to write (global uses `setGlobal`, room uses `setRoom`/`clearRoom`).
 * Saving here would make the file know two stores, and the control would cross ownership
 * boundaries.
 */

/** User-facing name. Token counts are not shown because they are not the user's vocabulary. */
export const responseLengthLabel = (length: ResponseLength): string =>
	translator("generation")(`responseLength.${length}`);

export function ResponseLengthField({
	value,
	inheritedLabel,
	description,
	controlClassName = "sm:w-40",
	loading,
	disabled,
	onChange,
}: {
	/** The value this layer picked. `null` means follow the parent. */
	value: ResponseLength | null;
	/**
	 * The name of the value applied when following the parent; it goes in the parenthetical.
	 *
	 * The screen does not compute it. It takes the answer from the priority resolver
	 * (`lib/local-generation/hooks.ts`). Writing a `?? "Standard"` fallback here would create a second rule.
	 */
	inheritedLabel: string;
	description?: string;
	/**
	 * The width of the control column is set by the screen that owns that column, because the
	 * neighbors differ per screen. In settings the generation target (two columns) sits directly
	 * below, so the two rows must start at the same edge. The conversation settings dialog is narrow,
	 * so it gives more room to the name. The default is the previous value, so callers that pass
	 * nothing see no pixel change. On narrow screens the full row is used either way (`w-full`); that
	 * rule stays here.
	 */
	controlClassName?: string;
	/** The stored value has not arrived yet. 'Not chosen' is a different state. */
	loading?: boolean;
	disabled?: boolean;
	onChange: (value: ResponseLength | null) => void;
}) {
	const { t } = useTranslation("generation");
	const id = useId();
	const descriptionId = `${id}-description`;

	/**
	 * The first item is 'not chosen'. It is not labeled `Auto`, because the runtime does not pick
	 * anything dynamically. The parent's value is used as is, and the parenthetical names that value.
	 */
	const options = [
		{ value: INHERIT_VALUE, label: t("inherit", { value: inheritedLabel }) },
		...RESPONSE_LENGTHS.map((length) => ({
			value: length as string,
			label: responseLengthLabel(length),
		})),
	];

	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
			<div className="min-w-0">
				<Label htmlFor={id} className="text-sm font-medium">
					{t("responseLength.label")}
				</Label>
				{description && (
					<p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
						{description}
					</p>
				)}
			</div>

			{/*
			 * Do not draw the choices before the value arrives. Otherwise a user who chose `Long` would see
			 * 'use default' flash each time settings open before switching to their own choice, and could
			 * not tell which value is saved. The placeholder is the same size as the trigger, so the row
			 * does not move when the value arrives.
			 */}
			{loading ? (
				<Skeleton
					className={cn("h-9 w-full shrink-0 sm:h-8", controlClassName)}
				/>
			) : (
				<Select
					/*
					 * Pass `items`, or the trigger draws the value instead of the name. Without it, `SelectValue`
					 * echoes the stored value and `__inherit__` shows.
					 */
					items={options}
					value={value ?? INHERIT_VALUE}
					onValueChange={(next) => {
						if (next === null) return;
						onChange(next === INHERIT_VALUE ? null : (next as ResponseLength));
					}}
					disabled={disabled}
				>
					<SelectTrigger
						id={id}
						size="sm"
						aria-describedby={description ? descriptionId : undefined}
						// On narrow screens the control takes the full row. Beside the label at 390px, both would be
						// clipped.
						className={cn(
							SELECT_TRIGGER_HEIGHT,
							"w-full shrink-0",
							controlClassName,
						)}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	);
}
