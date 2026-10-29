import type {
	ChatNarrationSettings,
	ChatRoom,
	NarrationScope,
} from "@rowcat/chat";
import {
	DEFAULT_NARRATION_SETTINGS,
	NARRATION_SCOPES,
	narrationBlockedReason,
	PROMPT_PACK_DENSITIES,
	promptPackCapabilityFor,
	resolveNarrationExecution,
} from "@rowcat/chat";
import { radiusScale, space } from "@rowcat/design";
import { generationModelsQueryOptions } from "@rowcat/query";
import {
	ChoiceGroup,
	ChoiceOption,
	Notice,
	Switch,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import {
	MotionIndicatorGroup,
	MotionIndicatorItem,
} from "../../../lib/motion/active-indicator.tsx";
import { useRoomGenerationState } from "../generation/use-room-generation.ts";
import {
	NARRATION_CAST_DESCRIPTION,
	NARRATION_CAST_LABEL,
	NARRATION_CATALOG_UNKNOWN_NOTICE,
	NARRATION_CREDIT,
	NARRATION_DENSITY_DESCRIPTION,
	NARRATION_DENSITY_FOLDED_NOTICE,
	NARRATION_DENSITY_LABEL,
	NARRATION_LOCKED_HINT,
	NARRATION_OFF_DESCRIPTION,
	NARRATION_OFF_LABEL,
	NARRATION_SAVE_FAILURE_MESSAGE,
	NARRATION_SCOPE_DESCRIPTION,
	NARRATION_SCOPE_LABEL,
	NARRATION_UNSUPPORTED_NOTICE,
	narrationSingleDensityNotice,
} from "./narration-copy.ts";

/**
 * Narration pane of room settings; draws the same decisions as the web counterpart. Only the
 * container differs: web uses `aria-pressed` buttons, here `ChoiceGroup`, because RN already has a
 * radio primitive and we need not build roving tabindex (web avoided that role for fear of
 * implementing half of its convention). The rules are identical: on/off is the first value of the
 * dial, density shows only when the model offers two, saving happens on pick, and the value belongs
 * to the conversation so it syncs.
 */
export function RoomSettingsNarration({
	room,
	onApply,
}: {
	room: ChatRoom;
	/** `null` turns the pack off. */
	onApply: (narration: ChatNarrationSettings | null) => Promise<unknown>;
}) {
	const { colors } = useTheme();
	/** Same values as web's `bg-accent rounded-md`. */
	const indicatorStyle = {
		backgroundColor: colors.accent,
		borderRadius: radiusScale.md,
	};
	const { effective } = useRoomGenerationState(room.id);
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const [error, setError] = useState<string | null>(null);
	/** Blocks a second press in the same tick; `setState` only shows on the next render. */
	const applyingRef = useRef(false);

	const settings = room.narration ?? null;
	const capability = promptPackCapabilityFor({
		models: catalog.data ?? [],
		catalogLoaded: catalog.isSuccess,
		target: effective.target,
	});
	const blocked = narrationBlockedReason({ settings, capability });
	const execution = resolveNarrationExecution({ settings, capability });
	const densityChoices = capability?.densities ?? [];

	const apply = (next: ChatNarrationSettings | null): void => {
		if (applyingRef.current) return;
		applyingRef.current = true;
		setError(null);
		void onApply(next)
			.catch(() => setError(NARRATION_SAVE_FAILURE_MESSAGE))
			.finally(() => {
				applyingRef.current = false;
			});
	};

	/** The other two axes keep their current values; resetting them on every off/on would make chosen values vanish. */
	const chooseScope = (value: string): void => {
		if (value === OFF) {
			apply(null);
			return;
		}
		apply({
			...(settings ?? DEFAULT_NARRATION_SETTINGS),
			scope: value as NarrationScope,
		});
	};

	return (
		<View style={styles.root}>
			{blocked === "model-unsupported" ? (
				<Notice message={NARRATION_UNSUPPORTED_NOTICE} />
			) : blocked === "catalog-unknown" ? (
				<Notice message={NARRATION_CATALOG_UNKNOWN_NOTICE} />
			) : null}
			{error ? <Notice message={error} tone="destructive" /> : null}

			<View style={styles.section}>
				<Text variant="label" tone="muted-foreground">
					Narration scope
				</Text>
				<ChoiceGroup value={settings?.scope ?? OFF} onValueChange={chooseScope}>
					{/* The scope is one ordered dial, so the indicator sliding across steps expresses that order (same as web's `MotionActiveIndicator`). Selection itself is still stated by bold text, the check and radio accessibility state. */}
					<MotionIndicatorGroup
						activeKey={settings?.scope ?? OFF}
						indicatorStyle={indicatorStyle}
					>
						<MotionIndicatorItem itemKey={OFF}>
							<ChoiceOption
								label={NARRATION_OFF_LABEL}
								note={NARRATION_OFF_DESCRIPTION}
								value={OFF}
								selected={settings === null}
							/>
						</MotionIndicatorItem>
						{NARRATION_SCOPES.map((scope) => (
							<MotionIndicatorItem key={scope} itemKey={scope}>
								<ChoiceOption
									label={NARRATION_SCOPE_LABEL[scope]}
									note={NARRATION_SCOPE_DESCRIPTION[scope]}
									value={scope}
									selected={settings?.scope === scope}
								/>
							</MotionIndicatorItem>
						))}
					</MotionIndicatorGroup>
				</ChoiceGroup>
			</View>

			{/* While the pack is off, say so in one line (as on web): without it nothing on screen shows the other two axes exist. */}
			{settings === null && blocked !== "model-unsupported" ? (
				<Text variant="caption" tone="muted-foreground">
					{NARRATION_LOCKED_HINT}
				</Text>
			) : null}

			{settings && densityChoices.length > 1 ? (
				<View style={styles.section}>
					<Text variant="label" tone="muted-foreground">
						Description density
					</Text>
					<ChoiceGroup
						value={settings.density}
						onValueChange={(density) =>
							apply({
								...settings,
								density: density as (typeof PROMPT_PACK_DENSITIES)[number],
							})
						}
					>
						<MotionIndicatorGroup
							activeKey={settings.density}
							indicatorStyle={indicatorStyle}
						>
							{PROMPT_PACK_DENSITIES.filter((density) =>
								densityChoices.includes(density),
							).map((density) => (
								<MotionIndicatorItem key={density} itemKey={density}>
									<ChoiceOption
										label={NARRATION_DENSITY_LABEL[density]}
										note={NARRATION_DENSITY_DESCRIPTION[density]}
										value={density}
										selected={settings.density === density}
									/>
								</MotionIndicatorItem>
							))}
						</MotionIndicatorGroup>
					</ChoiceGroup>
				</View>
			) : null}

			{settings && execution && densityChoices.length <= 1 ? (
				/* Nothing to choose, but a value still applies; the default model is a reduced one, so most users see this branch. */
				<Text variant="caption" tone="muted-foreground">
					{execution.densityFolded
						? NARRATION_DENSITY_FOLDED_NOTICE
						: narrationSingleDensityNotice(
								NARRATION_DENSITY_LABEL[execution.density],
							)}
				</Text>
			) : null}

			{settings ? (
				<View style={styles.toggleRow}>
					{/* The switch owns the label (the primitive sets target and accessible name together); a `Text` here would read the word twice. */}
					<Switch
						label={NARRATION_CAST_LABEL}
						value={settings.castTracking}
						onValueChange={(castTracking) =>
							apply({ ...settings, castTracking })
						}
					/>
					<Text variant="caption" tone="muted-foreground">
						{NARRATION_CAST_DESCRIPTION}
					</Text>
				</View>
			) : null}

			{/* Attribution, same place and wording as web. Never collapsed: the bodies are an original work, and hiding that behind a press hides the condition. */}
			<View style={[styles.credit, { borderTopColor: colors.border }]}>
				<Text variant="label">{NARRATION_CREDIT.heading}</Text>
				{NARRATION_CREDIT.lines.map((line) => (
					<Text key={line} variant="caption" tone="muted-foreground">
						· {line}
					</Text>
				))}
				<Text variant="caption" tone="muted-foreground">
					{NARRATION_CREDIT.body}
				</Text>
				<Text variant="caption" tone="muted-foreground">
					{NARRATION_CREDIT.thanks}
				</Text>
			</View>
		</View>
	);
}

/**
 * Picker value for "no pack". Kept out of `NarrationScope` on purpose: an `off` in the vocabulary
 * would reach the store and prompt assembler and give "no pack" two representations (key absence
 * and `off`). It is one control's representation and stays in this file.
 */
const OFF = "off";

const styles = StyleSheet.create({
	root: { gap: space.xl },
	section: { gap: space.sm },
	toggleRow: { gap: space.xs },
	credit: {
		gap: space.xs,
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingTop: space.lg,
	},
});
