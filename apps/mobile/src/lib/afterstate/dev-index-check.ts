import { type ChatStore, reconcileConversation } from "@rowcat/chat";
import {
	hasNativeAfterstate,
	openNativeAfterstate,
} from "../../../modules/afterstate-memory/index.ts";
import { requestedMemoryBackend } from "./native-memory.ts";

/**
 * Dev diagnostics only (`/dev-tools`): whether the member's afterstate index agrees with the local
 * store. Everything is a **dry run** — nothing is ingested or erased here — and only counts leave
 * this function (no message text, no ids), so a screenshot of the result carries no content.
 *
 * It opens its own handle on the member's file and closes it; a chat screen holding another handle
 * is fine (the bridge allows several engines on one file).
 */
export interface IndexCheckRow {
	label: string;
	value: string;
}

export async function runAfterstateIndexCheck(
	scopeKey: string | null,
	store: ChatStore | null,
): Promise<IndexCheckRow[]> {
	const rows: IndexCheckRow[] = [
		{ label: "mode", value: requestedMemoryBackend() },
		{ label: "engine", value: hasNativeAfterstate() ? "loaded" : "absent" },
	];
	if (!scopeKey || !store || !hasNativeAfterstate()) return rows;
	const native = await openNativeAfterstate(scopeKey);
	if (!native) return rows;
	try {
		const status = await native.call<Record<string, unknown>>("status", {});
		const counts = (status.memories ?? status.counts ?? null) as unknown;
		rows.push({
			label: "status",
			value: counts ? JSON.stringify(counts) : Object.keys(status).join(","),
		});
		const rooms = await store.listRooms();
		rows.push({ label: "rooms (store)", value: String(rooms.length) });
		const port = { call: native.call };
		// Dry run of the sweep: the bridge reports conversations it would erase without erasing them.
		const sweep = await native.call<{
			live: number;
			orphaned: number;
			erased_passages: number;
		}>("sweep", { live: rooms.map((r) => r.id), dry_run: true });
		rows.push({
			label: "index rooms: live / not in store (dry run)",
			value: `${sweep.live} / ${sweep.orphaned} (passages ${sweep.erased_passages})`,
		});
		for (const [i, room] of rooms.entries()) {
			const r = await reconcileConversation(port, store, room.id, {
				dryRun: true,
			});
			rows.push({
				label: `room ${i + 1}`,
				value:
					`msg current ${r.messages.current} missing ${r.messages.missing} ` +
					`stale ${r.messages.stale} orphaned ${r.messages.orphaned}; ` +
					`notes current ${r.notes.current} missing ${r.notes.missing}`,
			});
		}
	} finally {
		await native.close();
	}
	return rows;
}
