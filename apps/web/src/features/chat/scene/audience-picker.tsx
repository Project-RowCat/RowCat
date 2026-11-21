import {
	CHAT_SCENE_MAX_MEMBERS,
	type ChatSceneAudience,
	type SceneCastMember,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

type Kind = ChatSceneAudience["kind"];

/**
 * Picks who is present (a scene) or who knows (a memory): a multi-select over `sceneCast`, and,
 * when `kinds` is on, the two audiences that are not a list (everyone, no character) — a correction
 * of a past scene may need either.
 *
 * It writes nothing. It hands the audience it built to the caller, which validates it through the
 * shared rules (`planStartScene` / `planCorrectScene` / `requireSceneAudience`) and writes. The
 * limits drawn here (at least one, at most `CHAT_SCENE_MAX_MEMBERS`) only disable the button early;
 * the rule still lives in `@rowcat/chat`.
 *
 * Refs in `initial` that are no longer in the cast (a deleted character) are dropped from the
 * selection: they cannot be shown, so keeping them would write a member nobody can see or remove.
 */
export function AudiencePicker({
	cast,
	initial,
	kinds = false,
	label,
	note,
	submitLabel,
	pending,
	onCancel,
	onSubmit,
}: {
	cast: readonly SceneCastMember[];
	initial: ChatSceneAudience;
	/** Offer everyone / only these / no character instead of the list alone. */
	kinds?: boolean;
	label: string;
	/** One line under the label (e.g. what a correction changes). */
	note?: string;
	submitLabel: string;
	pending: boolean;
	onCancel: () => void;
	onSubmit: (audience: ChatSceneAudience) => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const groupId = useId();
	const [kind, setKind] = useState<Kind>(kinds ? initial.kind : "participants");
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
		const refs = new Set(cast.map((member) => member.ref));
		return new Set(
			initial.kind === "participants"
				? initial.members.filter((ref) => refs.has(ref))
				: [],
		);
	});

	const count = selected.size;
	const invalid =
		kind === "participants" && (count === 0 || count > CHAT_SCENE_MAX_MEMBERS);

	const submit = () => {
		if (invalid || pending) return;
		onSubmit(
			kind === "participants"
				? {
						kind: "participants",
						// The cast's order, not the order of clicks; storage normalizes anyway.
						members: cast
							.map((member) => member.ref)
							.filter((ref) => selected.has(ref)),
					}
				: { kind },
		);
	};

	return (
		<div className="flex flex-col gap-2.5">
			<p id={groupId} className="text-sm font-medium">
				{label}
			</p>
			{note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
			{kinds ? (
				<div className="flex flex-wrap gap-1.5">
					{(["room", "participants", "narrator"] as const).map((option) => (
						<Button
							key={option}
							type="button"
							size="sm"
							variant={kind === option ? "secondary" : "outline"}
							aria-pressed={kind === option}
							disabled={pending}
							onClick={() => setKind(option)}
						>
							{option === "room"
								? t("scene.kind.everyone")
								: option === "participants"
									? t("scene.kind.participants")
									: t("scene.kind.narrator")}
						</Button>
					))}
				</div>
			) : null}
			{kind === "participants" ? (
				<ul aria-labelledby={groupId} className="flex flex-col gap-1">
					{cast.map((member) => {
						const id = `${groupId}-${member.ref}`;
						return (
							<li key={member.ref}>
								<label
									htmlFor={id}
									className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-sm hover:bg-muted/60"
								>
									<Checkbox
										id={id}
										checked={selected.has(member.ref)}
										disabled={pending}
										onCheckedChange={(checked) =>
											setSelected((current) => {
												const next = new Set(current);
												if (checked === true) next.add(member.ref);
												else next.delete(member.ref);
												return next;
											})
										}
									/>
									<span className="min-w-0 truncate">
										{member.kind === "user"
											? t("scene.you", { name: member.name })
											: member.name}
									</span>
								</label>
							</li>
						);
					})}
				</ul>
			) : null}
			{kind === "participants" && count > CHAT_SCENE_MAX_MEMBERS ? (
				<p className="text-sm text-destructive">
					{t("scene.pickTooMany", { max: CHAT_SCENE_MAX_MEMBERS })}
				</p>
			) : kind === "participants" && count === 0 ? (
				<p className="text-sm text-muted-foreground">{t("scene.pickEmpty")}</p>
			) : null}
			<div className="flex justify-end gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={pending}
					onClick={onCancel}
				>
					{t("common:actions.cancel")}
				</Button>
				<Button size="sm" disabled={invalid || pending} onClick={submit}>
					{submitLabel}
				</Button>
			</div>
		</div>
	);
}
