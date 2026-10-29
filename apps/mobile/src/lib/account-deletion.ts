import { resetViewerState } from "@rowcat/query";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { requestAccountDeletion } from "./account-deletion-auth.ts";
import type { AuthErrorLike } from "./auth-error.ts";
import { removeDraftCoverDirectory } from "./draft-cover-files.ts";
import { deleteExpoSqliteDatabase } from "./local-data/expo-driver.ts";
import { deleteLocalDataForViewer } from "./local-data/purge.ts";
import { useMobileLocalScope } from "./local-data/scope.tsx";
import { expoSecureKeyStorage } from "./local-sync/secure-store.ts";
import { purgeDeletedViewer } from "./purge-deleted-viewer.ts";

/**
 * Product wiring of account deletion: the two functions feature code sees.
 *
 * This file exists for the boundary. Four pieces are involved (auth client, scope ownership,
 * SQLite/SecureStore deletion, query-cache reset). If the screen grabbed them directly, one would
 * inevitably drop a step, and the symptom would be someone else's data left behind or the deleted
 * account's values still shown on screen. So `features/account/` takes only this hook and holds
 * neither the auth client, `resetViewerState`, nor the deletion primitives (a static scan enforces
 * it, `account-boundaries.test.ts`).
 *
 * Ordering, locking and state are not here: they belong to the pure coordinator
 * (`features/account/deletion-turn.ts`). This file only fills that coordinator's ports with the
 * real implementations.
 *
 * `resetViewerState` being the same function as sign-out is the point. The list of private cells to
 * empty (viewer, account, personalization, notifications, moderation, creation) already lives
 * there; a second list here would eventually be fixed on one side only.
 */
export interface AccountDeletionPorts {
	/** Server deletion: `null` is confirmed success; `{}` means no response was received. */
	deleteAccount: (password?: string) => Promise<AuthErrorLike | null>;
	/** Local cleanup on this device: called only after a successful server deletion. Needs no authentication. */
	purge: (viewerId: string) => Promise<void>;
}

export function useAccountDeletionPorts(): AccountDeletionPorts {
	const queryClient = useQueryClient();
	const { abandonViewer } = useMobileLocalScope();
	return useMemo(
		() => ({
			deleteAccount: requestAccountDeletion,
			purge: (viewerId) =>
				purgeDeletedViewer(viewerId, {
					abandonViewer,
					deleteLocalData: (id) =>
						deleteLocalDataForViewer(id, {
							deleteDatabase: deleteExpoSqliteDatabase,
							deleteDraftCovers: removeDraftCoverDirectory,
							secureStorage: expoSecureKeyStorage,
						}),
					resetPrivateState: () => resetViewerState(queryClient),
				}),
		}),
		[queryClient, abandonViewer],
	);
}
