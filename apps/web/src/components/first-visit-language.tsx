import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	DEFAULT_LOCALE,
	hasLocaleChoice,
	isLocale,
	LOCALES,
	localeName,
} from "#/lib/i18n/locale.ts";
import { chooseLocale, rememberLocale } from "#/lib/i18n/set-locale.ts";

/**
 * Asks once which language this browser wants, on the first visit only.
 *
 * Until now the first document was drawn from Accept-Language and the choice sat behind a header menu
 * (guests) or the settings screen (members) — someone whose browser advertises a language they do not
 * read had to find an icon in a language they cannot read. Asking up front removes that hunt.
 *
 * "First visit" is the cookie's absence, the same fact `resolveLocale` reads, so there is no second
 * flag to drift from it. Whichever way the window ends — a language pressed, Esc, the close button, an
 * outside press — the language on screen is written down, so it never asks again: a picker that came
 * back on every load would be a gate, not a question. Closing without choosing means "this is fine".
 *
 * It opens after hydration, never in the server render: the server cannot know whether the browser
 * will keep a document the cookie decided, and drawing the window there would mismatch on the one
 * render where it matters. Nothing waits on it — the page behind is already usable.
 */
export function FirstVisitLanguage() {
	const { t, i18n } = useTranslation("shell");
	const [open, setOpen] = useState(false);
	const current = isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;

	useEffect(() => {
		if (!hasLocaleChoice(document.cookie)) setOpen(true);
	}, []);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) return;
				rememberLocale(current);
				setOpen(false);
			}}
		>
			<DialogContent className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-sm`}>
				<DialogHeader>
					<DialogTitle>{t("language.firstVisitTitle")}</DialogTitle>
					<DialogDescription>
						{t("language.firstVisitDescription")}
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2">
					{LOCALES.map((locale) => {
						const active = locale === current;
						return (
							<Button
								key={locale}
								lang={locale}
								variant={active ? "secondary" : "outline"}
								aria-pressed={active}
								className="h-11 justify-between"
								onClick={() => {
									if (active) {
										rememberLocale(locale);
										setOpen(false);
										return;
									}
									chooseLocale(locale);
								}}
							>
								{localeName(locale)}
								{active && <Check className="size-4" aria-hidden />}
							</Button>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}
