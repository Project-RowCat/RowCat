import { isRowCatApiError } from "@rowcat/sdk";
import { Button } from "@rowcat/ui-web/components/button";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { AlertTriangle, Inbox, ShieldOff, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import {
	type AdminQueryStaleness,
	adminQueryView,
	unreachableFailure,
} from "#/lib/query/query-state.ts";
import type { AdminQuery } from "#/lib/query/use-admin-query.ts";

/**
 * Status surfaces, drawn as five distinct states because misreading them is costly in an operations
 * console:
 *
 * ```text
 * loading       not known yet, and still in progress
 * unreachable   the server was not reached; not in progress (drawn as loading it is a skeleton forever)
 * failed        asked and got no answer; never drawn as 0
 * forbidden     asked and was refused; retry is useless (no retry button)
 * empty         asked and there really is nothing; the only state that says "none"
 * ```
 *
 * Folding failure into empty is the most dangerous mistake here: "0 unresolved reports" is a claim
 * we cannot know after a failed lookup, and operators conclude the queue is empty from it.
 *
 * The second mistake is drawing a held value as if it were current. These values (unresolved report
 * counts, sanction state, balances) drive operator actions, so keep the value but say the last
 * refresh did not finish: `StaleNotice`. Ordering and decisions belong to the pure function in
 * `lib/query/query-state.ts`.
 */

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
	return (
		<div className="space-y-2" aria-busy="true" aria-live="polite">
			{Array.from({ length: rows }, (_, index) => (
				<Skeleton
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
					key={index}
					className="h-10 w-full"
				/>
			))}
		</div>
	);
}

/**
 * The unreachable sentence, in one place. It does not say "the internet is down": all we know is
 * that no response came (`unreachableFailure`), and on a day the server is down that claim would
 * send every operator to their own wifi and slow incident response.
 */
const UNREACHABLE_MESSAGE = "Couldn't reach the server.";
const UNREACHABLE_HINT = "Check the connection and try again.";

/**
 * Human-readable failure text, with the request id shown: it is the only clue a user brings in a
 * screenshot (`ApiErrorBody.requestId`), and here that user is us.
 *
 * A non-`RowCatApiError` is not passed through: its `message` is the browser's English line
 * (`Failed to fetch`), which explains nothing to the operator while posing as our screen.
 */
function describeError(error: unknown): {
	message: string;
	requestId?: string;
} {
	if (isRowCatApiError(error))
		return { message: error.message, requestId: error.requestId };
	if (unreachableFailure(error))
		return { message: `${UNREACHABLE_MESSAGE} ${UNREACHABLE_HINT}` };
	return { message: "An unknown error occurred." };
}

/** Whether the error is a permission problem; if so no retry button is drawn. */
export const isForbiddenError = (error: unknown): boolean =>
	isRowCatApiError(error) && error.status === 403;

export function ErrorBlock({
	error,
	onRetry,
	title,
}: {
	error: unknown;
	onRetry?: () => void;
	title?: string;
}) {
	const { message, requestId } = describeError(error);
	const forbidden = isForbiddenError(error);

	return (
		<div
			// A failed lookup is announced; it is not something the user would seek out after the screen
			// changes.
			role="alert"
			className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
		>
			<div className="flex items-start gap-3">
				{forbidden ? (
					<ShieldOff
						className="mt-0.5 size-4 shrink-0 text-destructive"
						aria-hidden
					/>
				) : (
					<AlertTriangle
						className="mt-0.5 size-4 shrink-0 text-destructive"
						aria-hidden
					/>
				)}
				<div className="min-w-0 flex-1">
					<p className="font-medium text-sm">
						{title ?? (forbidden ? "No access" : "Couldn't load")}
					</p>
					<p className="mt-0.5 break-words text-muted-foreground text-sm">
						{message}
					</p>
					{requestId ? (
						<p className="mt-1 font-mono text-muted-foreground text-xs">
							Request ID: {requestId}
						</p>
					) : null}
				</div>
				{/**
				 * No retry on permission errors: the same session gets the same 403, and with a button
				 * operators press it several times before suspecting the cause.
				 */}
				{onRetry && !forbidden ? (
					<Button size="sm" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				) : null}
			</div>
		</div>
	);
}

/**
 * No value and not in progress. Without this state it was drawn as an endless skeleton or as
 * `Failed to fetch`, both of which suggest a slow or dead server when the request never reached it
 * and the operator should check their connection.
 *
 * `role="alert"` differs from the web's same state, which is quiet because it resumes when the
 * connection returns; here `networkMode: "always"` means nothing pauses and a person must retry.
 */
