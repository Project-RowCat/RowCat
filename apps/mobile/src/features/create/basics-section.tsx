import type { StoryDraft, StoryDraftPatch } from "@rowcat/authoring";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import type { Orientation } from "@rowcat/domain";
import {
	Button,
	Icon,
	Input,
	Select,
	SelectOption,
	Switch,
	Text,
	Textarea,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
	FIELD,
	FIELD_HINT,
	ORIENTATION_OPTIONS,
	ORIENTATION_UNSET_LABEL,
	OVER_LIMIT,
	SECTION,
	TAG_INPUT,
} from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";

/**
 * Basics: the part shown in the gallery.
 *
 * Every limit is read from `STORY_PUBLISH_LIMITS`; a literal here would let the screen pass values
 * the server rejects.
 *
 * Over-limit values are not cut: `maxLength` would silently drop the tail of a pasted passage. The
 * overflow is stated under the field and publication validation (`validateStoryPublication`) states
 * it again. Saving has no limit, so a draft stays durable even with an empty title or an overflow.
 *
 * The adult switch is never locked. A draft can legitimately hold `adult: true` without the
 * entitlement (it lapsed, or was set on another device), and a disabled switch would trap that
 * draft in adult-rated forever. The server decides at publication.
 */
export function BasicsSection({
	draft,
	onPatch,
}: {
	/** The saved record with the overlay on top (`draft-overlay.ts`). */
	draft: StoryDraft;
	onPatch: (patch: StoryDraftPatch) => void;
}) {
	return (
		<EditorSection
			first
			title={SECTION.basics.title}
			description={SECTION.basics.description}
		>
			<LimitedInput
				label={FIELD.title}
				value={draft.title}
				max={STORY_PUBLISH_LIMITS.title}
				onChange={(title) => onPatch({ title })}
			/>
			<LimitedInput
				label={FIELD.tagline}
				value={draft.tagline}
				max={STORY_PUBLISH_LIMITS.tagline}
				onChange={(tagline) => onPatch({ tagline })}
			/>
			<LimitedInput
				label={FIELD.description}
				value={draft.description}
				max={STORY_PUBLISH_LIMITS.description}
				multiline
				onChange={(description) => onPatch({ description })}
			/>

			<TagEditor tags={draft.tags} onChange={(tags) => onPatch({ tags })} />

			<View style={basics.field}>
				<Text variant="caption" tone="muted-foreground">
					{FIELD.orientation}
				</Text>
				<Select
					label={FIELD.orientation}
					value={
						ORIENTATION_OPTIONS.find(
							(option) => option.value === draft.orientation,
						)?.label ?? ORIENTATION_UNSET_LABEL
					}
				>
					{ORIENTATION_OPTIONS.map((option) => (
						<SelectOption
							key={option.value ?? "unset"}
							label={option.label}
							selected={option.value === draft.orientation}
							/* Unspecified is `null`, not `""`: transport conventions stay out of the storage model. */
							onSelect={() =>
								onPatch({ orientation: option.value as Orientation | null })
							}
						/>
					))}
				</Select>
			</View>

			<ToggleRow
				label={FIELD.adult}
				hint={FIELD_HINT.adult}
				value={draft.adult}
				onChange={(adult) => onPatch({ adult })}
			/>
			<ToggleRow
				label={FIELD.promptProtected}
				hint={FIELD_HINT.promptProtected}
				value={draft.promptProtected}
				onChange={(promptProtected) => onPatch({ promptProtected })}
			/>
		</EditorSection>
	);
}

/**
 * A field with a limit: it accepts overflow and says so. Length is counted in UTF-16 units
 * (`length`), the same as the contract's zod `max`; counting differently here would let the screen
 * pass what the server rejects.
 */
function LimitedInput({
	label,
	value,
	max,
	multiline,
	onChange,
}: {
	label: string;
	value: string;
	max: number;
	multiline?: boolean;
	onChange: (value: string) => void;
}) {
	const over = value.length > max;
	const Field = multiline ? Textarea : Input;
	return (
		<View style={basics.field}>
			<Field
				label={label}
				value={value}
				invalid={over}
				onChangeText={onChange}
			/>
			{over ? (
				<Text variant="caption" tone="destructive">
					{OVER_LIMIT(value.length, max)}
				</Text>
			) : null}
		</View>
	);
}

