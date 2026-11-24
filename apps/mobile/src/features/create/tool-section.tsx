import {
	checkDraftTool,
	DRAFT_TOOL_HTTP_METHODS,
	DRAFT_TOOL_KINDS,
	DRAFT_TOOL_LIMITS,
	type DraftTool,
	type DraftToolParameter,
	type DraftToolPatch,
	draftToolImportBlock,
	draftToolIssueSentence,
	draftToolMethod,
	draftToolUrl,
	type NewDraftTool,
	newDraftToolOf,
} from "@rowcat/authoring";
import { userToolNameTaken } from "@rowcat/chat";
import {
	CHAT_MAX_TOOL_PARAMETERS,
	CHAT_TOOL_PARAMETER_TYPES,
	STORY_PUBLISH_LIMITS,
} from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	Button,
	IconButton,
	Input,
	Notice,
	Panel,
	Select,
	SelectOption,
	Switch,
	Text,
	Textarea,
} from "@rowcat/ui-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import { useToolLibrary } from "../tools/use-tool-library.ts";
import {
	joinToolChoices,
	joinToolRows,
	parseToolNumber,
	SECTION,
	SECTION_SUMMARY_NOUN,
	sectionSummary,
	splitToolChoices,
	splitToolRows,
	TOOL,
	TOOL_KIND_LABEL,
	TOOL_PARAMETER_TYPE_LABEL,
	TOOL_RUNTIME_LOCK,
	toolHeadline,
} from "./editor-copy.ts";
import { EditorSection } from "./editor-section.tsx";
import {
	RuntimeLockedSection,
	useConversationAuthoringMode,
} from "./runtime-lock.tsx";
import { movedOrder } from "./use-draft-actions.ts";

/**
 * Creator tools: tools the conversation's model can call in this work (`draft-tool.ts` in
 * `@rowcat/authoring`). The same record and the same rules as the web's tool cards.
 *
 * - Every field saves as it is typed (`autosave.patchTool`), like lore. The record keeps every
 *   kind's fields side by side, so switching the kind hides the other fields without clearing
 *   them.
 * - What blocks publishing is shown on the card, from `checkDraftTool` (the contract's own schema),
 *   as the contract's own lines. An incomplete tool is still saved; publishing is where it is blocked
 *   (`invalid_tool`), and a story test plays without it.
 * - Up/down buttons, not drag, for lore's reason (`lore-section.tsx`).
 * - With the runtime on, this section locks with the rest of the conversation material: tools are
 *   declared on a conversation's requests, and runtime play creates no conversation.
 */
