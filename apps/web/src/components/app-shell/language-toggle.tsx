import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isLocale, LOCALES, localeName } from "#/lib/i18n/locale.ts";
import { chooseLocale } from "#/lib/i18n/set-locale.ts";

/**
 * Language switch for guests — the same reason `ModeToggle` stands for them only. Members change the
 * language in the settings screen's `Display` section; a guest cannot enter that screen, and without
 * this menu the only way to read the app in another language would be the browser's own
 * Accept-Language.
 *
 * It writes the same cookie and reloads through the same `chooseLocale` the settings row uses, so the
 * two entrances cannot disagree about where the choice lives. Each item is the language's own name
 * (and carries its `lang`), so someone who cannot read the current language still finds theirs.
 */
export function LanguageToggle() {
	const { t, i18n } = useTranslation("shell");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						// Same pressable area as the theme switch beside it.
						className="size-10 sm:size-8"
					/>
				}
			>
				<Languages className="size-4" />
				<span className="sr-only">{t("language.toggle")}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{LOCALES.map((locale) => (
					<DropdownMenuItem
						key={locale}
						lang={locale}
						onClick={() => {
							// Choosing the language already drawn would only reload the page.
							if (isLocale(i18n.language) && i18n.language === locale) return;
							chooseLocale(locale);
						}}
					>
						{localeName(locale)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
