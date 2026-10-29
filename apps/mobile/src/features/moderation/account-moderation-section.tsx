import type { MyAppealDto } from "@rowcat/contracts";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import { moderationStatusQueryOptions } from "@rowcat/query";
import { Button, Text, useTheme } from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDate } from "../../lib/format.ts";
import { AccountSection } from "../account/account-section.tsx";
import { AppealDialog } from "./appeal-dialog.tsx";
import {
	type AccountModerationView,
	accountModerationView,
	appealSlotFor,
	type RestrictionItem,
} from "./moderation-account-state.ts";
import {
	APPEAL_ACTION_LABEL,
	APPEAL_OPEN_NOTE,
	APPEAL_RESULT_LABEL,
	APPEAL_UNAVAILABLE_NOTE,
	MODERATION_SECTION_DESCRIPTION_ACTIVE,
	MODERATION_SECTION_DESCRIPTION_HISTORY,
	MODERATION_SECTION_TITLE,
	RESOLVED_APPEALS_TITLE,
	RESTRICTION_UNTIL_REVOKED,
	restrictionAppliedNote,
	restrictionExpiryNote,
} from "./moderation-copy.ts";

/**
 * The `Restrictions` (usage restrictions) section of the account screen. Native counterpart of the web's
 * `account-moderation-section.tsx`.
 *
 * It answers four questions: what was restricted, why, until when, and whether an appeal can be
 * filed. A restricted user usually meets a single failed response, which reads as the account being
 * broken; this section answers those four questions.
 *
 * ## With no restriction, draw nothing
 *
 * The decision is a pure function (`accountModerationView`; null means no section). The reasons
 * there is no always-on badge such as "all features available", and why the section stays when a
 * past appeal remains, are both in that file's header.
 *
 * ## A failed query does not cover the account screen
 *
 * This section is supplementary. Covering the whole screen (profile, security, sign-out) with an
 * error when it fails would leave a restricted account with no way to reach its own account. When
 * there is no value (loading, paused or failed alike), it steps aside quietly. Notifying the user
 * of a sanction is the notification inbox's job; this section redraws on the next visit.
 *
 * ## Operator notes do not arrive
 *
 * It reads `MyModerationStatusDto`, whose type has no internal `reason`. What makes this a real
 * boundary is that it is a **different type**, not a field-picking function. The reason drawn is
 * `publicReason` alone, and when it is empty no sentence is invented.
 *
 * ## An open dialog does not cross an account boundary
 *
 * This section lives inside `AccountContent` (`key={viewer.id}`). When the viewer changes, the tree
 * unmounts, taking an open appeal dialog and any half-written text with it. Drafts are not saved to
 * the device for the same reason.
 */
export function AccountModerationSection() {
	const status = useQuery(moderationStatusQueryOptions(getRowCatClient())).data;
	const [appeal, setAppeal] = useState<{
		actionId: string;
		subject: string;
	} | null>(null);

	if (!status) return null;
	const view = accountModerationView(status);
	if (!view) return null;

	return (
		<AccountSection
			title={MODERATION_SECTION_TITLE}
			description={
				view.items.length
					? MODERATION_SECTION_DESCRIPTION_ACTIVE
					: MODERATION_SECTION_DESCRIPTION_HISTORY
			}
		>
			<View style={section.items}>
				{view.items.map((item) => (
					<RestrictionRow
						key={item.actionId}
						item={item}
						view={view}
						onAppeal={() =>
							setAppeal({ actionId: item.actionId, subject: item.subject })
						}
					/>
				))}
			</View>

			<ResolvedAppeals appeals={view.resolvedAppeals} />

			{appeal ? (
				<AppealDialog
					actionId={appeal.actionId}
					subject={appeal.subject}
					onClose={() => setAppeal(null)}
				/>
			) : null}
		</AccountSection>
	);
}

