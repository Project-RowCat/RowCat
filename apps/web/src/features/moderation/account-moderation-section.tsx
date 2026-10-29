import type { AppealStatus, MyModerationStatusDto } from "@rowcat/contracts";
import { moderationStatusQueryOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountSection } from "#/features/account/account-shell.tsx";
import { ADMIN_CONSOLE_ORIGIN } from "#/lib/admin-console.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDate } from "#/lib/format/date-time.ts";
import { translator } from "#/lib/i18n/current.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { AppealDialog } from "./appeal-dialog.tsx";

/**
 * The moderation section of the account screen: what is restricted, why, until when, and whether it
 * can be appealed (§59).
 * - Not left to disabled buttons. A restricted user usually meets only a failed response, which
 *   does not say what was blocked, when it lifts, or whether it can be disputed. This section
 *   answers those four questions.
 * - Renders nothing without sanctions. There is no permanent "all features available" badge: an
 *   always-visible label is decoration, and it would make a real restriction look like just another
 *   tag. The account page's status alert makes the same call.
 * - No operator notes. The data type read here (MyModerationStatusDto) has no reason field (§57).
 *   The boundary is the different type, not field-picking.
 */
export function AccountModerationSection() {
	const { t } = useTranslation("moderation");
	const status = useQuery(moderationStatusQueryOptions(getRowCatClient())).data;
	const [appeal, setAppeal] = useState<{
		actionId: string;
		subject: string;
	} | null>(null);

	/**
	 * A failed lookup shows no error box. This section is supplementary; an error over the whole
	 * screen (email, logout, deletion) would leave a restricted account with no route to its own
	 * account. The legacy version did exactly that.
	 */
	if (!status) return null;

	const items = collectItems(status);
	const resolvedAppeals = status.appeals.filter((row) => row.status !== "open");
	/**
	 * Shows nothing when there are no restrictions and no past appeals. Past appeals count because an
	 * accepted appeal lifts the restriction. Checking only active restrictions would remove the
	 * section at that moment, and the user could no longer see how the appeal ended.
	 */
	if (!items.length && !resolvedAppeals.length) return null;

	const appealable = new Set(status.appealableActionIds);
	const openAppeals = new Set(
		status.appeals
			.filter((row) => row.status === "open")
			.map((row) => row.actionId),
	);

	return (
		<AccountSection
			title={t("account.title")}
			description={items.length ? t("account.active") : t("account.none")}
		>
			<ul className="flex flex-col gap-3">
				{items.map((item) => (
					<li
						key={item.actionId}
						className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
					>
						<p className="text-sm font-medium">{item.subject}</p>
						{/*
						 * With no public reason, the copy names only the action type and invents no sentence. Filling the
						 * gap
						 * with "policy violation" would put words on screen that the operator never wrote.
						 */}
						{item.publicReason && (
							<p className="mt-1 text-sm text-muted-foreground">
								{item.publicReason}
							</p>
						)}
						<p className="mt-1 text-xs text-muted-foreground">
							{item.expiresAt
								? t("account.until", { date: formatDate(item.expiresAt) })
								: t("account.untilLifted")}
							{" · "}
							{t("account.applied", { date: formatDate(item.createdAt) })}
						</p>

						{/*
						 * The outcome of an appeal submission appears in this slot. Once the dialog closes, the button's
						 * place
						 * shows the receipt, so the parent adds no separate "appeal received" sentence; two copies of one
						 * fact
						 * would look like two facts.
						 * The value still comes from the server's list. The dialog's invalidation brings the action into
						 * openAppeals and this slot switches. Nothing is drawn optimistically.
						 * mode="wait" because the three branches exclude each other; overlapping would show a button and
						 * text
						 * together.
						 */}
						<div className="mt-3">
							<AnimatePresence initial={false} mode="wait">
								{openAppeals.has(item.actionId) ? (
									/* One appeal per action. After filing, only the status is shown (§63). */
									<AppealSlot key="open">
										<p className="text-xs text-muted-foreground">
											{t("account.appealPending")}
										</p>
									</AppealSlot>
								) : appealable.has(item.actionId) ? (
									<AppealSlot key="appealable">
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												setAppeal({
													actionId: item.actionId,
													subject: item.subject,
												})
											}
										>
											{t("account.appeal")}
										</Button>
									</AppealSlot>
								) : (
									/*
									 * No disabled button for actions that cannot be appealed. The server's appealableActionIds
									 * list decides this. Restating the rule here would produce buttons that return 400 when
									 * pressed.
									 */
									<AppealSlot key="closed">
										<p className="text-xs text-muted-foreground">
											{t("account.notAppealable")}
										</p>
									</AppealSlot>
								)}
							</AnimatePresence>
						</div>
					</li>
				))}
			</ul>

			{/*
			 * Outcomes of past appeals. Ongoing appeals are already stated by the line above, so only finished
			 * ones are counted here. Stating the same fact twice makes the user think they differ.
			 */}
			<ResolvedAppeals appeals={resolvedAppeals} />

			{appeal && (
				<AppealDialog
					actionId={appeal.actionId}
					subject={appeal.subject}
					onClose={() => setAppeal(null)}
				/>
			)}
		</AccountSection>
	);
}

