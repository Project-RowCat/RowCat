import { useMemo } from "react";
import { removeDraftCoverDirectory } from "./draft-cover-files.ts";
import { deleteExpoSqliteDatabase } from "./local-data/expo-driver.ts";
import { deleteLocalDataForViewer } from "./local-data/purge.ts";
import { useMobileLocalScope } from "./local-data/scope.tsx";
import type { ResetLocalDataPorts } from "./local-reset.ts";
import { expoSecureKeyStorage } from "./local-sync/secure-store.ts";

/**
 * Product wiring for local reset: the one port that feature code sees.
 *
 * Same position and reason as `account-deletion.ts`. If screens start grabbing the pieces of this
 * operation directly (scope lifetime, the SQLite file, SecureStore keys), one of them will miss a
 * step, and the symptom is a leftover key or a deleted file coming back. So `features/settings/`
 * takes only this hook, with no delete primitive and no controller (a static scan enforces this).
 *
 * `resetViewerState` and `signOut` are not here. The account stays alive, so there is no private
 * cache to empty and the session is untouched. Those two belong to account deletion
 * (`lib/account-deletion.ts`).
 */
export function useLocalResetPorts(): ResetLocalDataPorts {
	const { resetViewerData } = useMobileLocalScope();
	return useMemo(
		() => ({
			resetScope: resetViewerData,
			deleteLocalData: (viewerId) =>
				deleteLocalDataForViewer(viewerId, {
					deleteDatabase: deleteExpoSqliteDatabase,
					secureStorage: expoSecureKeyStorage,
					deleteDraftCovers: removeDraftCoverDirectory,
				}),
		}),
		[resetViewerData],
	);
}
