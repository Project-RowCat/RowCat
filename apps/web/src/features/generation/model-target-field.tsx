import type { GenerationProvider, GenerationTarget } from "@rowcat/chat";
import { isGenerationProvider } from "@rowcat/chat";
import {
	GENERATION_MODELS_QUERY_KEY,
	generationModelsQueryOptions,
} from "@rowcat/query";
import { Label } from "@rowcat/ui-web/components/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { SELECT_TRIGGER_HEIGHT } from "#/lib/control-geometry.ts";
import { useConnectedProviders } from "#/lib/local-provider/hooks.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { useViewerCapability } from "#/lib/query/viewer-capability.ts";
import type { TargetUnavailability } from "./model-options.ts";
import {
	buildModelOptions,
	INHERIT_VALUE,
	targetForKey,
	unavailableMessage,
} from "./model-options.ts";

/**
 * The row for choosing the generation target. Global settings and room settings share it.
 *
 * Why one component: the meaning of 'inherit' must not drift between the two screens. If each had
 * its own, the symptom would appear later as a global change that a room left on 'use default' does
 * not follow. The same reason applies to the response length control (`response-length-field.tsx`).
 *
 * Why two columns: the same model name appears under two providers. Claude Sonnet 5 can be chosen
 * as RowCat managed or as Anthropic BYO, and those two send billing and prompts to different
 * places. A single column would show that difference only in a group heading. Asking for the access
 * path first makes the difference part of the choice.
 *
 * The stored value is still one `GenerationTarget`. The two columns are an input method, not a
 * stored model, so choosing a provider also fixes one model inside it. A 'provider only' state
 * cannot be stored (see the `GenerationTarget` comment in @rowcat/chat).
 *
 * One more axis: what can be selected versus what can run on this device. The catalog comes from
 * the server, but provider connection is per device, so unusable items can legitimately appear. The
 * rule is not to hide that state; hiding it would make a saved choice look like it vanished.
 *
 * The availability and list rules are not in this file (`model-options.ts`). What remains here is
 * drawing and waiting for two asynchronous sources.
 *
 * This component never saves. It receives values, draws them, and lifts changes up. Each screen
 * decides which store to write (global uses `setGlobal`, room uses `setRoom`). It never touches
 * credentials: entering keys here would make choosing a model and connecting a provider one action,
 * though they have different stores and lifetimes. The only route to recovery is the
 * `renderRecovery` callback the screen passes in, and that route ends at the provider connection
 * section, not a key-entry field.
 */

export interface ModelTargetFieldProps {
	/** The target chosen at this layer. `null` means follow the parent. */
	value: GenerationTarget | null;
	/**
	 * The effective target when following the parent. The screen does not compute it: it takes the
	 * value the priority resolver returned (`lib/local-generation/hooks.ts`). Writing `global ??
	 * default` here would create a second copy of that rule.
	 */
	inherited: GenerationTarget;
	description?: string;
	/** The stored value has not arrived yet. This is different from 'not chosen'. */
	loading?: boolean;
	disabled?: boolean;
	onChange: (value: GenerationTarget | null) => void;
	/**
	 * Where the user can go when the target is unusable. This differs per screen, so the screen builds
	 * it. Settings links to the provider-connection section on the same page; room settings link to
	 * `/settings/ai`. If this component knew those destinations, dialogs would need code to find
	 * scroll targets, and that would be the first step toward two separate connection screens.
	 */
	renderRecovery?: (unavailable: TargetUnavailability) => ReactNode;
}