/**
 * One restriction row: subject, the public reason (if any), the time, and the appeal slot.
 *
 * Status is not conveyed by color alone. The destructive color is only a background accent; what
 * was restricted and until when are stated in text. There is no large dashboard card, because when
 * an account has several restrictions this list must still be readable.
 */
function RestrictionRow({
	item,
	view,
	onAppeal,
}: {
	item: RestrictionItem;
	view: AccountModerationView;
	onAppeal: () => void;
}) {
	const { alpha } = useTheme();
	const slot = appealSlotFor(item.actionId, view);
	const expiry = item.expiresAt ? formatDate(item.expiresAt) : null;
	const applied = formatDate(item.createdAt);

	return (
		<View
			style={[
				row.root,
				{
					backgroundColor: alpha("destructive", 0.06),
					borderColor: alpha("destructive", 0.4),
				},
			]}
		>
			<Text variant="body">{item.subject}</Text>
			{/**
			 * When the public reason is empty, no sentence is invented: only the kind of action is named.
			 * Filling the empty reason with "policy violation" would put words the operator never wrote on
			 * screen.
			 */}
			{item.publicReason ? (
				<Text variant="label" tone="muted-foreground">
					{item.publicReason}
				</Text>
			) : null}
			{/**
			 * An expiry date is shown when there is one; otherwise `Until lifted` ("until revoked"). Remaining
			 * days and an expected lift date are not computed, because the server does not answer them. The
			 * applied date is shown alongside.
			 */}
			<Text variant="caption" tone="muted-foreground">
				{[
					expiry ? restrictionExpiryNote(expiry) : RESTRICTION_UNTIL_REVOKED,
					applied ? restrictionAppliedNote(applied) : null,
				]
					.filter(Boolean)
					.join(" · ")}
			</Text>

			{slot === "open" ? (
				/** One appeal per action; once filed, only its status is shown. */
				<Text variant="caption" tone="muted-foreground">
					{APPEAL_OPEN_NOTE}
				</Text>
			) : slot === "appealable" ? (
				<View style={row.action}>
					<Button
						label={APPEAL_ACTION_LABEL}
						variant="outline"
						size="sm"
						onPress={onAppeal}
					/>
				</View>
			) : (
				/**
				 * No disabled button for an action that cannot be appealed. Which actions are appealable is
				 * stated by the list the server decides; re-writing that rule here would produce a button that
				 * returns 400 when pressed.
				 */
				<Text variant="caption" tone="muted-foreground">
					{APPEAL_UNAVAILABLE_NOTE}
				</Text>
			)}
		</View>
	);
}

/**
 * Outcomes of past appeals. In-progress ones are stated by the row above, so only **finished** ones
 * come here (selection is done by `accountModerationView`, which is also the section's visibility
 * condition).
 */
function ResolvedAppeals({ appeals }: { appeals: MyAppealDto[] }) {
	if (!appeals.length) return null;
	return (
		<View style={section.history}>
			<Text accessibilityRole="header" variant="body">
				{RESOLVED_APPEALS_TITLE}
			</Text>
			{appeals.map((row) => {
				const resolved = formatDate(row.resolvedAt ?? row.createdAt);
				/** The result is stated in text, not color: `Accepted` or `Not accepted`. */
				const result =
					row.status === "open" ? null : APPEAL_RESULT_LABEL[row.status];
				if (!result) return null;
				return (
					<Text key={row.id} variant="label" tone="muted-foreground">
						{resolved ? `${resolved} · ${result}` : result}
					</Text>
				);
			})}
		</View>
	);
}

const section = StyleSheet.create({
	items: { gap: space.sm },
	history: { gap: space.xs, marginTop: space.sm },
});

const row = StyleSheet.create({
	root: {
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		gap: space.xs,
		padding: space.md,
	},
	/** Keeps the button from stretching across the row; the size of an action reflects its weight. */
	action: { alignSelf: "flex-start", marginTop: space.xs },
});
