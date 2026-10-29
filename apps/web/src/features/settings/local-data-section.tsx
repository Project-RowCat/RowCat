import { Button } from "@rowcat/ui-web/components/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resetLocalDataForViewer } from "#/lib/local-data/reset.ts";
import { useLocalDataScope } from "#/lib/local-data/scope.tsx";
import { LocalDataResetDialog } from "./local-data-reset-dialog.tsx";
import { SettingsGroup, SettingsRow } from "./settings-parts.tsx";

/**
 * The section holds one destructive action: clearing this browser's local data.
 *
 * It sits apart from the account screen's `Danger zone` section on purpose. That file deferred the
 * question until another destructive action appeared, because logout, account deletion and local
 * data deletion mean different things. Grouping them would stop users from learning the difference
 * on screen. This section is about what this browser holds, not the account's lifecycle. Its axis
 * matches the display (brightness) section. Theme colors are not cleared here: they are stored on
 * the account and follow the user across devices (see settings-general-page.tsx).
 *
 * It reads only the member id, which owns the local scope (useLocalDataScope). Account values such
 * as nickname, email and sync status stay with /account, and settings-boundaries.test.ts enforces
 * that statically.
 *
 * Guests get no section, since there is no local scope to clear. Do not render a disabled
 * placeholder. The sidebar likewise omits the `Recent conversations` section for guests.
 *
 * Do not wait for the scope to become ready. Deletion works by name (resetLocalDataForViewer) and
 * needs no open connection. Gating on status === "ready" would show a control that flickers
 * disabled after hydration without actually being blocked.
 */
export function LocalDataGroup() {
	const { t } = useTranslation(["settings", "common"]);
	const { viewerId } = useLocalDataScope();
	const [confirming, setConfirming] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!viewerId) return null;

	const close = () => {
		setConfirming(false);
		setError(null);
	};

	const reset = async () => {
		setPending(true);
		setError(null);
		try {
			await resetLocalDataForViewer({ viewerId });
			/*
			 * Do not reset `pending` on the success path. Reaching this line means a page reload has
			 * started. Re-enabling the button here would let the user trigger the same reset again on a page
			 * that is already leaving.
			 */
		} catch (error) {
			console.error("[settings] couldn't clear this device's data", error);
			setPending(false);
			/*
			 * Do not show the raw caught exception. Error names such as DatabaseClosedError do not tell the
			 * user what to do. The usual blocker is a connection held by another tab, so the message points
			 * at that one cause.
			 */
			setError(t("localDataSection.couldnTClearTheData"));
		}
	};

	return (
		<SettingsGroup
			title={t("localDataSection.thisDeviceSData")}
			/*
			 * State what is stored here first. An earlier version of this sentence listed only `Conversations and drafts`, but
			 * this browser also holds generation settings and saved AI provider API keys. The reset below
			 * clears all of it.
			 */
			description={t("localDataSection.conversationsDraftsInProgressThis")}
		>
			<SettingsRow
				label={t("localDataSection.clearStoredData")}
				/*
				 * Keep the stated scope accurate before the user presses. The old copy listed only `Conversations and drafts`,
				 * but the reset also removes generation settings, saved provider API keys and the remembered
				 * sync key. API keys can only be recreated in the provider's console, so users should not first
				 * learn this inside the confirmation dialog.
				 *
				 * This line states what gets deleted. The confirmation dialog states what remains and what
				 * comes back. Moving those here would turn the settings row into a paragraph.
				 */
				description={t(
					"localDataSection.clearsTheConversationsDraftsGeneration",
				)}
				control={
					<Button
						variant="outline"
						size="sm"
						className="h-9 w-full text-destructive hover:text-destructive sm:h-8"
						onClick={() => setConfirming(true)}
					>
						{t("localDataSection.clearData")}
					</Button>
				}
			/>

			{confirming && (
				<LocalDataResetDialog
					pending={pending}
					error={error}
					onClose={close}
					onConfirm={() => void reset()}
				/>
			)}
		</SettingsGroup>
	);
}
