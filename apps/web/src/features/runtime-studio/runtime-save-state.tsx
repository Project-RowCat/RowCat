import { Button } from "@rowcat/ui-web/components/button";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { autosaveIndicatorView } from "#/features/create/editor/autosave-indicator.ts";
import {
	type DraftAutosave,
	useAutosaveState,
} from "#/features/create/editor/use-autosave.ts";
import { contentEnter } from "#/lib/motion/surface-content.ts";

/**
 * The studio's save indicator: same judgment and same wording as the draft editor.
 *
 * - The judgment is a pure function (`autosaveIndicatorView`). This component only places its
 *   answer; restating the conditions here would draw the same state with different text on two
 *   screens.
 * - It is a separate component so that only these few characters subscribe to save state. If the
 *   studio body read it, each save would re-render the whole editor tree three times for a change
 *   of a few characters.
 * - Wording switches in place with an opacity fade (`surface-content.ts`), with no zoom or
 *   movement. Saves can happen several times a second while typing, so anything heavier would make
 *   this line constantly move. The old word disappears as the new one appears; there is no exit.
 * - Switching between failure and status does not move. The two branches with different `key`s
 *   are an accessibility contract (see `AutosaveIndicator` in draft-editor-page.tsx). If only
 *   attributes on one node changed, assistive tech would not treat a second failure as a new alert,
 *   and it would stay silent. So presence lives inside the status branch only, and the failure node
 *   is attached and removed outside it.
 */
export function RuntimeSaveState({ autosave }: { autosave: DraftAutosave }) {
	const { t } = useTranslation(["runtimeStudio", "common"]);
	const { label, announce, retryable } = autosaveIndicatorView(
		useAutosaveState(autosave),
	);

	return (
		<span className="flex items-center gap-2">
			{announce ? (
				<span key="failure" role="alert" className="text-xs text-destructive">
					{label}
				</span>
			) : (
				<AnimatePresence key="status" initial={false}>
					<m.span
						key={label}
						initial={contentEnter.initial}
						animate={contentEnter.animate}
						transition={contentEnter.transition}
						className="text-xs text-muted-foreground"
					>
						{label}
					</m.span>
				</AnimatePresence>
			)}
			{retryable && (
				<Button
					size="sm"
					variant="outline"
					className="h-6 px-2 text-xs"
					onClick={() => void autosave.flush()}
				>
					{t("common:actions.retry")}
				</Button>
			)}
		</span>
	);
}
