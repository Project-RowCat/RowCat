import { Button } from "@rowcat/ui-web/components/button";
import { useTranslation } from "react-i18next";

/**
 * `Try again` takes a handler for server-backed surfaces, not refetch. Passing refetch would give a
 * button that does nothing on a stalled query (see panel-retry.ts). The mismatch cannot be seen
 * from inside the surface: only offline users would see the dead button, so review would miss it.
 */
export interface RetrySurface {
	isRetrying: boolean;
	onRetry: () => void;
}

/**
 * Shown when a value is on screen but the last refresh failed or was interrupted, as a one-line
 * quiet strip that never grows larger than the value. A destructive box would make users read the
 * box first, though only the freshness of the data changed. `role="alert"` is avoided for the same
 * reason: the value is already readable, so screen readers should not be interrupted.
 *
 * The caller passes a complete sentence, because Korean particles depend on the noun's final
 * consonant and a template picks the wrong particle for some words.
 */
export function StaleNotice({
	message,
	isRetrying,
	onRetry,
}: RetrySurface & { message: string }) {
	const { t } = useTranslation("common");
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-muted/60 px-3 py-1.5">
			<p className="text-xs text-muted-foreground">{message}</p>
			<Button size="sm" variant="ghost" disabled={isRetrying} onClick={onRetry}>
				{isRetrying ? t("state.loading") : t("actions.retry")}
			</Button>
		</div>
	);
}
