import type { ChatUserTool, UpdateUserToolPatch } from "@rowcat/chat";
import {
	CHAT_CUSTOM_TOOL_KINDS,
	CHAT_CUSTOM_TOOL_LIMITS,
	CHAT_MAX_TOOL_PARAMETERS,
	CHAT_TOOL_PARAMETER_TYPES,
	type ChatCustomToolKind,
	type ChatToolParameterType,
} from "@rowcat/contracts/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rowcat/ui-web/components/select";
import { Switch } from "@rowcat/ui-web/components/switch";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { Plus, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	checkToolDraft,
	emptyHeaderDraft,
	emptyParameterDraft,
	emptyToolDraft,
	issuesFor,
	type ToolFormDraft,
	type ToolFormField,
	type ToolFormIssue,
	toolDraftOf,
	toolKindDescription,
	toolKindLabel,
	toolParameterTypeLabel,
} from "./tool-form.ts";

/**
 * Create or edit one tool. One form for both paths, for the persona editor's reason: two forms
 * would drift on limits and validation, each drift visible on one path only.
 *
 * Validation runs on the first save attempt, then live. Checking from the first keystroke would
 * greet a new tool with a column of red; checking only on save would leave a fixed field still
 * marked wrong until the next press. The check is the same function the store runs
 * (`checkUserToolDefinition`, via `checkToolDraft`), so nothing the form accepts is refused later.
 *
 * Failures stay in the dialog, with the typing intact (docs/design/FAILURE-FEEDBACK.md).
 */