export function ToolSection({
	draftId,
	tools,
	onPatch,
	onAdd,
	onRemove,
	onReorder,
}: {
	draftId: string;
	tools: readonly DraftTool[];
	onPatch: (id: string, patch: DraftToolPatch) => void;
	/** `input`: a copy from the author's tool library; omitted, a blank tool. */
	onAdd: (input?: NewDraftTool) => void;
	onRemove: (id: string) => void;
	onReorder: (orderedIds: string[]) => void;
}) {
	const mode = useConversationAuthoringMode(draftId);
	const [picking, setPicking] = useState(false);

	const ids = tools.map((tool) => tool.id);
	const over = tools.length > STORY_PUBLISH_LIMITS.tools;
	const full = tools.length >= STORY_PUBLISH_LIMITS.tools;

	if (mode !== "editable")
		return (
			<RuntimeLockedSection
				mode={mode}
				title={SECTION.tools.title}
				description={SECTION.tools.description}
				lock={TOOL_RUNTIME_LOCK}
			/>
		);

	return (
		<EditorSection
			title={SECTION.tools.title}
			description={SECTION.tools.description}
			/** Collapsed by default, like lore: most works have none, and each card is long. */
			summary={sectionSummary(SECTION_SUMMARY_NOUN.tools, tools.length)}
			/** Over the cap can only arrive by sync; the notice must show while collapsed. */
			alert={
				over ? (
					<Notice
						message={TOOL.tooMany(STORY_PUBLISH_LIMITS.tools)}
						tone="destructive"
					/>
				) : null
			}
			action={
				<View style={card.actions}>
					<Button
						label={TOOL.fromLibrary}
						variant="outline"
						size="sm"
						disabled={full}
						onPress={() => setPicking((open) => !open)}
					/>
					<Button
						label={TOOL.add}
						icon="add"
						variant="outline"
						size="sm"
						disabled={full}
						onPress={() => onAdd()}
					/>
				</View>
			}
		>
			{picking ? (
				<LibraryPicker
					disabled={full}
					draftNames={new Set(tools.map((tool) => tool.name.trim()))}
					onPick={(input) => onAdd(input)}
					onClose={() => setPicking(false)}
				/>
			) : null}
			{tools.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{TOOL.empty}
				</Text>
			) : null}
			{/** `enter={false}` for lore's reason: a card moved by reorder must not look newly added. */}
			{tools.map((tool, index) => (
				<MotionRow key={tool.id} enter={false} exit={tools.length > 1}>
					<ToolCard
						tool={tool}
						first={index === 0}
						last={index === tools.length - 1}
						onPatch={(patch) => onPatch(tool.id, patch)}
						onRemove={() => onRemove(tool.id)}
						onMove={(direction) =>
							onReorder(movedOrder(ids, tool.id, direction))
						}
					/>
				</MotionRow>
			))}
		</EditorSection>
	);
}

