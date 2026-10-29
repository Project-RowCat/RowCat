import { summarizeDraftRecoveries } from "@rowcat/authoring";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	draftRecoveryCopy,
	draftRecoveryGroupLabel,
} from "#/features/create/editor/recovery-copy.ts";
import { useAllDraftRecoveries } from "#/lib/local-recovery/hooks.ts";

/**
 * One row in the sync section, showing that there is recoverable content. It exists because a
 * recovery copy is visible only in the editor for its draft, and after a few days the user will not
 * remember which draft it came from. So this row is a route to the destination, not a second
 * recovery screen. Restore and delete are not done here.
 *
 * Do not widen this section into a sync history dashboard. Transfer events, device lists and
 * conflict counters are developer values. Users need to see only the content they have lost.
 *
 * Nothing is drawn when there are no copies. A permanent `0 items` becomes background rather than
 * information, and it would go unread even when something new appears.
 */
export function RecoverySummary() {
	const { t } = useTranslation("sync");
	const { items } = useAllDraftRecoveries();
	if (items.length === 0) return null;

	const summary = summarizeDraftRecoveries(items);

	return (
		<section className="flex flex-col gap-2 rounded-lg border p-3">
			<div className="flex items-baseline justify-between gap-3">
				<span className="text-sm font-medium">
					{draftRecoveryCopy().summaryLabel}
				</span>
				<span className="text-sm text-muted-foreground">
					{t("recoverySummary.count", { count: summary.total })}
				</span>
			</div>
			<ul className="flex flex-col gap-1">
				{summary.drafts.map((entry) => (
					<li key={entry.draftId}>
						{/*
						 * Draft titles are not looked up here. Doing so would make this section open the authoring store
						 * too, which widens what the account screen knows. The group name already says which area is
						 * affected, and the editor shows the title in its header after the link is followed.
						 */}
						<Link
							to="/create/$draftId"
							params={{ draftId: entry.draftId }}
							className="text-sm text-primary underline-offset-4 hover:underline"
						>
							{entry.groups.map(draftRecoveryGroupLabel).join(" · ")}
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
