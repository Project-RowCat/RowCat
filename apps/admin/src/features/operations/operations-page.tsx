import {
	type AppPlatform,
	type AppUpdateBroadcastStatusDto,
	type AppVersionFloorDto,
	FEATURE_FLAGS,
	type FeatureFlagDto,
	type FeatureFlagState,
	featureFlagDefinition,
} from "@rowcat/contracts";
import {
	adminAppUpdateBroadcastStatusesQueryOptions,
	adminAppVersionFloorsQueryOptions,
	adminBroadcastAppUpdateMutationOptions,
	adminFeatureFlagsQueryOptions,
	adminSetAppVersionFloorMutationOptions,
	adminSetFeatureFlagMutationOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@rowcat/ui-web/components/card";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useId, useState } from "react";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDateTime } from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { canAdminister } from "#/lib/operator.ts";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";

/**
 * Operational settings: breakers and minimum app versions.
 *
 * The screen keeps no list of its own. Rows come from the server, which walks the `FEATURE_FLAGS`
 * registry in `@rowcat/contracts`, and descriptions come from that registry too
 * (`featureFlagDefinition`). A second list here would miss a newly added key, and the symptom — the
 * switch missing from this screen — appears exactly when someone needs to turn it off.
 *
 * ⚠️ The minimum version is the most dangerous control here. A floor at a version not in the store
 * locks every mobile user out of the app, and that cannot be undone until store review completes
 * (the locked app cannot announce anything). The server cannot know what is in the store, so what
 * stands in the way is this screen's explicit confirmation, which is why the warning is a sentence
 * inside the confirm dialog.
 */

const STATE_LABEL: Record<FeatureFlagState, string> = {
	default: "Default",
	on: "On",
	off: "Off",
};

function FlagRow({
	flag,
	canEdit,
	onChange,
}: {
	flag: FeatureFlagDto;
	canEdit: boolean;
	onChange: (state: FeatureFlagState) => void;
}) {
	const definition = featureFlagDefinition(flag.key);
	return (
		<div className="flex flex-wrap items-start gap-3 border-border border-b py-3 last:border-0">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="font-medium text-sm">{definition.label}</p>
					<Badge variant={flag.enabled ? "secondary" : "destructive"}>
						{flag.enabled ? "Running" : "Blocked"}
					</Badge>
					{flag.state !== "default" ? (
						<Badge variant="outline">{STATE_LABEL[flag.state]}</Badge>
					) : null}
				</div>
				<p className="mt-0.5 text-muted-foreground text-sm">
					{definition.description}
				</p>
				{flag.message ? (
					<p className="mt-1 text-muted-foreground text-xs">
						User-facing message: {flag.message}
					</p>
				) : null}
				{flag.updatedAt ? (
					<p className="mt-1 text-muted-foreground text-xs">
						Last changed {formatDateTime(flag.updatedAt)}
					</p>
				) : null}
			</div>
			{canEdit ? (
				<div className="flex gap-1">
					{(["default", "on", "off"] as const).map((state) => (
						<Button
							key={state}
							size="xs"
							variant={
								flag.state === state
									? state === "off"
										? "destructive"
										: "default"
									: "outline"
							}
							/**
							 * Pressing the current state does nothing, so no confirm dialog opens.
							 */
							disabled={flag.state === state}
							onClick={() => onChange(state)}
						>
							{STATE_LABEL[state]}
						</Button>
					))}
				</div>
			) : null}
		</div>
	);
}

function VersionFloorRow({
	floor,
	canEdit,
	onSubmit,
}: {
	floor: AppVersionFloorDto;
	canEdit: boolean;
	onSubmit: (minVersion: string | null) => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState(floor.minVersion ?? "");

	const valid = draft === "" || /^\d+\.\d+\.\d+$/.test(draft);

	return (
		<div className="flex flex-wrap items-end gap-3 border-border border-b py-3 last:border-0">
			<div className="min-w-0 flex-1 space-y-1">
				<Label htmlFor={id} className="font-medium text-sm">
					{floor.platform}
				</Label>
				<p className="text-muted-foreground text-xs">
					{floor.minVersion
						? `Versions below ${floor.minVersion} are asked to update.`
						: "No floor: every version passes."}
					{floor.updatedAt
						? ` · Last changed ${formatDateTime(floor.updatedAt)}`
						: null}
				</p>
			</div>
			{canEdit ? (
				<div className="flex items-end gap-2">
					<Input
						id={id}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="1.2.0 (empty for no floor)"
						className="h-8 w-48"
						aria-invalid={!valid}
					/>
					<Button
						size="sm"
						disabled={!valid || draft === (floor.minVersion ?? "")}
						onClick={() => onSubmit(draft === "" ? null : draft)}
					>
						Apply
					</Button>
				</div>
			) : null}
		</div>
	);
}

/**
 * The announcement row is kept apart from the floor row. Changing the floor changes the server's
 * decision (older apps lock from that moment); this row only announces it. Merged into one button,
 * every floor-adjustment mistake would leave an irreversible row in every member's inbox — and
 * rolling the floor back to the same version reuses the idempotency key, so no correction goes out.
 */
function AppUpdateNoticeRow({
	status,
	canEdit,
	onBroadcast,
}: {
	status: AppUpdateBroadcastStatusDto;
	canEdit: boolean;
	onBroadcast: () => void;
}) {
	return (
		<div className="flex flex-wrap items-end gap-3 border-border border-b py-3 last:border-0">
			<div className="min-w-0 flex-1 space-y-1">
				<p className="font-medium text-sm">{status.platform}</p>
				{status.minVersion ? (
					<p className="text-muted-foreground text-xs">
						{status.minVersion} notice: {status.notifiedRecipients}/
						{status.totalRecipients} members
						{status.lastNotifiedAt
							? ` · Last sent ${formatDateTime(status.lastNotifiedAt)}`
							: " · Not sent yet"}
					</p>
				) : (
					/**
					 * No disabled button: with no floor there is nothing to announce, and an unpressable button
					 * reads as "coming soon" when the thing to do is set the floor above.
					 */
					<p className="text-muted-foreground text-xs">
						There is no floor, so there is nothing to announce. Set a floor
						above to be able to announce it.
					</p>
				)}
			</div>
			{canEdit && status.minVersion ? (
				<Button size="sm" variant="outline" onClick={onBroadcast}>
					{status.broadcastComplete ? "Send again" : "Send notice"}
				</Button>
			) : null}
		</div>
	);
}

export function OperationsPage() {
	const client = getRowCatClient();
	const queryClient = useQueryClient();
	const viewerQuery = useAdminQuery(viewerQueryOptions(client));
	const canEdit = canAdminister(viewerQuery.data);

	const flagsQuery = useAdminQuery(adminFeatureFlagsQueryOptions(client));
	const floorsQuery = useAdminQuery(adminAppVersionFloorsQueryOptions(client));

	const setFlag = useMutation(
		adminSetFeatureFlagMutationOptions(client, queryClient),
	);
	const setFloor = useMutation(
		adminSetAppVersionFloorMutationOptions(client, queryClient),
	);
	/**
	 * A separate query from the floors, so failures are independent: the floor stays editable when
	 * announcement status cannot be read, and vice versa.
	 */
	const noticeQuery = useAdminQuery(
		adminAppUpdateBroadcastStatusesQueryOptions(client),
	);
	const broadcast = useMutation(
		adminBroadcastAppUpdateMutationOptions(client, queryClient),
	);

	const [flagChange, setFlagChange] = useState<{
		flag: FeatureFlagDto;
		next: FeatureFlagState;
	} | null>(null);
	const [floorChange, setFloorChange] = useState<{
		platform: AppPlatform;
		minVersion: string | null;
		previous: string | null;
	} | null>(null);
	const [noticeSend, setNoticeSend] =
		useState<AppUpdateBroadcastStatusDto | null>(null);
	return (
		<PageEnter className="space-y-5">
			<PageHeader
				title="Operations"
				description="Features turned off here are really refused by the server: this is not hiding them on screen."
			/>

			{!canEdit ? (
				<p className="rounded-lg border border-border border-dashed p-3 text-muted-foreground text-sm">
					Changes require the admin role. You can read the current state.
				</p>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Feature switches</CardTitle>
				</CardHeader>
				<CardContent>
					<QueryState query={flagsQuery} loadingRows={5}>
						{(data) => (
							<div>
								{/**
								 * Keep the server's order; it is the registry's, and re-sorting
								 * here would create a second order.
								 */}
								{data.items.map((flag) => (
									<FlagRow
										key={flag.key}
										flag={flag}
										canEdit={canEdit}
										onChange={(next) => setFlagChange({ flag, next })}
									/>
								))}
							</div>
						)}
					</QueryState>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">
						Minimum supported app version
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
						<AlertTriangle
							className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
							aria-hidden
						/>
						<p className="text-sm">
							Setting the floor to a version not yet in the store locks every
							mobile user out of the app. That state can't be undone until store
							review completes: the app is already locked, so nothing can be
							announced through it.
						</p>
					</div>
					<QueryState query={floorsQuery} loadingRows={2}>
						{(data) => (
							<div>
								{data.items.map((floor) => (
									<VersionFloorRow
										key={floor.platform}
										floor={floor}
										canEdit={canEdit}
										onSubmit={(minVersion) =>
											setFloorChange({
												platform: floor.platform,
												minVersion,
												previous: floor.minVersion,
											})
										}
									/>
								))}
							</div>
						)}
					</QueryState>
					<p className="text-muted-foreground text-xs">
						The web is not in this table: one refresh makes it the latest code,
						so the concept of a floor doesn't exist, and with a row present
						someone would eventually fill it and lock web users out.
					</p>

					<div className="space-y-3 border-border border-t pt-4">
						<div className="space-y-1">
							<p className="font-medium text-sm">Update notice</p>
							<p className="text-muted-foreground text-xs">
								Announces the current floor to every member's notification
								inbox. Setting the floor and announcing it are separate, so
								until you send here nobody is notified. No mail goes out.
							</p>
						</div>
						<QueryState query={noticeQuery} loadingRows={2}>
							{(data) => (
								<div>
									{data.items.map((status) => (
										<AppUpdateNoticeRow
											key={status.platform}
											status={status}
											canEdit={canEdit}
											onBroadcast={() => setNoticeSend(status)}
										/>
									))}
								</div>
							)}
						</QueryState>
						<p className="text-muted-foreground text-xs">
							The server doesn't know which members use the app: it doesn't
							record that axis. So the notice reaches members who use only the
							web too.
						</p>
					</div>
				</CardContent>
			</Card>

			<ConfirmDialog
				open={flagChange !== null}
				onOpenChange={(open) => {
					if (!open) {
						setFlagChange(null);
						setFlag.reset();
					}
				}}
				title={
					flagChange
						? `${featureFlagDefinition(flagChange.flag.key).label} — ${STATE_LABEL[flagChange.next]}`
						: ""
				}
				target={flagChange ? `Feature switch ${flagChange.flag.key}` : null}
				consequence={
					flagChange ? (
						<div className="space-y-2">
							<p>{featureFlagDefinition(flagChange.flag.key).description}</p>
							<p className="text-muted-foreground">
								Now {flagChange.flag.enabled ? "running" : "blocked"} →{" "}
								{flagChange.next === "default"
									? `default (${
											FEATURE_FLAGS.find((f) => f.key === flagChange.flag.key)
												?.defaultState === "on"
												? "running"
												: "blocked"
										})`
									: flagChange.next === "on"
										? "running"
										: "blocked"}
							</p>
							<p className="text-muted-foreground">
								Changes apply immediately. With several servers running, all
								follow within 5 seconds at most.
							</p>
						</div>
					) : null
				}
				confirmLabel="Apply"
				requireReason
				reasonLabel="Reason for the change"
				reasonPlaceholder="e.g. upstream provider outage · spam surge"
				destructive={flagChange?.next === "off"}
				pending={setFlag.isPending}
				error={setFlag.error}
				onConfirm={(reason) => {
					if (!flagChange) return;
					setFlag.mutate(
						{
							key: flagChange.flag.key,
							request: {
								state: flagChange.next,
								/** Keep the current description; this only changes the state. */
								message: flagChange.flag.message,
								reason,
							},
						},
						{ onSuccess: () => setFlagChange(null) },
					);
				}}
			/>

			<ConfirmDialog
				open={floorChange !== null}
				onOpenChange={(open) => {
					if (!open) {
						setFloorChange(null);
						setFloor.reset();
					}
				}}
				title="Change minimum app version"
				target={
					floorChange ? (
						<>
							Platform {floorChange.platform}
							<br />
							{floorChange.previous ?? "No floor"} →{" "}
							{floorChange.minVersion ?? "No floor"}
						</>
					) : null
				}
				consequence={
					floorChange?.minVersion ? (
						<div className="space-y-2">
							<p className="font-medium text-destructive">
								Every user of the {floorChange.platform} app below{" "}
								{floorChange.minVersion}
								is trapped on the update screen.
							</p>
							<p>
								First check that this version is really in the store and has
								passed review. If it isn't, those users can't update, and
								nothing can be announced through the app.
							</p>
						</div>
					) : (
						<p>Removes the floor. Every version passes.</p>
					)
				}
				confirmLabel="Apply"
				requireReason
				reasonLabel="Reason for the change"
				reasonPlaceholder="e.g. forcing out a sign-in defect fix"
				destructive={floorChange?.minVersion !== null}
				pending={setFloor.isPending}
				error={setFloor.error}
				onConfirm={(reason) => {
					if (!floorChange) return;
					setFloor.mutate(
						{
							platform: floorChange.platform,
							request: {
								minVersion: floorChange.minVersion,
								message: "",
								reason,
							},
						},
						{ onSuccess: () => setFloorChange(null) },
					);
				}}
			/>

			<ConfirmDialog
				open={noticeSend !== null}
				onOpenChange={(open) => {
					if (!open) {
						setNoticeSend(null);
						broadcast.reset();
					}
				}}
				title="Send app update notice"
				target={
					noticeSend ? (
						<>
							Platform {noticeSend.platform}
							<br />
							End of support below {noticeSend.minVersion}
						</>
					) : null
				}
				consequence={
					noticeSend ? (
						<div className="space-y-2">
							<p>
								One row appears in the notification inbox of all{" "}
								{noticeSend.totalRecipients} current members. Nothing happens
								for the {noticeSend.notifiedRecipients}
								who already received it: rerunning makes no rows and doesn't
								turn already read notices back to unread.
							</p>
							<p className="text-muted-foreground">
								Sent rows can't be deleted. No correction notice can go out for
								the same version either (the idempotency key is the version).
							</p>
							<p className="text-muted-foreground">
								No mail goes out, and this operation doesn't change the floor.
							</p>
						</div>
					) : null
				}
				confirmLabel="Send"
				requireReason
				reasonLabel="Reason for sending"
				reasonPlaceholder="e.g. announcing a forced sign-in defect fix"
				pending={broadcast.isPending}
				error={broadcast.error}
				onConfirm={(reason) => {
					if (!noticeSend) return;
					broadcast.mutate(
						{ platform: noticeSend.platform, request: { reason } },
						{ onSuccess: () => setNoticeSend(null) },
					);
				}}
			/>
		</PageEnter>
	);
}
