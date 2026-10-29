import { space } from "@rowcat/design";
import { type CreatorWork, isPinnableWork } from "@rowcat/domain";
import { creatorWorks, creatorWorksInfiniteQueryOptions } from "@rowcat/query";
import {
	Button,
	Dialog,
	DialogActions,
	Panel,
	Separator,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Fragment, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import {
	ACCOUNT_RETRY_LABEL,
	PINNED_PICKER_CLOSE,
	PINNED_PICKER_DESCRIPTION,
	PINNED_PICKER_EMPTY,
	PINNED_PICKER_LOAD_FAILED,
	PINNED_PICKER_MORE,
	PINNED_PICKER_TITLE,
	UNTITLED_WORK,
} from "./account-copy.ts";

/**
 * Pinned-work picker: only my works that **stand on the profile now**, minus those already picked.
 *
 * It is a `Dialog`: what is chosen from is a list of unknown length (`Show more` appends), not a short
 * single choice, and rising from the bottom earns nothing here. `ChoiceSheet` is for short choices
 * with options known up front. On narrow screens it docks to the bottom (`adaptive`).
 *
 * Candidates come from the `Published` list, as on the web. The public profile grid would drop adult
 * works of an owner who has adult display off, leaving no way to pick them. Whether a work can be
 * pinned is `isPinnableWork` alone, and the server re-decides with the same two lines.
 */
export function PinnedStoryPickerDialog({
	chosen,
	onClose,
	onPick,
}: {
	chosen: readonly CreatorWork[];
	onClose: () => void;
	onPick: (work: CreatorWork) => void;
}) {
	const client = getRowCatClient();
	const works = useInfiniteQuery(creatorWorksInfiniteQueryOptions(client));
	const candidates = useMemo(() => {
		const taken = new Set(chosen.map((work) => work.id));
		return works.data
			? creatorWorks(works.data).filter(
					(work) => isPinnableWork(work) && !taken.has(work.id),
				)
			: [];
	}, [works.data, chosen]);

	return (
		<Dialog
			title={PINNED_PICKER_TITLE}
			description={PINNED_PICKER_DESCRIPTION}
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			placement="adaptive"
			scroll
		>
			<View style={picker.stack}>
				{works.isPending ? (
					<View style={picker.loading}>
						<Spinner />
					</View>
				) : works.isError && works.data === undefined ? (
					<View style={picker.stack}>
						<Text accessibilityRole="alert" variant="label" tone="destructive">
							{PINNED_PICKER_LOAD_FAILED}
						</Text>
						<Button
							label={ACCOUNT_RETRY_LABEL}
							variant="outline"
							size="sm"
							onPress={() => void works.refetch()}
						/>
					</View>
				) : candidates.length === 0 && !works.hasNextPage ? (
					<Text variant="label" tone="muted-foreground">
						{PINNED_PICKER_EMPTY}
					</Text>
				) : (
					<Panel padded={false}>
						{candidates.map((work, index) => (
							<Fragment key={work.id}>
								{index > 0 ? <Separator /> : null}
								<Pressable
									accessibilityRole="button"
									onPress={() => onPick(work)}
									style={({ pressed }) => [
										picker.row,
										pressed && picker.pressed,
									]}
								>
									<Text variant="label">
										{work.title.trim() || UNTITLED_WORK}
									</Text>
								</Pressable>
							</Fragment>
						))}
					</Panel>
				)}

				<DialogActions>
					{works.hasNextPage ? (
						<Button
							label={PINNED_PICKER_MORE}
							variant="outline"
							size="sm"
							busy={works.isFetchingNextPage}
							disabled={works.isFetchingNextPage}
							onPress={() => void works.fetchNextPage()}
						/>
					) : null}
					<Button
						label={PINNED_PICKER_CLOSE}
						variant="outline"
						size="sm"
						onPress={onClose}
					/>
				</DialogActions>
			</View>
		</Dialog>
	);
}

const picker = StyleSheet.create({
	stack: { gap: space.md },
	loading: { alignItems: "center", paddingVertical: space.lg },
	row: { paddingHorizontal: space.md, paddingVertical: space.md },
	/** Pressed feedback: lower the opacity only, no new color (nothing outside the tokens). */
	pressed: { opacity: 0.6 },
});