function ToolCard({
	tool,
	first,
	last,
	onPatch,
	onRemove,
	onMove,
}: {
	tool: DraftTool;
	first: boolean;
	last: boolean;
	onPatch: (patch: DraftToolPatch) => void;
	onRemove: () => void;
	onMove: (direction: -1 | 1) => void;
}) {
	const headline = toolHeadline(tool.name);
	const checked = checkDraftTool(tool);
	const library = useToolLibrary();
	const [libraryNote, setLibraryNote] = useState<string | null>(null);

	/**
	 * Copies a publishable tool into Settings → Tools, arriving off (the tool-file import rule): a tool
	 * written for one story should not join every other conversation until its author turns it on.
	 */
	const saveToLibrary = async (): Promise<void> => {
		if (!checked.ok) return;
		if (userToolNameTaken(library.tools, checked.tool.declaration.name)) {
			setLibraryNote(TOOL.libraryNameTaken);
			return;
		}
		try {
			const outcome = await library.create({
				tool: checked.tool,
				enabledByDefault: false,
			});
			setLibraryNote(outcome === "done" ? TOOL.savedToLibrary : null);
		} catch {
			setLibraryNote(TOOL.saveToLibraryFailed);
		}
	};

	return (
		<Panel style={card.card}>
			<View style={card.head}>
				<Text
					variant="label"
					weight="semibold"
					numberOfLines={1}
					style={card.headline}
				>
					{headline}
				</Text>
				<IconButton
					icon="chevron-up"
					label={`${headline} ${TOOL.moveUp}`}
					tone="muted-foreground"
					disabled={first}
					onPress={() => onMove(-1)}
				/>
				<IconButton
					icon="chevron-down"
					label={`${headline} ${TOOL.moveDown}`}
					tone="muted-foreground"
					disabled={last}
					onPress={() => onMove(1)}
				/>
				<IconButton
					icon="delete"
					label={`${headline} ${TOOL.remove}`}
					tone="destructive"
					onPress={onRemove}
				/>
			</View>

			{checked.ok ? (
				<View style={card.libraryRow}>
					<Button
						label={TOOL.saveToLibrary}
						variant="outline"
						size="sm"
						disabled={library.store === null || library.pending}
						onPress={() => void saveToLibrary()}
					/>
					{libraryNote ? (
						<Text variant="caption" tone="muted-foreground">
							{libraryNote}
						</Text>
					) : null}
				</View>
			) : null}

			{checked.ok ? null : (
				/** Not destructive: an unfinished tool is the normal state while writing, not a failure. */
				<Notice
					message={`${TOOL.issues}\n${checked.issues.map(draftToolIssueSentence).join("\n")}`}
				/>
			)}

			<Input
				label={TOOL.name}
				value={tool.name}
				placeholder="harbor_weather"
				autoCapitalize="none"
				autoCorrect={false}
				onChangeText={(name) => onPatch({ name })}
			/>
			<Text variant="caption" tone="muted-foreground">
				{TOOL.nameHint}
			</Text>
			<Textarea
				label={TOOL.description}
				value={tool.description}
				onChangeText={(description) => onPatch({ description })}
			/>
			<Text variant="caption" tone="muted-foreground">
				{TOOL.descriptionHint}
			</Text>

			<ToolParameters
				parameters={tool.parameters}
				onChange={(parameters) => onPatch({ parameters })}
			/>

			<Select label={TOOL.kind} value={TOOL_KIND_LABEL[tool.kind]}>
				{DRAFT_TOOL_KINDS.map((kind) => (
					<SelectOption
						key={kind}
						label={TOOL_KIND_LABEL[kind]}
						selected={kind === tool.kind}
						onSelect={() => kind !== tool.kind && onPatch({ kind })}
					/>
				))}
			</Select>

			{tool.kind === "template" ? (
				<>
					<Textarea
						label={TOOL.template}
						value={tool.template}
						invalid={tool.template.length > DRAFT_TOOL_LIMITS.templateChars}
						onChangeText={(template) => onPatch({ template })}
					/>
					<Text variant="caption" tone="muted-foreground">
						{TOOL.templateHint}
					</Text>
				</>
			) : null}

			{tool.kind === "table" ? (
				<>
					<Textarea
						label={TOOL.entries}
						value={joinToolRows(tool.entries)}
						onChangeText={(text) => onPatch({ entries: splitToolRows(text) })}
					/>
					<Text variant="caption" tone="muted-foreground">
						{TOOL.entriesHint}
					</Text>
					<NumberInput
						label={`${TOOL.draws} (1–${DRAFT_TOOL_LIMITS.tableMaxDraws})`}
						value={tool.draws}
						onCommit={(draws) => onPatch({ draws })}
					/>
				</>
			) : null}

			{tool.kind === "agent" ? (
				<>
					<Textarea
						label={TOOL.system}
						value={tool.system}
						invalid={tool.system.length > DRAFT_TOOL_LIMITS.agentSystemChars}
						onChangeText={(system) => onPatch({ system })}
					/>
					<Text variant="caption" tone="muted-foreground">
						{TOOL.systemHint}
					</Text>
					<NumberInput
						label={`${TOOL.maxOutputTokens} (1–${DRAFT_TOOL_LIMITS.agentMaxOutputTokens})`}
						value={tool.maxOutputTokens}
						onCommit={(maxOutputTokens) => onPatch({ maxOutputTokens })}
					/>
				</>
			) : null}

			{tool.kind === "http" ? (
				<>
					<Input
						label={TOOL.url}
						value={draftToolUrl(tool)}
						placeholder="http://localhost:8787/tool"
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						onChangeText={(url) => onPatch({ url })}
					/>
					<Text variant="caption" tone="muted-foreground">
						{TOOL.urlHint}
					</Text>
					<Select label={TOOL.method} value={draftToolMethod(tool)}>
						{DRAFT_TOOL_HTTP_METHODS.map((method) => (
							<SelectOption
								key={method}
								label={method}
								selected={method === draftToolMethod(tool)}
								onSelect={() =>
									method !== draftToolMethod(tool) && onPatch({ method })
								}
							/>
						))}
					</Select>
					<Text variant="caption" tone="muted-foreground">
						{TOOL.methodHint[draftToolMethod(tool)]}
					</Text>
					<Text variant="caption" tone="muted-foreground">
						{TOOL.httpNote}
					</Text>
				</>
			) : null}
		</Panel>
	);
}