/**
 * The slot below a restriction line: appealable, already appealed, or not appealable. One branch
 * has a button, so it must not be clickable while the screen exits. A button left over during the
 * exit frame could be pressed again, and the server would reject the second appeal. The reason the
 * guard is tied to presence state rather than the exit target is in lib/motion/exit-guard.ts. The
 * rhythm matches the one-line feedback next to an action (lib/motion/feedback.ts).
 */
function AppealSlot({ children }: { children: ReactNode }) {
	const exiting = useExitGuard();
	return (
		<m.div
			style={exiting}
			initial={feedbackEnter.initial}
			animate={feedbackEnter.animate}
			exit={feedbackExit}
			transition={feedbackEnter.transition}
		>
			{children}
		</m.div>
	);
}

/**
 * Folds account actions, capability restrictions and hidden works into one list, since to the user
 * they are all the same kind of restriction.
 */
interface RestrictionItem {
	actionId: string;
	subject: string;
	publicReason: string;
	createdAt: string;
	expiresAt: string | null;
}

function collectItems(status: MyModerationStatusDto): RestrictionItem[] {
	const t = translator("moderation");
	return [
		...status.accountActions.map((row) => ({
			actionId: row.actionId,
			subject:
				row.kind === "ban_member" ? t("account.ban") : t("account.suspend"),
			publicReason: row.publicReason,
			createdAt: row.createdAt,
			expiresAt: null,
		})),
		...status.restrictions.map((row) => ({
			actionId: row.actionId,
			subject: t("account.capability", {
				capability: t(`capability.${row.capability}`),
			}),
			publicReason: row.publicReason,
			createdAt: row.createdAt,
			expiresAt: row.expiresAt,
		})),
		...status.hiddenStories.map((row) => ({
			actionId: row.actionId,
			subject: t("account.hiddenStory"),
			publicReason: row.publicReason,
			createdAt: row.createdAt,
			expiresAt: null,
		})),
	];
}

const appealResult = (status: AppealStatus): string => {
	const t = translator("moderation");
	if (status === "open") return t("account.appealOpen");
	if (status === "accepted") return t("account.appealAccepted");
	return t("account.appealRejected");
};

function ResolvedAppeals({
	appeals: resolved,
}: {
	/**
	 * Only finished appeals arrive here. The caller selects them, and that selection also decides
	 * whether the section exists.
	 */
	appeals: MyModerationStatusDto["appeals"];
}) {
	if (!resolved.length) return null;
	return (
		<div className="mt-4">
			<h3 className="text-sm font-medium">
				{translator("moderation")("account.pastAppeals")}
			</h3>
			<ul className="mt-2 flex flex-col gap-1">
				{resolved.map((row) => (
					<li key={row.id} className="text-sm text-muted-foreground">
						{formatDate(row.resolvedAt ?? row.createdAt)} ·{" "}
						{appealResult(row.status)}
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * Links to the operations console, shown only to staff and admin (§51). The console is a separate
 * app on another origin (apps/admin), so this is a plain <a href> rather than a router Link. A
 * router Link would try to resolve the absolute URL inside the app's own route tree and render a
 * 404. The address comes only from lib/admin-console.ts. If it is unset, the section is not
 * rendered rather than guessing a domain. This link is not authorization. The console's own
 * requests still return 403 to non-moderators (requireModeratorViewer).
 */
export function OperatorToolsLink() {
	const { t } = useTranslation("moderation");
	if (!ADMIN_CONSOLE_ORIGIN) return null;
	return (
		<AccountSection
			title={t("account.operatorTitle")}
			description={t("account.operatorDescription")}
		>
			<a
				href={ADMIN_CONSOLE_ORIGIN}
				className="text-sm font-medium underline-offset-4 hover:underline"
			>
				{t("account.operatorOpen")}
			</a>
		</AccountSection>
	);
}
