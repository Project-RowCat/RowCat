import { isRowCatApiError } from "@rowcat/sdk";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rowcat/ui-web/components/empty";
import { Link, useRouter } from "@tanstack/react-router";
import { FileQuestion, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { syncBrowserOnline } from "#/lib/query/panel-retry.ts";

/**
 * Failure screen for the work detail.
 *
 * A 404 is handled specially, but the screen does not say why. The server returns the same 404 for
 * a missing work and for one the user cannot see (private, blocked, adult gate). A 403 would reveal
 * that the work exists, and scanning ids would expose other people's private works. Guessing a
 * reason here would undo the boundary the server keeps. The only fact known is 'this work does not
 * exist for this person', and the copy says no more than that.
 *
 * No stack trace is shown, since the server sends none either. The request id is shown instead.
 * Users can send it in a screenshot, and it is enough to find the same request in server logs.
 */
export function StoryDetailError({
	error,
	reset,
}: {
	error: Error;
	reset: () => void;
}) {
	const { t } = useTranslation(["story", "common", "shell"]);
	const router = useRouter();
	const apiError = isRowCatApiError(error) ? error : null;
	const missing = apiError?.status === 404;

	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					{missing ? <FileQuestion /> : <TriangleAlert />}
				</EmptyMedia>
				<EmptyTitle>
					{missing ? t("error.notFound") : t("error.loadFailed")}
				</EmptyTitle>
				<EmptyDescription>
					{missing
						? t("error.notFoundBody")
						: (apiError?.message ?? t("error.retryLater"))}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<div className="flex flex-wrap items-center justify-center gap-2">
					{/*
					 * The navigation must be a real link. Rendering it through Button's `render` prop loses link
					 * behavior (open
					 * in new tab, copy address), and Base UI warns about that combination. Only the variant classes are
					 * reused,
					 * since only the look is needed.
					 */}
					<Link
						to="/"
						search={{}}
						className={buttonVariants({
							variant: missing ? "default" : "outline",
							size: "sm",
						})}
					>
						{t("shell:fallback.backToDiscover")}
					</Link>
					{/*
					 * No retry on a missing work. The same request gets the same 404, and a retry button would only
					 * suggest that
					 * pressing it a few more times might help.
					 */}
					{!missing && (
						<Button
							size="sm"
							onClick={() => {
								/*
								 * Restore the connectivity signal first. While the cache layer believes it is offline, a
								 * loader that re-runs will still drop straight back into the stalled state
								 * (`panel-retry.ts`).
								 */
								syncBrowserOnline();
								reset();
								router.invalidate();
							}}
						>
							{t("common:actions.retry")}
						</Button>
					)}
				</div>
				{apiError?.requestId && (
					<p className="font-mono text-xs text-muted-foreground">
						{t("error.requestId", { id: apiError.requestId })}
					</p>
				)}
			</EmptyContent>
		</Empty>
	);
}