/**
 * A whole-number box. The text being typed is local, because the record only takes a number: an
 * emptied box (on the way from `3` to `5`) has no number to save, and drawing it from the record
 * would put `3` back under the creator's finger. Saved on every readable change, so nothing waits
 * on a blur that a phone may never send before the app is backgrounded.
 */
function NumberInput({
	label,
	value,
	onCommit,
}: {
	label: string;
	value: number;
	onCommit: (value: number) => void;
}) {
	const [text, setText] = useState(String(value));
	return (
		<Input
			label={label}
			value={text}
			keyboardType="number-pad"
			onChangeText={(next) => {
				setText(next);
				const parsed = parseToolNumber(next, Number.NaN);
				if (Number.isFinite(parsed)) onCommit(parsed);
			}}
		/>
	);
}

/**
 * The screen's copy of the parameter array. The record holds the rows as one array, and the store
 * catches up 500ms after each edit; rebuilding the array from the record on every keystroke would
 * undo an edit made to another row inside that window. So the screen owns the array until the record
 * returns the value it sent (the web's `useEditedValue`, compared by value).
 */
function useParameterDraft(
	record: readonly DraftToolParameter[],
	commit: (next: DraftToolParameter[]) => void,
): [readonly DraftToolParameter[], (next: DraftToolParameter[]) => void] {
	const same = (
		a: readonly DraftToolParameter[],
		b: readonly DraftToolParameter[],
	) => JSON.stringify(a) === JSON.stringify(b);
	const [state, setState] = useState<{
		value: readonly DraftToolParameter[];
		pending: readonly DraftToolParameter[] | null;
	}>({ value: record, pending: null });

	let next = state;
	if (state.pending !== null) {
		if (same(record, state.pending))
			next = { value: state.value, pending: null };
	} else if (!same(record, state.value))
		next = { value: record, pending: null };
	// Adjusting state during render: React's pattern for following a prop without an effect's lag.
	if (next !== state) setState(next);

	return [
		next.value,
		(value) => {
			setState({ value, pending: value });
			commit(value);
		},
	];
}

