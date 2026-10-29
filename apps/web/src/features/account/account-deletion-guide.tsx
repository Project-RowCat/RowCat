import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "#/components/app-shell/canvas.tsx";
import { PageEnter } from "#/lib/motion/page-transition.tsx";

/**
 * Account deletion guide: **one page readable without signing in.**
 *
 * Its readers are not people who can open the account screen. They are app store reviewers, people
 * checking how deletion works in advance, and people who cannot log in. So nothing here may depend
 * on a session (no guard, no viewer lookup), and the address must never change: store listings cite
 * it, and a dead address blocks review.
 *
 * **Accounts cannot be deleted from here.** There is no field where you enter an email to delete
 * it. That field would verify no identity, so anyone who knew someone's email could delete that
 * account. This page only explains; actual deletion happens on the signed-in screen.
 *
 * The copy states **only what the product does today**. It does not claim the server clears other
 * devices' storage (it cannot), and it does not claim all content disappears (published works can
 * remain with their author identity removed). A promise we cannot keep is worse on a guide page
 * than on a screen, because the guide lasts longer.
 */
export function AccountDeletionGuide() {
	const { t } = useTranslation(["account", "common"]);
	return (
		<Canvas>
			<div className="mx-auto w-full max-w-2xl">
				<h1 className="text-2xl font-bold tracking-tight">
					{t("accountDeletionGuide.accountDeletionGuide")}
				</h1>
				<PageEnter className="mt-6 flex flex-col gap-8">
					<Section title={t("accountDeletionGuide.howToDelete")}>
						{/*
						 * Steps are written with the **current screen names**. Copying the legacy sidebar or old
						 * settings tabs would send a reviewer hunting for menus that no longer exist, and they would
						 * conclude that deletion is not available.
						 */}
						<ol className="list-decimal space-y-1 pl-5">
							<li>{t("accountDeletionGuide.signInToRowcat")}</li>
							<li>{t("accountDeletionGuide.goToAccountFromThe")}</li>
							<li>{t("accountDeletionGuide.pressDeleteAccountInThe")}</li>
							<li>{t("accountDeletionGuide.reviewTheNoticeAndIf")}</li>
						</ol>
						<p>
							{/*
							 * Says up front why accounts without a password are not asked for one. Without this line,
							 * "there is no password field" reads as a defect.
							 */}
							{t("accountDeletionGuide.anAccountThatUsesOnly")}
						</p>
						<p>{t("accountDeletionGuide.deletionHappensImmediatelyAndCan")}</p>
						{/*
						 * Someone held at the entry gate cannot follow these steps: the account screen is behind
						 * the gate (age, guardian consent), so at step 2 they meet the gate again. That screen
						 * carries its own deletion action (`features/onboarding/gate-shell.tsx`), and this line
						 * states that fact. Without it, a reader hunts for a menu that is not there and concludes
						 * that the gate is the only way forward.
						 */}
						<p>{t("accountDeletionGuide.ifAScreenAskingFor")}</p>
					</Section>

					<Section title={t("accountDeletionGuide.whatGetsDeleted")}>
						<ul className="list-disc space-y-1 pl-5">
							<li>{t("accountDeletionGuide.yourAccountAndSignIn")}</li>
							<li>{t("accountDeletionGuide.signInSessionsOnEvery")}</li>
							<li>{t("accountDeletionGuide.memberInformationAndProfile")}</li>
							<li>{t("accountDeletionGuide.favoritesFollowsAndBlocks")}</li>
							<li>
								{/*
								 * The inbox the person alone read is deleted whole. A line that remains in someone
								 * else's inbox is something that actually happened to that other person, so it stays
								 * with the identity detached. Both directions are stated together because the
								 * retention policy (§125) does not silently add new kept items.
								 */}
								{t("accountDeletionGuide.notificationsYouReceivedWhereYou")}
							</li>
							<li>{t("accountDeletionGuide.dataKeptForSyncBetween")}</li>
							<li>{t("accountDeletionGuide.conversationsAndDraftsSavedOn")}</li>
							<li>{t("accountDeletionGuide.theSyncKeyRememberedOn")}</li>
						</ul>
					</Section>

					<Section title={t("accountDeletionGuide.whatMayRemain")}>
						<ul className="list-disc space-y-1 pl-5">
							<li>
								{t("accountDeletionGuide.publiclyPublishedStoriesTheyMay")}
							</li>
							<li>
								{t("accountDeletionGuide.conversationsAndDraftsAlreadySaved")}
							</li>
						</ul>
					</Section>

					<Section title={t("accountDeletionGuide.dataLeftOnOtherDevices")}>
						{/*
						 * The most important honest statement in this guide. RowCat is local-first: the originals of
						 * conversations and drafts live on the device, and the server cannot remotely empty another
						 * device's storage. Writing "deleted on every device" would be a promise we cannot keep.
						 */}
						<p>{t("accountDeletionGuide.rowcatConversationsAndDraftsAre")}</p>
						<p>{t("accountDeletionGuide.thoseDevicesAreSignedOut")}</p>
					</Section>

					<Section title={t("accountDeletionGuide.ifYouCanTSign")}>
						<p>
							{t("accountDeletionGuide.accountDeletionRequiresConfirmingIt")}
						</p>
						{/*
						 * No support address is written here. The open-source release carries no operator identity,
						 * and a contact frozen into this page would outlive whoever deploys it; the deployment that
						 * runs this page is who answers.
						 */}
						<p>{t("accountDeletionGuide.ifYouCanTSign2")}</p>
					</Section>

					<Section title={t("accountDeletionGuide.howItDiffersFromOther")}>
						{/*
						 * The three are placed side by side because users genuinely confuse them. They log out and ask
						 * "why is my data still here?", or they delete the account and say "I only meant to log out".
						 */}
						<dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[7rem_1fr]">
							<dt className="font-medium text-foreground">
								{t("accountDeletionGuide.signOut")}
							</dt>
							<dd>{t("accountDeletionGuide.theAccountStaysAndThis")}</dd>
							<dt className="font-medium text-foreground">
								{t("accountDeletionGuide.deleteAccount")}
							</dt>
							<dd>{t("accountDeletionGuide.theAccountItselfDisappearsIt")}</dd>
						</dl>
					</Section>
				</PageEnter>
			</div>
		</Canvas>
	);
}

/**
 * One section of the guide.
 *
 * Not the account screen's `AccountSection`. That one is the settings form's rhythm (title plus
 * controls), while this is **prose to read**, with different spacing between paragraphs and a
 * different body color. Forcing one shared component would leave one of them awkward.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h2 className="text-base font-semibold">{title}</h2>
			<div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
				{children}
			</div>
		</section>
	);
}
