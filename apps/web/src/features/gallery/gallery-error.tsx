import { GALLERY_ERROR_CODE } from "@rowcat/contracts";
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
import { Lock, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translator } from "#/lib/i18n/current.ts";
import { syncBrowserOnline } from "#/lib/query/panel-retry.ts";

/**
 * Notice for when the server gate blocks access.
 *
 * Eligibility is judged by the server. If the client repeated that computation, the two judgments
 * would drift apart one day, and the screen would say you may view while the list shows empty. This
 * file only turns the name of a decision already made into human-readable copy.
 */
function gateMessage(
	code: string,
): { title: string; description: string } | undefined {
	const t = translator("gallery");
	switch (code) {
		case GALLERY_ERROR_CODE.adultVerificationRequired:
			return {
				title: t("gate.adultVerificationTitle"),
				description: t("gate.adultVerificationBody"),
			};
		case GALLERY_ERROR_CODE.adultVisibilityOff:
			return {
				title: t("gate.adultOffTitle"),
				description: t("gate.adultOffBody"),
			};
		/**
		 * Annual recheck: do not tell the user to turn the setting on. It may already be on, and turning
		 * it on would not clear this.
		 */
		case GALLERY_ERROR_CODE.adultRecheckRequired:
			return {
				title: t("gate.recheckTitle"),
				description: t("gate.recheckBody"),
			};
		case GALLERY_ERROR_CODE.loginRequired:
			return { title: t("gate.loginTitle"), description: t("gate.loginBody") };
		default:
			return undefined;
	}
}

/**
 * Gallery failure screen. No stack trace is shown (the server does not send one either). The
 * request id is shown instead: it is the only clue a user can bring in a screenshot, and it lets
 * the server log find the same request.
 */
export function GalleryError({
	error,
	reset,
}: {
	error: Error;
	reset: () => void;
}) {
	const { t } = useTranslation(["gallery", "common"]);
	const router = useRouter();
	const apiError = isRowCatApiError(error) ? error : null;
	const gate = apiError ? gateMessage(apiError.code) : undefined;

	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					{gate ? <Lock /> : <TriangleAlert />}
				</EmptyMedia>
				<EmptyTitle>{gate?.title ?? t("loadFailed")}</EmptyTitle>
				<EmptyDescription>
					{gate?.description ?? apiError?.message ?? t("retryLater")}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<div className="flex flex-wrap items-center justify-center gap-2">
					{/*
					 * Navigation must stay a real link. Passing `<a>` through Button's `render` strips link behavior
					 * (opening in a new tab, copying the address), and Base UI warns about that combination. Only the
					 * appearance is needed, so only the variant classes are reused.
					 */}
					{gate && (
						<Link
							to="/"
							search={{}}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{t("resetFilters")}
						</Link>
					)}
					<Button
						size="sm"
						onClick={() => {
							/*
							 * Restore the connection signal first. While the cache layer believes it is offline, a
							 * loader that reruns would still stop at the offline state (`panel-retry.ts`).
							 */
							syncBrowserOnline();
							reset();
							router.invalidate();
						}}
					>
						{t("common:actions.retry")}
					</Button>
				</div>
				{apiError?.requestId && (
					<p className="font-mono text-xs text-muted-foreground">
						{t("requestId", { id: apiError.requestId })}
					</p>
				)}
			</EmptyContent>
		</Empty>
	);
}
