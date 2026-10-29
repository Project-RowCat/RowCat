import { buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Link } from "@tanstack/react-router";
import { LibraryBig } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The profile of a creator with no published works.
 *
 * Draft counts such as `3 drafts` are never shown, even on the owner's own profile. The screen must
 * look the same to every viewer, and draft counts are not what a public profile answers; the create
 * screen already does.
 *
 * Only the owner gets a next action. Other viewers have no fact to act on, so no button is placed
 * for them. The owner flag is the only reason this component reads the viewer; the works list is
 * identical for everyone.
 */
export function ProfileEmpty({ own }: { own: boolean }) {
	const { t } = useTranslation("profile");
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryBig />
				</EmptyMedia>
				<EmptyTitle>{t("empty.title")}</EmptyTitle>
				{own && <EmptyDescription>{t("empty.body")}</EmptyDescription>}
			</EmptyHeader>
			{own && (
				<EmptyContent>
					{/*
					 * Navigation must be a real link. Wrapping `Button` in its render prop would give the `<a>` button
					 * semantics and lose open-in-new-tab and copy-link. Only the appearance is needed.
					 */}
					<Link
						to="/create"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{t("empty.goCreate")}
					</Link>
				</EmptyContent>
			)}
		</Empty>
	);
}
