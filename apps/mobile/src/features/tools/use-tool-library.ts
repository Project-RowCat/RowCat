import type {
	ChatStore,
	ChatToolImportWrites,
	ChatUserTool,
	CreateUserToolInput,
	UpdateUserToolPatch,
} from "@rowcat/chat";
import { useCallback, useMemo, useState } from "react";
import type { LocalLiveStatus } from "../../lib/local-data/live.ts";
import { useChatScope } from "../../lib/local-data/scope.tsx";
import { useLocalUserTools } from "../../lib/local-data/use-user-tools.ts";
import {
	applyManagedToolImport,
	createManagedTool,
	deleteManagedTool,
	type ToolImportOutcome,
	type ToolMutationScope,
	type ToolWriteOutcome,
	updateManagedTool,
} from "./tool-mutations.ts";

/**
 * Owner of the tool library's writes: one list plus the write operations, the persona library's
 * hook (`use-persona-library.ts`) for its reasons. Screens never hold `ChatStore`; the store
 * instance captured when a write starts goes into the pure combinator, which re-asks whether it
 * still belongs to the current scope.
 *
 * Local writes emit the write signal automatic sync listens to (`lib/local-data/stores.ts`); there
 * is no sync call here.
 */

export interface ToolLibrary {
	tools: ChatUserTool[];
	status: LocalLiveStatus;
	store: ChatStore | null;
	/** Whether a write is in flight. */
	pending: boolean;
	create: (input: CreateUserToolInput) => Promise<ToolWriteOutcome>;
	update: (id: string, patch: UpdateUserToolPatch) => Promise<ToolWriteOutcome>;
	remove: (id: string) => Promise<ToolWriteOutcome>;
	applyImport: (writes: ChatToolImportWrites) => Promise<ToolImportOutcome>;
}

export function useToolLibrary(): ToolLibrary {
	const { value: tools, status, store } = useLocalUserTools();
	const { ownsStore } = useChatScope();
	const [pending, setPending] = useState(false);

	const run = useCallback(
		async <T>(
			task: (scope: ToolMutationScope) => Promise<T>,
			foreign: T,
		): Promise<T> => {
			if (!store) return foreign;
			setPending(true);
			try {
				return await task({ store, owns: ownsStore });
			} finally {
				setPending(false);
			}
		},
		[store, ownsStore],
	);

	return useMemo(
		() => ({
			tools,
			status,
			store,
			pending,
			create: (input) =>
				run<ToolWriteOutcome>(async (scope) => {
					const outcome = await createManagedTool(scope, input);
					return outcome.status === "done" ? "done" : "foreign";
				}, "foreign"),
			update: (id, patch) =>
				run<ToolWriteOutcome>(
					(scope) => updateManagedTool(scope, id, patch),
					"foreign",
				),
			remove: (id) =>
				run<ToolWriteOutcome>(
					(scope) => deleteManagedTool(scope, id),
					"foreign",
				),
			applyImport: (writes) =>
				run<ToolImportOutcome>(
					(scope) => applyManagedToolImport(scope, writes),
					{ status: "foreign" },
				),
		}),
		[tools, status, store, pending, run],
	);
}
