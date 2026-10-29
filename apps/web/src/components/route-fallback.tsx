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
 * Draws the two states the router handles on its own: **an unknown address** and **an unhandled
 * error.**
 *
 * Until this file existed, the router's defaults drew both. In practice that meant a bare `<p>Not
 * Found</p>` at the top left of a black screen, with no shell, no way back, and no Korean text, and
 * a "Something went wrong!" message next to a **Show Error** button that expands the raw
 * `error.message`, even in production builds. Every other screen in this repo has its own designed
 * loading, empty and failure states (detail, gallery, analytics). These two were the only leaks,
 * and they are the least visible: normal navigation never reaches them, only typos, stale links and
 * deploy incidents do.
 *
 * ## Where it sits
 *
 * It is attached at the root route (`__root.tsx`). Routes that have their own fallback (gallery,
 * story detail, public profile) keep using it, and everything else lands here. Attaching it at the
 * root is why a newly added route cannot skip it.
 *
 * ## No `<main>` here
 *
 * This component is drawn in two places: the whole document with no route matched (no shell), and
 * inside the `(app)` canvas (with the shell; `/docs/runtime/unknown-page` is that case). A `<main>` added
 * here would produce two landmarks, one nested in the other. Losing one landmark is better than
 * duplicating one.
 */

/** Both screens share this geometry: inside the canvas it grows, standing alone it sets its own height. */
function FallbackFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 min-h-[60svh]">
			{children}
		</div>
	);
}

/**
 * Unknown address.
 *
 * The server already answers 404 (the router sets the status code). Only what the person sees
 * changes here. There is **one** way out: discovery. Going back would return them to the page that
 * produced the link, which may be the very page that led here, and they would meet the same screen
 * again.
 */
export function RouteNotFound() {
	const { t } = useTranslation("shell");
	return (
		<FallbackFrame>
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FileQuestion />
					</EmptyMedia>
					<EmptyTitle>{t("fallback.notFoundTitle")}</EmptyTitle>
					<EmptyDescription>{t("fallback.notFoundBody")}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Link
						to="/"
						search={{}}
						className={buttonVariants({ variant: "default", size: "sm" })}
					>
						{t("fallback.backToDiscover")}
					</Link>
				</EmptyContent>
			</Empty>
		</FallbackFrame>
	);
}

/**
 * An error nobody handled.
 *
 * **No button that opens the raw error.** The router's default has one, but errors that reach this
 * point can include things outside our contract: chunk load failures, exceptions thrown during
 * render, bodies leaked by a proxy. So only failures we named carry a sentence. `RowCatApiError`
 * carries the Korean sentence the server wrote; everything else folds into a generic sentence
 * (`generation-error.ts` follows the same rule).
 *
 * The request id is kept. It is the only thread linking a server log to a person, and on its own it
 * says nothing. The failure screen for a work detail already made the same decision.
 */
export function RouteError({
	error,
	reset,
}: {
	error: Error;
	reset: () => void;
}) {
	const { t } = useTranslation(["shell", "common"]);
	const router = useRouter();
	const apiError = isRowCatApiError(error) ? error : null;
	return (
		<FallbackFrame>
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TriangleAlert />
					</EmptyMedia>
					<EmptyTitle>{t("fallback.errorTitle")}</EmptyTitle>
					<EmptyDescription>
						{apiError?.message ?? t("fallback.retryLater")}
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							size="sm"
							onClick={() => {
								/*
								 * Restore the connection signal first. While the cache layer believes it is offline, a
								 * re-run loader would fall straight back into the paused state (`panel-retry.ts`).
								 */
								syncBrowserOnline();
								reset();
								router.invalidate();
							}}
						>
							{t("common:actions.retry")}
						</Button>
						<Link
							to="/"
							search={{}}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{t("fallback.backToDiscover")}
						</Link>
					</div>
					{apiError?.requestId && (
						<p className="font-mono text-xs text-muted-foreground">
							{t("fallback.requestId", { id: apiError.requestId })}
						</p>
					)}
				</EmptyContent>
			</Empty>
		</FallbackFrame>
	);
}
