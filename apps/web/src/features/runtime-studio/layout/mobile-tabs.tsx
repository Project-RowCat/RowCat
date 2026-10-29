import { cn } from "@rowcat/ui-web/lib/utils";
import { useTranslation } from "react-i18next";
import { translator } from "#/lib/i18n/current.ts";
import { MotionActiveIndicator } from "#/lib/motion/active-indicator.tsx";
import {
	RUNTIME_MOBILE_TABS,
	type RuntimeMobileTab,
} from "../runtime-workspace-state.ts";

/**
 * Narrow-screen switcher for the files, code and preview faces. All three are not shown side by
 * side: at 390px, three columns leave none usable, especially the editor. This row only switches
 * faces; the page shows and hides them (runtime-studio-page.tsx). Only the active indicator moves.
 * Faces do not slide, since this is not a carousel: Monaco re-measures its width on change, and an
 * animated transition would relayout the editor throughout. The moving bg-accent indicator uses the
 * same language as tab switches in the sidebar and settings. The current face is conveyed by
 * aria-selected and text color first, so the indicator snapping into place under reduced motion
 * loses nothing. This component lives outside the page so the page has no moving elements. The page
 * assembles Monaco and panel geometry, and a single m.* there would make 'no motion around the
 * editor' impossible to verify statically (runtime-motion.test.ts).
 */
export function RuntimeMobileTabs({
	active,
	onSelect,
}: {
	active: RuntimeMobileTab;
	onSelect: (tab: RuntimeMobileTab) => void;
}) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	return (
		<div
			role="tablist"
			aria-label={t("mobileTabs.workspace")}
			className="flex shrink-0 gap-1 border-b px-2 py-1 lg:hidden"
		>
			{RUNTIME_MOBILE_TABS.map((tab) => {
				const selected = active === tab;
				return (
					<button
						key={tab}
						type="button"
						role="tab"
						aria-selected={selected}
						className={cn(
							"relative rounded-md px-3 py-1 text-xs font-medium",
							selected
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => onSelect(tab)}
					>
						{selected && (
							<MotionActiveIndicator
								group="runtime-mobile-tab"
								className="absolute inset-0 rounded-md bg-accent"
							/>
						)}
						{/* Label text sits above the background. Only the background moves. */}
						<span className="relative">{mobileTabLabel(tab)}</span>
					</button>
				);
			})}
		</div>
	);
}

/** The face label map is a Record, so adding a face breaks compilation here. */
const mobileTabLabel = (tab: RuntimeMobileTab): string =>
	translator("runtimeStudio")(`mobileTab.${tab}`);
