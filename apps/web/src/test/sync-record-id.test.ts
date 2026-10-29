import { runtimeProjectIdFor } from "@rowcat/authoring";
import { summaryIdFor } from "@rowcat/chat";
import { SyncRecordId } from "@rowcat/contracts";
import {
	RUNTIME_SAVE_SLOTS,
	runtimeConversationIdFor,
	runtimePersistentIdFor,
	runtimePlaythroughIdFor,
} from "@rowcat/runtime-persistence";
import { describe, expect, it } from "vitest";

/**
 * Checks at the assembly point that derived identities pass the wire contract, by value. Derivation
 * rules are spread across chat, authoring and runtime-persistence, and the contract lives in
 * contracts; this is the only place all four can be imported together. For a time every derived id
 * was rejected because of colons, and no test failed: engine tests used an unverified fake server
 * and codec tests skipped id-format checks. The symptom was not an error but an account whose sync
 * failed every time, with the cause in one record and nothing visible on screen.
 *
 * Inputs are the longest shapes actually produced: room and draft ids come from crypto.randomUUID()
 * (36 chars), work ids from the server's newId() (32 hex chars). The 64-char length limit is pinned
 * too.
 */
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SERVER_ID = "a3f1c2d4e5b60718293a4b5c6d7e8f90";

const accepted = (id: string) => SyncRecordId.safeParse(id).success;

describe("derived record id ↔ SyncRecordId", () => {
	it("conversation summary", () => {
		expect(accepted(summaryIdFor(UUID))).toBe(true);
	});

	it("a draft's runtime project", () => {
		expect(accepted(runtimeProjectIdFor(UUID))).toBe(true);
	});

	it.each(
		RUNTIME_SAVE_SLOTS,
	)("runtime saves and library rows — slot %s", (slot) => {
		expect(accepted(runtimePlaythroughIdFor(SERVER_ID, slot))).toBe(true);
		expect(accepted(runtimeConversationIdFor(SERVER_ID, slot))).toBe(true);
		expect(accepted(runtimePersistentIdFor(SERVER_ID))).toBe(true);
	});
});
