import { createContext, type ReactNode, useContext } from "react";

/**
 * The feedback port for the moment a value is picked. This package does not know what it rings
 * with. UIKit's picker gives selection haptics on its own. The hand-built choice controls here
 * (`ChoiceGroup`, `SelectOption`, `MenuRadioGroup`) do not, and this port fills that gap. The
 * implementation belongs to the app (apps/mobile/src/lib/haptics/). The haptic library is a native
 * dependency, and importing it here would make this package aware of the app's link configuration.
 * What stays here is when: the instant the value actually changes, a fact only the control knows.
 * Without a provider nothing happens, which is how tests and previews run. `Switch` does not use
 * this port. It is a platform switch that already gives feedback, and adding one here would ring
 * twice. The caller decides whether the value changed (`next !== value`, `!selected`). Re-picking
 * the already selected row is not a change, and feedback there would read as "something changed".
 */
const SelectionFeedbackContext = createContext<() => void>(() => {});

export function SelectionFeedbackProvider({
	onSelectionChange,
	children,
}: {
	/**
	 * Called once when the value changes. It must not throw, so it cannot block the follow-up work of
	 * the selection.
	 */
	onSelectionChange: () => void;
	children: ReactNode;
}) {
	return (
		<SelectionFeedbackContext.Provider value={onSelectionChange}>
			{children}
		</SelectionFeedbackContext.Provider>
	);
}

export function useSelectionFeedback(): () => void {
	return useContext(SelectionFeedbackContext);
}
