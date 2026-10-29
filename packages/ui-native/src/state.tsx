import { borderWidth, iconSize, radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import {
	ActivityIndicator,
	type StyleProp,
	StyleSheet,
	View,
	type ViewStyle,
} from "react-native";
import { Button } from "./button.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Surface for product states. The eight states are kept distinct rather than folded together:
 * - loading: no answer yet
 * - empty: answered, nothing to show
 * - offline: no network; resumes automatically when connected
 * - failed: query failed; retry is possible
 * - missing: resource absent or not visible; retrying gives the same result
 * - restricted: allowed in principle, not for this account
 * - notice: a fact that is not a failure
 * - destructive: a user-started action failed
 *
 * The package gives each state a consistent shape only. It does not decide which state applies;
 * that stays in the screen resolvers (resolveDiscoverState, resolveStoryState,
 * resolveCommentsState, resolveChatScreenState). Importing those judgments would make the UI
 * package aware of product state.
 *
 * `accessibilityRole="alert"` is used only for user-started failures, because it interrupts the
 * screen reader. A notice such as `Sign in to comment` is a fact, not a failure, and reading it
 * aloud on screen open would be an interruption.
 */

/** Neutral wait indicator. It does not say what it is waiting for; the screen decides that. */
export function Spinner({
	label,
	style,
}: {
	label?: string;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	return (
		<View style={[state.spinner, style]}>
			<ActivityIndicator color={colors["muted-foreground"]} />
			{label ? (
				<Text variant="caption" tone="muted-foreground">
					{label}
				</Text>
			) : null}
		</View>
	);
}

/**
 * Bordered notice: one fact that is not a failure, plus one next action if there is one. Same
 * surface as the web Empty and notice cards (card background plus border).
 */
export function Notice({
	message,
	actionLabel,
	onAction,
	busy,
	tone = "muted",
	style,
}: {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
	busy?: boolean;
	/**
	 * `destructive` is reserved for failed operations. Only then does the screen reader interrupt to
	 * read it.
	 */
	tone?: "muted" | "destructive";
	style?: StyleProp<ViewStyle>;
}) {
	const { colors, alpha } = useTheme();
	const failed = tone === "destructive";

	return (
		<View
			style={[
				state.notice,
				{
					backgroundColor: failed ? alpha("destructive", 0.08) : colors.card,
					borderColor: failed ? alpha("destructive", 0.4) : colors.border,
				},
				style,
			]}
		>
			<View style={state.noticeHead}>
				<Icon
					name={failed ? "warning" : "info"}
					size="md"
					tone={failed ? "destructive" : "muted-foreground"}
				/>
				<Text
					accessibilityRole={failed ? "alert" : undefined}
					variant="label"
					tone={failed ? "destructive" : "muted-foreground"}
					style={state.noticeText}
				>
					{message}
				</Text>
			</View>
			{actionLabel && onAction ? (
				<Button
					label={actionLabel}
					variant={failed ? "outline" : "secondary"}
					size="sm"
					onPress={onAction}
					busy={busy}
				/>
			) : null}
		</View>
	);
}

/**
 * A failed action or query: one sentence and one way out.
 *
 * It deliberately accepts no cause string (stack, provider response, request URL). Those carry
 * server configuration and internal paths, and the user cannot act on them.
 */
export function ErrorState({
	message,
	actionLabel,
	onAction,
	busy,
	detail,
	style,
}: {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
	busy?: boolean;
	/**
	 * One clue the user can quote when contacting support, such as a request id. Not the response
	 * body.
	 */
	detail?: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<View style={[state.block, style]}>
			<Notice
				tone="destructive"
				message={message}
				actionLabel={actionLabel}
				onAction={onAction}
				busy={busy}
			/>
			{detail}
		</View>
	);
}

/**
 * A returned, empty answer: an illustration, a sentence, and optionally one next step.
 *
 * Keep this separate from failure. Drawing a failed query as `No stories yet` tells the user their
 * data is gone.
 */
/**
 * Empty state with the same structure as the web Empty set: icon box, title, description, one
 * action.
 *
 * The icon is optional because this slot draws two kinds of emptiness. Where the reason has a name
 * (no search matches), the web draws an icon too (SearchX, LibraryBig). Short hints inside lists
 * are text only. Do not attach an icon to an empty state that has no specific meaning.
 */
export function EmptyState({
	icon,
	title,
	description,
	actionLabel,
	actionVariant = "primary",
	onAction,
	style,
}: {
	icon?: IconName;
	title: string;
	description?: string;
	actionLabel?: string;
	/**
	 * Visual weight of the action. The web splits this into two groups, counted from its Empty call
	 * sites:
	 * - primary: leaving a dead-end screen (log in, go home, back to the chat list, browse works)
	 * - outline: the next step beside the state (create new work, reset filters, clear search)
	 *
	 * Defaults to primary because more call sites in this app are of that kind: the eight screens
	 * reached from the tabs without logging in all use it.
	 *
	 * This was once hardcoded to secondary, which is not one of the web variants. All 22 slots drew a
	 * gray button, so the only action a logged-out user could take (log in) read as a minor secondary
	 * action.
	 *
	 * The type is not opened to every ButtonVariant. ghost and destructive empty-state actions do not
	 * exist on the web, and allowing them would invite someone to pick one later.
	 */
	actionVariant?: "primary" | "outline";
	onAction?: () => void;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	return (
		/**
		 * Sits inside a dashed box, matching the web Empty (rounded-lg border-dashed p-6). Every web call
		 * site of that primitive adds `className="border"`.
		 *
		 * The app's empty states had no box at all, at every call site of this component (empty lists,
		 * zero search results, zero filter results, guest hints). The gap only shows when two screens sit
		 * side by side. The text and icons match, so either screen viewed alone looks plausible. The box
		 * says this is a slot and it is empty. Without it, the sentence reads as a floating note and
		 * nothing signals where content will appear.
		 */
		<View style={[state.empty, { borderColor: colors.border }, style]}>
			{icon ? <EmptyMedia icon={icon} /> : null}
			<Text variant="title" tone="foreground" style={state.center}>
				{title}
			</Text>
			{description ? (
				<Text variant="label" tone="muted-foreground" style={state.center}>
					{description}
				</Text>
			) : null}
			{actionLabel && onAction ? (
				/**
				 * Center the action. Button defaults to hugging its content and sitting at the left (hug =
				 * alignSelf: flex-start). alignSelf is more specific than the parent's alignItems center, so
				 * the button stayed left-aligned under a centered illustration, title and description. This
				 * affected every call site of this component, not a single screen.
				 *
				 * Button gets no alignment argument: left-hugging is right for groups that read left-aligned,
				 * like Notice. The decision to center belongs to this component, so it is set here through
				 * style.
				 */
				<Button
					label={actionLabel}
					variant={actionVariant}
					size="md"
					onPress={onAction}
					style={state.emptyAction}
				/>
			) : null}
		</View>
	);
}

/**
 * Icon box: same values as the web EmptyMedia variant=icon (size-10 rounded square, bg-muted,
 * size-6 icon).
 *
 * The icon is decorative and has no accessible name. The title below says what is empty, and naming
 * the icon too would make a screen reader announce the same thing twice.
 */
function EmptyMedia({ icon }: { icon: IconName }) {
	const { colors } = useTheme();
	return (
		<View style={[state.media, { backgroundColor: colors.muted }]}>
			<Icon name={icon} size="xl" tone="foreground" />
		</View>
	);
}

const state = StyleSheet.create({
	spinner: {
		alignItems: "center",
		gap: space.md,
		justifyContent: "center",
		padding: space.lg,
	},
	block: { gap: space.sm },
	notice: {
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		gap: space.md,
		padding: space.md,
	},
	noticeHead: { flexDirection: "row", gap: space.sm },
	noticeText: { flex: 1 },
	media: {
		alignItems: "center",
		borderRadius: radiusScale.lg,
		height: iconSize["2xl"],
		justifyContent: "center",
		width: iconSize["2xl"],
	},
	/**
	 * Same values as the web Empty (rounded-lg border-dashed p-6): radius 10, 1px dashed border,
	 * padding 24. Narrow-screen values are used; the web's sm:p-12 starts at 640px, a width this app
	 * does not reach.
	 */
	empty: {
		alignItems: "center",
		borderRadius: radiusScale.lg,
		borderStyle: "dashed",
		borderWidth: borderWidth,
		gap: space.sm,
		padding: space.xl,
	},
	emptyAction: { alignSelf: "center" },
	center: { textAlign: "center" },
});
