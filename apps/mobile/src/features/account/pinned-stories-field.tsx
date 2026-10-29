import {
	PINNED_STORY_ERROR_CODE,
	PROFILE_PINNED_STORY_LIMIT,
} from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	type CreatorWork,
	canInteract,
	movePinnedItem,
	pinItem,
	pinnedWorkNotice,
	samePinnedOrder,
	unpinItem,
	type Viewer,
} from "@rowcat/domain";
import {
	ownPinnedStoriesQueryOptions,
	pinnedStoriesMutationOptions,
} from "@rowcat/query";
import { isRowCatApiError } from "@rowcat/sdk";
import {
	Button,
	IconButton,
	Panel,
	Separator,
	Spinner,
	Text,
} from "@rowcat/ui-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { FeedbackLine } from "../../lib/motion/feedback.tsx";
import {
	ACCOUNT_RETRY_LABEL,
	PINNED_ADD_LABEL,
	PINNED_EMPTY,
	PINNED_LABEL,
	PINNED_LOAD_FAILED,
	PINNED_UNAVAILABLE,
	pinnedDescription,
	pinnedMoveDownLabel,
	pinnedMoveUpLabel,
	pinnedRemoveLabel,
	restrictionNote,
	SAVE_LABEL,
	SAVED_LABEL,
	SAVING_LABEL,
	UNTITLED_WORK,
} from "./account-copy.ts";
import { accountErrorMessage } from "./account-error.ts";
import { PinnedStoryPickerDialog } from "./pinned-story-picker-dialog.tsx";
import type { SaveResult } from "./profile-form.ts";

/**
 * Pinned works: the three works to stand at the top of the public profile. Same structure as the
 * web `pinned-stories-field.tsx`.
 *
 * The rules are not in this file. What can be picked, why a pin is not visible now, and how the
 * list changes live in `@rowcat/domain`'s `profile-pins.ts` (the web calls the same functions);
 * cache policy is `@rowcat/query`'s `pinnedStoriesMutationOptions`. Only the drawing stays here. If
 * one app missed operator hiding, the difference would surface only as a server 409.
 *
 * There is a save button: saving on every reorder would briefly show other people the middle state
 * of a swap (an order nobody chose). The slots are screen state and one final list goes to the
 * server.
 *
 * A pin turned private is not hidden; its row says why it occupies a slot.
 */
