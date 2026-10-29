import { useTranslation } from "react-i18next";
import { draftTitleLabel } from "#/lib/i18n/vocab.ts";
import { useLocalDraft } from "#/lib/local-authoring/hooks.ts";

/**
 * The draft context in the header: which draft is being edited. The list trigger and the `← Drafts`
 * back link were both removed. The way out is the sidebar's `Create` entry (`/create`), which keeps a
 * fixed list address rather than history. The editor can open without passing through the list
 * (saved address, session restore, cross-device link), so back navigation can leave RowCat.
 *
 * The title stays although it repeats the canvas h1. It is now the only place that names the
 * resource the user is inside, and it is a stationary name tag rather than an editable value. It
 * only reads the draft (a liveQuery), so pending autosave changes are untouched.
 */
export function DraftHeaderContext({ draftId }: { draftId: string }) {
	const { t } = useTranslation(["create", "common"]);
	const { draft } = useLocalDraft(draftId);

	return (
		<span
			className="min-w-0 flex-1 truncate text-sm font-medium"
			title={draft ? draftTitleLabel(draft) : undefined}
		>
			{draft ? draftTitleLabel(draft) : t("headerContext.draft")}
		</span>
	);
}
