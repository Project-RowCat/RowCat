import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@rowcat/ui-web/components/dialog";
import { BookOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Canvas } from "#/components/app-shell/canvas.tsx";
import { RuntimeDocLink } from "./runtime-doc-link.tsx";
import { runtimeDocsCopy } from "./runtime-docs-copy.ts";
import { runtimeDocNav } from "./runtime-docs-nav.ts";

/**
 * Shell of the docs screen: table of contents on the left, body on the right.
 * - Sits inside the app shell. Sidebar and header stay (`section: null`, `utility: null`,
 *   public docs). If the docs drew their own header, the brand would appear twice, and the header
 *   is also where readers return to the app. This component adds only movement between docs; it is a
 *   column because there are more than twenty docs.
 * - On narrow screens it is a drawer. A table of contents that always takes width would make the
 *   body unreadable. It uses the same container as the app's main navigation drawer (`Dialog
 *   placement="left"`); two drawers that open and close differently would teach users two
 *   conventions.
 * - The table of contents derives from one movement model. The wide column and the drawer both
 *   render `DocsNav`, whose list comes from `runtime-docs-nav.ts`. Doc names are not typed here.
 */
export function RuntimeDocsShell({
	activeSlug,
	children,
}: {
	activeSlug: string;
	children: ReactNode;
}) {
	return (
		<Canvas>
			<div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
				<aside className="hidden lg:block">
					{/*
					 * Attaches below the header. While reading a long doc, if the table of contents scrolled with
					 * the page, the links to other docs would leave the viewport.
					 */}
					<div className="sticky top-[calc(var(--shell-header)+1.5rem)] max-h-[calc(100dvh-var(--shell-header)-3rem)] overflow-y-auto pr-2">
						<DocsNav activeSlug={activeSlug} />
					</div>
				</aside>
				<div className="min-w-0">
					<div className="mb-5 lg:hidden">
						<DocsNavSheet activeSlug={activeSlug} />
					</div>
					{children}
				</div>
			</div>
		</Canvas>
	);
}

const NAV_LINK =
	"block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground";

function DocsNav({
	activeSlug,
	onNavigate,
}: {
	activeSlug: string;
	onNavigate?: () => void;
}) {
	const sections = runtimeDocNav();
	return (
		<nav
			aria-label={runtimeDocsCopy().navLabel}
			className="flex flex-col gap-6"
		>
			<RuntimeDocLink
				slug=""
				className="flex items-center gap-2 px-2 text-sm font-semibold text-foreground"
				onNavigate={onNavigate}
			>
				<BookOpen aria-hidden="true" className="size-4" />
				{runtimeDocsCopy().title}
			</RuntimeDocLink>
			{sections.map((section) => (
				<div key={section.group.id}>
					<h2 className="mb-1.5 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{section.group.label}
					</h2>
					<ul className="flex flex-col">
						{section.entries.map((entry) => (
							<li key={entry.slug}>
								<RuntimeDocLink
									slug={entry.slug}
									className={NAV_LINK}
									current={entry.slug === activeSlug}
									onNavigate={onNavigate}
								>
									{entry.title}
								</RuntimeDocLink>
							</li>
						))}
					</ul>
				</div>
			))}
		</nav>
	);
}

function DocsNavSheet({ activeSlug }: { activeSlug: string }) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						aria-label={runtimeDocsCopy().openNav}
					/>
				}
			>
				<BookOpen aria-hidden="true" />
				{runtimeDocsCopy().navLabel}
			</DialogTrigger>
			<DialogContent
				showCloseButton={false}
				placement="left"
				className="top-0 left-0 flex h-dvh w-72 max-w-[85vw] flex-col gap-0 rounded-none rounded-r-xl p-0 sm:max-w-[20rem]"
			>
				<DialogTitle className="sr-only">
					{runtimeDocsCopy().navLabel}
				</DialogTitle>
				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
					<DocsNav activeSlug={activeSlug} onNavigate={() => setOpen(false)} />
				</div>
			</DialogContent>
		</Dialog>
	);
}
