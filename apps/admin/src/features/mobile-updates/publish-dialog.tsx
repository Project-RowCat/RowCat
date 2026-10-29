import {
	type AdminMobileUpdateJobsConfigDto,
	MOBILE_UPDATE_REASON_MAX_LENGTH,
	type MobileUpdateChannel,
	type MobileUpdatePlatform,
	type MobileUpdateSourceBranch,
	MobileUpdatePlatform as PlatformSchema,
} from "@rowcat/contracts";
import { updateNotesFor } from "@rowcat/domain";
import { adminMobileUpdatePublishMutationOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { Textarea } from "@rowcat/ui-web/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { FilterSelect } from "#/components/filter-bar.tsx";
import { ErrorBlock } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import {
	CHANNEL_LABEL,
	initialRolloutChoices,
	PLATFORM_LABEL,
	type PublishDraft,
	publishRequestOf,
} from "./mobile-update-view.ts";

/**
 * New OTA release — a form that requests an intent, not an uploader.
 *
 * Only channel, platform, source (an allowed branch or a 40-char commit), initial rollout, update
 * note and reason are choosable. Runtime generation and API origin come from the repository CI
 * checks out and the channel's environment; a field for them would eventually get "fixed" by
 * someone.
 *
 * The note list is the one bundled when this console was built, so a newer commit's note may be
 * missing; hence a free date field. CI checks that note against that commit's registry (the job
 * stops at the `Update note` stage otherwise).
 */

const OTHER_NOTE = "__other";

const emptyDraft = (channel: MobileUpdateChannel | ""): PublishDraft => ({
	channel,
	platform: "",
	sourceKind: "branch",
	branch: "main",
	commit: "",
	rollout: "draft",
	note: "",
	reason: "",
});

export function PublishDialog({
	open,
	onOpenChange,
	config,
	onRequested,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	config: AdminMobileUpdateJobsConfigDto;
	onRequested: (jobId: string) => void;
}) {
	const commitId = useId();
	const noteId = useId();
	const reasonId = useId();
	const queryClient = useQueryClient();
	const publish = useMutation(
		adminMobileUpdatePublishMutationOptions(getRowCatClient(), queryClient),
	);
	const onlyChannel = config.channels.length === 1 ? config.channels[0] : "";
	const [draft, setDraft] = useState<PublishDraft>(() =>
		emptyDraft(onlyChannel ?? ""),
	);
	const [noteChoice, setNoteChoice] = useState("");
	const [submitted, setSubmitted] = useState(false);

	/** Cleared on every open so a previous reason never lands in the next request's audit record. */
	useEffect(() => {
		if (!open) return;
		setDraft(emptyDraft(onlyChannel ?? ""));
		setNoteChoice("");
		setSubmitted(false);
		publish.reset();
	}, [open, onlyChannel, publish.reset]);

	const notes = updateNotesFor("mobile");
	const noteOptions = [
		{ value: "", label: "Choose" },
		...notes.map((note) => ({ value: note.id, label: note.title })),
		{ value: "none", label: "None: no note covers this release" },
		{ value: OTHER_NOTE, label: "Enter the date directly" },
	];

	const patch = (next: Partial<PublishDraft>) =>
		setDraft((previous) => {
			const merged = { ...previous, ...next };
			/** Falls back to draft when the new channel does not offer the current rollout (production is draft only). */
			if (
				!initialRolloutChoices(merged.channel).some(
					(choice) => choice.value === merged.rollout,
				)
			)
				merged.rollout = "draft";
			return merged;
		});

	const { request, issues } = publishRequestOf(draft);
	const shown = submitted ? issues : {};

	const submit = () => {
		setSubmitted(true);
		if (!request) return;
		publish.mutate(request, { onSuccess: (job) => onRequested(job.id) });
	};

	const production = draft.channel === "production";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (publish.isPending) return;
				onOpenChange(next);
			}}
		>
			<DialogContent
				closeButtonDisabled={publish.isPending}
				className="sm:max-w-xl"
			>
				<DialogHeader>
					<DialogTitle>New OTA release</DialogTitle>
					<DialogDescription>
						CI checks out the chosen commit, then checks, exports, signs and
						registers it. This window uploads no code.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-3 sm:grid-cols-2">
					<div>
						<FilterSelect
							label="Channel"
							value={draft.channel}
							options={[
								{ value: "", label: "Choose" },
								...config.channels.map((value) => ({
									value,
									label: CHANNEL_LABEL[value],
								})),
							]}
							onChange={(value) =>
								patch({ channel: value as MobileUpdateChannel })
							}
						/>
						{shown.channel ? (
							<p className="mt-1 text-destructive text-xs">{shown.channel}</p>
						) : null}
					</div>
					<div>
						<FilterSelect
							label="Platform"
							value={draft.platform}
							options={[
								{ value: "", label: "Choose" },
								...PlatformSchema.options.map((value) => ({
									value,
									label: PLATFORM_LABEL[value],
								})),
							]}
							onChange={(value) =>
								patch({ platform: value as MobileUpdatePlatform })
							}
						/>
						{shown.platform ? (
							<p className="mt-1 text-destructive text-xs">{shown.platform}</p>
						) : null}
					</div>
					<FilterSelect
						label="Source"
						value={
							draft.sourceKind === "branch"
								? `branch:${draft.branch}`
								: "commit"
						}
						options={[
							...config.sourceBranches.map((branch) => ({
								value: `branch:${branch}`,
								label: `Head of the ${branch} branch`,
							})),
							{ value: "commit", label: "Specify a commit" },
						]}
						onChange={(value) =>
							value === "commit"
								? patch({ sourceKind: "commit" })
								: patch({
										sourceKind: "branch",
										branch: value.slice(
											"branch:".length,
										) as MobileUpdateSourceBranch,
									})
						}
					/>
					<FilterSelect
						label="Initial percentage"
						value={draft.rollout}
						options={initialRolloutChoices(draft.channel)}
						onChange={(value) => patch({ rollout: value })}
					/>
				</div>

				{draft.sourceKind === "commit" ? (
					<div className="space-y-1.5">
						<Label htmlFor={commitId}>Commit (40 characters)</Label>
						<Input
							id={commitId}
							value={draft.commit}
							onChange={(event) => patch({ commit: event.target.value })}
							placeholder="0123456789abcdef0123456789abcdef01234567"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							disabled={publish.isPending}
						/>
						<p className="text-muted-foreground text-xs">
							Only commits already merged into an allowed branch are published:
							CI checks, and otherwise stops before signing.
						</p>
						{shown.commit ? (
							<p className="text-destructive text-xs">{shown.commit}</p>
						) : null}
					</div>
				) : null}

				<div className="space-y-1.5">
					<FilterSelect
						label="Update note"
						value={noteChoice}
						options={noteOptions}
						onChange={(value) => {
							setNoteChoice(value);
							patch({ note: value === OTHER_NOTE ? "" : value });
						}}
					/>
					{noteChoice === OTHER_NOTE ? (
						<>
							<Label htmlFor={noteId} className="sr-only">
								Note date
							</Label>
							<Input
								id={noteId}
								value={draft.note}
								onChange={(event) =>
									patch({ note: event.target.value.trim().slice(0, 10) })
								}
								placeholder="YYYY-MM-DD"
								className="w-40 font-mono"
								disabled={publish.isPending}
							/>
						</>
					) : null}
					{shown.note ? (
						<p className="text-destructive text-xs">{shown.note}</p>
					) : null}
				</div>

				<div className="space-y-1.5">
					<Label htmlFor={reasonId}>Reason</Label>
					<Textarea
						id={reasonId}
						value={draft.reason}
						onChange={(event) => patch({ reason: event.target.value })}
						maxLength={MOBILE_UPDATE_REASON_MAX_LENGTH}
						rows={2}
						disabled={publish.isPending}
						placeholder="Why ship this code now"
					/>
					<p className="text-muted-foreground text-xs">
						Recorded in the audit log and the job. Not sent to CI.
					</p>
					{shown.reason ? (
						<p className="text-destructive text-xs">{shown.reason}</p>
					) : null}
				</div>

				{production ? (
					<p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
						Production publishes register <strong>only as drafts</strong>: they
						go to nobody. Check the result release, then raise its percentage
						separately from that release.
					</p>
				) : null}

				{publish.error ? <ErrorBlock error={publish.error} /> : null}

				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={publish.isPending}
					>
						Cancel
					</Button>
					<Button onClick={submit} disabled={publish.isPending}>
						{publish.isPending ? "Requesting…" : "Request publish"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
