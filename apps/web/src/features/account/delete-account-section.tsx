import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AccountSection } from "./account-shell.tsx";
import { DeleteAccountTrigger } from "./delete-account-trigger.tsx";
import type { AccountDeletion } from "./use-account-deletion.ts";

/**
 * Danger zone — **the bottom of the account screen.**
 *
 * Placement is policy. Putting it at the same weight beside the nickname would make reversible and
 * irreversible actions look alike, and putting it under `/settings` would make it a preference: an
 * account's lifetime is not a preference (`/settings` is where theme and response length live).
 *
 * One action per section. If another destructive action such as "delete this device's data"
 * appears, reconsider placing them side by side then. Sign-out, account deletion and device data
 * deletion mean entirely different things, and gathering them in one place would prevent users from
 * learning the difference on screen.
 */
export function DeleteAccountSection({
	deletion,
}: {
	deletion: AccountDeletion;
}) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<AccountSection title={t("deleteAccountSection.dangerZone")}>
			<div className="flex flex-col gap-4 rounded-lg border border-destructive/40 p-4">
				<div className="flex flex-col gap-1.5">
					<h3 className="text-sm font-medium">
						{t("deleteAccountSection.deleteAccount")}
					</h3>
					<div className="flex flex-col gap-1 text-sm text-muted-foreground">
						<p>{t("deleteAccountSection.aDeletedAccountCanT")}</p>
						<p>{t("deleteAccountSection.conversationsAndDraftsOnThis")}</p>
						<p>{t("deleteAccountSection.publiclyPublishedStoriesMayRemain")}</p>
					</div>
					{/*
					 * Leads to guidance readable without signing in. It looks redundant to the person reading
					 * here, but this page's real reader is someone who wants to check **after deleting**, or while
					 * unable to sign in.
					 */}
					<Link
						to="/account-deletion"
						className="w-fit text-sm underline underline-offset-4"
					>
						{t("deleteAccountSection.seeWhatGetsDeleted")}
					</Link>
				</div>

				{/*
				 * The button and confirmation dialog are **the same as the entry gate's**. That gate must also
				 * allow deletion, so the set of controls is shared; see
				 * `delete-account-trigger.tsx` for details.
				 */}
				<DeleteAccountTrigger deletion={deletion} className="w-fit" />
			</div>
		</AccountSection>
	);
}
