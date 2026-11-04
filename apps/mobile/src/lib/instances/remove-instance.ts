import { forgetInstanceSession } from "../auth.ts";
import { removeDraftCoverDirectory } from "../draft-cover-files.ts";
import { deleteExpoSqliteDatabase } from "../local-data/expo-driver.ts";
import { deleteLocalDataForViewer } from "../local-data/purge.ts";
import { expoSecureKeyStorage } from "../local-sync/secure-store.ts";
import { deviceInstanceRegistry } from "./device-registry.ts";
import {
	type InstanceRemovalBlocker,
	instanceRemovalBlocker,
} from "./instance-removal.ts";

/**
 * Removes another instance from this device, **with everything this device holds for it**: its session,
 * and for every member scope opened on it the database, draft covers, remembered sync key and provider keys
 * (`docs/mobile/INSTANCES.md` §전환 · 로그아웃 · 취소된 자격). The server keeps its encrypted copy — adding
 * the instance back and entering the recovery code brings it down again, and the confirmation says so.
 *
 * The order is files first, the registry entry last: if a step fails, the instance is still listed and
 * removing it again finishes the job. The other way round, a failure would leave files no list points at.
 */
export async function removeInstanceFromDevice(
	origin: string,
	homeOrigin: string,
): Promise<
	{ removed: true } | { removed: false; blocker: InstanceRemovalBlocker }
> {
	const registry = deviceInstanceRegistry();
	const blocker = instanceRemovalBlocker(registry, origin, homeOrigin);
	if (blocker) return { removed: false, blocker };
	await forgetInstanceSession({
		instance: { kind: "other", origin },
		origin,
		webOrigin: null,
	});
	for (const scopeKey of registry.scopesOf(origin))
		await deleteLocalDataForViewer(
			{ scopeKey },
			{
				deleteDatabase: deleteExpoSqliteDatabase,
				deleteDraftCovers: removeDraftCoverDirectory,
				secureStorage: expoSecureKeyStorage,
			},
		);
	await registry.remove(origin);
	return { removed: true };
}
