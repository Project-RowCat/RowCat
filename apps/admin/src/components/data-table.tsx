import { cn } from "@rowcat/ui-web/lib/utils";
import type { ReactNode } from "react";

/**
 * The table is this app's dominant surface. It is a component for consistency, not reuse:
 * hand-written `<table>`s drift in alignment, spacing and header contrast, and operators scan
 * tables constantly.
 *
 * - Horizontal scroll lives on the wrapper, not the page; otherwise one wide table pushes the
 *   whole page (sidebar and header included) sideways in a narrow desktop window.
 * - There is no sort UI. Order is server-defined per list (reports oldest first, members and
 *   works newest first), and changing it would also change the cursor pagination's sort key.
 */

export interface Column<T> {
	key: string;
	header: ReactNode;
	/** Right-aligned with tabular digits. */
	numeric?: boolean;
	/** Hidden below this breakpoint; give the least important columns the widest breakpoint. */
	hideBelow?: "sm" | "md" | "lg";
	/**
	 * Clips with an ellipsis. `truncate` alone does nothing in a table cell: auto layout widens the
	 * column to its longest content, so without a cap one 90-character display name collapsed the
	 * whole table.
	 */
	truncate?: boolean;
	className?: string;
	render: (row: T) => ReactNode;
}

const HIDE_CLASS = {
	sm: "hidden sm:table-cell",
	md: "hidden md:table-cell",
	lg: "hidden lg:table-cell",
} as const;

export function DataTable<T>({
	columns,
	rows,
	rowKey,
	onRowClick,
	caption,
}: {
	columns: Column<T>[];
	rows: T[];
	rowKey: (row: T) => string;
	/** Makes the whole row pressable. */
	onRowClick?: (row: T) => void;
	caption?: string;
}) {
	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="w-full border-collapse text-sm">
				{caption ? <caption className="sr-only">{caption}</caption> : null}
				<thead>
					<tr className="border-border border-b bg-muted/40">
						{columns.map((column) => (
							<th
								key={column.key}
								scope="col"
								className={cn(
									"whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground text-xs",
									column.numeric && "text-right",
									column.hideBelow && HIDE_CLASS[column.hideBelow],
									column.className,
								)}
							>
								{column.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={rowKey(row)}
							className={cn(
								"border-border/60 border-b last:border-0",
								onRowClick &&
									"cursor-pointer hover:bg-muted/40 focus-within:bg-muted/40",
							)}
							{...(onRowClick
								? {
										onClick: () => onRowClick(row),
										/**
										 * Keyboard access via `tabIndex` and Enter/Space rather than `role="button"` on the
										 * `<tr>`, which would drop the table semantics and make screen readers read it as a list.
										 */
										tabIndex: 0,
										onKeyDown: (event: React.KeyboardEvent) => {
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											onRowClick(row);
										},
									}
								: {})}
						>
							{columns.map((column) => (
								<td
									key={column.key}
									className={cn(
										/**
										 * No wrapping by default: one short value breaking onto two lines makes that row taller
										 * and breaks the scanning rhythm (`10 hours ago` once split into `10 hours / ago`). Only `truncate`
										 * columns get a cap and an ellipsis.
										 */
										"whitespace-nowrap px-3 py-2 align-middle",
										column.truncate && "max-w-[18rem] overflow-hidden",
										column.numeric && "tabular text-right",
										column.hideBelow && HIDE_CLASS[column.hideBelow],
										column.className,
									)}
								>
									{column.render(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
