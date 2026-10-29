import {
	type GalleryFilters,
	periodApplies,
	relevanceApplies,
	STORY_PERIODS,
	STORY_SORTS,
	type StoryPeriod,
	type StorySort,
} from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { periodLabel, sortLabel, sortTriggerLabel } from "#/lib/i18n/vocab.ts";

/**
 * Sort, and the popularity window attached to it.
 *
 * The window is not a separate control, because that axis is part of popularity sorting. It used to
 * sit as an inactive Select next to newest, but a permanently visible dead control soon goes
 * unread. Now choosing popular reveals a `Period` group inside the same menu, so the relation shows by
 * position.
 *
 * Closing differs per item: `Newest` closes, since there is nothing more to choose; `Popular` stays open,
 * since it must reveal the window; choosing a window closes the menu.
 *
 * Returning to newest does not clear the window here. Whether the value stays in the address is the
 * address translation's rule (search.ts), and this menu does not restate it; only the trigger's
 * label folds the window (`sortTriggerLabel`).
 */
export function GallerySortMenu({
	filters,
	onChange,
}: {
	filters: GalleryFilters;
	onChange: (patch: Partial<GalleryFilters>) => void;
}) {
	const { t } = useTranslation("gallery");
	const showPeriod = periodApplies(filters);
	/**
	 * Relevance is offered as an item only when a query exists. Without a query, picking it folds to
	 * newest (effectiveGallerySort), so the item would be selectable yet change nothing.
	 */
	const sorts = STORY_SORTS.filter(
		(sort) => sort !== "relevance" || relevanceApplies(filters),
	);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						aria-label={t("sortTrigger", { label: sortTriggerLabel(filters) })}
						className="h-10 px-3 sm:h-9"
					/>
				}
			>
				{sortTriggerLabel(filters)}
				<ChevronDown aria-hidden="true" className="text-muted-foreground" />
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" className="min-w-40">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{t("sort")}</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={filters.sort}
						onValueChange={(sort: StorySort) => onChange({ sort })}
					>
						{sorts.map((sort) => (
							<DropdownMenuRadioItem
								key={sort}
								value={sort}
								closeOnClick={!periodApplies({ sort })}
							>
								{sortLabel(sort)}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>

				{showPeriod && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>{t("period")}</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={filters.period}
								onValueChange={(period: StoryPeriod) => onChange({ period })}
							>
								{STORY_PERIODS.map((period) => (
									<DropdownMenuRadioItem
										key={period}
										value={period}
										closeOnClick
									>
										{periodLabel(period)}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuGroup>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