export function PinnedStoriesField({ viewer }: { viewer: Viewer }) {
	const client = getRowCatClient();
	const queryClient = useQueryClient();

	const own = useQuery(ownPinnedStoriesQueryOptions(client));
	const saved = own.data ?? NONE;

	/** `null` draws the server value, same shape and reason as the bio field. */
	const [draft, setDraft] = useState<readonly CreatorWork[] | null>(null);
	const value = draft ?? saved;
	const [result, setResult] = useState<SaveResult>(null);
	const [picking, setPicking] = useState(false);
	const error = result?.kind === "error" ? result.message : null;

	const policy = pinnedStoriesMutationOptions(client, queryClient, viewer.id);
	const mutation = useMutation({
		...policy,
		onError: (...args) => {
			policy.onError?.(...args);
			const [failure] = args;
			/**
			 * Unpickable works are mixed in: refetch the list and draw the current state, but keep the order
			 * being picked (dropping only the offending row and saving again is enough).
			 */
			if (
				isRowCatApiError(failure) &&
				failure.code === PINNED_STORY_ERROR_CODE.unavailable
			) {
				void own.refetch();
				setResult({ kind: "error", message: PINNED_UNAVAILABLE });
				return;
			}
			setResult({ kind: "error", message: accountErrorMessage(failure) });
		},
		onSuccess: (...args) => {
			policy.onSuccess?.(...args);
			setDraft(null);
			setResult({ kind: "saved" });
		},
	});

	const restricted = !canInteract(viewer);
	const editable = !restricted && own.isSuccess;
	const pending = mutation.isPending;
	const unchanged = samePinnedOrder(value, saved);
	const full = value.length >= PROFILE_PINNED_STORY_LIMIT;

	/** The same array coming back (cap or end arrows) means nothing changed, so `Saved` stays too. */
	const edit = (next: readonly CreatorWork[]) => {
		if (next === value) return;
		setDraft(next);
		setResult((current) => (current?.kind === "saved" ? null : current));
	};

	return (
		<View style={field.stack}>
			<View style={field.heading}>
				<Text accessibilityRole="header" variant="label" weight="semibold">
					{PINNED_LABEL}
				</Text>
				<Text variant="caption" tone="muted-foreground">
					{pinnedDescription(PROFILE_PINNED_STORY_LIMIT)}
				</Text>
			</View>

			{own.isPending ? (
				<View style={field.loading}>
					<Spinner />
				</View>
			) : own.isError && own.data === undefined ? (
				/**
				 * A failed lookup is not drawn as an empty list: someone with pins would read them as erased,
				 * and saving from that state really erases them. Editing is locked on this branch too.
				 */
				<View style={field.row}>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{PINNED_LOAD_FAILED}
					</Text>
					<Button
						label={ACCOUNT_RETRY_LABEL}
						variant="outline"
						size="sm"
						onPress={() => void own.refetch()}
					/>
				</View>
			) : value.length === 0 ? (
				<Text variant="label" tone="muted-foreground">
					{PINNED_EMPTY}
				</Text>
			) : (
				<Panel padded={false}>
					{value.map((work, index) => (
						<Fragment key={work.id}>
							{index > 0 ? <Separator /> : null}
							<PinnedRow
								work={work}
								first={index === 0}
								last={index === value.length - 1}
								disabled={!editable || pending}
								onMove={(offset) =>
									edit(movePinnedItem(value, work.id, offset))
								}
								onRemove={() => edit(unpinItem(value, work.id))}
							/>
						</Fragment>
					))}
				</Panel>
			)}

			<View style={field.row}>
				{/** Locked at the cap; the count beside it says why it cannot open. */}
				<Button
					label={PINNED_ADD_LABEL}
					icon="add"
					variant="outline"
					disabled={!editable || pending || full}
					onPress={() => setPicking(true)}
				/>
				<Button
					label={
						pending
							? SAVING_LABEL
							: result?.kind === "saved"
								? SAVED_LABEL
								: SAVE_LABEL
					}
					icon={result?.kind === "saved" ? "check" : "save"}
					busy={pending}
					disabled={!editable || pending || unchanged}
					onPress={() => {
						setResult(null);
						mutation.mutate(value.map((work) => work.id));
					}}
				/>
				<Text variant="caption" tone="muted-foreground">
					{value.length} / {PROFILE_PINNED_STORY_LIMIT}
				</Text>
			</View>

			{error ? (
				<FeedbackLine>
					<Text accessibilityRole="alert" variant="label" tone="destructive">
						{error}
					</Text>
				</FeedbackLine>
			) : restricted && viewer.status !== "approved" ? (
				<Text variant="label" tone="muted-foreground">
					{restrictionNote(
						viewer.status === "banned" ? "banned" : "suspended",
						"your pinned works",
					)}
				</Text>
			) : null}

			{/**
			 * Mounted only while open: the candidate list is fetched when the dialog opens, and a closed dialog
			 * has no reason to hold the `Published` list.
			 */}
			{picking ? (
				<PinnedStoryPickerDialog
					chosen={value}
					onClose={() => setPicking(false)}
					onPick={(work) => {
						edit(pinItem(value, work, PROFILE_PINNED_STORY_LIMIT));
						setPicking(false);
					}}
				/>
			) : null}
		</View>
	);
}

/** Empty list for when the server value is absent; a fresh array per render would make every comparison "changed". */
const NONE: readonly CreatorWork[] = [];

/**
 * One pin row: title, the reason if not visible, and three actions.
 *
 * The title goes into each action's name. Three icon-only buttons per row repeat the same three
 * words for a screen reader without saying which work they belong to. The end arrows are locked
 * rather than hidden, since a varying button count per row misplaces what the hand remembers.
 */
function PinnedRow({
	work,
	first,
	last,
	disabled,
	onMove,
	onRemove,
}: {
	work: CreatorWork;
	first: boolean;
	last: boolean;
	disabled: boolean;
	onMove: (offset: -1 | 1) => void;
	onRemove: () => void;
}) {
	const title = work.title.trim() || UNTITLED_WORK;
	const notice = pinnedWorkNotice(work);
	return (
		<View style={field.pinned}>
			<View style={field.pinnedText}>
				<Text variant="label" weight="semibold">
					{title}
				</Text>
				{notice ? (
					<Text variant="caption" tone="muted-foreground">
						{notice}
					</Text>
				) : null}
			</View>
			<IconButton
				icon="chevron-up"
				label={pinnedMoveUpLabel(title)}
				disabled={disabled || first}
				onPress={() => onMove(-1)}
			/>
			<IconButton
				icon="chevron-down"
				label={pinnedMoveDownLabel(title)}
				disabled={disabled || last}
				onPress={() => onMove(1)}
			/>
			<IconButton
				icon="close"
				label={pinnedRemoveLabel(title)}
				disabled={disabled}
				onPress={onRemove}
			/>
		</View>
	);
}

const field = StyleSheet.create({
	stack: { gap: space.sm },
	heading: { gap: space.xs },
	loading: { alignItems: "flex-start", paddingVertical: space.sm },
	row: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
	pinned: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.xs,
		paddingHorizontal: space.md,
		paddingVertical: space.sm,
	},
	pinnedText: { flex: 1, gap: space.xs },
});
