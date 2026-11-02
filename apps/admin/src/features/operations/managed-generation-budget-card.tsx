import { adminManagedGenerationBudgetQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@rowcat/ui-web/components/card";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";
import { managedGenerationBudgetView } from "./managed-generation-budget-view.ts";

/**
 * The instance ceilings on the operator's key. Staff and admin both read it, like the switches: during
 * an incident "is the budget spent or is Redis down" is the first question, and either role may be
 * the one answering. It reads only; the numbers are set in the deployment's environment
 * (`MANAGED_GENERATION_*`), not here, so there is nothing to edit and no form.
 */
export function ManagedGenerationBudgetCard() {
	const budgetQuery = useAdminQuery(
		adminManagedGenerationBudgetQueryOptions(getRowCatClient()),
	);
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-3">
				<CardTitle className="text-sm">Default AI — operator key</CardTitle>
				{budgetQuery.data ? (
					managedGenerationBudgetView(budgetQuery.data).open ? (
						<Badge variant="secondary">Accepting</Badge>
					) : (
						<Badge variant="destructive">Refusing</Badge>
					)
				) : null}
			</CardHeader>
			<CardContent>
				<QueryState query={budgetQuery} loadingRows={6}>
					{(data) => {
						const view = managedGenerationBudgetView(data);
						return (
							<div className="space-y-3">
								{view.blockers.length > 0 ? (
									<ul className="space-y-1 rounded-lg border border-destructive/40 p-3 text-sm">
										{view.blockers.map((sentence) => (
											<li key={sentence}>{sentence}</li>
										))}
									</ul>
								) : null}
								<dl className="divide-y divide-border">
									{view.rows.map((row) => (
										<div
											key={row.label}
											className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
										>
											<dt className="text-muted-foreground text-sm">
												{row.label}
											</dt>
											<dd className="text-sm tabular-nums">{row.value}</dd>
										</div>
									))}
								</dl>
							</div>
						);
					}}
				</QueryState>
			</CardContent>
		</Card>
	);
}
