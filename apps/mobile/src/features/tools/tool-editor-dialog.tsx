import type { ChatUserTool } from "@rowcat/chat";
import {
	CHAT_CUSTOM_TOOL_KINDS,
	type ChatCustomToolKind,
	type ChatToolParameterType,
} from "@rowcat/contracts/chat";
import { radiusScale, space } from "@rowcat/design";
import {
	Button,
	ChoiceGroup,
	ChoiceOption,
	Dialog,
	DialogActions,
	Input,
	Notice,
	Switch,
	Text,
	Textarea,
	useTheme,
} from "@rowcat/ui-native";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import {
	emptyHeaderDraft,
	emptyParameterDraft,
	emptyToolDraft,
	invalidFields,
	planToolSave,
	type ToolDraft,
	type ToolFormIssue,
	type ToolHeaderDraft,
	type ToolParameterDraft,
	toolDraftOf,
} from "./tool-form.ts";
import type { ToolWriteOutcome } from "./tool-mutations.ts";

/**
 * The form for creating or editing one tool. A `Dialog` that fills the surface: a tool is a long
 * form (parameters, a body that can be a whole system prompt), the same reason the report form fills
 * it.
 *
 * Validation is `planToolSave` (`tool-form.ts`), which asks `@rowcat/chat` the same question storage
 * asks. The issues are drawn together above the actions and the parts they belong to are marked,
 * so a long form never fails with a single "invalid" and no place to look.
 *
 * No `maxLength` on any field, for the persona form's reason: a limit that silently drops the end
 * of a pasted body is never expressed; the contract's message is.
 *
 * A second submit in the same tick is rejected by a ref: two taps in one frame would both see
 * `pending` false and create the tool twice.
 */
