import { space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Textarea,
	type TextFieldHandle,
	type TextFieldSelectionEvent,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FIELD, PROMPT_EXPAND, PROMPT_RUNTIME_LOCK } from "./editor-copy.ts";
import {
	RuntimeLockNotice,
	RuntimeLockPending,
	useConversationAuthoringMode,
} from "./runtime-lock.tsx";

/**
 * Body of the prompt section, in one of three states set by the runtime project: `pending` (project
 * not read yet, placeholder), `editable` (`PromptField`), `locked` (runtime on, notice).
 *
 * `pending` exists because an open field before the project is read lets one frame of typing pass
 * through autosave and mix into a runtime work's old prompt. Subscription and judgment live in
 * `useConversationAuthoringMode`, shared by the four conversation-material sections.
 *
 * While locked it neither reads nor writes the prompt, so there is no second prompt state and
 * turning the runtime on never clears the value. This app cannot turn the runtime off (authoring is
 * the web's); when sync brings that change, the field reopens with the stored value.
 */
export function PromptSectionBody({
	draftId,
	value,
	onChange,
}: {
	draftId: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const mode = useConversationAuthoringMode(draftId);

	if (mode === "pending") return <RuntimeLockPending />;
	if (mode === "locked")
		return <RuntimeLockNotice lock={PROMPT_RUNTIME_LOCK} />;

	return <PromptField value={value} onChange={onChange} />;
}

import {
	caretAtEnd,
	clampTextSelection,
	type TextSelection,
} from "./prompt-editing.ts";

/**
 * Prompt: the whole authored body is one field. v1 split it into four (world, play guide,
 * counterpart, character cards); reviving that split would roll the storage model back to v1
 * (`AUTHORING_SCHEMA_VERSION` in `@rowcat/authoring`).
 *
 * - No length cap: the contract has none, and a number here would make the screen stricter than
 *   the server.
 * - Line breaks and indentation are kept; the publication assembler only trims the ends.
 * - Growth: the field grows to a screen-proportional cap, then scrolls inside itself. An uncapped
 *   box pushes the title and the publish button far down the screen. The ratio and limits belong to
 *   `@rowcat/ui-native`.
 * - `Edit full screen` is a second field over the same `value`/`onChange`, with no second draft state and
 *   no save button. Typing in the window reaches autosave through the same path as inline typing.
 *   It is a `Dialog size="full"`: not a sheet (rising from the bottom earns nothing here) and not a
 *   route (an address would outlive the draft and stay reachable after deletion). `scroll={false}`
 *   matters: if the window scrolls, the field inside gets infinite height and collapses to 0 with
 *   no error.
 */
export function PromptField({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const inline = useRef<TextFieldHandle>(null);
	/** Last cursor positions the two fields reported. A ref: as state, every keystroke would re-render this section. */
	const inlineCaret = useRef<TextSelection | null>(null);
	const expandedCaret = useRef<TextSelection | null>(null);
	/**
	 * Positions planted once into the other field. Controlling `selection` continuously breaks Hangul
	 * composition, so each seed is released on the first `onSelectionChange`. Both fields stay mounted
	 * (the inline one lives behind the window), so there are two seeds: with one, the position handed
	 * over on close would also apply to the field inside the window.
	 */
	const [expandedSeed, setExpandedSeed] = useState<TextSelection | null>(null);
	const [inlineSeed, setInlineSeed] = useState<TextSelection | null>(null);

	const remember =
		(slot: typeof inlineCaret) => (event: TextFieldSelectionEvent) => {
			slot.current = event.nativeEvent.selection;
		};

	const open = (): void => {
		setExpandedSeed(
			clampTextSelection(inlineCaret.current, value.length) ??
				caretAtEnd(value),
		);
		setExpanded(true);
	};

	/**
	 * All four ways of closing (`Done`, the close button, Android back, screen-reader escape) come
	 * through here, so none can lose the cursor. Focus moves before closing: otherwise the keyboard
	 * drops when the window's field unmounts and the inline field raises it again.
	 */
	const close = (): void => {
		setInlineSeed(clampTextSelection(expandedCaret.current, value.length));
		inline.current?.focus();
		setExpanded(false);
	};

	return (
		<View style={prompt.root}>
			{/**
			 * The trigger sits directly above the field, not in the section header's `action` (which means
			 * "add an item to this section"). This is a way of viewing the field, not an add.
			 */}
			<View style={prompt.toolbar}>
				<Button
					label={PROMPT_EXPAND.open}
					variant="ghost"
					size="sm"
					onPress={open}
				/>
			</View>

			<Textarea
				ref={inline}
				label={FIELD.prompt}
				labelHidden
				value={value}
				onChangeText={onChange}
				growth="capped"
				selection={inlineSeed ?? undefined}
				onSelectionChange={(event) => {
					remember(inlineCaret)(event);
					if (inlineSeed) setInlineSeed(null);
				}}
			/>

			<Dialog
				title={PROMPT_EXPAND.title}
				description={PROMPT_EXPAND.description}
				open={expanded}
				size="full"
				/** The window does not scroll; the field inside does. */
				scroll={false}
				onOpenChange={(next) => {
					if (!next) close();
				}}
			>
				{/** Same value and `onChange` as the inline field: no second draft state and no save here. */}
				<Textarea
					label={FIELD.prompt}
					labelHidden
					value={value}
					onChangeText={onChange}
					growth="fill"
					autoFocus
					selection={expandedSeed ?? undefined}
					onSelectionChange={(event) => {
						remember(expandedCaret)(event);
						if (expandedSeed) setExpandedSeed(null);
					}}
				/>
				<DialogActions>
					<Button label={PROMPT_EXPAND.close} onPress={close} />
				</DialogActions>
			</Dialog>
		</View>
	);
}

const prompt = StyleSheet.create({
	root: { gap: space.xs },
	/** One action at the right end; leaves no room for anything else on this row. */
	toolbar: { alignItems: "flex-end" },
});
