import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Link between docs. Maps to the router's `Link`, not a plain `<a>`.
 *
 * In markdown, `[…](/docs/runtime/concepts/state#anchor)` becomes this component. With a plain
 * `<a>`, every move between docs reloads the whole document, and the shell (sidebar and header)
 * disappears and returns in between. The root and the other pages are separate routes, which is why
 * `to` differs.
 */
export function RuntimeDocLink({
	slug,
	hash,
	className,
	children,
	onNavigate,
	current,
}: {
	slug: string;
	hash?: string;
	className?: string;
	children: ReactNode;
	onNavigate?: () => void;
	/**
	 * `current` is set when the navigation list is showing the current doc. Links inside the body do
	 * not pass it.
	 */
	current?: boolean;
}) {
	const shared = {
		className,
		onClick: onNavigate,
		/**
		 * Active only on an exact match. The default compares against the current path prefix, so the
		 * root (`/docs/runtime`) would be active on every doc, and `reference` on every reference page.
		 * The table of contents would then show two `aria-current` values (verified in the browser).
		 */
		activeOptions: { exact: true },
		"aria-current": current ? ("page" as const) : undefined,
		...(hash === undefined ? {} : { hash }),
	};
	if (slug.length === 0)
		return (
			<Link to="/docs/runtime" {...shared}>
				{children}
			</Link>
		);
	return (
		<Link to="/docs/runtime/$" params={{ _splat: slug }} {...shared}>
			{children}
		</Link>
	);
}
