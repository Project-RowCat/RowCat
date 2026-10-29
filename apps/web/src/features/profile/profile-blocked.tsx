import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { ShieldBan } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Shown in place of the works when the viewer has blocked this creator. The profile itself stays
 * open: name and bio remain public, and this screen is where the block is undone. A 404 here would
 * remove the way back.
 *
 * Blocking hides the creator's works from this viewer. It does not make the creator nonexistent,
 * and the screen says so.
 *
 * This must stay distinct from `ProfileEmpty`. The server returns zero works for a blocked creator,
 * so the data matches an empty profile. Reusing the empty copy would make the blocked viewer think
 * the creator has posted nothing.
 *
 * The unblock control is not placed here. The block action lives only in the header overflow menu,
 * because a second control could disagree with the first while one is pending.
 */
export function ProfileBlocked() {
	const { t } = useTranslation("profile");
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<ShieldBan />
				</EmptyMedia>
				<EmptyTitle>{t("blocked.title")}</EmptyTitle>
				{/*
				 * Describe only what actually happens. Copy such as `They can't see you` is avoided because
				 * the server does not guarantee it. Promising more privacy than the system provides puts people who
				 * act on that promise at risk.
				 */}
				<EmptyDescription>{t("blocked.body")}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