/**
 * Tags as chips plus one input. Normalization (trim, drop empties, dedupe, first-appearance order)
 * is done by `prepareStoryPublication`; this screen only blocks the obvious, so the previewed tags
 * match the published ones.
 *
 * At the limit only adding is blocked. Removing from an already over-limit list (another device,
 * migration) must stay possible.
 */
function TagEditor({
	tags,
	onChange,
}: {
	tags: readonly string[];
	onChange: (tags: string[]) => void;
}) {
	const { colors } = useTheme();
	const [pending, setPending] = useState("");
	const trimmed = pending.trim();
	const full = tags.length >= STORY_PUBLISH_LIMITS.tags;
	const tooLong = trimmed.length > STORY_PUBLISH_LIMITS.tag;

	const add = () => {
		if (!trimmed || full || tooLong || tags.includes(trimmed)) return;
		onChange([...tags, trimmed]);
		setPending("");
	};

	return (
		<View style={basics.field}>
			<View style={basics.tagRow}>
				<View style={basics.tagInput}>
					<Input
						label={TAG_INPUT.label}
						value={pending}
						placeholder={TAG_INPUT.placeholder}
						returnKeyType="done"
						onChangeText={setPending}
						onSubmitEditing={add}
					/>
				</View>
				{/*
				 * The keyboard's `Done` alone is not enough: adding must also be an on-screen button, since a
				 * gesture only some people know is not an operation.
				 */}
				<Button
					label={TAG_INPUT.add}
					variant="outline"
					disabled={trimmed.length === 0 || full || tooLong}
					onPress={add}
					style={basics.tagAdd}
				/>
			</View>
			{full ? (
				<Text variant="caption" tone="muted-foreground">
					{TAG_INPUT.full}
				</Text>
			) : null}
			{tooLong ? (
				<Text variant="caption" tone="destructive">
					{TAG_INPUT.tooLong}
				</Text>
			) : null}
			{tags.length > 0 ? (
				<View style={basics.chips}>
					{tags.map((tag) => (
						<Pressable
							key={tag}
							accessibilityRole="button"
							accessibilityLabel={TAG_INPUT.remove(tag)}
							onPress={() => onChange(tags.filter((item) => item !== tag))}
							style={({ pressed }) => [
								basics.chip,
								{ borderColor: colors.border },
								pressed && { backgroundColor: colors.muted },
							]}
						>
							<Text variant="caption">{tag}</Text>
							<Icon name="close" size="sm" tone="muted-foreground" />
						</Pressable>
					))}
				</View>
			) : null}
		</View>
	);
}

/**
 * One on/off setting row. The label and the switch's `label` are the same sentence, so a screen
 * reader announces a named control.
 */
function ToggleRow({
	label,
	hint,
	value,
	onChange,
}: {
	label: string;
	hint: string;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<View style={basics.toggle}>
			<View style={basics.toggleText}>
				<Text variant="body">{label}</Text>
				<Text variant="caption" tone="muted-foreground">
					{hint}
				</Text>
			</View>
			<Switch label={label} value={value} onValueChange={onChange} />
		</View>
	);
}

const basics = StyleSheet.create({
	field: { gap: space.xs },
	tagRow: { alignItems: "flex-end", flexDirection: "row", gap: space.sm },
	/* Overrides `Button`'s default `alignSelf: "flex-start"`, which would sit the button at label height. */
	tagAdd: { alignSelf: "flex-end", flexShrink: 0 },
	tagInput: { flex: 1, minWidth: 0 },
	chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
	chip: {
		alignItems: "center",
		borderRadius: radiusScale.sm,
		borderWidth: borderWidth,
		flexDirection: "row",
		gap: space.xs,
		minHeight: touchTarget,
		paddingHorizontal: space.sm,
	},
	toggle: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.md,
		minHeight: touchTarget,
	},
	toggleText: { flex: 1, gap: space.px, minWidth: 0 },
});
