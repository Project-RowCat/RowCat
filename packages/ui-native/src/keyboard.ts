import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Whether the soft keyboard is currently covering the screen. This is the only place in this
 * package that asks that question.
 *
 * Focus is not the answer. A text field can be focused with no soft keyboard showing, when a
 * hardware keyboard is attached (iPad Magic Keyboard, an Android Bluetooth keyboard, or the
 * simulator's Connect Hardware Keyboard). If focus were used to drop the bottom safe-area padding,
 * the input would sit under the home indicator. That reproduces by default on developers'
 * simulators, so the wrong screen would be the one developers see every day.
 *
 * The decision relies only on the platform's keyboard lifecycle signal. Without a signal, the
 * safe-area padding stays. That error goes in the protective direction.
 *
 * The keyboard height is not exported. On Android with adjustResize the window itself shrinks, so
 * adding the keyboard height again would push twice. With edge-to-edge it does not shrink. The
 * difference depends on where the component sits on screen, which KeyboardAvoidingView already
 * measures (frame.screenY + frame.height - keyboardFrame.screenY). The only output here is one
 * boolean: whether to drop the bottom padding now, since the keyboard already occupies that space.
 */

/**
 * iOS listens to the `will` events and Android to the `did` events.
 *
 * iOS keyboardWillShow fires at the start of the animation, so the padding moves together with the
 * keyboard. With the did event, the padding disappears only after the keyboard has finished rising,
 * and the layout jumps by a frame. Android has no will events at all. Pretending they exist would
 * leave the listeners silently unattached.
 */
const SHOW = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

export function useSoftKeyboardVisible(): boolean {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const shown = Keyboard.addListener(SHOW, () => setVisible(true));
		const hidden = Keyboard.addListener(HIDE, () => setVisible(false));
		return () => {
			shown.remove();
			hidden.remove();
		};
	}, []);

	return visible;
}
