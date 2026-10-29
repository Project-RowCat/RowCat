import type { ChatMessage, ChatRoom } from "@rowcat/chat";
import { chatUsageView } from "@rowcat/chat";
import { space } from "@rowcat/design";
import { Button, Separator, Text } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
	ROOM_USAGE_TITLE,
	ROOM_USAGE_UNKNOWN_MODEL,
	roomUsageOutcomeLabel,
	roomUsageRowLine,
	roomUsageScope,
	usageTotalLines,
} from "./info-copy.ts";

/**
 * Conversation info: facts that are read-only for this conversation. Same place and content as
 * web's `room-settings/info.tsx`.
 *
 * This file opens no window. It was once `RoomInfoDialog`, opened directly by the header overflow
 * menu; now it is one pane inside room settings, whose only container is
 * `room-settings-dialog.tsx`. A `...Dialog` name would make the next reader assume a window and
 * build another beside it.
 *
 * The pane has no controls, by definition rather than as a corollary of immutability. The rows
 * above are immutable fields fixed at acquisition (first-writer-wins merge) and the usage table
 * moves with every settled response, but they share a pane for one reason: nothing here is
 * editable. Turning room settings into a seed editor would change the premise of a conversation in
 * progress.
 *
 * The usage table moved here from the `Generation settings` pane. The old placement was causal (values chosen
 * there move these numbers), but it cost more: everyone opening it to pick a model had to scroll
 * past a diagnostic table. The panes answer different questions (what to make it with: operate;
 * what this conversation was: read). Web made the same call.
 *
 * `Not applicable` is not drawn. Rating and prompt protection rows appear only when applicable; empty
 * placeholders would show two meaningless rows in most conversations and become claims of fact, so
 * the top is usually a single row (same as web). The usage table follows the same rule: absent with
 * no responses.
 *
 * No timestamps. An older version had `start` and `Last activity`; web's pane has neither, correctly: `Last
 * activity` is the list's sort axis, not a fact about this conversation, and drawing it makes users read
 * it as deciding something. Same axis as omitting developer metadata (room id, revision, HLC): this
 * is conversation info, not a record viewer.
 *
 * The origin work is not looked up. The room opens even if the work turned private or was deleted
 * (the room's seed is the source of truth); checking would make this pane wait on the server and a
 * room from a vanished work could not read its own info. A link ending in 404 is better.
 */
export function RoomInfoContent({
	room,
	messages,
	onLeave,
}: {
	room: ChatRoom;
	/**
	 * Recent messages the window already subscribes to; the usage table reads them. Room settings
	 * panes do not hold the store directly (`room/use-management.tsx`), which keeps ownership checks
	 * in one place; a read-only exception would invite the next pane to make one for writes.
	 */
	messages: readonly ChatMessage[];
	/** Leaves for the work; the caller closes the settings sheet first. */
	onLeave: () => void;
}) {
	const router = useRouter();
	const storyId = room.originStoryId;

	return (
		<View style={info.root}>
			<InfoRow label="start">
				{storyId ? (
					<Button
						label="View the original story"
						variant="outline"
						fullWidth
						onPress={() => {
							onLeave();
							router.push({
								pathname: "/stories/[storyId]",
								params: { storyId },
							});
						}}
					/>
				) : (
					<Text variant="label">
						This conversation didn't start from a story.
					</Text>
				)}
			</InfoRow>

			{room.adult ? (
				<InfoRow label="Rating">
					<Text variant="label">
						This conversation started from an adult story.
					</Text>
				</InfoRow>
			) : null}

			{/* A protected prompt stays hidden here too. `promptProtected` is a protection boundary, not a display setting, so there is no "view source" item. */}
			{room.promptProtected ? (
				<InfoRow label="Prompt">
					<Text variant="label">
						The creator protected this story, so the creative prompt isn't
						shown.
					</Text>
				</InfoRow>
			) : null}

			<RoomUsage messages={messages} />
		</View>
	);
}

/**
 * Label and value, always stacked. Web stacks below `sm` and sets them side by side above; this app
 * has no upper branch, so the stacked one matches web's narrow shape. No divider between rows: the
 * list is at most three long and usually one, where a divider shows itself instead of separating
 * anything.
 */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<View style={info.row}>
			<Text variant="label" tone="muted-foreground">
				{label}
			</Text>
			{children}
		</View>
	);
}

const info = StyleSheet.create({
	root: { gap: space.lg, paddingVertical: space.sm },
	row: { gap: space.xs },
	usage: { gap: space.xs },
	usageTotals: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
	usageRow: {
		flexDirection: "row",
		alignItems: "baseline",
		justifyContent: "space-between",
		gap: space.md,
	},
	usageModel: { flexShrink: 1 },
});

/**
 * Recent usage; same place and rules as web (`room-settings/info.tsx`). Counting is a shared pure
 * function (`chatUsageView`); summing here would eventually introduce `?? 0`, turning responses
 * that reported no usage into responses that spent none and making totals always smaller than the
 * truth, silently.
 *
 * The window is the most recent page and did not widen when the table moved, because the question
 * is unchanged: did tokens spike on a recent turn. The window size has one owner
 * (`lib/local-data/use-room-messages.ts`) and web uses the same size. No money: the table counts
 * tokens, and rates are not something this app knows.
 */
function RoomUsage({ messages }: { messages: readonly ChatMessage[] }) {
	const usage = chatUsageView(messages);
	if (usage.rows.length === 0) return null;

	return (
		<>
			<Separator />
			<View style={info.usage}>
				<Text
					accessibilityRole="header"
					variant="caption"
					tone="muted-foreground"
				>
					{ROOM_USAGE_TITLE}
				</Text>
				<Text variant="label" tone="muted-foreground">
					{roomUsageScope(usage.rows.length, usage.unreported)}
				</Text>
				<View style={info.usageTotals}>
					{usageTotalLines(usage.totals).map((line) => (
						<Text key={line} variant="label">
							{line}
						</Text>
					))}
				</View>
				{/* The outcome stands beside the model name. Reports of output stopping midway had nothing readable in the conversation, though the value was already on the record (`chatUsageView` header). Normal rows say nothing. */}
				{usage.rows.map((row) => {
					const outcome = roomUsageOutcomeLabel(row.outcome);
					return (
						<View key={row.messageId} style={info.usageRow}>
							<Text
								variant="label"
								tone="muted-foreground"
								numberOfLines={1}
								style={info.usageModel}
							>
								{row.model ?? ROOM_USAGE_UNKNOWN_MODEL}
								{outcome === null ? "" : ` · ${outcome}`}
							</Text>
							<Text variant="label">{roomUsageRowLine(row)}</Text>
						</View>
					);
				})}
			</View>
		</>
	);
}
