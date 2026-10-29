import type { ReasoningEffort, ReasoningOptions } from "@rowcat/chat";
import { Select, SelectOption } from "@rowcat/ui-native";
import {
	inheritLabel,
	REASONING_EFFORT_FIELD,
	reasoningEffortLabel,
} from "./labels.ts";

/**
 * The reasoning effort control, shared by three screens (room settings, default AI settings,
 * playtest).
 *
 * Unlike the response-length control the list is not a constant: the currently chosen model decides
 * it. Written per screen, one would skip the filtering and draw a tier that can be chosen but never
 * executes (saved, yet responses do not change, so it is silent).
 *
 * The row frame is not here: screens use different containers, and whether this row exists at all
 * is answered by the options, so the screen must fold its own divider with it. Drawing a frame here
 * would leave an empty line.
 *
 * Neither the list nor the inheritance decision lives here: `@rowcat/chat`'s
 * `buildReasoningOptions` owns them and web calls the same function.
 */
export function ReasoningEffortSelect({
	options,
	disabled,
	onChange,
}: {
	/** Built by the shared module. When `available` is false the screen does not draw this control at all. */
	options: ReasoningOptions;
	disabled?: boolean;
	onChange: (value: ReasoningEffort | null) => void;
}) {
	const inherited = inheritLabel(reasoningEffortLabel(options.inheritedEffort));
	return (
		<Select
			label={REASONING_EFFORT_FIELD.label}
			value={options.value ? reasoningEffortLabel(options.value) : inherited}
			disabled={disabled}
		>
			{/**
			 * The first item is always inheritance, with the tier currently inherited in the
			 * parenthesis. That value has passed through this model's capability: if the model cannot
			 * do the inherited tier it actually runs on the model default, and a parenthesis naming
			 * the old value would promise something other than what executes (the shared module decides).
			 *
			 * Choosing it erases the override rather than copying the parent value.
			 */}
			<SelectOption
				label={inherited}
				selected={options.value === null}
				onSelect={() => onChange(null)}
			/>
			{options.efforts.map((effort) => (
				<SelectOption
					key={effort}
					label={reasoningEffortLabel(effort)}
					selected={options.value === effort}
					onSelect={() => onChange(effort)}
				/>
			))}
		</Select>
	);
}
