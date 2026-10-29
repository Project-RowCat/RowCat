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
import { generationModelsQueryOptions } from "@rowcat/query";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import { useQuery } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useRoomGenerationState } from "#/lib/local-generation/hooks.ts";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import {
	narrationCastDescription,
	narrationCastLabel,
	narrationCatalogUnknownNotice,
	narrationCredit,
	narrationDensityDescription,
	narrationDensityFoldedNotice,
	narrationDensityLabel,
	narrationLockedHint,
	narrationOffDescription,
	narrationOffLabel,
	narrationSaveFailureMessage,
	narrationScopeDescription,
	narrationScopeLabel,
	narrationSingleDensityNotice,
	narrationUnsupportedNotice,
} from "./narration-copy.ts";

/**
 * The narration panel of conversation settings. It decides who writes this conversation.
 *
 * ## Three axes, but the control must read as one
 *
 * The legacy screen had one checkbox and three dropdowns (on/off, style, type, pack), and all of
 * its twenty-four combination names were slang. The real problem was not the number of controls:
 * the four values of the first axis looked like unrelated choices. In fact they are **one dial**
 * measuring how far the AI writes my character, and listing them with a sentence each makes that
 * visible.
 *
 * ```text
 * Off → Only I write my character → Default → AI assists → Autoplay
 *                                     how much the AI writes for me →
 * ```
 *
 * ## No disabled controls, and no silence either
 *
 * On/off is the **first value** of the dial, so the dependency between checkbox and dropdown is
 * gone. Unusable controls are not drawn, because a disabled control promises "you can do something
 * here, just not now", and this panel has no way to keep that promise.
 *
 * ⚠️ But dropping them is not enough, and the first draft got worse. Its default is `Off`,
 * so on first open only one tick was visible, and nothing showed that density and cast cards
 * existed. An invisible control is worse than a disabled one, which at least says "it is here". So
 * each slot gets one line of fact:
 *
 * ```text
 * pack is off                 "Turn it on to choose density and …"   states that the other axes exist
 * only one density            "This model has only one density …"   states the value that applies
 * chosen density was folded   states that it was folded
 * model does not take pack    a fact line instead of a control
 * ```
 *
 * The middle line matters most. **The product default model is in the reduced family, which has one
 * density.** Leaving that slot blank means this axis never appears for most users: a value applies
 * while the screen does not show it, and the screen describes only half of what it decides.
 *
 * ## Saving happens on selection
 *
 * Same call as the generation panel: there is no `Save` button. There is no transaction spanning the
 * three values, so one commit button would report a partial success as success, and undoing a
 * single change costs nothing.
 *
 * ## The value belongs to this conversation, so it syncs
 *
 * This differs from model, response length and reasoning effort, which are device preferences. A
 * story switched to autoplay that comes back as an ordinary conversation on another device is not a
 * setting that failed to follow; it is a different story. The full rationale is in the
 * `narration.ts` header in `@rowcat/chat`.
 */
