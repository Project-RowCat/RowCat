import { Button } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { LibraryBig, SearchX, UserRoundPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Zero results. Separating 'filtered out, nothing matches' from 'nothing exists yet' matters
 * because the next action differs. The first has a reset button that carries the action; the second
 * needs a line saying there is nothing to do but wait. The same wording would stop users from
 * suspecting their own filter. The decision itself is made by the domain's `hasActiveFilters`.
 *
 * An empty following feed is a third branch. 'No work matches' is true there too, but the next
 * action differs: not clearing a filter but following creators. No recommended list is made up here
 * (§31). This slice has no product decision about recommendations, and calling a few arbitrary
 * people 'recommended' would require explaining their selection rule.
 */
export function GalleryEmpty({
	filtered,
	followsNobody,
	onReset,
}: {
	filtered: boolean;
	/**
	 * The following filter is on and this member follows no creators at all. Kept apart from 'followed
	 * creators have not published any works yet', since the same wording would tell someone who
	 * already follows several people that they follow nobody.
	 */
	followsNobody: boolean;
	onReset: () => void;
}) {
	const { t } = useTranslation("gallery");
	if (followsNobody)
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<UserRoundPlus />
					</EmptyMedia>
					<EmptyTitle>{t("followingEmptyTitle")}</EmptyTitle>
					<EmptyDescription>{t("followingEmptyBody")}</EmptyDescription>
				</EmptyHeader>
				{/*
				 * The way back is the discovery screen itself. There is no separate `/following` page; the
				 * following state is a filter on the same screen, so clearing the filter is exactly that way
				 * back.
				 */}
				<Button variant="outline" size="sm" onClick={onReset}>
					{t("browse")}
				</Button>
			</Empty>
		);

	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					{filtered ? <SearchX /> : <LibraryBig />}
				</EmptyMedia>
				<EmptyTitle>{filtered ? t("filteredEmpty") : t("empty")}</EmptyTitle>
				{!filtered && <EmptyDescription>{t("emptyBody")}</EmptyDescription>}
			</EmptyHeader>
			{filtered && (
				<Button variant="outline" size="sm" onClick={onReset}>
					{t("resetFilters")}
				</Button>
			)}
		</Empty>
	);
}
