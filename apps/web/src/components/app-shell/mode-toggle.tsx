import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { themeGlyphRhythm } from "#/lib/motion/transitions.ts";
import { useTheme } from "#/lib/theme/provider.tsx";

/**
 * Theme switch: light, dark or system.
 *
 * It is a menu rather than a toggle because there are three states. Cycling through two would leave
 * no way back to "follow the OS": once someone has pressed it, they stay on the app's own setting
 * even after the OS setting changes.
 *
 * The menu does not mark which item is the current value; the result is already visible across the
 * whole screen.
 *
 * The icon solves the problem that the server cannot know the current theme, without regressing:
 * both glyphs are drawn and cross-faded by the `dark` variant, so CSS, not React, decides which one
 * shows. Unlike the previous implementation, whose icon slot was empty until mount, the correct
 * icon appears from the first paint. For that reason this swap is not moved to `AnimatedIconSwap`:
 * that component decides from React state and would lose this first-paint property. Its rhythm
 * comes from the same place instead (`themeGlyphRhythm`, which replaced timing that had been
 * attached to Tailwind's default classes). The only properties that move are transforms, so
 * `motion-reduce` removes the transition entirely while the picture remains readable.
 */
export function ModeToggle() {
	const { t } = useTranslation("shell");
	const { setTheme } = useTheme();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						// Keeps the icon size and enlarges only the pressable area (same rule as the other icon
						// buttons in the header). `relative` is the anchor for the moon icon overlaid on it; without
						// it the sticky header becomes the anchor and the icon is pushed off-screen.
						className="relative size-10 sm:size-8"
					/>
				}
			>
				{/*
				 * The transition list is `[scale,rotate]`. In Tailwind v4, `scale-*` and `rotate-*`
				 * are independent properties rather than part of `transform`, and those two are the
				 * only properties that actually move here (`transition-transform` also covers them
				 * from 4.3.3 on, but this list names only what moves). Because only transforms
				 * move, `motion-reduce` removes the transition entirely while the picture stays
				 * readable.
				 */}
				<Sun
					style={themeGlyphRhythm}
					className="size-4 scale-100 rotate-0 transition-[scale,rotate] motion-reduce:transition-none dark:scale-0 dark:-rotate-90"
				/>
				<Moon
					style={themeGlyphRhythm}
					className="absolute size-4 scale-0 rotate-90 transition-[scale,rotate] motion-reduce:transition-none dark:scale-100 dark:rotate-0"
				/>
				<span className="sr-only">{t("theme.toggle")}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => setTheme("light")}>
					{t("theme.light")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("dark")}>
					{t("theme.dark")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("system")}>
					{t("theme.system")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
