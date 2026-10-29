import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { cn } from "@rowcat/ui-web/lib/utils";
import { ClientOnly } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SELECT_TRIGGER_HEIGHT } from "#/lib/control-geometry.ts";
import { translator } from "#/lib/i18n/current.ts";
import {
	DEFAULT_LOCALE,
	isLocale,
	LOCALES,
	type Locale,
	localeName,
} from "#/lib/i18n/locale.ts";
import { chooseLocale } from "#/lib/i18n/set-locale.ts";
import { useTheme } from "#/lib/theme/provider.tsx";
import {
	SettingsGroup,
	SettingsRow,
	SettingsRowFrame,
} from "./settings-parts.tsx";

/**
 * This section does not own the theme. The source of truth is `lib/theme/provider.tsx`, which
 * writes localStorage and sets a class on the document root. This section only calls the same
 * `setTheme`. A second state (`settingsTheme`) would make the header toggle and this screen show
 * different values, and only a refresh would fix that.
 *
 * The member header has no toggle, because this section handles all three states and two places
 * would change the same value. The guest header keeps it, following the same rule: this screen is
 * reachable only when logged in, so removing the toggle for guests would leave no way to change the
 * theme inside the app (the login screen is also outside the shell).
 *
 * The theme is attached to the device, not the member. Logged-out users must still see dark mode,
 * and moving the value to member scope would leave nowhere to keep a guest's theme. This one value
 * therefore lives in localStorage rather than the per-member local database. The exception is
 * documented in `docs/settings/ARCHITECTURE.md`.
 *
 * No settings are added to fill this section. Theme is the only display setting today. A one-row
 * section is short but not a problem, while placeholders for language, text size, or density would
 * turn the screen into a list of empty slots.
 */

const THEME_VALUES = ["system", "light", "dark"] as const;
type ThemeValue = (typeof THEME_VALUES)[number];

const themeOptions = () =>
	THEME_VALUES.map((value) => ({
		value,
		label: translator("settings")(`appearance.theme.${value}`),
	}));

export function AppearanceGroup() {
	const { t } = useTranslation(["settings", "common"]);
	return (
		<SettingsGroup title={t("appearanceSection.display")}>
			{/*
			 * The server cannot know this value; it lives in the browser's localStorage and the OS setting.
			 * Rendering `System` on the server would make a user who chose `Dark` see the value change every
			 * time settings open, which is also a hydration mismatch. This is a real wait, so a placeholder is
			 * right. Its size matches the trigger, so the row does not move when the value arrives.
			 */}
			<ClientOnly fallback={<ThemeRowFallback />}>
				<ThemeRow />
			</ClientOnly>
			{/*
			 * The language is known on the server (the cookie decides the render), so unlike the theme
			 * row this one needs no client-only wait.
			 */}
			<LanguageRow />
		</SettingsGroup>
	);
}

/**
 * The label is `Screen brightness`, not `Theme`. The section below (account color) is titled
 * `Theme`. While this row used the same word, `Theme` appeared twice on one screen, and the titles alone
 * could not show what each control covered. The placeholder and the real row read the same value,
 * using the same word as the mobile `appearance-copy.ts`.
 */
const appearanceFieldLabel = (): string =>
	translator("settings")("appearanceSection.screenBrightness");

/**
 * Placeholder shown before the browser part arrives. It uses the same skeleton as the real row so
 * heights do not differ.
 */
function ThemeRowFallback() {
	return (
		<SettingsRowFrame>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<span className="text-sm font-medium">{appearanceFieldLabel()}</span>
				<Skeleton className="h-9 w-full shrink-0 sm:h-8 sm:w-56" />
			</div>
		</SettingsRowFrame>
	);
}

function ThemeRow() {
	const { t } = useTranslation(["settings", "common"]);
	const { theme, setTheme } = useTheme();
	const id = useId();
	/**
	 * The description belongs to this control. It says what is picked and where the choice applies:
	 * this browser only. `SettingsRow` already had a slot for that id, but nothing passed it, so
	 * screen-reader users got no such sentence.
	 */
	const descriptionId = `${id}-description`;

	return (
		<SettingsRow
			label={appearanceFieldLabel()}
			htmlFor={id}
			description={t("appearanceSection.followTheSystemSettingOr")}
			descriptionId={descriptionId}
			control={
				<Select
					/*
					 * Pass `items` so the trigger shows the label rather than the raw value. Without it,
					 * `SelectValue` displays the stored value, so the user would see `system`.
					 */
					items={themeOptions()}
					value={theme}
					// Picking the same item again gives `null`. Nothing should happen in that case.
					onValueChange={(next) => {
						if (next === null || next === theme) return;
						setTheme(next as ThemeValue);
					}}
				>
					<SelectTrigger
						id={id}
						size="sm"
						aria-describedby={descriptionId}
						className={cn(SELECT_TRIGGER_HEIGHT, "w-full")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{themeOptions().map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
		/>
	);
}

/**
 * The display language. Choosing writes the cookie and reloads (`chooseLocale`): the server draws
 * the next document in the new language, and strings pure modules already produced would otherwise
 * stay in the old one. Names are each language's own, so someone who cannot read the current
 * language can still find theirs.
 */
function LanguageRow() {
	const { t, i18n } = useTranslation(["settings", "common"]);
	const current: Locale = isLocale(i18n.language)
		? i18n.language
		: DEFAULT_LOCALE;
	const id = useId();
	const descriptionId = `${id}-description`;
	const options = LOCALES.map((value) => ({ value, label: localeName(value) }));

	return (
		<SettingsRow
			label={t("appearance.language")}
			htmlFor={id}
			description={t("appearance.languageDescription")}
			descriptionId={descriptionId}
			control={
				<Select
					items={options}
					value={current}
					onValueChange={(next) => {
						if (!isLocale(next) || next === current) return;
						chooseLocale(next);
					}}
				>
					<SelectTrigger
						id={id}
						size="sm"
						aria-describedby={descriptionId}
						className={cn(SELECT_TRIGGER_HEIGHT, "w-full")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{options.map((option) => (
							<SelectItem
								key={option.value}
								value={option.value}
								lang={option.value}
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
		/>
	);
}
