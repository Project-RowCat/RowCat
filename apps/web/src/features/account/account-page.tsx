import { canModerate, type Viewer } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
	AccountModerationSection,
	OperatorToolsLink,
} from "#/features/moderation/account-moderation-section.tsx";
import { MyReportsSection } from "#/features/moderation/my-reports-section.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { AccountShell } from "./account-shell.tsx";
import { ContentSection } from "./content-section.tsx";
import { DataSection } from "./data-section.tsx";
import { DeleteAccountSection } from "./delete-account-section.tsx";
import { DeletionTerminal } from "./deletion-terminal.tsx";
import { ProfileSection } from "./profile-section.tsx";
import { SecuritySection } from "./security-section.tsx";
import { useAccountDeletion } from "./use-account-deletion.ts";

/**
 * Account: the private self-management screen.
 *
 * Sections, in order: profile, moderation, my reports, content display, security, data, (operator
 * tools), danger zone. Do not grow this into a general settings dashboard. Notifications, language
 * and analytics consent are separate slices, and reserving space for them here would turn the
 * screen into a list of empty slots to fill later.
 *
 * The public profile (`/creators/:id`) is not this screen. That one is the face shown to others;
 * this one is seen only by you. So the public profile is read-only, and the only place to edit the
 * values it shows (nickname, bio) is the profile section here. There is one link in each direction:
 * account → public profile, and public profile (when it is your own) → account.
 *
 * **Deletion changes this screen's nature.** Every other action is reversible, so if one fails the
 * screen returns to where it was. Once account deletion is confirmed there is no earlier place to
 * return to, so from then on the render is the terminal panel (`deletion-terminal.tsx`), not the
 * sections.
 */
export function AccountPage() {
	/**
	 * The route guard (`beforeLoad`) has already settled the viewer. We still avoid a non-null
	 * assertion, because logging out can happen on this screen: the cache becomes null, and one render
	 * remains before the router finishes navigating. An assertion would turn that render into an
	 * exception.
	 */
	const viewer = useQuery(viewerQueryOptions(getRowCatClient())).data ?? null;
	const deletion = useAccountDeletion();

	/**
	 * Once the account is gone, **draw no sections at all.**
	 *
	 * Hiding by `viewer` alone is not enough. The viewer cache is cleared only after server deletion
	 * finishes, and in between the render would still show the deleted account's email and sync
	 * button. A boundary that cannot be undone must be true from the moment it is crossed.
	 */
	if (deletion.terminal)
		return (
			<AccountShell>
				<DeletionTerminal deletion={deletion} />
			</AccountShell>
		);

	return (
		<AccountShell>
			{viewer && (
				/*
				 * The entrance wraps only the inside of the shell. The title belongs to the frame shared with
				 * the placeholder, so it must stay in place during transitions.
				 *
				 * When logout makes the viewer null, this wrapper disappears at once. We attach no transition
				 * to that exit: there is no reason to spend frames letting the previous person's email linger
				 * on screen while another account takes over.
				 */
				<PageEnter className="mt-6">
					<StatusNotice status={viewer.status} />
					<ProfileSection viewer={viewer} />
					{/*
					 * The moderation section sits directly **after the profile.** A restricted account's user is
					 * looking for "why can't I do this", and if that answer were below security and data they would
					 * reach it only at the bottom of the scroll. Without restrictions the section draws nothing (it
					 * decides that itself), so most accounts see the same screen as before.
					 */}
					<AccountModerationSection />
					{/*
					 * `My reports` sits **right after the moderation section**, because the two answer neighbouring
					 * questions:
					 *
					 * ```text
					 * restrictions   what happened to me                       (what others did to me)
					 * my reports     what became of the review I asked for    (what I asked for)
					 * ```
					 *
					 * The axes are opposite, so they are **not merged into one section**: someone checking a
					 * restriction also reads their report history, and the two are not each other's context. If they
					 * have never filed a report, the section says so in one line.
					 */}
					<MyReportsSection />
					<ContentSection viewer={viewer} />
					{/*
					 * Only the security section has its own query (`/me/account`). The sections above need only the
					 * viewer, and adding the email to that query would carry it on every route.
					 */}
					<SecuritySection />
					{/*
					 * Data comes **after security**, for the same reason: security answers "whose account is this" and
					 * data answers "what does this account hold". Like the rule above, it stays away from the
					 * irreversible actions.
					 */}
					<DataSection />
					{/*
					 * The operator tools link appears **only for accounts with a role** (§51). It is not in the sidebar,
					 * because the sidebar's information architecture is fixed. The link is not authorization: every
					 * lookup on that screen goes through the server gate again.
					 */}
					{canModerate(viewer) && <OperatorToolsLink />}
					{/*
					 * Bottom of the screen. Keep the order relative to the sections above: an irreversible action next to
					 * the nickname input would make the two look equally weighted.
					 */}
					<DeleteAccountSection deletion={deletion} />
				</PageEnter>
			)}
		</AccountShell>
	);
}

/**
 * Account status notice, **shown only on restricted accounts.**
 *
 * `approved` deliberately gets no "normal" badge. A badge everyone sees all the time is decoration,
 * not information, and with it present a suspension would differ only by colour, so the state would
 * be signalled by colour alone. Here a sentence appears only when there is something to report.
 *
 * **Appeals and reasons are not here.** The `AccountModerationSection` directly below owns them.
 * Saying the same thing in two places would make the user think they are two different things. This
 * notice stays because its role differs: that section is the list of "what was restricted and why",
 * while this is the **one sentence** read on arrival.
 *
 * So what this sentence states is what the account can **still** do. A restricted account should
 * not hit the dead end the legacy app had, where the account screen could not be reached at all.
 */
function StatusNotice({ status }: { status: Viewer["status"] }) {
	const { t } = useTranslation(["account", "common"]);
	if (status === "approved") return null;
	return (
		/*
		 * Not a live region (`role="status"`). This notice already exists when the page renders and does
		 * not change while on screen. Giving it a live-region role would announce "something just
		 * happened" to assistive technology. As a sentence in the document flow it is read in order.
		 *
		 * Colour is not the only signal either: the border and background only support the sentence,
		 * which is what states the status.
		 */
		<div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
			<p className="text-sm font-medium">
				{status === "banned"
					? t("accountPage.thisAccountIsBanned")
					: t("accountPage.thisAccountIsSuspended")}
			</p>
			<p className="mt-1 text-sm text-muted-foreground">
				{t("accountPage.publishingAndInteractionsAreRestricted")}
			</p>
		</div>
	);
}
