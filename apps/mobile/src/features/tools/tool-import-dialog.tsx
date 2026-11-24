import {
	type ChatToolFileEntry,
	type ChatToolImportChoice,
	type ChatUserTool,
	chatToolImportChoices,
	chatToolImportWrites,
	defaultChatToolImportChoice,
	planChatToolImport,
} from "@rowcat/chat";
import { radiusScale, space } from "@rowcat/design";
import {
	Button,
	Dialog,
	DialogActions,
	Notice,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import {
	importChoiceLabel,
	importItemName,
	importReachLines,
	importStatusLine,
} from "./tool-file-copy.ts";
import type { ToolImportOutcome } from "./tool-mutations.ts";

/**
 * The import review: every entry of a file that was read, what it is, and what will happen to it.
 * The decisions are `tool-file.ts` in `@rowcat/chat`; this window only draws them and holds the
 * importer's choices.
 *
 * What the window guarantees, each one from that module's header:
 * - **Nothing is replaced by default.** A name already in the library starts at "skip"
 *   (`defaultChatToolImportChoice`); "replace" is a choice the importer makes per tool.
 * - **Invalid entries are shown, never imported.** Their name (or position) and the contract's
 *   issues are listed, with no control, so the importer knows what the file contained and why it
 *   did not arrive.
 * - **An `http` entry says where it sends** (origin) and which header values the importer must fill
 *   in, before anything is chosen.
 * - Every imported tool starts off; the intro says so, since "imported" otherwise reads as "active".
 *
 * The plan is computed against the library the window opened with and recomputed if the library
 * changes while it is open (sync can deliver a tool of the same name meanwhile).
 */
export function ToolImportDialog({
	entries,
	library,
	pending,
	onApply,
	onCancel,
}: {
	entries: readonly ChatToolFileEntry[];
	library: readonly ChatUserTool[];
	pending: boolean;
	/** Rejection is a failure drawn here; the caller closes and reports on success. */
	onApply: (
		writes: ReturnType<typeof chatToolImportWrites>,
	) => Promise<ToolImportOutcome>;
	onCancel: () => void;
}) {
	const { t } = useTranslation("tools");
	const { t: tCommon } = useTranslation("common");
	const { colors } = useTheme();
	const plan = useMemo(
		() => planChatToolImport(entries, library),
		[entries, library],
	);
	const [choices, setChoices] = useState<Record<number, ChatToolImportChoice>>(
		{},
	);
	const [error, setError] = useState<string | null>(null);
	const submittingRef = useRef(false);

	const choiceOf = (item: (typeof plan)[number]): ChatToolImportChoice => {
		const chosen = choices[item.entry.index];
		/* A choice the item no longer allows (the library changed under it) falls back to the default. */
		return chosen && chatToolImportChoices(item).includes(chosen)
			? chosen
			: defaultChatToolImportChoice(item);
	};
	const writes = chatToolImportWrites(
		plan,
		library,
		Object.fromEntries(plan.map((item) => [item.entry.index, choiceOf(item)])),
	);
	const count = writes.create.length + writes.replace.length;

	const apply = (): void => {
		if (submittingRef.current || count === 0) return;
		submittingRef.current = true;
		setError(null);
		void onApply(writes)
			.then(() => {
				submittingRef.current = false;
			})
			.catch(() => {
				submittingRef.current = false;
				setError(t("copy.importApplyFailed"));
			});
	};

	return (
		<Dialog
			open
			size="full"
			title={t("copy.importTitle")}
			onOpenChange={(next) => {
				if (!next && !pending) onCancel();
			}}
		>
			<View style={review.root}>
				<Text variant="label" tone="muted-foreground">
					{t("copy.importIntro")}
				</Text>

				{plan.map((item) => {
					const allowed = chatToolImportChoices(item);
					const current = choiceOf(item);
					return (
						<View
							key={item.entry.index}
							style={[review.item, { borderColor: colors.border }]}
						>
							<Text variant="body" weight="medium" numberOfLines={1}>
								{importItemName(item)}
							</Text>
							{item.entry.ok ? (
								<Text variant="label" tone="muted-foreground" numberOfLines={3}>
									{item.entry.tool.declaration.description}
								</Text>
							) : null}
							<Text
								variant="caption"
								tone={
									item.status === "new" ? "muted-foreground" : "destructive"
								}
							>
								{importStatusLine(item)}
							</Text>
							{importReachLines(item).map((line) => (
								<Text key={line} variant="caption" tone="foreground">
									{line}
								</Text>
							))}
							{item.entry.ok ? null : (
								<View style={review.issues}>
									{item.entry.issues.map((issue) => (
										<Text key={issue} variant="caption" tone="muted-foreground">
											• {issue}
										</Text>
									))}
								</View>
							)}
							{/* Only items with a real choice get controls; "skip" alone is a fact, not a choice. */}
							{allowed.length > 1 ? (
								<View
									accessibilityRole="radiogroup"
									accessibilityLabel={importItemName(item)}
									style={review.choices}
								>
									{allowed.map((choice) => (
										<Button
											key={choice}
											label={importChoiceLabel(choice)}
											size="sm"
											variant={
												current === choice
													? choice === "replace"
														? "destructive"
														: "secondary"
													: "ghost"
											}
											onPress={() =>
												setChoices((previous) => ({
													...previous,
													[item.entry.index]: choice,
												}))
											}
										/>
									))}
								</View>
							) : null}
						</View>
					);
				})}

				{count === 0 ? (
					<Text variant="caption" tone="muted-foreground">
						{t("copy.importNothing")}
					</Text>
				) : null}
				{error ? <Notice tone="destructive" message={error} /> : null}

				<DialogActions>
					<Button
						label={tCommon("actions.cancel")}
						variant="outline"
						fullWidth
						onPress={onCancel}
						style={review.action}
					/>
					<Button
						label={t("importAction", { count })}
						fullWidth
						busy={pending}
						disabled={count === 0}
						onPress={apply}
						style={review.action}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const review = StyleSheet.create({
	root: { gap: space.md },
	item: {
		borderRadius: radiusScale.md,
		borderWidth: StyleSheet.hairlineWidth,
		gap: space.xs,
		padding: space.md,
	},
	issues: { gap: space.px },
	choices: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
	action: { alignSelf: "stretch" },
});
