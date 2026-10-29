import { Check, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";

/**
 * The answer inside the save button: `Save → Saving… → ✓ Saved`.
 *
 * The result lives here because of causality. Saving changes nothing on screen except the control
 * that was pressed (the value is already in the field, and the public profile is another address),
 * so without this the button returning to its original label was the only signal, which is
 * indistinguishable from a failure.
 *
 * Only the glyph changes. The icon slot is always reserved (one `size-4` cell) and never empties:
 * an emptied slot pushed the `Save` text sideways and made the button look tilted. Collapsing the
 * cell would shift the geometry when the check arrives, since `AnimatedIconSwap` assumes a fixed
 * outer geometry, so the answer fills the cell rather than removing it.
 *
 * `stateKey` folds `idle` and `pending` together because they draw the same glyph; keeping them
 * apart would run a no-op swap on every press.
 *
 * This indicator does not interrupt screen readers: no `role="alert"` and no live region. Profile
 * saves are frequent, and announcing "saved" each time would interrupt reading. The button label
 * change is enough, and it happens in the same render as the state. Failures are the opposite (see
 * the `role="alert"` message elsewhere in this section).
 */
export function SaveLabel({ state }: { state: "idle" | "pending" | "saved" }) {
	const { t } = useTranslation(["account", "common"]);
	return (
		<span className="inline-flex items-center gap-1.5">
			<AnimatedIconSwap
				stateKey={state === "saved" ? "saved" : "idle"}
				className="size-4"
			>
				{state === "saved" ? (
					<Check aria-hidden="true" className="size-4" />
				) : (
					<Save aria-hidden="true" className="size-4" />
				)}
			</AnimatedIconSwap>
			{state === "pending"
				? t("saveLabel.saving")
				: state === "saved"
					? t("saveLabel.saved")
					: t("saveLabel.save")}
		</span>
	);
}