export function ModelTargetField({
	value,
	inherited,
	description,
	loading,
	disabled,
	onChange,
	renderRecovery,
}: ModelTargetFieldProps) {
	const { t } = useTranslation(["generation", "common"]);
	const id = useId();
	const titleId = `${id}-title`;
	const providerId = `${id}-provider`;
	const providerLabelId = `${id}-provider-label`;
	const modelId = `${id}-model`;
	const modelLabelId = `${id}-model-label`;
	const descriptionId = `${id}-description`;
	const unavailableId = `${id}-unavailable`;

	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	/**
	 * The `Try again` action. On a stalled query, `refetch()` does nothing, so the rule lives in
	 * `lib/query/panel-retry.ts`.
	 */
	const retryCatalog = usePanelRetry(GENERATION_MODELS_QUERY_KEY, catalog);
	const { providers: connected, loading: connectionsLoading } =
		useConnectedProviders();
	/**
	 * Account eligibility is a separate axis from connection. For a child account, BYO entries stay
	 * closed even when connected, and the list must say so. The verdict comes from a pure function;
	 * this component only passes the values in.
	 */
	const capability = useViewerCapability();

	const models = catalog.data ?? [];
	/**
	 * Wait for both sources. If drawn once only the catalog has arrived, a connected provider's
	 * entries would briefly show `Connect the provider first` and then change, which users would read as the connection
	 * flickering.
	 */
	const pending =
		Boolean(loading) ||
		catalog.isPending ||
		connectionsLoading ||
		capability.loading;

	const options = buildModelOptions({
		models,
		value,
		inherited,
		connected,
		byoAllowed: capability.byo,
		/**
		 * Use the catalog as evidence only when the query succeeded. On failure `models` is an empty
		 * array, so judging against it would call every saved model 'not in catalog'.
		 */
		catalogLoaded: catalog.isSuccess,
	});

	/**
	 * Joins the description and the unavailable reason into the description of both controls. Small
	 * text beside a control does not exist for users who are not looking at the screen.
	 */
	const describedBy =
		[
			description ? descriptionId : null,
			options.unavailable ? unavailableId : null,
		]
			.filter(Boolean)
			.join(" ") || undefined;

	/**
	 * Changing the provider also sets one target in that provider. Which model is decided by the pure
	 * module (`ProviderOptionEntry.defaultTarget`). Picking `entries[0]` here would move the 'usable
	 * first' rule to a place that cannot be verified without rendering.
	 */
	const selectProvider = (next: string | null): void => {
		if (next === null) return;
		if (next === INHERIT_VALUE) {
			onChange(null);
			return;
		}
		if (!isGenerationProvider(next)) return;
		const provider: GenerationProvider = next;
		const entry = options.providers.find(
			(candidate) => candidate.provider === provider,
		);
		/** For a provider not recognized, leave the value unchanged; do not clear the override. */
		if (entry) onChange(entry.defaultTarget);
	};

	return (
		/**
		 * The two controls are one setting but do not form a group element. Each column's accessible name
		 * reads both the outer title and its own name (`Generation target Provider`). Linking the outer title to the
		 * provider column with `Label htmlFor` would make that column's name just `Generation target`, so a
		 * screen-reader user could not tell which of the two has focus. Wrapping them in a `fieldset`
		 * would pull the `legend` out of flex flow and break the side-by-side layout.
		 */
		<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
			<div className="min-w-0">
				<span id={titleId} className="text-sm font-medium">
					{t("target.label")}
				</span>
				{description && (
					<p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
						{description}
					</p>
				)}
			</div>

			{pending ? (
				<div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
					<Skeleton className="h-9 w-full sm:h-8" />
					<Skeleton className="h-9 w-full sm:h-8" />
				</div>
			) : (
				<div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
					{/* Provider: the access path is chosen first. Inheritance also lives in this column. */}
					<div className="flex flex-col gap-1">
						<Label
							htmlFor={providerId}
							id={providerLabelId}
							className="text-xs font-normal text-muted-foreground"
						>
							{t("target.provider")}
						</Label>
						<Select
							items={options.providerItems}
							value={options.providerValue}
							onValueChange={selectProvider}
							disabled={disabled}
						>
							<SelectTrigger
								id={providerId}
								size="sm"
								aria-labelledby={`${titleId} ${providerLabelId}`}
								/**
								 * The reason it cannot be used is tied to the trigger. For users not looking at the screen,
								 * red text beside the control does not exist; unless it is read when focus lands, they
								 * cannot learn the fact.
								 */
								aria-describedby={describedBy}
								className={cn(SELECT_TRIGGER_HEIGHT, "w-full")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={INHERIT_VALUE}>
									{options.inheritLabel}
								</SelectItem>
								{options.providers.map((entry) => (
									<SelectItem
										key={entry.provider}
										value={entry.provider}
										/**
										 * Why an item cannot be chosen is inside the item name (`… · Connect the provider first`). If it were only
										 * gray, the item would be a blocked entry with no reason for a screen-reader user.
										 */
										disabled={entry.disabled}
									>
										{entry.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/*
					 * Model: choose only within the selected provider.
					 *
					 * While inheriting, the control is disabled but still shows the inherited name. Leaving it
					 * empty would hide what currently applies. Adding `Use default` here would make the UI
					 * promise a state that cannot be expressed: 'the provider is inherited and only the model is
					 * chosen'.
					 */}
					<div className="flex flex-col gap-1">
						<Label
							htmlFor={modelId}
							id={modelLabelId}
							className="text-xs font-normal text-muted-foreground"
						>
							{t("target.model")}
						</Label>
						{options.modelValue === null ? (
							/*
							 * While inheriting there is nothing to pick. The element is an `output` because it can carry
							 * a label. A label on a `div` would leave the column as an unnamed block of text for users
							 * not looking at the screen, and the applied value would not be read out.
							 */
							<output
								id={modelId}
								className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground sm:h-8"
							>
								{options.inheritedModelLabel}
							</output>
						) : (
							<Select
								items={options.modelItems}
								value={options.modelValue}
								onValueChange={(next) => {
									if (next === null) return;
									/**
									 * When re-selecting a value that is not in the catalog (the currently saved one), keep the
									 * value as is. Dropping it to `null` would make re-selecting your own choice clear the
									 * override.
									 */
									onChange(targetForKey(next, models) ?? value);
								}}
								disabled={disabled}
							>
								<SelectTrigger
									id={modelId}
									size="sm"
									aria-labelledby={`${titleId} ${modelLabelId}`}
									aria-describedby={describedBy}
									className={cn(SELECT_TRIGGER_HEIGHT, "w-full")}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{/*
									 * The managed list is grouped by the company that made each model, since one provider holds
									 * models from several companies. A list with one company (BYO) has no heading and is not
									 * drawn; that decision lives in the pure module.
									 */}
									{options.modelGroups.map((group) => (
										<SelectGroup key={group.label ?? "__flat__"}>
											{group.label && <SelectLabel>{group.label}</SelectLabel>}
											{group.entries.map((entry) => (
												<SelectItem
													key={entry.key}
													value={entry.key}
													disabled={entry.disabled}
												>
													{entry.label}
												</SelectItem>
											))}
										</SelectGroup>
									))}
								</SelectContent>
							</Select>
						)}
					</div>

					{/*
					 * The line below the controls states that the currently applied target cannot be used. It
					 * does not clear the value or swap in another model. When the provider is reconnected, the
					 * saved target must work again; if it had been overwritten, the user would end up using a
					 * model they never chose.
					 *
					 * The sentence differs by reason. Telling a connected provider to `connect it` is untrue, and
					 * an untrue instruction is worse than none.
					 */}
					{options.unavailable && (
						<div id={unavailableId} className="flex flex-col gap-1">
							<p className="text-sm text-destructive">
								{unavailableMessage(options.unavailable)}
							</p>
							{renderRecovery?.(options.unavailable)}
						</div>
					)}
					{catalog.isError && (
						<p role="alert" className="text-sm text-destructive">
							{t("target.catalogFailed")}{" "}
							<button
								type="button"
								className="underline underline-offset-2 disabled:opacity-70"
								disabled={catalog.isFetching}
								onClick={retryCatalog}
							>
								{catalog.isFetching
									? t("target.loading")
									: t("common:actions.retry")}
							</button>
						</p>
					)}
				</div>
			)}
		</div>
	);
}