export function OfflineBlock({ onRetry }: { onRetry?: () => void }) {
	return (
		<div
			role="alert"
			className="rounded-lg border border-border bg-muted/30 p-4"
		>
			<div className="flex items-start gap-3">
				<WifiOff
					className="mt-0.5 size-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-sm">{UNREACHABLE_MESSAGE}</p>
					<p className="mt-0.5 text-muted-foreground text-sm">
						{UNREACHABLE_HINT}
					</p>
				</div>
				{onRetry ? (
					<Button size="sm" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				) : null}
			</div>
		</div>
	);
}

export function EmptyBlock({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-lg border border-border border-dashed px-6 py-10 text-center">
			<Inbox className="size-5 text-muted-foreground" aria-hidden />
			<p className="font-medium text-sm">{title}</p>
			{description ? (
				<p className="text-muted-foreground text-sm">{description}</p>
			) : null}
		</div>
	);
}

/** Sentences for the two kinds of staleness; the operator's next step differs (connection vs server). */
const STALE_MESSAGE: Record<Exclude<AdminQueryStaleness, "fresh">, string> = {
	offline: `${UNREACHABLE_MESSAGE} Below is the last confirmed value.`,
	failed: "Couldn't load the latest value. Below is the last confirmed value.",
};

/**
 * One line that keeps the value and only adds that it is stale.
 *
 * 1. The value is not covered: an error box would take away the number the operator was reading,
 *    which the server still confirmed.
 * 2. `role="status"`, not `alert`: a first failure with no value occupies the screen, but this
 *    happened in the background, and reading it with the same weight interrupts
 *    assistive-technology users each time a background refresh wobbles.
 * 3. No re-announcement per retry: the line stays mounted with an unchanged sentence while
 *    failure continues (TanStack Query keeps the error state until success), and live regions only
 *    re-read on content change, so repeated failures announce once.
 */
export function StaleNotice({
	staleness,
	onRetry,
}: {
	staleness: Exclude<AdminQueryStaleness, "fresh">;
	onRetry?: () => void;
}) {
	return (
		<div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
			<AlertTriangle
				className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
				aria-hidden
			/>
			{/*
			 * `<output>` is `role="status"` (implicit). It is a live region, so it must hold one
			 * sentence only: a button inside would be read with its name and repeat that noise on every
			 * background wobble.
			 */}
			<output className="min-w-0 flex-1 text-sm">
				{STALE_MESSAGE[staleness]}
			</output>
			{onRetry ? (
				<Button size="sm" variant="outline" onClick={onRetry}>
					Try again
				</Button>
			) : null}
		</div>
	);
}

/**
 * Folds one query's five states in order. `adminQueryView` owns the order; branching in components
 * lets screens diverge and one of them folds failure into empty.
 *
 * `isPending` rather than `isLoading` is intended: with a held value, a failed background refresh
 * still draws it, with one `StaleNotice` line on top.
 *
 * Requiring `AdminQuery` is the last defense: a plain `useQuery` result is rejected by the type, so
 * no screen can keep a `Try again` that does not retry (`lib/query/use-admin-query.ts`).
 */
export function QueryState<T>({
	query,
	empty,
	children,
	loadingRows,
}: {
	query: AdminQuery<T>;
	empty?: { title: string; description?: string; when: (data: T) => boolean };
	children: (data: T) => ReactNode;
	loadingRows?: number;
}) {
	const data = query.data;
	const view = adminQueryView({
		hasData: data !== undefined,
		isEmpty: data !== undefined && (empty?.when(data) ?? false),
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		unreachable: query.unreachable,
	});

	/**
	 * Takes over the screen only when there is no value. Splitting on `data === undefined` keeps the
	 * branches below standing only on the fact that a value exists; the pure function already chose
	 * the state.
	 */
	if (data === undefined) {
		if (view.state === "offline") return <OfflineBlock onRetry={query.retry} />;
		if (view.state === "error")
			return <ErrorBlock error={query.error} onRetry={query.retry} />;
		return <LoadingBlock rows={loadingRows} />;
	}

	return (
		<>
			{view.staleness === "fresh" ? null : (
				<StaleNotice staleness={view.staleness} onRetry={query.retry} />
			)}
			{view.state === "empty" && empty ? (
				<EmptyBlock title={empty.title} description={empty.description} />
			) : (
				children(data)
			)}
		</>
	);
}
