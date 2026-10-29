import { useTranslation } from "react-i18next";
import { SyncSection } from "#/features/sync/sync-section.tsx";
import { AccountSection } from "./account-shell.tsx";

/**
 * Data — what is on this device, and how far it goes.
 *
 * This section was explanation-only because sync did not exist. Now there is something real to do,
 * so it lives here. The reason there is no separate settings route is that this is where users
 * bring this question ("can I see it on other devices?").
 *
 * The copy still does **not exceed its promises**: nothing is adjusted automatically, the server
 * cannot read the content, and if the key is lost we cannot recover it. All three are facts, and
 * users must know all three in advance.
 */
export function DataSection() {
	const { t } = useTranslation(["account", "common"]);
	return (
		<AccountSection title={t("dataSection.data")}>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-sm text-muted-foreground">
					<p>{t("dataSection.conversationsAndDraftsInProgress")}</p>
					<p>{t("dataSection.signingOutDoesnTErase")}</p>
				</div>

				{/*
				 * Subsections have no rule; the outer `gap-6` already provides 24px.
				 *
				 * For a while `border-t pt-6` sat here too, which made this boundary 24 + line + 24, **the same
				 * weight as the gap between sections** (two `py-6` layers plus a line in `AccountSection`). The
				 * screen then expressed hierarchy only through heading levels (h2/h3), and to a scanning eye
				 * `Data` and `Sync between devices` read as siblings.
				 *
				 * The five subsections of the security section follow the same rule (no line, `gap-6`).
				 */}
				<div className="flex flex-col gap-3">
					<div>
						<h3 className="text-sm font-medium">
							{t("dataSection.syncBetweenDevices")}
						</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							{/*
							 * Not called "backup". A backup reads as something we can restore for you, and this
							 * feature is designed the opposite way.
							 */}
							{t("dataSection.conversationsAndDraftsAreEncrypted")}
						</p>
					</div>
					<SyncSection />
				</div>
			</div>
		</AccountSection>
	);
}
