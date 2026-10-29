import { buttonVariants } from "@rowcat/ui-web/components/button";
import { cn } from "@rowcat/ui-web/lib/utils";
import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { runtimeDocsCopy } from "./runtime-docs-copy.ts";

/**
 * A single entry link from the authoring surfaces to the public docs.
 *
 * Four places show it: the intro section before the runtime is enabled, the template gallery, the
 * studio header, and the preview's empty state. If each wrote its own `<Link to="/docs/runtime">`,
 * one would forget the new tab or use another word, and nothing would error. The word, icon and
 * new-tab decision is made once, here.
 *
 * It opens in a new tab. Every place it appears is a workspace (editor, gallery, studio). Leaving
 * for the docs would lose the template being chosen, open tabs and the preview session. The docs
 * are a public route that needs no session or draft, so they open directly in the new tab.
 */
export function RuntimeDocsEntryLink({
	slug = "",
	label = runtimeDocsCopy().entry,
	variant = "text",
	className,
}: {
	/**
	 * For jumping straight to a non-root doc (e.g. `preview-and-publish`). The destination is
	 * guaranteed by the generated output.
	 */
	slug?: string;
	label?: string;
	/** `text` is a link inside a sentence; `icon` is an icon button in a header. */
	variant?: "text" | "icon";
	className?: string;
}) {
	const shared = {
		target: "_blank",
		rel: "noopener noreferrer",
	} as const;
	const content =
		variant === "icon" ? (
			<BookOpen aria-hidden="true" className="size-4" />
		) : (
			<>
				<BookOpen aria-hidden="true" className="size-3.5" />
				{label}
			</>
		);
	const linkClass =
		variant === "icon"
			? cn(
					buttonVariants({ variant: "ghost", size: "icon" }),
					"size-8",
					className,
				)
			: cn(
					"inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
					className,
				);
	const a11y = variant === "icon" ? { "aria-label": label, title: label } : {};
	if (slug.length === 0)
		return (
			<Link to="/docs/runtime" className={linkClass} {...shared} {...a11y}>
				{content}
			</Link>
		);
	return (
		<Link
			to="/docs/runtime/$"
			params={{ _splat: slug }}
			className={linkClass}
			{...shared}
			{...a11y}
		>
			{content}
		</Link>
	);
}
