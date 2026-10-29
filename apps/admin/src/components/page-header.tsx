import type { ReactNode } from "react";

/**
 * Screen header; the canvas owns the title. The shell header draws none, for the same reason as the
 * web app: screens registering a title through an effect bring a title one frame late and the
 * previous screen's title during navigation. Each screen draws its own `h1`.
 */
export function PageHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: string;
	/** Screen-wide actions; per-row actions live in the table. */
	actions?: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0">
				<h1 className="font-semibold text-lg">{title}</h1>
				{description ? (
					<p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex items-center gap-2">{actions}</div>
			) : null}
		</div>
	);
}
