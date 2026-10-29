import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import {
	RuntimeLockNotice,
	useConversationAuthoringMode,
} from "../runtime-lock.tsx";
import { promptRuntimeLock, runtimePendingLabel } from "./prompt-editing.ts";
import { PromptField } from "./prompt-field.tsx";

/**
 * The body takes one of three shapes, chosen by the project's runtime state.
 *
 * The pending placeholder is why this component exists. If the field were open before the project
 * is read, keystrokes in that frame would pass through autosave and mix into the prompt of a
 * runtime-enabled work. Nothing would look wrong, because the field locks right after.
 *
 * While locked, the component neither reads nor writes the prompt value and keeps no state of its
 * own. Enabling the runtime never clears the prompt, and disabling it restores the saved value.
 * Edits already queued still flush through autosave; only new edits are blocked. The lock decision
 * comes from one hook (`useConversationAuthoringMode`) shared by the four conversation-material
 * sections.
 */
export function PromptSection({
	draftId,
	value,
	onChange,
	placeholder,
	hint,
}: {
	draftId: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	hint?: string;
}) {
	const mode = useConversationAuthoringMode(draftId);

	if (mode === "pending")
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<span className="sr-only">{runtimePendingLabel()}</span>
				<Skeleton className="h-4 w-24 rounded" aria-hidden="true" />
				<Skeleton className="h-40 w-full rounded-md" aria-hidden="true" />
			</div>
		);

	if (mode === "locked")
		return <RuntimeLockNotice lock={promptRuntimeLock()} />;

	return (
		<PromptField
			value={value}
			placeholder={placeholder}
			hint={hint}
			onChange={onChange}
		/>
	);
}
