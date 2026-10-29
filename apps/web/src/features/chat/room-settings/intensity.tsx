import type { ChatIntensity, ChatRoom } from "@rowcat/chat";
import {
	chatIntensityChoices,
	resolveAllAges,
	roomChatIntensity,
} from "@rowcat/chat";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import { useViewerCapability } from "#/lib/query/viewer-capability.ts";
import {
	intensityAdultLockedNotice,
	intensityAllAgesNotice,
	intensityDefaultDescription,
	intensityDefaultLabel,
	intensityDescription,
	intensityLabel,
	intensityRatingNote,
	intensitySaveFailureMessage,
} from "./intensity-copy.ts";

/**
 * The expression-intensity panel of conversation settings. It sets how much is shown, within the
 * range the rating allows.
 *
 * ## Three ticks, two values
 *
 * The middle tick (`Default`) is the absence of a stored key, not a stored value (`applyRoomIntensity`).
 * There is no layer above to inherit from, so "reset" and "never chose" are the same fact. Storing
 * them in different shapes would give one fact two room-record forms. The narration panel's `Off`
 * sits in the same place for the same reason.
 *
 * ## The rating is this panel's ceiling, and the panel says so
 *
 * ```text
 * all-ages work           `Intense` is absent from the list      intensityAllAgesNotice()
 * adult work, not eligible `Intense` exists but doesn't apply now  intensityAdultLockedNotice()
 * ```
 *
 * Telling these two apart is the easiest part of this panel to get wrong. The first is the **work's
 * rating**, which never changes (`ROOM_IMMUTABLE`). The second is **this turn's effective rating**,
 * which disappears once adult verification completes. Folding them together would tell someone who
 * only needs to verify that they "cannot choose it in this work".
 *
 * Not drawing a disabled control, and not staying silent in its place, is the same call the
 * narration panel makes. A drawn but unusable control sends users looking for a fix; with no
 * statement, this panel describes only half of what it decides.
 *
 * ## Saving happens on selection
 *
 * There is only one value, so there is no space for a `Save` button (the same call as the generation
 * and narration panels).
 *
 * ## The value belongs to this conversation, so it syncs
 *
 * This differs from model and response length, which are device preferences, and the stakes are
 * higher. A story read at `Softened` that returns at full intensity on another device is not a setting
 * that failed to follow; it is the thing that person was avoiding, shown to them. The full
 * rationale is in the `intensity.ts` header in `@rowcat/chat`.
 */
export function RoomSettingsIntensity({ room }: { room: ChatRoom }) {
	const { t } = useTranslation(["chat", "common"]);
	const { store } = useChatScope();
	const capability = useViewerCapability();
	const [error, setError] = useState<string | null>(null);

	const intensity = roomChatIntensity(room);
	const choices = chatIntensityChoices(room.adult);
	/**
	 * This turn's effective rating, computed by the **same function** generation uses. Rewriting
	 * `room.adult && viewer.adult` here would create a second copy of the decision, and the mismatch
	 * would only show as "the panel says it applies but the response does not change".
	 *
	 * If the viewer is not read yet, claim nothing (`null`). Folding to `false` would show an eligible
	 * person the restriction notice.
	 */
	const allAges = capability.loading
		? null
		: resolveAllAges(room, { adultAllowed: capability.adult });

	const apply = async (next: ChatIntensity | null): Promise<void> => {
		setError(null);
		if (!store) return;
		try {
			await store.setRoomIntensity(room.id, next);
		} catch (failure) {
			// The raw Dexie error stays out of the UI; the user-facing message is generic on purpose.
			console.error("[chat] couldn't save the intensity", failure);
			setError(intensitySaveFailureMessage());
		}
	};

	return (
		<div className="flex flex-col gap-5">
			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}

			{/*
			 * The ticks are plain buttons with `aria-pressed`, not `role="radiogroup"`, for the same
			 * reason as the narration panel. Implementing half of the radio convention (roving tabindex and
			 * arrow-key traversal) would leave assistive-technology users with a list that does not
			 * behave the way they expect.
			 */}
			<fieldset className="flex flex-col gap-1">
				<legend className="mb-1 text-xs font-medium text-muted-foreground">
					{t("intensity.intensity")}
				</legend>
				<IntensityRow
					label={intensityDefaultLabel()}
					description={intensityDefaultDescription()}
					selected={intensity === null}
					onSelect={() => void apply(null)}
				/>
				{choices.map((value) => (
					<IntensityRow
						key={value}
						label={intensityLabel(value)}
						description={intensityDescription(value)}
						selected={intensity === value}
						onSelect={() => void apply(value)}
					/>
				))}
			</fieldset>

			{/*
			 * The two notices are mutually exclusive. All-ages works never have `Intense`, and only adult
			 * works can show the "does not apply this time" notice.
			 */}
			{room.adult ? (
				intensity === "intense" && allAges === true ? (
					<p className="text-sm text-amber-600 dark:text-amber-500">
						{intensityAdultLockedNotice()}
					</p>
				) : null
			) : (
				<p className="text-sm text-muted-foreground">
					{intensityAllAgesNotice()}
				</p>
			)}

			<p className="text-sm text-muted-foreground">{intensityRatingNote()}</p>
		</div>
	);
}

/**
 * One tick row, the same shape as `ScopeRow` in the narration panel.
 *
 * It is not lifted into a shared part on purpose. The two screens share the layout by coincidence,
 * and a shared part would let one screen's needs change the other's markup. This is the same call
 * as `parts.tsx`, which holds only the two home-screen parts (it is not a general settings
 * framework).
 */
function IntensityRow({
	label,
	description,
	selected,
	onSelect,
}: {
	label: string;
	description: string;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className="relative -mx-2 flex items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
		>
			{/*
			 * Same indicator as the narration panel: the selected row's background moves between
			 * siblings. Hover is painted at half strength for the same reason. If hover matched the
			 * selection colour, the arrival on press would not be visible.
			 *
			 * Here the movement does **not** imply order. The rows are not ordered by strength (`Default`
			 * is the absence of a value, so it sits on top). The movement says one thing only: the
			 * selection moved within this scale.
			 */}
			{selected ? (
				<MotionActiveIndicator
					group="room-intensity"
					className="absolute inset-0 rounded-md bg-accent"
				/>
			) : null}
			<Check
				className={`relative mt-0.5 size-4 shrink-0 ${selected ? "" : "invisible"}`}
				aria-hidden
			/>
			<span className="relative flex flex-col gap-0.5">
				<span className="text-sm font-medium">{label}</span>
				<span className="text-sm text-muted-foreground">{description}</span>
			</span>
		</button>
	);
}
