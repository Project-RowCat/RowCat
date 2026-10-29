import { borderWidth, radiusScale, space } from "@rowcat/design";
import {
	Icon,
	Notice,
	Spinner,
	Text,
	touchTarget,
	useTheme,
} from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";
import {
	type GenerationRecoveryAction,
	generationRecovery,
} from "../generation/error.ts";
import type { ReplySuggestionState } from "./use-reply-suggestion.ts";

/**
 * Reply suggestions, one layer directly above the composer. It sits in the same seat as the failure
 * notice and continue-generation because it answers the press just made; as a list bubble it would
 * scroll away.
 *
 * Picking fills the composer and never sends. Sending on pick would make a model-written sentence
 * the user's own utterance before they read it, and would turn one press into two paid operations.
 * This component therefore has only `onPick`.
 *
 * The group is a one-line heading and three sentences, grouped by spacing rather than surfaces.
 * Only the failure keeps `Notice`. Failures use the same table as conversation failures
 * (`generationRecovery`), so no-connection leads to the same place whichever request hit it.
 */

/**
 * Retry label for the suggestion request. Not `RETRY_LABEL` (`Regenerate`), which means regenerating the
 * story response and would read as advancing the conversation a turn.
 */
const RETRY_SUGGESTION_LABEL = "Try again";

/**
 * The response arrived but was not usable. Kept apart from the generic failure sentence, which
 * would be false: the response was received and billed on managed.
 */
const MALFORMED_SUGGESTION_MESSAGE = "Couldn't make suggested lines.";

export function ReplySuggestionPanel({
	state,
	onRequest,
	onPick,
	onDismiss,
	onRecover,
}: {
	state: ReplySuggestionState;
	onRequest: () => void;
	/** Fills the chosen sentence into the composer; does not send. */
	onPick: (text: string) => void;
	onDismiss: () => void;
	/** The screen navigates; this component passes only the recovery action. */
	onRecover: (action: GenerationRecoveryAction) => void;
}) {
	const { colors } = useTheme();

	if (state.status === "failed") {
		const recovery = generationRecovery({
			error: state.error,
			/* Always unanswered here: whether retry helps is the table's call (`canRetryGeneration`). */
			unanswered: true,
			/* A suggestion failure never offers continuing the conversation. */
			continuable: false,
			/* Suggestion requests have no stop operation, and a failure is always present in this branch. */
			stopped: false,
		});
		if (!recovery) return null;
		const action = recovery.action;
		return (
			<View style={panel.slot}>
				<Notice
					tone="destructive"
					message={
						state.malformed ? MALFORMED_SUGGESTION_MESSAGE : recovery.message
					}
					actionLabel={
						action
							? action.kind === "retry"
								? RETRY_SUGGESTION_LABEL
								: action.label
							: undefined
					}
					onAction={
						action
							? () => {
									if (action.kind === "retry") onRequest();
									else onRecover(action);
								}
							: undefined
					}
				/>
			</View>
		);
	}

	if (state.status === "ready")
		return (
			<View style={[panel.slot, panel.stack]}>
				{/*
				 * One-line heading. It promises nothing about cost or about sending: picking never sends, and
				 * cost depends on the device's managed or BYO setting.
				 */}
				<View style={panel.head}>
					<Text
						variant="caption"
						tone="muted-foreground"
						numberOfLines={1}
						style={panel.headText}
					>
						Suggested replies · picking one fills the composer
					</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Close suggested replies"
						onPress={onDismiss}
						style={panel.dismiss}
					>
						<Icon name="close" size="md" tone="muted-foreground" />
					</Pressable>
				</View>
				{/* The radiogroup name tells screen-reader users the three targets are one choice. */}
				<View
					accessibilityRole="radiogroup"
					accessibilityLabel="Suggested replies"
					style={panel.list}
				>
					{state.suggestions.map((suggestion) => (
						<Pressable
							key={suggestion}
							accessibilityRole="button"
							accessibilityLabel={suggestion}
							onPress={() => onPick(suggestion)}
							style={[
								panel.option,
								{ backgroundColor: colors.muted, borderColor: colors.border },
							]}
						>
							{/* Not truncated: an ellipsis would make the user pick without reading the full sentence. */}
							<Text variant="body">{suggestion}</Text>
						</Pressable>
					))}
				</View>
			</View>
		);

	/* Loading and idle share one target: splitting them would unmount it under the finger mid-press. */
	const loading = state.status === "loading";
	return (
		<View style={panel.slot}>
			{/* The border marks this as pressable; bare text would read as a label above the composer. */}
			<Pressable
				accessibilityRole="button"
				/* The name changes in the same render as the state; motion only animates the glyphs. */
				accessibilityLabel={
					loading ? "Choosing a suggestion" : "Suggested replies"
				}
				accessibilityState={{ disabled: loading }}
				disabled={loading}
				onPress={onRequest}
				style={[
					panel.trigger,
					{ backgroundColor: colors.muted, borderColor: colors.border },
					loading && panel.triggerBusy,
				]}
			>
				{loading ? (
					<Spinner />
				) : (
					<Icon name="sparkle" size="md" tone="muted-foreground" />
				)}
				<Text variant="label" tone="muted-foreground">
					{loading ? "Choosing a suggestion" : "Suggested replies"}
				</Text>
			</Pressable>
		</View>
	);
}

const panel = StyleSheet.create({
	/* Same seat and margins as the failure notice and continue-generation, so the composer never nudges. */
	slot: { paddingHorizontal: space.md, paddingTop: space.sm },
	stack: { gap: space.xs },
	/* Left margin matches the option text start (`option`'s horizontal padding). */
	head: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.xs,
		paddingLeft: space.sm,
	},
	headText: { flex: 1 },
	list: { gap: space.xs },
	option: {
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		justifyContent: "center",
		minHeight: touchTarget,
		paddingHorizontal: space.sm,
		paddingVertical: space.xs,
	},
	dismiss: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: touchTarget,
		width: touchTarget,
	},
	trigger: {
		alignItems: "center",
		alignSelf: "flex-start",
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		flexDirection: "row",
		gap: space.xs,
		minHeight: touchTarget,
		paddingHorizontal: space.sm,
	},
	triggerBusy: { opacity: 0.75 },
});
