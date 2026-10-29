import type { DraftConflictRecovery, StoryDraft } from "@rowcat/authoring";
import {
	DRAFT_RECOVERY_COPY,
	DRAFT_RECOVERY_FIELD_LABEL,
	DRAFT_RECOVERY_GROUP_LABEL,
	draftRecoveryDifferences,
	draftRecoveryObservedText,
	draftRecoveryRestoreConfirm,
	draftRecoveryValueText,
	restoreDraftConflict,
} from "@rowcat/authoring";
import { space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Notice,
	Panel,
	Text,
} from "@rowcat/ui-native";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
	useAuthoringScope,
	useDraftRecoveryScope,
} from "../../lib/local-data/scope.tsx";
import { useDraftRecoveries } from "../../lib/local-data/use-recoveries.ts";

/**
 * Preserved-edit notice: same rules as web's, different container. The shared package owns the
 * rules (what is preserved, what restore overwrites, the sentences); here only presentation is
 * decided: a one-line `Notice` and a `Dialog` list. Not a sheet, since this is a small
 * read-and-decide management screen (presentation table). It never opens or restores itself; a
 * layer appearing over the editor when sync finishes is an interruption, not a notice.
 */
export function DraftRecoveryNotice({ draft }: { draft: StoryDraft }) {
	const { value: items } = useDraftRecoveries(draft.id);
	const [open, setOpen] = useState(false);

	/**
	 * No copy means no placeholder either. Most edits have no conflict, and a permanent empty row
	 * becomes background and goes unread when it finally matters.
	 */
	if (items.length === 0) return null;

	return (
		<>
			<Notice
				message={DRAFT_RECOVERY_COPY.notice}
				actionLabel={DRAFT_RECOVERY_COPY.open}
				onAction={() => setOpen(true)}
				style={styles.notice}
			/>
			<Dialog
				title={DRAFT_RECOVERY_COPY.title}
				description={DRAFT_RECOVERY_COPY.description}
				open={open}
				onOpenChange={setOpen}
				size="full"
				scroll
			>
				<View style={styles.list}>
					{items.map((recovery) => (
						<RecoveryCard key={recovery.id} recovery={recovery} draft={draft} />
					))}
				</View>
			</Dialog>
		</>
	);
}

/**
 * One copy; preserved and current values are stacked vertically where web uses two columns. A long
 * prompt split into two columns on a narrow screen is unreadable on both sides, and the user's job
 * here is to read both and choose. Labels say which is which; order is not left to guesswork.
 */
function RecoveryCard({
	recovery,
	draft,
}: {
	recovery: DraftConflictRecovery;
	draft: StoryDraft;
}) {
	const authoring = useAuthoringScope();
	const recoveryScope = useDraftRecoveryScope();
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const differing = draftRecoveryDifferences(recovery, draft);
	/**
	 * With no differing field, show all of the group's fields. The values already match (rewritten on
	 * another device or reverted by hand), and an empty card would not say what was preserved.
	 */
	const fields =
		differing.length > 0
			? differing
			: (Object.keys(recovery.values) as typeof differing);

	async function run(
		action: () => Promise<string | null>,
		fallback: string,
	): Promise<void> {
		setBusy(true);
		setFailure(null);
		try {
			setFailure(await action());
		} catch {
			setFailure(fallback);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Panel style={styles.card}>
			<View style={styles.cardHead}>
				<Text variant="label">
					{DRAFT_RECOVERY_GROUP_LABEL[recovery.group]}
				</Text>
				<Text variant="caption" tone="muted-foreground">
					{draftRecoveryObservedText(recovery.observedAt)}
				</Text>
			</View>

			{fields.map((field) => (
				<View key={field} style={styles.field}>
					<Text variant="caption" tone="muted-foreground">
						{DRAFT_RECOVERY_FIELD_LABEL[field]}
					</Text>
					<ValueBlock
						label={DRAFT_RECOVERY_COPY.preservedColumn}
						text={draftRecoveryValueText(field, recovery.values[field])}
					/>
					<ValueBlock
						label={DRAFT_RECOVERY_COPY.currentColumn}
						text={draftRecoveryValueText(field, draft[field])}
					/>
				</View>
			))}

			{failure ? (
				<Text accessibilityRole="alert" variant="caption" tone="destructive">
					{failure}
				</Text>
			) : null}

			{confirming ? (
				<View style={styles.confirm}>
					<Text variant="caption" tone="muted-foreground">
						{draftRecoveryRestoreConfirm(recovery.group)}
					</Text>
					<DialogActions>
						<Button
							label={DRAFT_RECOVERY_COPY.cancel}
							variant="ghost"
							fullWidth
							disabled={busy}
							onPress={() => setConfirming(false)}
						/>
						<Button
							label={DRAFT_RECOVERY_COPY.restore}
							fullWidth
							busy={busy}
							onPress={() =>
								void run(async () => {
									const store = await authoring.ensureStore();
									const recoveryStore = await recoveryScope.ensureStore();
									if (!store || !recoveryStore)
										return DRAFT_RECOVERY_COPY.restoreFailed;
									/**
									 * Restore is an ordinary edit: it goes through one `updateDraft`, so it gets a new
									 * revision, turns dirty and wakes auto-sync as usual. No path rolls back old
									 * `rev`/`fieldRev`.
									 */
									const outcome = await restoreDraftConflict(
										{ authoring: store, recovery: recoveryStore },
										recovery,
									);
									if (outcome.status === "missing")
										return DRAFT_RECOVERY_COPY.restoreMissing;
									setConfirming(false);
									return null;
								}, DRAFT_RECOVERY_COPY.restoreFailed)
							}
						/>
					</DialogActions>
				</View>
			) : (
				<View style={styles.actions}>
					<Button
						label={DRAFT_RECOVERY_COPY.restore}
						fullWidth
						disabled={busy}
						onPress={() => setConfirming(true)}
					/>
					<Button
						label={DRAFT_RECOVERY_COPY.discard}
						variant="ghost"
						fullWidth
						disabled={busy}
						onPress={() =>
							void run(async () => {
								const store = await recoveryScope.ensureStore();
								if (!store) return DRAFT_RECOVERY_COPY.discardFailed;
								await store.discard(recovery.id);
								return null;
							}, DRAFT_RECOVERY_COPY.discardFailed)
						}
					/>
					<Text variant="caption" tone="muted-foreground">
						{DRAFT_RECOVERY_COPY.discardConfirm}
					</Text>
				</View>
			)}
		</Panel>
	);
}

/** One value cell. Long prompts land here, so scrolling stays inside its own box. */
function ValueBlock({ label, text }: { label: string; text: string }) {
	return (
		<View style={styles.value}>
			<Text variant="caption" tone="muted-foreground">
				{label}
			</Text>
			<ScrollView style={styles.valueScroll} nestedScrollEnabled>
				<Text variant="body">{text}</Text>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	notice: { marginBottom: space.md },
	list: { gap: space.md },
	card: { gap: space.sm, padding: space.md },
	cardHead: {
		alignItems: "baseline",
		flexDirection: "row",
		gap: space.sm,
		justifyContent: "space-between",
	},
	field: { gap: space.xs },
	value: { gap: space.xs },
	valueScroll: { maxHeight: 160 },
	actions: { gap: space.xs },
	confirm: { gap: space.sm },
});
