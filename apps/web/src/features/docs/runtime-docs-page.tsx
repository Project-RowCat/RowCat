import { ArrowLeft, ArrowRight } from "lucide-react";
import type { RuntimeDocEntry } from "#/generated/runtime-docs.ts";
import { RUNTIME_DOC_BODIES } from "#/generated/runtime-docs-content.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { RUNTIME_BETA } from "#/lib/runtime-beta.ts";
import { RuntimeDocLink } from "./runtime-doc-link.tsx";
import { runtimeDocsCopy } from "./runtime-docs-copy.ts";
import { RuntimeDocsMarkdown } from "./runtime-docs-markdown.tsx";
import {
	runtimeDocGroupLabel,
	runtimeDocNeighbors,
} from "./runtime-docs-nav.ts";
import { RuntimeDocsShell } from "./runtime-docs-shell.tsx";

/**
 * One doc page. `/docs/runtime` and `/docs/runtime/$` render the same component.
 *
 * The route reads only the manifest (`runtime-docs.ts`). The full bodies
 * (`runtime-docs-content.ts`) are imported by this component. Route components are code-split, so
 * people who never open a doc do not download the body bytes. Importing the bodies in the route
 * file would pull them into the app's main bundle through the route tree.
 *
 * There is no loader, viewer lookup or guard. The docs are public: they must be readable without a runtime-enabled draft or a login. The body's h1 comes
 * from the markdown itself.
 */
export function RuntimeDocPage({ entry }: { entry: RuntimeDocEntry }) {
	const body = RUNTIME_DOC_BODIES[entry.slug] ?? "";
	const { previous, next } = runtimeDocNeighbors(entry.slug);
	return (
		<RuntimeDocsShell activeSlug={entry.slug}>
			<PageEnter>
				<article className="mx-auto w-full max-w-3xl">
					<p className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
						<span>
							{runtimeDocsCopy().title} · {runtimeDocGroupLabel(entry.group)}
						</span>
						{/*
						 * The status badge appears only on the first page. On all twenty-five pages it would stop being
						 * read after the fourth, and it would repeat a provisional note on every API page. What is
						 * provisional is this product's stage, not the signature of `useStoryState`.
						 */}
						{entry.slug === "" && (
							<span className="rounded-full border border-border px-1.5 py-px normal-case">
								<span className="sr-only">{RUNTIME_BETA.srPrefix}</span>
								{RUNTIME_BETA.label}
							</span>
						)}
					</p>
					<RuntimeDocsMarkdown body={body} />
					{/*
					 * The compatibility promise line appears only on the badge's page. The badge states the status;
					 * this line says what that status means for creators. If the two diverge, the badge becomes
					 * meaningless.
					 *
					 * It lives here, not in the markdown body, because the source must be single: written in the
					 * doc, the studio badge and this sentence would become two values that could be updated
					 * separately.
					 */}
					{entry.slug === "" && (
						<p className="mt-10 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
							{RUNTIME_BETA.promise}
						</p>
					)}
					<nav
						aria-label={runtimeDocsCopy().pagerLabel}
						className="mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2"
					>
						{previous !== null ? (
							<RuntimeDocLink
								slug={previous.slug}
								className="group flex flex-col gap-1 rounded-lg border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							>
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<ArrowLeft aria-hidden="true" className="size-3.5" />
									{runtimeDocsCopy().previous}
								</span>
								<span className="text-sm font-medium">{previous.title}</span>
							</RuntimeDocLink>
						) : (
							<span aria-hidden="true" />
						)}
						{next !== null && (
							<RuntimeDocLink
								slug={next.slug}
								className="group flex flex-col items-end gap-1 rounded-lg border bg-card p-4 text-right transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							>
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									{runtimeDocsCopy().next}
									<ArrowRight aria-hidden="true" className="size-3.5" />
								</span>
								<span className="text-sm font-medium">{next.title}</span>
							</RuntimeDocLink>
						)}
					</nav>
				</article>
			</PageEnter>
		</RuntimeDocsShell>
	);
}
