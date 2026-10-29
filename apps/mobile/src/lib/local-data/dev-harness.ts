import {
	expoDraftCoverFiles,
	removeDraftCoverDirectory,
} from "../draft-cover-files.ts";
import { expoSecureKeyStorage } from "../local-sync/secure-store.ts";
import { openScopeWith } from "./activation.ts";
import { seedFromTitle } from "./dev-harness-seed.ts";
import {
	deleteExpoSqliteDatabase,
	openExpoSqliteDriver,
} from "./expo-driver.ts";
import { deleteLocalDataForViewer } from "./purge.ts";

/**
 * Native self-check: confirms **only what unit tests cannot prove.**
 *
 * The adapter's SQL and rules are already verified on `node:sqlite` (`*.test.ts`). Two things
 * remain that those tests cannot answer:
 *
 * ```text
 * Whether expo-sqlite really opens the file on this device, and whether that file survives an app kill and relaunch
 * Whether expo-secure-store really keeps values, and whether they never cross between members
 * ```
 *
 * Only a simulator or device can answer those, which is why this harness exists. **It is called
 * only from development builds.** The screen wraps it in `__DEV__`, and the member ids used here
 * are fixtures. To avoid planting a fake sign-in state in product code, this does not imitate the
 * auth path. It opens and closes scopes directly.
 *
 * What reaches the screen is **only PASS/FAIL and counts**. Room titles, draft contents, member
 * ids, file names and key material never leave here.
 */

/** Two fixture members. Isolation can only be checked with two. */
const VIEWER_A = "dev-harness-viewer-a";
const VIEWER_B = "dev-harness-viewer-b";

const DEK = new Uint8Array(32).fill(42);

export interface SelfCheckStep {
	label: string;
	ok: boolean;
	detail: string;
}

const openScope = openScopeWith(
	openExpoSqliteDriver,
	expoSecureKeyStorage,
	expoDraftCoverFiles,
);

/**
 * One self-check run.
 *
 * **The first step is the cold-launch check.** After the app is fully killed and relaunched to run
 * this diagnosis, rooms created in the previous run must still be visible. That is the only
 * evidence that native SQLite writes to a file. With an in-memory database this count would always
 * be 0.
 */
export async function runLocalStorageSelfCheck(): Promise<SelfCheckStep[]> {
	const steps: SelfCheckStep[] = [];
	const record = (label: string, ok: boolean, detail: string): void => {
		steps.push({ label, ok, detail });
	};

	const a = await openScope(VIEWER_A);
	try {
		const carried = await a.stores.chat.listRooms();
		const carriedDrafts = await a.stores.authoring.listDrafts();
		record(
			"Cold launch — data from the previous run",
			true,
			`rooms ${carried.length} · drafts ${carriedDrafts.length}`,
		);
		record(
			"Remembered key — from the previous run",
			true,
			(await a.stores.deviceKey.recall()) ? "present" : "none",
		);

		const room = await a.stores.chat.createRoom({
			originStoryId: null,
			seed: seedFromTitle("Self-check"),
			title: "Self-check",
		});
		await a.stores.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Diagnostic",
		});
		await a.stores.chat.createMemory({
			roomId: room.id,
			content: "Diagnostic memory",
		});
		const draft = await a.stores.authoring.createDraft({ title: "Self-check" });
		await a.stores.authoring.createLore(draft.id, {
			content: "Diagnostic lore",
		});
		await a.stores.deviceKey.remember(DEK);
		record(
			"Writes — rooms · messages · memories · drafts · children",
			true,
			"Done",
		);

		const state = await a.stores.sync.readState();
		record(
			"Sync state row",
			state.deviceId.length > 0,
			`cursor ${state.cursor}`,
		);
	} finally {
		await a.close();
	}

	/** Reopens the same member on a **new connection**, to check that the data was actually committed to the file. */
	const again = await openScope(VIEWER_A);
	try {
		const rooms = await again.stores.chat.listRooms();
		const drafts = await again.stores.authoring.listDrafts();
		record(
			"Close and reopen — the same file",
			rooms.length > 0 && drafts.length > 0,
			`rooms ${rooms.length} · drafts ${drafts.length}`,
		);
		const recalled = await again.stores.deviceKey.recall();
		record(
			"Keychain recall",
			recalled?.length === DEK.length,
			recalled ? `${recalled.length} bytes` : "none",
		);
	} finally {
		await again.close();
	}

	/** Another member. **Nothing may be visible.** */
	const b = await openScope(VIEWER_B);
	try {
		const rooms = await b.stores.chat.listRooms();
		const drafts = await b.stores.authoring.listDrafts();
		const key = await b.stores.deviceKey.recall();
		record(
			"Other member isolation",
			rooms.length === 0 && drafts.length === 0 && key === null,
			`rooms ${rooms.length} · drafts ${drafts.length} · key ${key ? "present" : "none"}`,
		);
	} finally {
		await b.close();
	}

	return steps;
}

/** Deletes what the harness created: both the file and the Keychain items. */
export async function clearSelfCheckData(): Promise<void> {
	const targets = {
		deleteDatabase: deleteExpoSqliteDatabase,
		secureStorage: expoSecureKeyStorage,
		deleteDraftCovers: removeDraftCoverDirectory,
	};
	await deleteLocalDataForViewer(VIEWER_A, targets);
	await deleteLocalDataForViewer(VIEWER_B, targets);
}