export function ToolEditorDialog({
	tool,
	library,
	pending,
	onSave,
	onDelete,
	onCancel,
}: {
	/** The tool to edit. `null` creates one. */
	tool: ChatUserTool | null;
	/** The live library, for the name check. */
	library: readonly ChatUserTool[];
	pending: boolean;
	/** A rejection is a failure, drawn inside the form; `foreign` closes quietly in the caller. */
	onSave: (input: {
		tool: ChatUserTool["tool"];
		enabledByDefault: boolean;
	}) => Promise<ToolWriteOutcome>;
	/** Present only when editing; the caller confirms before deleting. */
	onDelete?: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation("tools");
	const { t: tCommon } = useTranslation("common");
	const { colors } = useTheme();
	const [draft, setDraft] = useState<ToolDraft>(() =>
		tool ? toolDraftOf(tool) : emptyToolDraft(),
	);
	const [issues, setIssues] = useState<ToolFormIssue[]>([]);
	const [error, setError] = useState<string | null>(null);
	const submittingRef = useRef(false);
	const marked = invalidFields(issues);

	/** Any edit clears the shown problems; they described the previous text. */
	const change = (patch: Partial<ToolDraft>): void => {
		setDraft((current) => ({ ...current, ...patch }));
		setIssues([]);
		setError(null);
	};
	const changeParameter = (
		key: string,
		patch: Partial<ToolParameterDraft>,
	): void =>
		change({
			parameters: draft.parameters.map((parameter) =>
				parameter.key === key ? { ...parameter, ...patch } : parameter,
			),
		});
	const changeHeader = (key: string, patch: Partial<ToolHeaderDraft>): void =>
		change({
			headers: draft.headers.map((header) =>
				header.key === key ? { ...header, ...patch } : header,
			),
		});

	const submit = (): void => {
		if (submittingRef.current) return;
		const plan = planToolSave(draft, library, tool);
		if (plan.kind === "invalid") {
			setIssues(plan.issues);
			return;
		}
		if (plan.kind === "unchanged") {
			onCancel();
			return;
		}
		submittingRef.current = true;
		setError(null);
		void onSave({ tool: plan.tool, enabledByDefault: plan.enabledByDefault })
			.then(() => {
				submittingRef.current = false;
			})
			.catch(() => {
				submittingRef.current = false;
				setError(t("copy.saveFailed"));
			});
	};

	const kindLabel: Record<ChatCustomToolKind, { label: string; note: string }> =
		{
			template: {
				label: t("copy.kindTemplate"),
				note: t("copy.kindTemplateNote"),
			},
			table: { label: t("copy.kindTable"), note: t("copy.kindTableNote") },
			agent: { label: t("copy.kindAgent"), note: t("copy.kindAgentNote") },
			http: { label: t("copy.kindHttp"), note: t("copy.kindHttpNote") },
		};
	const typeLabel: Record<ChatToolParameterType, string> = {
		string: t("copy.typeString"),
		number: t("copy.typeNumber"),
		boolean: t("copy.typeBoolean"),
	};

	return (
		<Dialog
			open
			size="full"
			title={tool ? t("copy.editTitle") : t("copy.newTitle")}
			onOpenChange={(next) => {
				if (!next && !pending) onCancel();
			}}
		>
			<View style={form.root}>
				<Input
					label={t("copy.name")}
					value={draft.name}
					autoCapitalize="none"
					autoCorrect={false}
					autoFocus={tool === null}
					invalid={marked.has("name")}
					onChangeText={(name) => change({ name })}
				/>
				<Text variant="caption" tone="muted-foreground">
					{t("copy.nameHint")}
				</Text>

				<Textarea
					label={t("copy.description")}
					value={draft.description}
					invalid={marked.has("description")}
					onChangeText={(description) => change({ description })}
				/>
				<Text variant="caption" tone="muted-foreground">
					{t("copy.descriptionHint")}
				</Text>

				{/* Parameters: one bordered block each, so which fields belong together reads at a glance. */}
				<View style={form.section}>
					<Text variant="body" weight="medium">
						{t("copy.parameters")}
					</Text>
					<Text variant="caption" tone="muted-foreground">
						{t("copy.parametersHint")}
					</Text>
					{draft.parameters.map((parameter, index) => (
						<View
							key={parameter.key}
							style={[form.block, { borderColor: colors.border }]}
						>
							<Text variant="label" weight="medium">
								{t("parameterLabel", { position: index + 1 })}
							</Text>
							<Input
								label={t("copy.parameterName")}
								value={parameter.name}
								autoCapitalize="none"
								autoCorrect={false}
								invalid={marked.has("parameters")}
								onChangeText={(name) =>
									changeParameter(parameter.key, { name })
								}
							/>
							<Segmented
								label={t("copy.parameterType")}
								options={(["string", "number", "boolean"] as const).map(
									(type) => ({ value: type, label: typeLabel[type] }),
								)}
								value={parameter.type}
								onChange={(type) => changeParameter(parameter.key, { type })}
							/>
							<Input
								label={t("copy.parameterDescription")}
								value={parameter.description}
								onChangeText={(description) =>
									changeParameter(parameter.key, { description })
								}
							/>
							{parameter.type === "string" ? (
								<>
									<Textarea
										label={t("copy.parameterChoices")}
										value={parameter.choices}
										autoCapitalize="none"
										onChangeText={(choices) =>
											changeParameter(parameter.key, { choices })
										}
									/>
									<Text variant="caption" tone="muted-foreground">
										{t("copy.parameterChoicesHint")}
									</Text>
								</>
							) : null}
							<View style={form.toggleRow}>
								<Text variant="body" style={form.toggleText}>
									{t("copy.parameterRequired")}
								</Text>
								<Switch
									label={`${t("parameterLabel", { position: index + 1 })} ${t("copy.parameterRequired")}`}
									value={parameter.required}
									onValueChange={(required) =>
										changeParameter(parameter.key, { required })
									}
								/>
							</View>
							<Button
								label={t("copy.removeParameter")}
								variant="ghost"
								icon="delete"
								onPress={() =>
									change({
										parameters: draft.parameters.filter(
											(entry) => entry.key !== parameter.key,
										),
									})
								}
							/>
						</View>
					))}
					<Button
						label={t("copy.addParameter")}
						variant="outline"
						icon="add"
						onPress={() =>
							change({
								parameters: [...draft.parameters, emptyParameterDraft()],
							})
						}
					/>
				</View>

				<View style={form.section}>
					<Text variant="body" weight="medium">
						{t("copy.kind")}
					</Text>
					<ChoiceGroup<ChatCustomToolKind>
						value={draft.kind}
						onValueChange={(kind) => change({ kind })}
					>
						{CHAT_CUSTOM_TOOL_KINDS.map((kind) => (
							<ChoiceOption
								key={kind}
								value={kind}
								label={kindLabel[kind].label}
								note={kindLabel[kind].note}
								selected={draft.kind === kind}
							/>
						))}
					</ChoiceGroup>
				</View>

				{draft.kind === "template" ? (
					<>
						<Textarea
							label={t("copy.template")}
							value={draft.template}
							growth="capped"
							invalid={marked.has("action")}
							onChangeText={(template) => change({ template })}
						/>
						<Text variant="caption" tone="muted-foreground">
							{t("templateHint", { example: "{{city}}" })}
						</Text>
					</>
				) : draft.kind === "table" ? (
					<>
						<Textarea
							label={t("copy.entries")}
							value={draft.entries}
							growth="capped"
							invalid={marked.has("action")}
							onChangeText={(entries) => change({ entries })}
						/>
						<Text variant="caption" tone="muted-foreground">
							{t("copy.entriesHint")}
						</Text>
						<Input
							label={t("copy.draws")}
							value={draft.draws}
							keyboardType="number-pad"
							invalid={marked.has("action")}
							onChangeText={(draws) => change({ draws })}
						/>
					</>
				) : draft.kind === "agent" ? (
					<>
						<Textarea
							label={t("copy.system")}
							value={draft.system}
							growth="capped"
							invalid={marked.has("action")}
							onChangeText={(system) => change({ system })}
						/>
						<Text variant="caption" tone="muted-foreground">
							{t("copy.systemHint")}
						</Text>
						<Input
							label={t("copy.maxOutputTokens")}
							value={draft.maxOutputTokens}
							keyboardType="number-pad"
							invalid={marked.has("action")}
							onChangeText={(maxOutputTokens) => change({ maxOutputTokens })}
						/>
					</>
				) : (
					<>
						{/* Said before the URL is typed, not after: what leaves the device is the point of this kind. */}
						<Notice message={t("copy.httpNotice")} />
						<Input
							label={t("copy.url")}
							value={draft.url}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
							invalid={marked.has("action")}
							onChangeText={(url) => change({ url })}
						/>
						<Segmented
							label={t("copy.method")}
							options={[
								{ value: "POST", label: t("copy.methodPost") },
								{ value: "GET", label: t("copy.methodGet") },
							]}
							value={draft.method}
							onChange={(method) => change({ method })}
						/>
						<View style={form.section}>
							<Text variant="body" weight="medium">
								{t("copy.headers")}
							</Text>
							<Text variant="caption" tone="muted-foreground">
								{t("copy.headersHint")}
							</Text>
							{draft.headers.map((header, index) => (
								<View
									key={header.key}
									style={[form.block, { borderColor: colors.border }]}
								>
									<Text variant="label" weight="medium">
										{t("headerLabel", { position: index + 1 })}
									</Text>
									<Input
										label={t("copy.headerName")}
										value={header.name}
										autoCapitalize="none"
										autoCorrect={false}
										onChangeText={(name) => changeHeader(header.key, { name })}
									/>
									{/* Masked: header values are usually keys, and the form is often open in public. */}
									<Input
										label={t("copy.headerValue")}
										value={header.value}
										autoCapitalize="none"
										autoCorrect={false}
										secureTextEntry
										onChangeText={(value) =>
											changeHeader(header.key, { value })
										}
									/>
									<Button
										label={t("copy.removeHeader")}
										variant="ghost"
										icon="delete"
										onPress={() =>
											change({
												headers: draft.headers.filter(
													(entry) => entry.key !== header.key,
												),
											})
										}
									/>
								</View>
							))}
							<Button
								label={t("copy.addHeader")}
								variant="outline"
								icon="add"
								onPress={() =>
									change({ headers: [...draft.headers, emptyHeaderDraft()] })
								}
							/>
						</View>
					</>
				)}

				<View style={form.toggleRow}>
					<View style={form.toggleText}>
						<Text variant="body">{t("copy.enabledByDefault")}</Text>
						<Text variant="caption" tone="muted-foreground">
							{t("copy.enabledByDefaultHint")}
						</Text>
					</View>
					<Switch
						label={t("copy.enabledByDefault")}
						value={draft.enabledByDefault}
						onValueChange={(enabledByDefault) => change({ enabledByDefault })}
					/>
				</View>

				{issues.length > 0 ? (
					<Notice
						tone="destructive"
						message={[
							t("copy.fixIssues"),
							...issues.map((issue) => `• ${issue.message}`),
						].join("\n")}
					/>
				) : null}
				{error ? <Notice tone="destructive" message={error} /> : null}

				<DialogActions>
					<Button
						label={tCommon("actions.cancel")}
						variant="outline"
						fullWidth
						onPress={onCancel}
						style={form.action}
					/>
					<Button
						label={t("copy.save")}
						fullWidth
						busy={pending}
						onPress={submit}
						style={form.action}
					/>
				</DialogActions>
				{onDelete ? (
					<Button
						label={t("copy.deleteThis")}
						variant="ghost"
						icon="delete"
						onPress={onDelete}
					/>
				) : null}
			</View>
		</Dialog>
	);
}

/**
 * A row of mutually exclusive buttons for two or three short values (a parameter's type, the HTTP
 * method). Not a `Select`: its menu is a floating layer, and stacking one over this window would
 * make two focus owners; the values are few enough to stand side by side anyway.
 */
function Segmented<T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: readonly { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<View accessibilityRole="radiogroup" accessibilityLabel={label}>
			<View style={form.segments}>
				{options.map((option) => (
					<Button
						key={option.value}
						label={option.label}
						size="sm"
						variant={option.value === value ? "secondary" : "ghost"}
						accessibilityHint={option.value === value ? undefined : label}
						onPress={() => onChange(option.value)}
					/>
				))}
			</View>
		</View>
	);
}

const form = StyleSheet.create({
	root: { gap: space.md },
	section: { gap: space.sm },
	block: {
		borderRadius: radiusScale.md,
		borderWidth: StyleSheet.hairlineWidth,
		gap: space.sm,
		padding: space.md,
	},
	segments: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
	toggleRow: { alignItems: "center", flexDirection: "row", gap: space.md },
	toggleText: { flex: 1, gap: space.px },
	action: { alignSelf: "stretch" },
});
