import type { GenerationTarget, ReasoningEffort } from "@rowcat/chat";
import { buildReasoningOptions } from "@rowcat/chat";
import { generationModelsQueryOptions } from "@rowcat/query";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { SELECT_TRIGGER_HEIGHT } from "#/lib/control-geometry.ts";
import { translator } from "#/lib/i18n/current.ts";
import { INHERIT_VALUE } from "./model-options.ts";

/**
 * A single row for choosing reasoning effort, shared by global settings, room settings, and the
 * work test. It sits beside the response length row, with one difference: this row sometimes does
 * not exist, because the steps depend on the model and some models cannot be adjusted at all.
 * - Adjustable model: the row shows reasoning effort with only that model's steps.
 * - Non-adjustable model: no row is drawn, and no disabled control is shown.
 *
 * No disabled select labeled `Not supported`. The settings screen should show what the
 * user can do now. A permanently disabled row is never read, takes space, and suggests the feature
 * is coming later. When a model becomes adjustable, the row appears in that place; the appearance
 * itself expresses the capability.
 *
 * Capability is not guessed here. There is no model-name check and no comparison on the vendor
 * label. The server catalog answers which steps are selectable (`GenerationModelDto.reasoning`),
 * and the list-building rule lives in `buildReasoningOptions` in `@rowcat/chat`. This is the same
 * way the model selector takes its list from a shared module. If the screen made that judgment,
 * every new model would need an edit here, and a missed deploy would draw entries that can be
 * selected but do not run.
 *
 * This component does not save. It receives values, draws them, and lifts changes up. Each screen
 * decides which store to write. Saving here would make this file know both stores, and the control
 * would start crossing ownership boundaries (`response-length-field.tsx` made the same call).
 */

/**
 * The user-facing names. Neither the token budget nor the provider vocabulary is shown.
 *
 * The one hard choice in this table is `medium`. It is not labeled `Medium`, because it is the
 * product default, not the midpoint, and `Medium` reads as 'somewhat', which gives no reason to pick
 * it. `Standard` says it is the answer when nothing has been chosen. The response length
 * control uses the same word for the same reason.
 */
export const reasoningEffortLabel = (effort: ReasoningEffort): string =>
	translator("generation")(`reasoning.${effort}`);

export function ReasoningEffortField({
	value,
	inherited,
	target,
	/** Label and description for this row. All three screens use the same words. */
	description = translator("generation")("reasoning.description"),
	frameClassName,
	controlClassName = "sm:w-40",
	loading,
	disabled,
	onChange,
}: {
	/** The value this layer picked. `null` means follow the parent. */
	value: ReasoningEffort | null;
	/** The value applied when this layer picks nothing. It is exactly what the resolver answered. */
	inherited: ReasoningEffort;
	/**
	 * The target currently applied: this layer's override, or else the inherited target.
	 *
	 * Capability is a property of the model, so the target is needed to build the list. Passing the
	 * inherited target through matters: even if this room did not pick a model, whether reasoning
	 * works depends on the model that actually runs.
	 */
	target: GenerationTarget;
	description?: string;
	/**
	 * The frame for this row (border and spacing). Each screen differs, so the screen supplies it.
	 *
	 * The frame is not a wrapper in the caller, because the row may not exist. An outer `<div
	 * className="py-4">` would leave an empty gap and a divider on models that draw no control, and
	 * users would read something as missing below. Only this component knows whether the row exists,
	 * so it draws the frame too.
	 */
	frameClassName?: string;
	controlClassName?: string;
	/** The stored value has not arrived yet. 'Not chosen' is a different state. */
	loading?: boolean;
	disabled?: boolean;
	onChange: (value: ReasoningEffort | null) => void;
}) {
	const id = useId();
	const descriptionId = `${id}-description`;

	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const options = buildReasoningOptions({
		models: catalog.data ?? [],
		/**
		 * Use the catalog as evidence only when the query succeeded. On failure the list is empty, so
		 * judging would mark every target as having no reasoning.
		 */
		catalogLoaded: catalog.isSuccess,
		target,
		value,
		inherited,
	});

	/**
	 * Do not reserve space before the value arrives. Unlike the response length row, which every model
	 * has and so can show a placeholder, this row's existence is known only once the catalog arrives.
	 * Holding space would make a row flash in and out for users of non-adjustable models, which reads
	 * as something disappearing.
	 */
	if (loading || catalog.isPending) return null;
	if (!options.available) return null;

	const items = [
		{
			value: INHERIT_VALUE,
			label: translator("generation")("inherit", {
				value: reasoningEffortLabel(options.inheritedEffort),
			}),
		},
		...options.efforts.map((effort) => ({
			value: effort as string,
			label: reasoningEffortLabel(effort),
		})),
	];

	return (
		<div className={frameClassName}>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div className="min-w-0">
					<Label htmlFor={id} className="text-sm font-medium">
						{translator("generation")("reasoning.label")}
					</Label>
					{description && (
						<p
							id={descriptionId}
							className="mt-1 text-sm text-muted-foreground"
						>
							{description}
						</p>
					)}
				</div>

				<Select
					/*
					 * Pass `items`, or the trigger draws the value instead of the name. Without it, `SelectValue`
					 * echoes the stored value and `__inherit__` shows.
					 */
					items={items}
					value={options.value ?? INHERIT_VALUE}
					onValueChange={(next) => {
						if (next === null) return;
						/**
						 * `Use default` does not copy the currently inherited value; it clears the override. Copying
						 * would mean that changing the global or product default no longer reaches this layer.
						 */
						onChange(next === INHERIT_VALUE ? null : (next as ReasoningEffort));
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
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
