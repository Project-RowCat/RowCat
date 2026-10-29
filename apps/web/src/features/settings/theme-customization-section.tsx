import type { ThemePreset } from "@rowcat/contracts";
import { THEME_CUSTOMIZATION_SLOTS } from "@rowcat/design";
import { nativeColorsFor } from "@rowcat/design/native";
import { APP_NAME } from "@rowcat/domain";
import {
	clearThemeColorsMutationOptions,
	resetThemeMutationOptions,
	saveThemeColorsMutationOptions,
	saveThemePresetMutationOptions,
	THEME_CUSTOMIZATION_QUERY_KEY,
	themeCustomizationQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@rowcat/ui-web/components/popover";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { Slider } from "@rowcat/ui-web/components/slider";
import { Switch } from "@rowcat/ui-web/components/switch";
import { cn } from "@rowcat/ui-web/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import { AnimatedCount } from "#/lib/motion/animated-count.tsx";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import { themeGradientCss } from "#/lib/theme/background-gradient.ts";
import { useTheme } from "#/lib/theme/provider.tsx";
import { SettingsGroup, SettingsRowFrame } from "./settings-parts.tsx";
import { ThemeColorPicker } from "./theme-customization-picker.tsx";
import {
	normalizedThemeDraftValue,
	THEME_PRESET_ORDER,
	type ThemeDraft,
	type ThemeFailureScope,
	type ThemePreviewBaseColors,
	type ThemePreviewColors,
	themeClearColorsLabel,
	themeCustomGroupDescription,
	themeCustomGroupTitle,
	themeCustomizationView,
	themeDraftEquals,
	themeDraftFrom,
	themeDraftHasValue,
	themeDraftValidation,
	themeDraftWithColor,
	themeDraftWithGradientAngle,
	themeDraftWithGradientEnabled,
	themeDraftWithGradientStop,
	themeDraftWithRandomGradient,
	themeDraftWithRandomPalette,
	themeFailureFor,
	themeForegroundNote,
	themeGradientAngleLabel,
	themeGradientAngleUnit,
	themeGradientContrastWarning,
	themeGradientFromLabel,
	themeGradientFromNote,
	themeGradientNeedsWarning,
	themeGradientToControlName,
	themeGradientToDescription,
	themeGradientToggleDescription,
	themeGradientToggleLabel,
	themeGradientToLabel,
	themePresetGroupDescription,
	themePresetGroupTitle,
	themePresetLabel,
	themePresetSwatch,
	themePreviewColors,
	themePreviewNote,
	themePreviewTitle,
	themeRandomGradientLabel,
	themeRandomPaletteLabel,
	themeRequestFrom,
	themeResetAllLabel,
	themeResetMenuLabel,
	themeSaveLabel,
	themeSaveNote,
	themeSectionDescription,
	themeSectionTitle,
	themeSlotDescription,
	themeSlotFallbackColors,
	themeSlotLabel,
	themeSlotUnsetLabel,
} from "./theme-customization-state.ts";

/**
 * The theme section does not apply colors. Applying is done by the root apply layer
 * (features/theme/account-theme-bridge.tsx). This section only edits the resource. Applying here
 * would make colors disappear as soon as the user left the settings screen.
 *
 * Two subsections: basic colors (preset cards, saved immediately on press) and custom colors
 * (drafts committed with the save button).
 *
 * The custom section was once gated to `cat tower` subscribers, and this file rendered a lock notice and
 * a /billing link. Both were removed when payments were dropped from the public build
 * (docs/oss/PLAN.md, step 3).
 */
export function ThemeCustomizationGroup() {
	const { t } = useTranslation(["settings", "common"]);
	const client = getRowCatClient();
	const queryClient = useQueryClient();

	/**
	 * Guests get no section and no query. Disabled controls are not used as placeholders in this repo
	 * because they read as 'coming soon'. The settings screen requires sign-in, so this branch is
	 * effectively unreachable. The query's enabled flag still should not depend on that fact.
	 */
	const viewerId = useQuery(viewerQueryOptions(client)).data?.id ?? null;

	const query = useQuery({
		...themeCustomizationQueryOptions(client),
		enabled: viewerId !== null,
	});

	const view = themeCustomizationView({
		state: query.data,
		isError: query.isError,
		isPaused: query.fetchStatus === "paused",
	});

	/**
	 * Retry button. On a paused query, query.refetch() does nothing. This section detected isPaused
	 * but still called raw refetch(), so the button was dead for offline users. The rule lives in
	 * lib/query/panel-retry.ts.
	 */
	const retry = usePanelRetry(THEME_CUSTOMIZATION_QUERY_KEY, query);

	if (!viewerId) return null;

	return (
		<SettingsGroup
			title={themeSectionTitle()}
			description={themeSectionDescription()}
		>
			{view.kind === "loading" && <ThemeSkeleton />}

			{/*
			 * Separates paused from failed. A paused query stays pending, so a placeholder would show
			 * offline users a loading state that never ends.
			 */}
			{view.kind === "offline" && (
				<SettingsRowFrame>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
						{/* `<output>` implicitly has role=status, so updates are announced once, politely. */}
						<output className="block text-sm text-muted-foreground">
							{t("themeCustomizationSection.youReNotConnectedRight")}
						</output>
						{/*
						 * Retry also appears while paused. A tab whose connection came back but missed the signal can
						 * only leave this state through this button. panel-retry.ts recovers that signal.
						 */}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={query.isFetching}
							onClick={retry}
						>
							{query.isFetching
								? t("common:state.loading")
								: t("common:actions.retry")}
						</Button>
					</div>
				</SettingsRowFrame>
			)}

			{view.kind === "error" && (
				<SettingsRowFrame>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
						<p className="text-sm text-muted-foreground" role="alert">
							{t("themeCustomizationSection.couldnTLoadThemeSettings")}
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={query.isFetching}
							onClick={retry}
						>
							{query.isFetching
								? t("common:state.loading")
								: t("common:actions.retry")}
						</Button>
					</div>
				</SettingsRowFrame>
			)}

			{view.kind === "ready" && (
				<ThemeEditor
					key={viewerId}
					preset={view.preset}
					customization={view.customization}
					client={client}
					queryClient={queryClient}
				/>
			)}
		</SettingsGroup>
	);
}

/**
 * Skeleton shown while the value loads, so the row does not jump. It uses the same structure as the
 * real editor.
 */
function ThemeSkeleton() {
	return (
		<SettingsRowFrame>
			<div className="flex flex-col gap-3">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-28 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
		</SettingsRowFrame>
	);
}

function ThemeEditor({
	preset,
	customization,
	client,
	queryClient,
}: {
	preset: ThemePreset;
	customization: Parameters<typeof themeDraftFrom>[0];
	client: ReturnType<typeof getRowCatClient>;
	queryClient: ReturnType<typeof useQueryClient>;
}) {
	const { t } = useTranslation(["settings", "common"]);
	/**
	 * Base palette for the current appearance, used to fill preview slots that no preset or draft
	 * overrides. Appearance does not enter account-theme resolution. Presets and custom colors are
	 * independent of it. Here it only decides what an unoverridden slot looks like, because the
	 * preview and preset cards must draw a complete mini theme.
	 */
	const { scheme } = useTheme();
	const base: ThemePreviewBaseColors = nativeColorsFor(scheme);

	/**
	 * Name of the radio group, generated with useId. The component is never rendered twice in one
	 * document, but a hard-coded name would turn that into an assumption. Radios sharing a name clear
	 * each other's selection.
	 */
	const presetGroupName = useId();

	const saved = themeDraftFrom(customization);
	const [draft, setDraft] = useState<ThemeDraft>(saved);
	/**
	 * A failure message plus the action it belongs to. Message text alone goes into one fixed slot,
	 * which here was the bottom of the section. The preset cards are at the top, so a failed preset
	 * save appeared far from the click and looked like a dropped click. The placement table lives in
	 * the pure module (themeFailureFor).
	 *
	 * Only one failure is shown at a time. A new action clears the previous failure.
	 */
	const [failure, setFailure] = useState<{
		scope: ThemeFailureScope;
		message: string;
	} | null>(null);

	/**
	 * Syncs the draft to the server value when that value changes: after a save from another device,
	 * or after a save or reset completes here. Sync happens only when a saved string actually differs,
	 * so in-progress edits are not overwritten. The comparison is over three strings and can be done
	 * by value.
	 *
	 * Presets are not in this list. Changing the preset would reset an in-progress custom draft, so
	 * merely trying a preset while picking a color would lose the draft.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: syncs only when the saved value actually changes.
	useEffect(() => {
		setDraft(saved);
		setFailure(null);
	}, [
		saved.background,
		saved.surface,
		saved.primary,
		/**
		 * The gradient is compared by its saved shape. Putting the whole object in the dependency list
		 * would produce a new reference on every render, so this effect would run constantly and
		 * overwrite the draft in progress. Values would keep reverting while the color picker is open.
		 */
		saved.gradient.enabled,
		saved.gradient.to,
		saved.gradient.angle,
	]);

	/**
	 * A preset save failure appears directly below the card that was pressed. It used to share the
	 * slot below the custom colors, which put the message a screen away from the click. Only one
	 * failure appears at a time, so two messages never show together.
	 */
	const savePreset = useMutation({
		...saveThemePresetMutationOptions(client, queryClient),
		onError: () => setFailure(themeFailureFor("preset")),
	});

	const saveColors = useMutation({
		...saveThemeColorsMutationOptions(client, queryClient),
		/**
		 * The raw error text is not shown. The draft is not cleared: a network blip should not discard a
		 * color the user just picked and force them to pick it again.
		 */
		onError: () => setFailure(themeFailureFor("colors")),
	});

	const clearColors = useMutation({
		...clearThemeColorsMutationOptions(client, queryClient),
		onError: () => setFailure(themeFailureFor("clearColors")),
	});

	const resetAll = useMutation({
		...resetThemeMutationOptions(client, queryClient),
		onError: () => setFailure(themeFailureFor("resetAll")),
	});

	const validation = themeDraftValidation(draft);
	const pending =
		savePreset.isPending ||
		saveColors.isPending ||
		clearColors.isPending ||
		resetAll.isPending;
	const dirty = !themeDraftEquals(draft, saved);
	/** An invalid draft has no document to send (null), so saving stays locked until it is fixed. */
	const request = themeRequestFrom(draft);

	/** The preview is the selected preset plus the draft, in the same order as the actual apply. */
	const preview = themePreviewColors(preset, draft, base);
	/**
	 * Fallback color for each empty slot, meaning what the slot will actually show. Swatches, the
	 * picker and the preview all read this same value.
	 */
	const fallback = themeSlotFallbackColors(preset, base);

	return (
		/**
		 * The section has two surfaces, and together they are the whole editor:
		 * 1. Pick a base and see the result: preset cards plus the preview.
		 * 2. Fine-tune on top and save: color rows, gradient, reset, save.
		 *
		 * It once had six SettingsRowFrame blocks. That frame expresses independent settings, but these
		 * are parts of one editor, so the screen read as three settings and an action. The preview sits
		 * directly below the presets because the next question after pressing a card is how it looks. The
		 * answer should not require scrolling past the color rows.
		 */
		<div className="flex flex-col">
			<SettingsRowFrame>
				<div className="flex flex-col gap-4">
					<fieldset disabled={pending} className="min-w-0">
						<legend className="text-sm font-medium">
							{themePresetGroupTitle()}
						</legend>
						<p className="mt-1 mb-3 text-sm text-muted-foreground">
							{themePresetGroupDescription()}
						</p>
						{/*
						 * The container is a native radio group. Four inputs sharing one name give arrow-key movement
						 * and a single tab stop for free. A div with role=radiogroup only promises that behavior without
						 * implementing it.
						 * The group's name comes from the legend above, so no aria-label is set. Otherwise assistive
						 * tech would read the same name twice.
						 */}
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
							{THEME_PRESET_ORDER.map((value) => (
								<ThemePresetCard
									key={value}
									preset={value}
									name={presetGroupName}
									selected={value === preset}
									colors={themePresetSwatch(value, base)}
									disabled={pending}
									onSelect={() => {
										if (value === preset) return;
										setFailure(null);
										savePreset.mutate(value);
									}}
								/>
							))}
						</div>
						{/*
						 * Preset save failures appear here, directly below the card just pressed. This action is not
						 * optimistic, so after a failure the card selection is unchanged. If the message were
						 * off-screen, the click would look ignored.
						 *
						 * No enter or exit animation is used. The preview below would wait for the message to fade out,
						 * and in tabs that never receive animation frames it would wait forever. The disconnect banner
						 * made the same call.
						 */}
						{failure?.scope === "preset" && (
							<p className="mt-3 text-sm text-destructive" role="alert">
								{failure.message}
							</p>
						)}
					</fieldset>

					{/*
					 * The preview shows the result of the chosen base. The custom draft from the section below is
					 * drawn in this box too.
					 */}
					<ThemePreview colors={preview} />
				</div>
			</SettingsRowFrame>

			<SettingsRowFrame>
				<div className="flex flex-col gap-4">
					<div className="min-w-0">
						<h3 className="text-sm font-medium">{themeCustomGroupTitle()}</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							{themeCustomGroupDescription()}
						</p>
					</div>

					<fieldset disabled={pending} className="min-w-0">
						<legend className="sr-only">{themeCustomGroupTitle()}</legend>
						<div className="flex flex-col gap-4">
							{THEME_CUSTOMIZATION_SLOTS.map((slot) => (
								<ThemeColorRow
									key={slot}
									label={themeSlotLabel(slot)}
									controlName={themeSlotLabel(slot)}
									description={themeSlotDescription(slot)}
									value={draft[slot]}
									valid={validation[slot]}
									fallbackColor={fallback[slot]}
									disabled={pending}
									/**
									 * Goes through the draft converter. Clearing the background also turns the gradient off,
									 * because a gradient without a first stop cannot be drawn. Expanding the object by hand
									 * here would drop that invariant from this one line. The symptom would be saving locked
									 * with no visible reason.
									 */
									onChange={(value) =>
										setDraft((current) =>
											themeDraftWithColor(current, slot, value),
										)
									}
								/>
							))}

							{/*
							 * The foreground-color note and the `Random palette` button share one line, since both concern the
							 * color rows directly above. The note explains the axis those rows do not set. The button
							 * regenerates all of them.
							 * `Random palette` changes only the local draft and makes no server call, so pressing it repeatedly
							 * changes nothing on the account. The value saves only when `Save colors` is pressed.
							 *
							 * The random source is passed in from here rather than taken from Math.random inside the rule.
							 * That lets tests verify that generated palettes are always readable.
							 */}
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-sm text-muted-foreground">
									{themeForegroundNote()}
								</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={pending}
									onClick={() => {
										setFailure(null);
										setDraft((current) =>
											themeDraftWithRandomPalette(current, Math.random),
										);
									}}
								>
									{themeRandomPaletteLabel()}
								</Button>
							</div>

							<ThemeGradientControls
								draft={draft}
								valid={validation.gradient}
								fallbackBackground={fallback.background}
								warn={themeGradientNeedsWarning(preview)}
								disabled={pending}
								onDraftChange={(next) => setDraft(next)}
							/>
						</div>
					</fieldset>

					{/*
					 * The commit row holds every action in this section. Save is the primary action (filled,
					 * rightmost). The two resets sit behind a single menu on the opposite side.
					 * With all three at equal weight, the screen did not say which to press. Save is what people
					 * press after editing. Resets are for people returning to undo, and equal weight hid that.
					 *
					 * Failures from this section are also shown here, next to the retry point. Preset failures are
					 * not, since the section above owns them.
					 */}
					{failure?.scope === "custom" && (
						<p className="text-sm text-destructive" role="alert">
							{failure.message}
						</p>
					)}
					<div className="flex flex-col gap-2">
						<p className="text-sm text-muted-foreground">{themeSaveNote()}</p>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<ThemeResetMenu
								pending={pending}
								resetting={clearColors.isPending || resetAll.isPending}
								canClearColors={themeDraftHasValue(saved)}
								canResetAll={themeDraftHasValue(saved) || preset !== "default"}
								onClearColors={() => {
									setFailure(null);
									clearColors.mutate();
								}}
								onResetAll={() => {
									setFailure(null);
									resetAll.mutate();
								}}
							/>
							<Button
								type="button"
								size="sm"
								className="ml-auto"
								disabled={pending || !dirty || request === null}
								onClick={() => {
									if (request === null) return;
									setFailure(null);
									saveColors.mutate(request);
								}}
							>
								{saveColors.isPending
									? t("themeCustomizationSection.saving")
									: themeSaveLabel()}
							</Button>
						</div>
					</div>
				</div>
			</SettingsRowFrame>
		</div>
	);
}