export function RoomSettingsNarration({ room }: { room: ChatRoom }) {
	const { t } = useTranslation(["chat", "common"]);
	const { store } = useChatScope();
	const { effective } = useRoomGenerationState(room.id);
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const [error, setError] = useState<string | null>(null);
	const creditId = useId();
	const castId = useId();

	const settings = room.narration ?? null;
	const capability = promptPackCapabilityFor({
		models: catalog.data ?? [],
		catalogLoaded: catalog.isSuccess,
		target: effective.target,
	});
	const blocked = narrationBlockedReason({ settings, capability });
	const execution = resolveNarrationExecution({ settings, capability });

	/**
	 * Writes as soon as the value is chosen.
	 *
	 * `null` means **no pack** (`applyRoomNarration` deletes the key itself). There is no layer above
	 * to inherit from, so "remove" and "turn off" mean the same thing, and the representation must be
	 * one.
	 */
	const apply = async (next: ChatNarrationSettings | null): Promise<void> => {
		setError(null);
		if (!store) return;
		try {
			await store.setRoomNarration(room.id, next);
		} catch (failure) {
			// The raw Dexie error stays out of the UI; the user-facing message is generic on purpose.
			console.error("[chat] couldn't save the narration", failure);
			setError(narrationSaveFailureMessage());
		}
	};

	/**
	 * Choosing a scope **carries the current values of the other two axes forward**.
	 *
	 * The defaults apply only when the pack is first turned on (`DEFAULT_NARRATION_SETTINGS`). If
	 * density and cast cards reset each time the pack is toggled, the user would watch a value they
	 * had chosen disappear.
	 */
	const chooseScope = (scope: NarrationScope | null): void => {
		void apply(
			scope === null
				? null
				: { ...(settings ?? DEFAULT_NARRATION_SETTINGS), scope },
		);
	};

	/**
	 * The density row appears **only when the model offers two or more**.
	 *
	 * For a single-density model no control is drawn, locked or otherwise. The fact that the value
	 * applies folded is stated in one line instead. A control drawn but unusable sends the user
	 * looking for a way to change it.
	 */
	const densityChoices = capability?.densities ?? [];

	return (
		<div className="flex flex-col gap-5">
			{blocked === "model-unsupported" ? (
				<p className="text-sm text-amber-600 dark:text-amber-500">
					{narrationUnsupportedNotice()}
				</p>
			) : blocked === "catalog-unknown" ? (
				<p className="text-sm text-muted-foreground">
					{narrationCatalogUnknownNotice()}
				</p>
			) : null}

			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}

			{/*
			 * The ticks are plain buttons with `aria-pressed`, not `role="radiogroup"`. This is the same
			 * call as the runtime template gallery. That role requires roving tabindex and arrow-key
			 * traversal together, and implementing half of it leaves assistive-technology users with a
			 * list whose conventions do not work, which is worse than a plain button list.
			 */}
			<fieldset className="flex flex-col gap-1">
				<legend className="mb-1 text-xs font-medium text-muted-foreground">
					{t("narration.narrationScope")}
				</legend>
				<ScopeRow
					group="room-narration-scope"
					label={narrationOffLabel()}
					description={narrationOffDescription()}
					selected={settings === null}
					onSelect={() => chooseScope(null)}
				/>
				{NARRATION_SCOPES.map((scope) => (
					<ScopeRow
						key={scope}
						group="room-narration-scope"
						label={narrationScopeLabel(scope)}
						description={narrationScopeDescription(scope)}
						selected={settings?.scope === scope}
						onSelect={() => chooseScope(scope)}
					/>
				))}
			</fieldset>

			{/*
			 * When the pack is off, **say so in one line.** The decision not to draw controls as
			 * disabled stands, but without a statement the screen gives no evidence that the other two
			 * axes exist. An invisible control is worse than a disabled one.
			 */}
			{settings === null && blocked !== "model-unsupported" ? (
				<p className="text-sm text-muted-foreground">{narrationLockedHint()}</p>
			) : null}

			{settings && densityChoices.length > 1 ? (
				<fieldset className="flex flex-col gap-1">
					<legend className="mb-1 text-xs font-medium text-muted-foreground">
						{t("narration.descriptionDensity")}
					</legend>
					{PROMPT_PACK_DENSITIES.filter((density) =>
						densityChoices.includes(density),
					).map((density) => (
						<ScopeRow
							key={density}
							group="room-narration-density"
							label={narrationDensityLabel(density)}
							description={narrationDensityDescription(density)}
							selected={settings.density === density}
							onSelect={() => void apply({ ...settings, density })}
						/>
					))}
				</fieldset>
			) : settings && execution ? (
				/*
				 * Even with nothing to choose, **there is a value that applies.** The product default model is
				 * in the reduced family, so this slot is the one most users see. Leaving it blank would make
				 * this panel describe only half of what it decides.
				 */
				<p className="text-sm text-muted-foreground">
					{execution.densityFolded
						? narrationDensityFoldedNotice()
						: narrationSingleDensityNotice(
								narrationDensityLabel(execution.density),
							)}
				</p>
			) : null}

			{settings ? (
				<label
					htmlFor={castId}
					className="flex cursor-pointer items-start gap-2.5"
				>
					<Checkbox
						id={castId}
						className="mt-0.5"
						checked={settings.castTracking}
						onCheckedChange={(checked) =>
							void apply({ ...settings, castTracking: checked === true })
						}
					/>
					<span className="flex flex-col gap-0.5">
						<span className="text-sm font-medium">{narrationCastLabel()}</span>
						<span className="text-sm text-muted-foreground">
							{narrationCastDescription()}
						</span>
					</span>
				</label>
			) : null}

			{/*
			 * The source credit is **not folded away.** The body this panel handles is the original
			 * work, and placing that fact behind a click would hide the condition.
			 */}
			<section
				aria-labelledby={creditId}
				className="mt-1 border-t pt-4 text-xs text-muted-foreground"
			>
				<h3
					id={creditId}
					className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground"
				>
					<Info className="size-3.5" aria-hidden />
					{narrationCredit().heading}
				</h3>
				<ul className="flex flex-col gap-0.5">
					{narrationCredit().lines.map((line) => (
						<li key={line}>· {line}</li>
					))}
				</ul>
				<p className="mt-2">{narrationCredit().body}</p>
				<p className="mt-1.5">{narrationCredit().thanks}</p>
			</section>
		</div>
	);
}

/**
 * One tick row: title, description and selection marker.
 *
 * **Selection is not conveyed by colour alone.** A check icon stands with it, and `aria-pressed`
 * tells assistive technology the same fact. Colour alone is unreadable to some users, a rule that
 * applies across this repository.
 */
function ScopeRow({
	group,
	label,
	description,
	selected,
	onSelect,
}: {
	/**
	 * The dial this row belongs to. Scope and density **stand together on one screen**, so the names
	 * must differ. If they matched, choosing a density would fly the selection indicator over from the
	 * scope row.
	 */
	group: "room-narration-scope" | "room-narration-density";
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
			 * The selected row's background **moves along the dial.** Scope is one ordered dial (the
			 * array order of `NARRATION_SCOPES` is that order), so the indicator sliding across steps
			 * expresses that order. Selection itself is still conveyed by the check and `aria-pressed`;
			 * this background is an explanation layered on top (see the header of
			 * `MotionActiveIndicator`).
			 *
			 * Hover is `bg-accent/50` as the counterpart of this indicator. If hover matched the
			 * selection colour, the row would already be painted when pressed, and the arrival of the
			 * indicator would be invisible.
			 */}
			{selected ? (
				<MotionActiveIndicator
					group={group}
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
