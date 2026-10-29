import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import { Link } from "@tanstack/react-router";
import { useSettingsReturnSearch } from "#/features/settings/settings-return.ts";
import type { GenerationRecoveryAction } from "./generation-error.ts";

/**
 * One recovery action, drawn as one element.
 *
 * Judgment and drawing are split because each branch needs a different element. Settings has an
 * address, so it must be a link (new tab, middle click and paste only work on links). Continue and
 * retry are operations on this screen, so they are buttons. If each screen kept its own table, one
 * screen could render a settings link as a button with no error.
 *
 * Three screens use this component (conversation, story test, reply suggestion), so it holds no
 * state. The pure function `generationRecovery` decides what is possible, and the caller passes
 * what each operation does.
 */
export function GenerationRecoveryActionButton({
	action,
	generating,
	onRetry,
	onContinue,
	retryLabel,
}: {
	action: GenerationRecoveryAction | null;
	/** Not pressable while generating, so two requests never go out for the same turn. */
	generating?: boolean;
	onRetry?: () => void;
	onContinue?: () => void;
	/**
	 * Some screens name the retry differently (reply suggestion uses `Try again`). That screen resends its
	 * own request rather than regenerating the conversation, so reusing the word `Regenerate` would make
	 * the user read it as a conversation regeneration.
	 */
	retryLabel?: string;
}) {
	/**
	 * Carries the return address on the way to settings (`settings-return.ts`). All three screens
	 * share one rule that builds this value, so it stays empty on screens that are not conversations
	 * (the story test). Passing it from each caller would let one screen miss it.
	 */
	const returnSearch = useSettingsReturnSearch();
	if (!action) return null;

	/**
	 * Anything with an address is a link. `to` is a literal because this address is a fixed product
	 * location. If the failure could choose the destination, the value would end up as a string coming
	 * from the error.
	 */
	if (action.kind === "providers")
		return (
			<Link
				to="/settings/ai"
				search={returnSearch}
				className={buttonVariants({
					variant: "outline",
					size: "sm",
					className: "shrink-0",
				})}
			>
				{action.label}
			</Link>
		);

	const run = action.kind === "continue" ? onContinue : onRetry;
	/** An operation the caller did not pass is not drawn, so no button does nothing when pressed. */
	if (!run) return null;

	return (
		<Button
			size="sm"
			variant="outline"
			className="shrink-0"
			disabled={generating}
			onClick={run}
		>
			{action.kind === "retry" && retryLabel ? retryLabel : action.label}
		</Button>
	);
}
