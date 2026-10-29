import { space } from "@rowcat/design";
import type { ReactNode } from "react";
import {
	KeyboardAvoidingView,
	ScrollView,
	type StyleProp,
	StyleSheet,
	View,
	type ViewStyle,
} from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "./theme.tsx";

/**
 * The bottom of the screen. The safe area lives in this one place. It exists so no feature writes
 * its own `paddingTop: 44` to clear the notch. Such numbers are wrong on some devices, and only the
 * owner of that device notices.
 * - Screen is confined to the screen height: a list and an input bar (discovery, chat).
 * - ScrollScreen is document flow, read top to bottom (login). This is the same split as the web
 *   shell's viewportLocked axis, for the same reason: one scrolls inside itself, the other scrolls
 *   as a whole. Merging them puts a document below a chat input or creates nested scrolling.
 */

export function Screen({
	children,
	edges = ["top", "bottom", "left", "right"],
	style,
}: {
	children: ReactNode;
	/**
	 * Which edges receive safe-area padding. Each edge left out must have another owner. Chat leaves
	 * out `bottom` because ComposerArea owns it and also tracks the keyboard. Padding here would leave
	 * an empty band when the keyboard is up. Do not omit an edge without an owner. A comment once
	 * pointed at a component that did not exist, and during that time the chat input sat over the home
	 * indicator. Left and right are handled here too. An inner layer adding them again would double
	 * the padding on devices that overflow horizontally, and only those devices would show it.
	 */
	edges?: readonly Edge[];
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	return (
		<SafeAreaView
			edges={edges}
			style={[screen.root, { backgroundColor: colors.background }, style]}
		>
			{children}
		</SafeAreaView>
	);
}

/**
 * A screen read top to bottom. It includes keyboard avoidance, because this shape is usually a
 * form, and a form without it loses its last field below the keyboard.
 */
export function ScrollScreen({
	children,
	contentStyle,
}: {
	children: ReactNode;
	contentStyle?: StyleProp<ViewStyle>;
}) {
	return (
		<Screen>
			{/** The keyboard offset rule is documented once, on KeyboardLayout below. This uses the same values. */}
			<KeyboardAvoidingView behavior="padding" style={screen.root}>
				<ScrollView
					contentContainerStyle={[screen.content, contentStyle]}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
				>
					{children}
				</ScrollView>
			</KeyboardAvoidingView>
		</Screen>
	);
}

/**
 * Sole owner of keyboard geometry. A screen should not add its own `KeyboardAvoidingView`, and a
 * feature must not compute its own margin from `Keyboard` events. Two corrections on one screen do
 * not agree, and their sum is always wrong. Both platforms use `padding`. An earlier Android branch
 * had no `behavior` on the premise that the window resizes. That premise no longer holds: the app
 * runs edge-to-edge (`edgeToEdgeEnabled=true` in android/gradle.properties), so the window does not
 * shrink for the keyboard and the input would sink beneath it. `padding` does not push twice on
 * devices where the window does resize, because this component does not read the value from events.
 * KeyboardAvoidingView measures its own frame and pushes only the overlap (frame.screenY +
 * frame.height - keyboardFrame.screenY). If the window already shrank, that overlap goes to zero,
 * so one line fits both modes.
 */
export function KeyboardLayout({
	children,
	style,
}: {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<KeyboardAvoidingView behavior="padding" style={[screen.root, style]}>
			{children}
		</KeyboardAvoidingView>
	);
}

/** The centered block for loading, empty, and failure states. Non-list states use this slot. */
export function CenteredArea({ children }: { children: ReactNode }) {
	return <View style={screen.centered}>{children}</View>;
}

/**
 * The horizontal gutter for the canvas, chosen once here rather than per screen. If it varied by
 * screen, content would slide sideways on every navigation.
 */
export const screenPadding = space.lg;

const screen = StyleSheet.create({
	root: { flex: 1 },
	content: { gap: space.xl, padding: space.xl },
	centered: {
		flex: 1,
		justifyContent: "center",
		padding: screenPadding,
	},
});
