import type { ChatIntensity, ChatRoom } from "@rowcat/chat";
import {
	chatIntensityChoices,
	resolveAllAges,
	roomChatIntensity,
} from "@rowcat/chat";
import { radiusScale, space } from "@rowcat/design";
import {
	ChoiceGroup,
	ChoiceOption,
	Notice,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
	MotionIndicatorGroup,
	MotionIndicatorItem,
} from "../../../lib/motion/active-indicator.tsx";
import { useViewerCapability } from "../../../lib/viewer-capability.ts";
import {
	INTENSITY_ADULT_LOCKED_NOTICE,
	INTENSITY_ALL_AGES_NOTICE,
	INTENSITY_DEFAULT_DESCRIPTION,
	INTENSITY_DEFAULT_LABEL,
	INTENSITY_DESCRIPTION,
	INTENSITY_LABEL,
	INTENSITY_RATING_NOTE,
	INTENSITY_SAVE_FAILURE_MESSAGE,
} from "./intensity-copy.ts";

/**
 * Expression-intensity pane of room settings; draws the same decisions as the web counterpart. Only
 * the container differs (web: `aria-pressed` buttons, here `ChoiceGroup`). The rules are identical:
 * the middle of the scale is the absence of the key, the rating caps this axis, saving happens on
 * pick, and the value belongs to the conversation so it syncs.
 *
 * The two notices split on different axes, which is easy to get wrong: the first follows the work's
 * rating (immutable), the second the turn's effective rating (disappears once entitlement is back).
 * Folding them would tell someone who only needs verification that they cannot pick it for this
 * work. Full rationale: the `intensity.ts` header in `@rowcat/chat`.
 */
export function RoomSettingsIntensity({
	room,
	onApply,
}: {
	room: ChatRoom;
	/** `null` resets to the default. */
	onApply: (intensity: ChatIntensity | null) => Promise<unknown>;
}) {
	const capability = useViewerCapability();
	const { colors } = useTheme();
	const [error, setError] = useState<string | null>(null);
	/** Blocks a second press in the same tick; `setState` only shows on the next render. */
	const applyingRef = useRef(false);

	const intensity = roomChatIntensity(room);
	const choices = chatIntensityChoices(room.adult);
	/**
	 * The turn's effective rating, from the same function generation uses. `null` while the viewer is
	 * unread: folding to `false` would flash the restriction notice at someone who is entitled.
	 */
	const allAges = capability.loading
		? null
		: resolveAllAges(room, { adultAllowed: capability.adult });

	const apply = (next: ChatIntensity | null): void => {
		if (applyingRef.current) return;
		applyingRef.current = true;
		setError(null);
		void onApply(next)
			.catch(() => setError(INTENSITY_SAVE_FAILURE_MESSAGE))
			.finally(() => {
				applyingRef.current = false;
			});
	};

	return (
		<View style={styles.root}>
			{error ? <Notice message={error} tone="destructive" /> : null}

			<View style={styles.section}>
				<Text variant="label" tone="muted-foreground">
					Intensity
				</Text>
				<ChoiceGroup
					value={intensity ?? DEFAULT}
					onValueChange={(value) =>
						apply(value === DEFAULT ? null : (value as ChatIntensity))
					}
				>
					{/* Same indicator as the narration pane; the motion implies no order (rows are not sorted by strength). */}
					<MotionIndicatorGroup
						activeKey={intensity ?? DEFAULT}
						indicatorStyle={{
							backgroundColor: colors.accent,
							borderRadius: radiusScale.md,
						}}
					>
						<MotionIndicatorItem itemKey={DEFAULT}>
							<ChoiceOption
								label={INTENSITY_DEFAULT_LABEL}
								note={INTENSITY_DEFAULT_DESCRIPTION}
								value={DEFAULT}
								selected={intensity === null}
							/>
						</MotionIndicatorItem>
						{choices.map((value) => (
							<MotionIndicatorItem key={value} itemKey={value}>
								<ChoiceOption
									label={INTENSITY_LABEL[value]}
									note={INTENSITY_DESCRIPTION[value]}
									value={value}
									selected={intensity === value}
								/>
							</MotionIndicatorItem>
						))}
					</MotionIndicatorGroup>
				</ChoiceGroup>
			</View>

			{/* The two notices are exclusive: all-ages works never list `Intense`, and only adult works can have the "not in effect this turn" case. */}
			{room.adult ? (
				intensity === "intense" && allAges === true ? (
					<Notice message={INTENSITY_ADULT_LOCKED_NOTICE} />
				) : null
			) : (
				<Text variant="caption" tone="muted-foreground">
					{INTENSITY_ALL_AGES_NOTICE}
				</Text>
			)}

			<Text variant="caption" tone="muted-foreground">
				{INTENSITY_RATING_NOTE}
			</Text>
		</View>
	);
}

/**
 * Picker value for the default state. Kept out of `ChatIntensity` on purpose: a `default` in the
 * vocabulary would reach the store and prompt assembler and give "default" two representations (key
 * absence and `default`). It is one control's representation and stays in this file, like `OFF` in
 * the narration pane.
 */
const DEFAULT = "default";

const styles = StyleSheet.create({
	root: { gap: space.xl },
	section: { gap: space.sm },
});
