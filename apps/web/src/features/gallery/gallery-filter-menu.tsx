import {
	type GalleryFilters,
	ORIENTATIONS,
	type Orientation,
	STORY_RATINGS,
	type StoryRating,
} from "@rowcat/domain";
import { Button } from "@rowcat/ui-web/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rowcat/ui-web/components/dropdown-menu";
import { ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	filterAxisLabel,
	orientationLabel,
	ratingLabel,
} from "#/lib/i18n/vocab.ts";

/**
 * The orientation 'any' value is null in the domain. Radio items need a value, so the string
 * conversion happens only here.
 */
const ORIENTATION_ANY = "any";

/**
 * Menu for narrowing conditions: orientation, usage rating and following.
 * - Sorting is not here. Sorting decides order, not what remains, so it has its own trigger on
 *   the toolbar (`gallery-sort-menu.tsx`). Search is not here either: it is the most used axis, and
 *   behind a menu it would need an extra tap.
 * - Everything is expanded in one panel. There are three axes with at most four values each, so
 *   nested submenus would not earn their depth. Radio and check items do not close the menu (the
 *   primitive's default), so applying two conditions in a row does not require reopening it.
 * - Holds no state. Values come from `filters`, and changes leave through `onChange`. Showing the
 *   active conditions outside the menu is the token's job (`gallery-filter-token.tsx`).
 */
export function GalleryFilterMenu({
	filters,
	followingAvailable,
	onChange,
}: {
	filters: GalleryFilters;
	followingAvailable: boolean;
	onChange: (patch: Partial<GalleryFilters>) => void;
}) {
	const { t } = useTranslation("gallery");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						/*
						 * On a narrow screen, one size larger: a thumb target. The label is the name, so the icon
						 * alone is not expected to carry the meaning.
						 */
						className="h-10 px-3 sm:h-9"
					/>
				}
			>
				<ListFilter aria-hidden="true" />
				{t("filter")}
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" className="min-w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						{filterAxisLabel("orientation")}
					</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={filters.orientation ?? ORIENTATION_ANY}
						onValueChange={(value: Orientation | typeof ORIENTATION_ANY) =>
							onChange({
								orientation: value === ORIENTATION_ANY ? null : value,
							})
						}
					>
						<DropdownMenuRadioItem value={ORIENTATION_ANY}>
							{t("all")}
						</DropdownMenuRadioItem>
						{ORIENTATIONS.map((orientation) => (
							<DropdownMenuRadioItem key={orientation} value={orientation}>
								{orientationLabel(orientation)}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>

				<DropdownMenuSeparator />

				<DropdownMenuGroup>
					<DropdownMenuLabel>{filterAxisLabel("rating")}</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={filters.rating}
						onValueChange={(rating: StoryRating) => onChange({ rating })}
					>
						{STORY_RATINGS.map((rating) => (
							<DropdownMenuRadioItem key={rating} value={rating}>
								{ratingLabel(rating)}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>

				{/*
				 * Following has only two values, so it is a check item. Guests get no item at all. A disabled
				 * checkbox would imply 'log in to use this', and a guest who has not followed anyone would see an
				 * empty feed as their first impression.
				 */}
				{followingAvailable && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuCheckboxItem
							checked={filters.followingOnly}
							onCheckedChange={(checked) =>
								onChange({ followingOnly: checked })
							}
						>
							{t("followingOnly")}
						</DropdownMenuCheckboxItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