export function ToolEditorDialog({
	tool,
	library,
	onClose,
	onSave,
	onDelete,
}: {
	/** Null creates. */
	tool: ChatUserTool | null;
	/** The live library, for the duplicate-name rule. */
	library: readonly ChatUserTool[];
	onClose: () => void;
	/** The validated patch: the full definition plus the default switch. Throwing keeps the dialog open. */
	onSave: (patch: Required<UpdateUserToolPatch>) => Promise<unknown>;
	/** Edit only: hands over to the delete confirmation. */
	onDelete?: () => void;
}) {
	const { t } = useTranslation(["tools", "common"]);
	const [draft, setDraft] = useState<ToolFormDraft>(() =>
		tool ? toolDraftOf(tool) : emptyToolDraft(),
	);
	const [attempted, setAttempted] = useState(false);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const pendingRef = useRef(false);

	const check = checkToolDraft(draft, library, tool?.id);
	const issues: ToolFormIssue[] = attempted && !check.ok ? check.issues : [];

	const patch = (next: Partial<ToolFormDraft>): void =>
		setDraft((current) => ({ ...current, ...next }));

	const submit = (): void => {
		if (pendingRef.current) return;
		setAttempted(true);
		if (!check.ok) return;
		pendingRef.current = true;
		setPending(true);
		setFailure(null);
		void onSave({ tool: check.tool, enabledByDefault: draft.enabledByDefault })
			.then(onClose)
			.catch((error: unknown) => {
				console.error("[tools] could not save the tool", error);
				setFailure(t("editor.saveFailed"));
			})
			.finally(() => {
				pendingRef.current = false;
				setPending(false);
			});
	};

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				className={`${DIALOG_VIEWPORT_BOUND} sm:max-w-2xl`}
			>
				<DialogHeader className="min-w-0">
					<DialogTitle>
						{tool ? t("editor.editTitle") : t("editor.newTitle")}
					</DialogTitle>
					<DialogDescription>{t("editor.description")}</DialogDescription>
				</DialogHeader>

				<form
					className="flex min-w-0 flex-col gap-5"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<Field
						label={t("editor.name")}
						hint={t("editor.nameHint")}
						errors={issuesFor(issues, "name")}
					>
						{(props) => (
							<Input
								{...props}
								value={draft.name}
								autoFocus
								autoComplete="off"
								spellCheck={false}
								className="font-mono"
								placeholder="roll_dice"
								onChange={(event) => patch({ name: event.target.value })}
							/>
						)}
					</Field>

					<Field
						label={t("editor.toolDescription")}
						errors={issuesFor(issues, "description")}
					>
						{(props) => (
							<Textarea
								{...props}
								value={draft.description}
								rows={3}
								placeholder={t("editor.toolDescriptionPlaceholder")}
								onChange={(event) => patch({ description: event.target.value })}
							/>
						)}
					</Field>

					<ParametersEditor draft={draft} issues={issues} onChange={patch} />

					<KindEditor draft={draft} issues={issues} onChange={patch} />

					<EnabledByDefault
						checked={draft.enabledByDefault}
						onChange={(enabledByDefault) => patch({ enabledByDefault })}
					/>

					{issuesFor(issues, "form").map((message) => (
						<p key={message} role="alert" className="text-destructive text-sm">
							{message}
						</p>
					))}
					{issues.length > 0 && (
						<p role="alert" className="text-destructive text-sm">
							{t("editor.fixIssues")}
						</p>
					)}
					{failure && (
						<p role="alert" className="text-destructive text-sm">
							{failure}
						</p>
					)}

					<DialogFooter className="sm:justify-between">
						{/*
						 * Delete sits apart, on the leading edge, so it is never the button a hurried press on the
						 * trailing pair lands on. It only opens the confirmation; nothing is deleted here.
						 */}
						{onDelete ? (
							<Button
								type="button"
								variant="destructive"
								onClick={onDelete}
								disabled={pending}
							>
								{t("editor.delete")}
							</Button>
						) : (
							<span />
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row">
							<Button
								type="button"
								variant="outline"
								onClick={onClose}
								disabled={pending}
							>
								{t("common:actions.cancel")}
							</Button>
							<Button type="submit" disabled={pending}>
								{pending
									? t("editor.saving")
									: tool
										? t("editor.save")
										: t("editor.create")}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface FieldControlProps {
	id: string;
	"aria-invalid": boolean | undefined;
	"aria-describedby": string | undefined;
}

/**
 * Label, control, hint, errors: one shape for every field, so ids and descriptions are wired the
 * same way everywhere. A control without `aria-describedby` would read its error to sighted people
 * only.
 */
function Field({
	label,
	hint,
	errors = [],
	children,
}: {
	label: string;
	hint?: ReactNode;
	errors?: readonly string[];
	children: (props: FieldControlProps) => ReactNode;
}) {
	const id = useId();
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	const described =
		[hint ? hintId : null, errors.length > 0 ? errorId : null]
			.filter(Boolean)
			.join(" ") || undefined;
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			{children({
				id,
				"aria-invalid": errors.length > 0 || undefined,
				"aria-describedby": described,
			})}
			{hint && (
				<p id={hintId} className="text-muted-foreground text-xs">
					{hint}
				</p>
			)}
			{errors.length > 0 && (
				<div id={errorId} className="flex flex-col gap-0.5">
					{errors.map((message) => (
						<p key={message} className="text-destructive text-xs">
							{message}
						</p>
					))}
				</div>
			)}
		</div>
	);
}

function ParametersEditor({
	draft,
	issues,
	onChange,
}: {
	draft: ToolFormDraft;
	issues: readonly ToolFormIssue[];
	onChange: (next: Partial<ToolFormDraft>) => void;
}) {
	const { t } = useTranslation("tools");
	const headingId = useId();
	const baseId = useId();
	const update = (
		index: number,
		next: Partial<ToolFormDraft["parameters"][number]>,
	): void =>
		onChange({
			parameters: draft.parameters.map((parameter, at) =>
				at === index ? { ...parameter, ...next } : parameter,
			),
		});

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-2">
				<h3 id={headingId} className="text-sm font-medium">
					{t("editor.parameters")}
				</h3>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={draft.parameters.length >= CHAT_MAX_TOOL_PARAMETERS}
					onClick={() =>
						onChange({
							parameters: [...draft.parameters, emptyParameterDraft()],
						})
					}
				>
					<Plus aria-hidden="true" />
					{t("editor.addParameter")}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				{t("editor.parametersHint", { max: CHAT_MAX_TOOL_PARAMETERS })}
			</p>
			{draft.parameters.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t("editor.noParameters")}
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{draft.parameters.map((parameter, index) => (
						<li
							key={parameter.key}
							className="flex flex-col gap-3 rounded-lg border p-3"
						>
							<div className="flex items-start gap-2">
								<div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_10rem]">
									<Field label={t("editor.parameterName")}>
										{(props) => (
											<Input
												{...props}
												value={parameter.name}
												autoComplete="off"
												spellCheck={false}
												className="font-mono"
												onChange={(event) =>
													update(index, { name: event.target.value })
												}
											/>
										)}
									</Field>
									<Field label={t("editor.parameterType")}>
										{(props) => (
											<Select
												value={parameter.type}
												items={CHAT_TOOL_PARAMETER_TYPES.map((type) => ({
													value: type,
													label: toolParameterTypeLabel(type),
												}))}
												onValueChange={(next) =>
													next !== null &&
													update(index, { type: next as ChatToolParameterType })
												}
											>
												<SelectTrigger id={props.id} className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{CHAT_TOOL_PARAMETER_TYPES.map((type) => (
														<SelectItem key={type} value={type}>
															{toolParameterTypeLabel(type)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									</Field>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="mt-6"
									aria-label={t("editor.removeParameter", {
										name: parameter.name || `#${index + 1}`,
									})}
									onClick={() =>
										onChange({
											parameters: draft.parameters.filter(
												(_, at) => at !== index,
											),
										})
									}
								>
									<X aria-hidden="true" />
								</Button>
							</div>
							<Field label={t("editor.parameterDescription")}>
								{(props) => (
									<Input
										{...props}
										value={parameter.description}
										onChange={(event) =>
											update(index, { description: event.target.value })
										}
									/>
								)}
							</Field>
							{parameter.type === "string" && (
								<Field
									label={t("editor.parameterChoices")}
									hint={t("editor.parameterChoicesHint")}
								>
									{(props) => (
										<Textarea
											{...props}
											value={parameter.choices}
											rows={2}
											onChange={(event) =>
												update(index, { choices: event.target.value })
											}
										/>
									)}
								</Field>
							)}
							<div className="flex items-center gap-2">
								<Checkbox
									id={`${baseId}-${parameter.key}-required`}
									checked={parameter.required}
									onCheckedChange={(checked) =>
										update(index, { required: checked === true })
									}
								/>
								<label
									htmlFor={`${baseId}-${parameter.key}-required`}
									className="text-sm"
								>
									{t("editor.parameterRequired")}
								</label>
							</div>
							<FieldErrors messages={issuesFor(issues, `parameter:${index}`)} />
						</li>
					))}
				</ul>
			)}
			<FieldErrors messages={issuesFor(issues, "parameters")} />
		</section>
	);
}

function FieldErrors({ messages }: { messages: readonly string[] }) {
	if (messages.length === 0) return null;
	return (
		<div className="flex flex-col gap-0.5">
			{messages.map((message) => (
				<p key={message} role="alert" className="text-destructive text-xs">
					{message}
				</p>
			))}
		</div>
	);
}

function KindEditor({
	draft,
	issues,
	onChange,
}: {
	draft: ToolFormDraft;
	issues: readonly ToolFormIssue[];
	onChange: (next: Partial<ToolFormDraft>) => void;
}) {
	const { t } = useTranslation("tools");
	const errors = (field: ToolFormField) => issuesFor(issues, field);
	return (
		<section className="flex flex-col gap-4">
			<Field label={t("editor.kind")} hint={toolKindDescription(draft.kind)}>
				{(props) => (
					<Select
						value={draft.kind}
						items={CHAT_CUSTOM_TOOL_KINDS.map((kind) => ({
							value: kind,
							label: toolKindLabel(kind),
						}))}
						onValueChange={(next) =>
							next !== null && onChange({ kind: next as ChatCustomToolKind })
						}
					>
						<SelectTrigger
							id={props.id}
							aria-describedby={props["aria-describedby"]}
							className="w-full sm:w-56"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CHAT_CUSTOM_TOOL_KINDS.map((kind) => (
								<SelectItem key={kind} value={kind}>
									{toolKindLabel(kind)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</Field>

			{draft.kind === "template" && (
				<Field
					label={t("editor.template")}
					hint={t("editor.templateHint", { example: "{{name}}" })}
					errors={errors("template")}
				>
					{(props) => (
						<Textarea
							{...props}
							value={draft.template}
							rows={6}
							onChange={(event) => onChange({ template: event.target.value })}
						/>
					)}
				</Field>
			)}

			{draft.kind === "table" && (
				<>
					<Field
						label={t("editor.entries")}
						hint={t("editor.entriesHint", {
							max: CHAT_CUSTOM_TOOL_LIMITS.tableEntries,
						})}
						errors={errors("entries")}
					>
						{(props) => (
							<Textarea
								{...props}
								value={draft.entries}
								rows={8}
								onChange={(event) => onChange({ entries: event.target.value })}
							/>
						)}
					</Field>
					<Field label={t("editor.draws")} errors={errors("draws")}>
						{(props) => (
							<Input
								{...props}
								type="number"
								inputMode="numeric"
								min={1}
								max={CHAT_CUSTOM_TOOL_LIMITS.tableMaxDraws}
								className="w-28"
								value={draft.draws}
								onChange={(event) => onChange({ draws: event.target.value })}
							/>
						)}
					</Field>
				</>
			)}

			{draft.kind === "agent" && (
				<>
					<Notice>{t("editor.agentNote")}</Notice>
					<Field label={t("editor.system")} errors={errors("system")}>
						{(props) => (
							<Textarea
								{...props}
								value={draft.system}
								rows={6}
								placeholder={t("editor.systemPlaceholder")}
								onChange={(event) => onChange({ system: event.target.value })}
							/>
						)}
					</Field>
					<Field
						label={t("editor.maxOutputTokens")}
						errors={errors("maxOutputTokens")}
					>
						{(props) => (
							<Input
								{...props}
								type="number"
								inputMode="numeric"
								min={1}
								max={CHAT_CUSTOM_TOOL_LIMITS.agentMaxOutputTokens}
								className="w-32"
								value={draft.maxOutputTokens}
								onChange={(event) =>
									onChange({ maxOutputTokens: event.target.value })
								}
							/>
						)}
					</Field>
				</>
			)}

			{draft.kind === "http" && (
				<HttpEditor draft={draft} issues={issues} onChange={onChange} />
			)}
		</section>
	);
}

/**
 * The web request fields. The two sentences above the address are not optional decoration: an
 * http tool sends text the model wrote from the conversation to a third party, and in a browser the
 * call fails outright unless that server allows this origin. Both facts have to be read before the
 * address is typed, not discovered from a failing reply.
 */
function HttpEditor({
	draft,
	issues,
	onChange,
}: {
	draft: ToolFormDraft;
	issues: readonly ToolFormIssue[];
	onChange: (next: Partial<ToolFormDraft>) => void;
}) {
	const { t } = useTranslation("tools");
	const headingId = useId();
	const updateHeader = (
		index: number,
		next: Partial<ToolFormDraft["headers"][number]>,
	): void =>
		onChange({
			headers: draft.headers.map((header, at) =>
				at === index ? { ...header, ...next } : header,
			),
		});

	return (
		<>
			<Notice warning>
				<span className="flex flex-col gap-1">
					<span>{t("editor.httpWarning")}</span>
					<span>{t("editor.httpCors")}</span>
				</span>
			</Notice>
			<Field label={t("editor.url")} errors={issuesFor(issues, "url")}>
				{(props) => (
					<Input
						{...props}
						type="url"
						inputMode="url"
						autoComplete="off"
						spellCheck={false}
						placeholder={t("editor.urlPlaceholder")}
						value={draft.url}
						onChange={(event) => onChange({ url: event.target.value })}
					/>
				)}
			</Field>
			<Field
				label={t("editor.method")}
				hint={t(`editor.methodHint.${draft.method}`)}
			>
				{(props) => (
					<Select
						value={draft.method}
						items={[
							{ value: "POST", label: "POST" },
							{ value: "GET", label: "GET" },
						]}
						onValueChange={(next) =>
							next !== null && onChange({ method: next as "GET" | "POST" })
						}
					>
						<SelectTrigger
							id={props.id}
							aria-describedby={props["aria-describedby"]}
							className="w-32"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="POST">POST</SelectItem>
							<SelectItem value="GET">GET</SelectItem>
						</SelectContent>
					</Select>
				)}
			</Field>
			<section aria-labelledby={headingId} className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between gap-2">
					<h3 id={headingId} className="text-sm font-medium">
						{t("editor.headers")}
					</h3>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={draft.headers.length >= CHAT_CUSTOM_TOOL_LIMITS.headers}
						onClick={() =>
							onChange({ headers: [...draft.headers, emptyHeaderDraft()] })
						}
					>
						<Plus aria-hidden="true" />
						{t("editor.addHeader")}
					</Button>
				</div>
				<p className="text-muted-foreground text-xs">
					{t("editor.headersHint")}
				</p>
				{draft.headers.length > 0 && (
					<ul className="flex flex-col gap-2">
						{draft.headers.map((header, index) => (
							<li key={header.key} className="flex flex-col gap-1">
								<div className="flex items-start gap-2">
									<div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[12rem_1fr]">
										<Input
											aria-label={t("editor.headerName")}
											placeholder="Authorization"
											autoComplete="off"
											spellCheck={false}
											className="font-mono"
											value={header.name}
											onChange={(event) =>
												updateHeader(index, { name: event.target.value })
											}
										/>
										{/*
										 * Plain text with autocomplete off, not a password field: a password field invites the
										 * browser to offer saving it as this site's login, which it is not.
										 */}
										<Input
											aria-label={t("editor.headerValue")}
											autoComplete="off"
											spellCheck={false}
											className="font-mono"
											value={header.value}
											onChange={(event) =>
												updateHeader(index, { value: event.target.value })
											}
										/>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label={t("editor.removeHeader", {
											name: header.name || `#${index + 1}`,
										})}
										onClick={() =>
											onChange({
												headers: draft.headers.filter((_, at) => at !== index),
											})
										}
									>
										<X aria-hidden="true" />
									</Button>
								</div>
								<FieldErrors messages={issuesFor(issues, `header:${index}`)} />
							</li>
						))}
					</ul>
				)}
				<FieldErrors messages={issuesFor(issues, "headers")} />
			</section>
		</>
	);
}

function Notice({
	warning,
	children,
}: {
	warning?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={
				warning
					? "flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
					: "rounded-lg border bg-muted/40 p-3 text-muted-foreground text-sm"
			}
		>
			{warning && (
				<TriangleAlert
					aria-hidden="true"
					className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
				/>
			)}
			{children}
		</div>
	);
}

function EnabledByDefault({
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const { t } = useTranslation("tools");
	const id = useId();
	return (
		<div className="flex items-start justify-between gap-4 rounded-lg border p-3">
			<div className="flex flex-col gap-0.5">
				<label htmlFor={id} className="text-sm font-medium">
					{t("editor.enabledByDefault")}
				</label>
				<p id={`${id}-hint`} className="text-muted-foreground text-xs">
					{t("editor.enabledByDefaultHint")}
				</p>
			</div>
			<Switch
				id={id}
				checked={checked}
				aria-describedby={`${id}-hint`}
				onCheckedChange={(next) => onChange(next)}
			/>
		</div>
	);
}
