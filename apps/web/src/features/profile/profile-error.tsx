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
import { TriangleAlert, UserRoundX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { syncBrowserOnline } from "#/lib/query/panel-retry.ts";

/**
 * Error screen for a failed public profile load. The 404 case is separate from other failures
 * because the next step differs. Offering `Try again` for a missing profile suggests a retry might
 * work, and calling a transient failure `no such person` treats a network blip as proof the identity is
 * absent.
 *
 * A 404 shows no reason. The server returns the same response for an id that never existed and for
 * a deleted member. Distinguishing them would reveal that a deleted id once existed. The copy
 * states only that no profile is at this address now.
 *
 * No stack trace is shown, matching the server. The request id is shown instead: users can capture
 * it in a screenshot, and it locates the request in the server logs.
 */
export function ProfileError({
	error,
	reset,
}: {
	error: Error;
	reset: () => void;
}) {
	const { t } = useTranslation(["profile", "common"]);
	const router = useRouter();
	const apiError = isRowCatApiError(error) ? error : null;
	const missing = apiError?.status === 404;

	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					{missing ? <UserRoundX /> : <TriangleAlert />}
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
					 * Always provide a way out. A profile can be opened directly from a link or bookmark, so there may
					 * be
					 * no history to go back to. Without an exit the user would have to edit the address bar.
					 */}
					<Link
						to="/"
						search={{}}
						className={buttonVariants({
							variant: missing ? "default" : "outline",
							size: "sm",
						})}
					>
						{t("error.backToDiscover")}
					</Link>
					{!missing && (
						<Button
							size="sm"
							onClick={() => {
								/*
								 * Restore the browser's online signal first. While the cache layer believes the app is
								 * offline, a loader that runs again also drops straight back into the stalled state (see
								 * `panel-retry.ts`).
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