/**
 * Groups the two reset actions in one menu instead of two buttons. The commit row once showed three
 * actions at equal weight, which implied a choice. In practice the person who finished editing
 * presses save, and the resets belong to someone undoing. The two resets stay separate because
 * clearing custom colors and resetting everything have different costs. Presets are easy to
 * re-pick, while custom colors must be recreated.
 *
 * The menu is not rendered when there is nothing to clear. Resets run immediately without
 * confirmation. Adding a confirmation dialog is a separate decision and is not made here. The draft
 * is not cleared optimistically, so a failed request does not look like a successful reset.
 */
function ThemeResetMenu({
	pending,
	resetting,
	canClearColors,
	canResetAll,
	onClearColors,
	onResetAll,
}: {
	/** True while any action in this section is running. Locks the trigger and its items together. */
	pending: boolean;
	/** True only while a reset is running. The trigger label states which action it is. */
	resetting: boolean;
	canClearColors: boolean;
	canResetAll: boolean;
	onClearColors: () => void;
	onResetAll: () => void;
}) {
	const { t } = useTranslation(["settings", "common"]);
	if (!canClearColors && !canResetAll) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending}
					/>
				}
			>
				{resetting
					? t("themeCustomizationSection.resetting")
					: themeResetMenuLabel()}
				<ChevronDown aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-48">
				{canClearColors && (
					<DropdownMenuItem disabled={pending} onClick={onClearColors}>
						{themeClearColorsLabel()}
					</DropdownMenuItem>
				)}
				{canResetAll && (
					<DropdownMenuItem disabled={pending} onClick={onResetAll}>
						{themeResetAllLabel()}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Preset card. The swatch is drawn before the name because users recognize a preset by how it
 * looks. Colors come from the shared resolver (themePresetSwatch) and are not repeated here. A card
 * that held its own preview colors would go stale when the palette is tuned.
 *
 * Uses a real native radio input, not a button with role=radio. Such a button announces a radio
 * group without implementing its arrow-key movement, so keyboard users would have to tab through
 * all four cards. Native inputs provide arrow movement, a single tab stop and form semantics.
 *
 * The input is visually hidden (sr-only) and the label draws the visible card. Focus is shown on
 * the card through has-[:focus-visible].
 */
function ThemePresetCard({
	preset,
	name,
	selected,
	colors,
	disabled,
	onSelect,
}: {
	preset: ThemePreset;
	/** Shared name of the radios in the same group. Arrow-key movement is scoped by this value. */
	name: string;
	selected: boolean;
	colors: ReturnType<typeof themePresetSwatch>;
	disabled: boolean;
	onSelect: () => void;
}) {
	return (
		<label
			className={cn(
				"flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
				"has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
				"has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
				selected ? "border-primary ring-2 ring-primary/30" : "hover:bg-accent",
			)}
		>
			<input
				type="radio"
				name={name}
				value={preset}
				checked={selected}
				disabled={disabled}
				onChange={onSelect}
				className="sr-only"
			/>
			{/*
			 * The swatch is decorative. Its three color chips are hidden from assistive tech, since they
			 * add nothing for it. The name comes from the text below and the selected state from the radio.
			 */}
			<span
				aria-hidden
				className="flex h-12 w-full flex-col justify-between rounded-md border p-1.5"
				style={{ backgroundColor: colors.background }}
			>
				<span
					className="h-3.5 w-3/4 rounded-sm"
					style={{ backgroundColor: colors.surface }}
				/>
				<span
					className="h-2.5 w-1/3 self-end rounded-sm"
					style={{ backgroundColor: colors.primary }}
				/>
			</span>
			<span className="text-xs font-medium">{themePresetLabel(preset)}</span>
		</label>
	);
}

/**
 * The preview is the only place where unsaved draft changes show immediately. It has three slots:
 * the outer panel is the background, the inner card is the surface, and the button is the primary
 * color. All colors come from the shared derivation (themePreviewColors, then
 * readableForegroundOn). This component does not recalculate contrast.
 *
 * aria-hidden because the preview is not interactive. The `Start` inside is not a button, and a
 * screen reader should not announce a button that does nothing. The status is explained by the
 * sentence below.
 */
function ThemePreview({ colors }: { colors: ThemePreviewColors }) {
	const { t } = useTranslation(["settings", "common"]);
	return (
		<div className="flex flex-col gap-2">
			{/*
			 * The outer panel is the page floor, and the only place the gradient is drawn. The inner card
			 * and button stay solid, matching the real screen, where the gradient is the page background
			 * rather than a paint applied to every element that uses the background color.
			 * The CSS string comes from the same function used on apply (themeGradientCss). Assembling it
			 * here would make the preview and the saved screen differ, and that difference would only show
			 * after saving.
			 * The solid background stays underneath, so the panel is not empty even without a gradient image.
			 */}
			<div
				aria-hidden
				className="rounded-lg border p-4 sm:p-5"
				style={{
					backgroundColor: colors.background,
					backgroundImage: colors.gradient
						? (themeGradientCss(colors.gradient) ?? undefined)
						: undefined,
					color: colors.foreground,
				}}
			>
				<div
					className="mx-auto flex w-full max-w-72 flex-col gap-1 rounded-md p-4 shadow-sm ring-1 ring-black/10"
					style={{
						backgroundColor: colors.surface,
						color: colors.surfaceForeground,
					}}
				>
					<span className="text-sm font-semibold">{APP_NAME}</span>
					<span className="text-xs opacity-80">{themePreviewTitle()}</span>
					<span
						className="mt-3 self-end rounded-md px-3 py-1.5 text-xs font-medium"
						style={{
							backgroundColor: colors.primary,
							color: colors.primaryForeground,
						}}
					>
						{t("themeCustomizationSection.getStarted")}
					</span>
				</div>
			</div>
			<p className="text-xs text-muted-foreground">{themePreviewNote()}</p>
		</div>
	);
}

/**
 * Gradient controls: one switch, and beneath it three rows: start (read-only), end and angle.
 *
 * The start color has no control. The first stop is the background row's value. A second picker
 * here would create two places editing the same value, which could normalize differently, and the
 * screen could not say which one is saved.
 *
 * Turning the switch on promotes the background to a draft. If the background is empty (using a
 * preset color), the color currently shown becomes the draft background. This is explicit
 * customization. Without it, the form could hold a gradient with no first stop, which cannot be
 * saved. The rule lives in themeDraftWithGradientEnabled so it can be checked without rendering.
 *
 * While the controls change, only the preview above changes. Nothing reaches the document until the
 * server confirms the save.
 */
function ThemeGradientControls({
	draft,
	valid,
	fallbackBackground,
	warn,
	disabled,
	onDraftChange,
}: {
	draft: ThemeDraft;
	/** Syntax check for the end color. Always passes while the gradient is off. */
	valid: boolean;
	/**
	 * Background color shown when the background slot is empty. Turning the gradient on freezes it as
	 * the first stop.
	 */
	fallbackBackground: string;
	/** Both ends are unreadable with the text color. This is a warning, not an error. */
	warn: boolean;
	disabled: boolean;
	onDraftChange: (draft: ThemeDraft) => void;
}) {
	const id = useId();
	const labelId = `${id}-label`;
	const descriptionId = `${id}-description`;
	const angleLabelId = `${id}-angle`;

	const { gradient } = draft;
	/** The first stop as drawn in the swatch: the preset color when the draft background is empty. */
	const from =
		normalizedThemeDraftValue(draft.background) === ""
			? fallbackBackground
			: normalizedThemeDraftValue(draft.background);

	return (
		<div className="flex flex-col gap-4 border-t pt-4">
			<div className="flex items-center justify-between gap-4">
				<div className="min-w-0">
					<p id={labelId} className="text-sm font-medium">
						{themeGradientToggleLabel()}
					</p>
					<p id={descriptionId} className="text-sm text-muted-foreground">
						{themeGradientToggleDescription()}
					</p>
				</div>
				<Switch
					checked={gradient.enabled}
					disabled={disabled}
					aria-labelledby={labelId}
					aria-describedby={descriptionId}
					onCheckedChange={(checked) =>
						onDraftChange(
							themeDraftWithGradientEnabled(draft, checked, fallbackBackground),
						)
					}
				/>
			</div>

			{/*
			 * When the gradient is on, its controls are children of the switch. Indentation and a left rule
			 * show that.
			 * Without this, the gradient rows would read as separate top-level settings. The editor would
			 * appear to hold seven settings instead of three color rows and one switch with children.
			 */}
			{gradient.enabled && (
				<div className="ml-1 flex flex-col gap-4 border-l pl-4">
					{/*
					 * The start color is a read-only picture. The swatch has aria-hidden and its value is written out
					 * as text, because a screen reader cannot read a color chip. Nothing here can be edited.
					 */}
					<div className="flex items-center justify-between gap-4">
						<div className="min-w-0">
							<p className="text-sm font-medium">{themeGradientFromLabel()}</p>
							<p className="text-sm text-muted-foreground">
								{themeGradientFromNote()}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<span className="font-mono text-xs text-muted-foreground">
								{from}
							</span>
							<span
								aria-hidden
								className="size-9 shrink-0 rounded-md border shadow-xs"
								style={{ backgroundColor: from }}
							/>
						</div>
					</div>

					{/*
					 * The end color reuses the color-row component, so no second picker is built. With no value, its
					 * swatch shows the first stop, but that does not promote it to the draft.
					 */}
					<ThemeColorRow
						label={themeGradientToLabel()}
						/**
						 * The visible label is `End color`, but the control's name is `Gradient end`. Building the name from
						 * the visible label would give `Edit end color`, an overlap that only screen readers hear. Using
						 * just `End` would leave the popover with no context about which end is meant.
						 */
						controlName={themeGradientToControlName()}
						description={themeGradientToDescription()}
						value={gradient.to}
						valid={valid}
						fallbackColor={from}
						disabled={disabled}
						onChange={(value) =>
							onDraftChange(themeDraftWithGradientStop(draft, value))
						}
					/>

					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-4">
							<span id={angleLabelId} className="text-sm font-medium">
								{themeGradientAngleLabel()}
							</span>
							{/*
							 * Continuous: the value changes on every frame while dragging. Bursts of changes are swapped in
							 * immediately rather than animated (countRollHasTime). A rolling animation applies only to
							 * discrete changes, such as one arrow key press or one `Random gradient` press.
							 */}
							<span className="font-mono text-xs text-muted-foreground">
								<AnimatedCount
									value={String(gradient.angle)}
									cadence="continuous"
								/>
								{themeGradientAngleUnit()}
							</span>
						</div>
						{/*
						 * The value is an array, though it looks like a mistake. Given a non-array, this wrapper draws
						 * two handles (it falls back to [min, max]). The angle has one handle, so it is passed as a
						 * one-element array.
						 *
						 * The maximum is 359, not 360. 360 is the same direction as 0, so accepting both would enable
						 * the save button for someone who slid to the end and back. The draft converter folds 360 once
						 * more anyway, because the keyboard can produce it.
						 */}
						<Slider
							value={[gradient.angle]}
							min={0}
							max={359}
							step={1}
							disabled={disabled}
							aria-labelledby={angleLabelId}
							format={{
								style: "unit",
								unit: "degree",
								unitDisplay: "narrow",
							}}
							onValueChange={(value) =>
								onDraftChange(
									themeDraftWithGradientAngle(
										draft,
										Array.isArray(value) ? (value[0] ?? 0) : value,
									),
								)
							}
						/>
					</div>

					{/*
					 * Re-rolls only the gradient; the color rows stay. A real case: someone likes the background and
					 * wants only the direction and end color changed. The full random button would discard the
					 * background they just picked.
					 */}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={() =>
								onDraftChange(themeDraftWithRandomGradient(draft, Math.random))
							}
						>
							{themeRandomGradientLabel()}
						</Button>
					</div>

					{/*
					 * Contrast warning. It does not block saving and does not change the chosen colors. The preview
					 * draws them as requested.
					 * Uses `<output>` (implicit role=status) because this is not a failure. Conditions change while
					 * the slider is dragged, and an alert role would interrupt assistive tech throughout.
					 */}
					{warn && (
						<output className="block text-sm text-muted-foreground">
							{themeGradientContrastWarning()}
						</output>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * One color row: name, description and a single swatch. Editing happens in the popover that the
 * swatch opens.
 *
 * A blank slot is not drawn as a black swatch (§26). The selected preset's color is drawn with a
 * dashed border and labeled `Preset color`. Otherwise 'picked black' and 'picked nothing' would look
 * identical, and the user could not learn the difference from the screen.
 */
function ThemeColorRow({
	label,
	controlName,
	description,
	value,
	valid,
	fallbackColor,
	disabled,
	onChange,
}: {
	/**
	 * Visible name in the row. The row takes a label rather than a slot key, because the same row also
	 * serves the gradient end color, which is not a slot. Adding a slot to make room would make the
	 * contract look like it has four slots, while THEME_CUSTOMIZATION_SLOTS has three.
	 */
	label: string;
	/**
	 * Word used when assembling the control name, kept separate from the visible label. The trigger
	 * and picker names are built as `Edit ${controlName} color` and `${controlName} color hue`. Using the
	 * visible label would produce `Edit end color`. That overlap is invisible on screen and is only read
	 * aloud by screen readers.
	 */
	controlName: string;
	description: string;
	value: string;
	valid: boolean;
	/**
	 * Color the swatch and picker show when no value is set: the selected preset's value, or the
	 * current appearance's default if there is none. It is not promoted to the draft. Saving still
	 * sends only the chosen slots.
	 */
	fallbackColor: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation(["settings", "common"]);
	const id = useId();
	const descriptionId = `${id}-description`;
	const [open, setOpen] = useState(false);

	const normalized = normalizedThemeDraftValue(value);
	const hasCustom = valid && normalized !== "";
	const displayColor = hasCustom ? normalized : fallbackColor;

	return (
		<div className="flex items-center justify-between gap-4">
			<div className="min-w-0">
				<p className="text-sm font-medium">{label}</p>
				<p id={descriptionId} className="text-sm text-muted-foreground">
					{description}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<span
					className={cn(
						"font-mono text-xs",
						valid ? "text-muted-foreground" : "text-destructive",
					)}
				>
					{value === "" ? themeSlotUnsetLabel() : valid ? normalized : value}
				</span>
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger
						render={
							<button
								type="button"
								disabled={disabled}
								aria-label={t("section.editColor", { name: controlName })}
								aria-describedby={descriptionId}
								aria-invalid={!valid || undefined}
								className={cn(
									"size-9 shrink-0 rounded-md border shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
									!hasCustom && "border-dashed",
									!valid && "border-destructive",
								)}
								style={{ backgroundColor: displayColor }}
							/>
						}
					/>
					{/*
					 * The picker is not mounted while the popover is closed (the portal does this), so the HSV axes
					 * live exactly as long as the popover. Opening alone does not change the draft. A custom value is
					 * created only after the picker has actually moved something.
					 *
					 * On narrow screens the popover width shrinks with the viewport so it does not overflow.
					 * Placement and collision handling remain the primitive's job.
					 */}
					<PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
						<PopoverHeader>
							<PopoverTitle>{label}</PopoverTitle>
							<PopoverDescription>{description}</PopoverDescription>
						</PopoverHeader>
						<ThemeColorPicker
							label={controlName}
							value={value}
							fallbackColor={fallbackColor}
							valid={valid}
							onChange={onChange}
						/>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