function ToolParameters({
	parameters: record,
	onChange,
}: {
	parameters: readonly DraftToolParameter[];
	onChange: (parameters: DraftToolParameter[]) => void;
}) {
	const [parameters, edit] = useParameterDraft(record, onChange);
	const update = (at: number, change: Partial<DraftToolParameter>) =>
		edit(
			parameters.map((parameter, index) =>
				index === at ? { ...parameter, ...change } : parameter,
			),
		);

	return (
		<View style={card.parameters}>
			<View style={card.head}>
				<Text variant="label" weight="semibold" style={card.headline}>
					{TOOL.parameters}
				</Text>
				<Button
					label={TOOL.addParameter}
					icon="add"
					variant="outline"
					size="sm"
					disabled={parameters.length >= CHAT_MAX_TOOL_PARAMETERS}
					onPress={() =>
						edit([
							...parameters,
							{
								name: "",
								type: "string",
								description: "",
								required: false,
								choices: [],
							},
						])
					}
				/>
			</View>
			{parameters.length === 0 ? (
				<Text variant="caption" tone="muted-foreground">
					{TOOL.noParameters}
				</Text>
			) : null}
			{parameters.map((parameter, index) => (
				// Rows have no identity of their own; position is the only stable key there is.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above.
				<View key={index} style={card.parameter}>
					<View style={card.head}>
						<View style={card.headline}>
							<Input
								label={TOOL.parameterName}
								value={parameter.name}
								placeholder="place"
								autoCapitalize="none"
								autoCorrect={false}
								onChangeText={(name) => update(index, { name })}
							/>
						</View>
						<IconButton
							icon="delete"
							label={`${parameter.name || `#${index + 1}`} ${TOOL.removeParameter}`}
							tone="destructive"
							onPress={() =>
								edit(parameters.filter((_, position) => position !== index))
							}
						/>
					</View>
					<Select
						label={TOOL.parameterType}
						value={TOOL_PARAMETER_TYPE_LABEL[parameter.type]}
					>
						{CHAT_TOOL_PARAMETER_TYPES.map((type) => (
							<SelectOption
								key={type}
								label={TOOL_PARAMETER_TYPE_LABEL[type]}
								selected={type === parameter.type}
								onSelect={() =>
									type !== parameter.type && update(index, { type })
								}
							/>
						))}
					</Select>
					<Input
						label={TOOL.parameterDescription}
						value={parameter.description}
						onChangeText={(description) => update(index, { description })}
					/>
					<View style={card.toggle}>
						<Text variant="body" style={card.headline}>
							{TOOL.parameterRequired}
						</Text>
						<Switch
							label={TOOL.parameterRequired}
							value={parameter.required}
							onValueChange={(required) => update(index, { required })}
						/>
					</View>
					{/* Choices constrain text only; the other types ignore them. */}
					{parameter.type === "string" ? (
						<Input
							label={TOOL.parameterChoices}
							value={joinToolChoices(parameter.choices)}
							autoCapitalize="none"
							onChangeText={(text) =>
								update(index, { choices: splitToolChoices(text) })
							}
						/>
					) : null}
				</View>
			))}
		</View>
	);
}

/**
 * Settings → Tools into this story, inline under the section header rather than a sheet: the
 * presentation boundary keeps generic sheets out of feature code, and the list is short. `http`
 * tools a story could not publish (`draftToolImportBlock`: off localhost, or with headers) are
 * listed with the reason they cannot be added, so the author does not wonder where they went.
 */
function LibraryPicker({
	disabled,
	draftNames,
	onPick,
	onClose,
}: {
	disabled: boolean;
	draftNames: ReadonlySet<string>;
	onPick: (input: NewDraftTool) => void;
	onClose: () => void;
}) {
	const { tools } = useToolLibrary();
	return (
		<Panel style={card.card}>
			<Text variant="caption" tone="muted-foreground">
				{TOOL.fromLibraryHint}
			</Text>
			{tools.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{TOOL.libraryEmpty}
				</Text>
			) : null}
			{tools.map((tool) => {
				const input = newDraftToolOf(tool.tool);
				const block = draftToolImportBlock(tool.tool);
				const inDraft = draftNames.has(tool.tool.declaration.name);
				return (
					<View key={tool.id} style={card.libraryItem}>
						<View style={card.libraryText}>
							<Text variant="label" weight="semibold" numberOfLines={1}>
								{tool.tool.declaration.name}
							</Text>
							<Text variant="caption" tone="muted-foreground" numberOfLines={2}>
								{input === null
									? block === "http_headers"
										? TOOL.libraryHttpHeaders
										: TOOL.libraryHttpNotLocal
									: inDraft
										? TOOL.libraryInDraft
										: `${TOOL_KIND_LABEL[input.kind ?? "template"]} · ${tool.tool.declaration.description}`}
							</Text>
						</View>
						<Button
							label={TOOL.libraryAdd}
							variant="outline"
							size="sm"
							disabled={input === null || inDraft || disabled}
							onPress={() => {
								if (input) onPick(input);
							}}
						/>
					</View>
				);
			})}
			<Button
				label={TOOL.libraryClose}
				variant="ghost"
				size="sm"
				onPress={onClose}
			/>
		</Panel>
	);
}

const card = StyleSheet.create({
	actions: { flexDirection: "row", gap: space.sm },
	libraryRow: { gap: space.xs },
	libraryItem: { flexDirection: "row", alignItems: "center", gap: space.sm },
	libraryText: { flex: 1, minWidth: 0 },
	card: { gap: space.sm, padding: space.md },
	head: { alignItems: "center", flexDirection: "row", gap: space.xs },
	headline: { flex: 1, minWidth: 0 },
	toggle: { alignItems: "center", flexDirection: "row", gap: space.md },
	parameters: { gap: space.sm },
	parameter: { gap: space.xs, paddingLeft: space.sm },
});
