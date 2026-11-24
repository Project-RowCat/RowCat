import {
	buildChatToolFile,
	type ChatToolFileEntry,
	type ChatUserTool,
	chatToolFileName,
	readChatToolFile,
	serializeChatToolFile,
} from "@rowcat/chat";
import { radiusScale, space } from "@rowcat/design";
import {
	AlertDialog,
	Badge,
	Button,
	EmptyState,
	Icon,
	Notice,
	Spinner,
	Text,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { MotionRow } from "../../lib/motion/list-motion.tsx";
import { resolveAppPhase } from "../../lib/session-state.ts";
import { exportToolFile, pickToolFile } from "../../lib/tool-files.ts";
import { ToolEditorDialog } from "./tool-editor-dialog.tsx";
import {
	strippedHeadersNotice,
	toolFileFailureMessage,
} from "./tool-file-copy.ts";
import { ToolImportDialog } from "./tool-import-dialog.tsx";
import { resolveToolLibraryState } from "./tool-library-state.ts";
import { useToolLibrary } from "./use-tool-library.ts";

/**
 * The tool library: an account asset, not a child of any conversation, for the persona library's
 * reason (`persona-library-section.tsx`). It takes no room id; which tools are on in a room is the
 * room settings' tools pane.
 *
 * Besides create, edit and delete it carries the two file directions (`tool-file.ts` in
 * `@rowcat/chat`, device side in `lib/tool-files.ts`):
 * - **Export** writes every live tool into one file. Header values never enter it; when some were
 *   left out the screen says which, so the author knows what the importer has to bring.
 * - **Import** reads a picked file, says in one sentence why a file is refused, and otherwise opens
 *   the review window (`tool-import-dialog.tsx`), where nothing is replaced unless chosen.
 *
 * No server calls: tools are local-first records and sync is woken by the write signal.
 */
export function ToolLibrarySection() {
	const { t } = useTranslation("tools");
	const { t: tCommon } = useTranslation("common");
	const router = useRouter();
	const identity = useMobileIdentity();
	const scope = useMobileLocalScope();
	const library = useToolLibrary();
	const [editing, setEditing] = useState<ChatUserTool | "new" | null>(null);
	const [deleting, setDeleting] = useState<ChatUserTool | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [importing, setImporting] = useState<ChatToolFileEntry[] | null>(null);
	/** The outcome of the last file action: a sentence and whether it is a failure. */
	const [fileNotice, setFileNotice] = useState<{
		message: string;
		destructive: boolean;
	} | null>(null);
	const [fileBusy, setFileBusy] = useState(false);

	const state = resolveToolLibraryState({
		phase: resolveAppPhase(identity.session, scope.status),
		tools: { status: library.status, total: library.tools.length },
	});

	const remove = (tool: ChatUserTool): void => {
		setDeleteError(null);
		void library.remove(tool.id).then(
			() => {
				/* `foreign` closes too: the viewer changed and this tree is about to unmount. */
				setDeleting(null);
			},
			() => setDeleteError(t("copy.deleteFailed")),
		);
	};

	const exportAll = (): void => {
		if (fileBusy) return;
		const tools = library.tools.map((tool) => tool.tool);
		if (tools.length === 0) {
			setFileNotice({ message: t("copy.exportEmpty"), destructive: false });
			return;
		}
		const { file, strippedHeaders } = buildChatToolFile(tools);
		setFileBusy(true);
		setFileNotice(null);
		void exportToolFile(chatToolFileName(tools), serializeChatToolFile(file))
			.then((outcome) => {
				const stripped = strippedHeadersNotice(strippedHeaders);
				/* Said even when the sheet was dismissed: the file was built without those values either way. */
				if (stripped) setFileNotice({ message: stripped, destructive: false });
				else if (outcome === "cancelled") setFileNotice(null);
			})
			.catch(() =>
				setFileNotice({ message: t("copy.exportFailed"), destructive: true }),
			)
			.finally(() => setFileBusy(false));
	};

	const importFile = (): void => {
		if (fileBusy) return;
		setFileBusy(true);
		setFileNotice(null);
		void pickToolFile()
			.then((picked) => {
				if (picked.kind === "cancelled") return;
				const read =
					picked.kind === "too_large"
						? ({ ok: false, reason: "too_large" } as const)
						: readChatToolFile(picked.text);
				if (!read.ok) {
					setFileNotice({
						message: toolFileFailureMessage(read.reason),
						destructive: true,
					});
					return;
				}
				setImporting(read.entries);
			})
			.catch(() =>
				setFileNotice({ message: t("copy.importFailed"), destructive: true }),
			)
			.finally(() => setFileBusy(false));
	};

	if (state.kind === "booting" || state.kind === "loading")
		return (
			<View style={section.center}>
				<Spinner />
			</View>
		);

	if (state.kind === "guest")
		return (
			<EmptyState
				icon="account"
				title={t("copy.emptyTitle")}
				description={t("copy.guest")}
				actionLabel={tCommon("actions.signIn")}
				onAction={() => {
					identity.clearFailure();
					router.push({
						pathname: "/login",
						params: { redirect: "/settings/tools" },
					});
				}}
			/>
		);

	if (state.kind === "unavailable")
		return (
			<Notice
				message={t("copy.unavailable")}
				actionLabel={tCommon("actions.tryAgain")}
				onAction={identity.retry}
			/>
		);

	if (state.kind === "storage-error")
		return (
			<Notice
				tone="destructive"
				message={t("copy.storageError")}
				actionLabel={tCommon("actions.tryAgain")}
				onAction={scope.retry}
			/>
		);

	if (state.kind === "read-error")
		return <Notice tone="destructive" message={t("copy.readError")} />;

	return (
		<View style={section.root}>
			{state.kind === "empty" ? (
				<View style={section.empty}>
					<Text variant="body" weight="medium">
						{t("copy.emptyTitle")}
					</Text>
					<Text variant="label" tone="muted-foreground">
						{t("copy.emptyBody")}
					</Text>
				</View>
			) : (
				library.tools.map((tool) => (
					<MotionRow key={tool.id} exit={library.tools.length > 1}>
						<ToolRow
							tool={tool}
							onEdit={() => setEditing(tool)}
							onDelete={() => {
								setDeleteError(null);
								setDeleting(tool);
							}}
						/>
					</MotionRow>
				))
			)}

			<Button
				label={t("copy.add")}
				variant="outline"
				icon="add"
				fullWidth
				onPress={() => setEditing("new")}
			/>
			<View style={section.fileRow}>
				<Button
					label={t("copy.import")}
					variant="ghost"
					busy={fileBusy && importing === null}
					onPress={importFile}
				/>
				{library.tools.length > 0 ? (
					<Button
						label={t("copy.exportAll")}
						variant="ghost"
						onPress={exportAll}
					/>
				) : null}
			</View>
			{fileNotice ? (
				<Notice
					tone={fileNotice.destructive ? "destructive" : "muted"}
					message={fileNotice.message}
				/>
			) : null}

			{editing ? (
				<ToolEditorDialog
					tool={editing === "new" ? null : editing}
					library={library.tools}
					pending={library.pending}
					onCancel={() => setEditing(null)}
					onSave={async ({ tool, enabledByDefault }) => {
						const outcome =
							editing === "new"
								? await library.create({ tool, enabledByDefault })
								: await library.update(editing.id, { tool, enabledByDefault });
						/* Closes on `foreign` too; failures reject and stay in the form. */
						setEditing(null);
						return outcome;
					}}
					{...(editing === "new"
						? {}
						: {
								/* The editor closes first: the confirmation is its own window, never one stacked on another. */
								onDelete: () => {
									setDeleteError(null);
									setEditing(null);
									setDeleting(editing);
								},
							})}
				/>
			) : null}

			{importing ? (
				<ToolImportDialog
					entries={importing}
					library={library.tools}
					pending={library.pending}
					onCancel={() => setImporting(null)}
					onApply={async (writes) => {
						const outcome = await library.applyImport(writes);
						setImporting(null);
						if (outcome.status === "done")
							setFileNotice({
								message: t("importApplied", { count: outcome.written }),
								destructive: false,
							});
						return outcome;
					}}
				/>
			) : null}

			{/* Irreversible, so an `AlertDialog`; the copy says what remains (conversations are untouched). */}
			<AlertDialog
				open={deleting !== null}
				title={t("copy.deleteTitle")}
				description={`${t("deleteDescription", {
					name: deleting?.tool.declaration.name ?? "",
				})} ${t("copy.deleteNotice")}`}
				confirmLabel={t("copy.deleteConfirm")}
				destructive
				busy={library.pending}
				error={deleteError}
				onConfirm={() => {
					if (deleting) remove(deleting);
				}}
				onCancel={() => {
					setDeleting(null);
					setDeleteError(null);
				}}
			/>
		</View>
	);
}

/**
 * One row: name, description, kind and whether it is on by default, with edit and delete as
 * siblings of the row (two targets inside one button would be indistinguishable to a screen reader).
 */
function ToolRow({
	tool,
	onEdit,
	onDelete,
}: {
	tool: ChatUserTool;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation("tools");
	const { colors } = useTheme();
	const name = tool.tool.declaration.name;
	const kind = {
		template: t("copy.kindTemplate"),
		table: t("copy.kindTable"),
		agent: t("copy.kindAgent"),
		http: t("copy.kindHttp"),
	}[tool.tool.action.kind];
	return (
		<View style={section.row}>
			<View style={section.rowText}>
				<Text variant="body" weight="medium" numberOfLines={1}>
					{name}
				</Text>
				<Text variant="label" tone="muted-foreground" numberOfLines={2}>
					{tool.tool.declaration.description}
				</Text>
				<View style={section.badges}>
					<Badge label={kind} />
					{tool.enabledByDefault ? (
						<Badge label={t("copy.enabledByDefault")} />
					) : null}
				</View>
			</View>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t("edit", { name })}
				onPress={onEdit}
				style={({ pressed }) => [
					section.action,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Icon name="edit" size="sm" tone="muted-foreground" />
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t("delete", { name })}
				onPress={onDelete}
				style={({ pressed }) => [
					section.action,
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Icon name="delete" size="sm" tone="destructive" />
			</Pressable>
		</View>
	);
}

const section = StyleSheet.create({
	root: { gap: space.md },
	center: { alignItems: "center", paddingVertical: space.xl },
	empty: { gap: space.xs, paddingVertical: space.sm },
	fileRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
	row: { alignItems: "center", flexDirection: "row", gap: space.xs },
	rowText: { flex: 1, gap: space.px, minWidth: 0 },
	badges: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
	action: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		height: touchTarget,
		justifyContent: "center",
		width: touchTarget,
	},
});
