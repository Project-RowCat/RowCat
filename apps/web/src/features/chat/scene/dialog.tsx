import {
	type ActiveSceneView,
	CHAT_SCENE_MAX_MEMBERS,
	type ChatCharacter,
	type ChatMessage,
	type ChatRoom,
	type ChatScene,
	type ChatSceneAudience,
	ChatSceneAudienceError,
	type ChatSceneStart,
	type ChatStore,
	compareMessagePosition,
	effectiveChatUserName,
	HISTORY_ADOPTION_CHOICES,
	HISTORY_ADOPTION_DEFAULT,
	type HistoryAdoptionChoice,
	historyAdoptionNeeded,
	orderScenes,
	planCorrectScene,
	planEndScene,
	planHistoryAdoption,
	planStartScene,
	sceneCast,
	sceneMemberNames,
	unclassifiedHistory,
} from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { useAllLocalMessages } from "#/lib/local-chat/hooks.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { AudiencePicker } from "./audience-picker.tsx";
import { earliestMessage, messageExcerpt } from "./copy.ts";
import { executeScenePlan } from "./run-plan.ts";

/**
 * The scene controls of one room: who is present now, start / change / end, how earlier history is
 * treated, and the room's past scenes with corrections (`docs/chat/SCENES.md`).
 *
 * **Every decision is `@rowcat/chat`'s** (`scene-controls.ts`): which scene is in effect, what a
 * control writes, whether starting must first ask about earlier history, how many earlier messages
 * are unclassified. This window draws those answers and executes the plans in order
 * (`executeScenePlan`). It never assigns messages to scenes: messages inherit the scene in effect.
 *
 * Writes are not frozen while a reply streams only by policy: a change made then would start after
 * the person's last message and the reply being written would land in the new scene, so the three
 * controls that move the current scene wait for the reply (corrections of past scenes do not).
 */

type View =
	| { kind: "home" }
	| { kind: "pick" }
	| { kind: "adopt"; audience: ChatSceneAudience }
	| { kind: "correct"; key: string }
	| { kind: "delete"; key: string };

const startKey = (start: ChatSceneStart) =>
	`${start.createdAt}\u0000${start.messageId}`;

const nowIso = () => new Date().toISOString();

export function SceneDialog({
	room,
	characters,
	scenes,
	active,
	lastMessage,
	generating,
	onClose,
}: {
	room: ChatRoom;
	characters: readonly ChatCharacter[];
	/** The room's scene records as subscribed by the chip (one subscription for both). */
	scenes: readonly ChatScene[];
	active: ActiveSceneView | null;
	/** The newest stored message; a change applies after it. */
	lastMessage: Pick<ChatMessage, "id" | "createdAt"> | null;
	generating: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation(["chat", "common"]);
	const { store, ownsStore } = useChatScope();
	/** The whole room, only while this window is open: adoption needs the first message, the list the heads. */
	const history = useAllLocalMessages(room.id);
	const [view, setView] = useState<View>({ kind: "home" });
	const [adoption, setAdoption] = useState<HistoryAdoptionChoice>(
		HISTORY_ADOPTION_DEFAULT,
	);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const adoptionName = useId();

	/** Closes with the scope, like every window holding a member's data (`memory/dialog.tsx`). */
	// biome-ignore lint/correctness/useExhaustiveDependencies: close only at the moment the scope changes.
	useEffect(() => {
		if (!store) onClose();
	}, [store]);

	const cast = useMemo(() => sceneCast(room, characters), [room, characters]);
	const namesOf = (members: readonly string[]): string =>
		sceneMemberNames(members, {
			seed: room.seed,
			characters: characters.filter((c) => c.deletedAt === null),
			userName: effectiveChatUserName(room),
		}).join(", ") || t("scene.unknownNames");

	const unclassified = history.loading
		? null
		: unclassifiedHistory(history.messages, scenes);

	/** The scenes in position order with where each one starts on screen. */
	const entries = useMemo(() => {
		const ordered = orderScenes(scenes);
		const sorted = [...history.messages].sort(compareMessagePosition);
		return ordered.map((entry, index) => {
			const start = {
				createdAt: entry.startAt.createdAt,
				id: entry.startAt.messageId,
			};
			const nextStart = ordered[index + 1]?.startAt;
			const next = nextStart
				? { createdAt: nextStart.createdAt, id: nextStart.messageId }
				: null;
			const first =
				sorted.find(
					(m) =>
						compareMessagePosition(m, start) >= 0 &&
						(!next || compareMessagePosition(m, next) < 0),
				) ?? null;
			const key = startKey(entry.startAt);
			return {
				key,
				audience: entry.audience,
				first,
				/** Every live record at this start (two devices may each have written one). */
				records: scenes.filter(
					(s) => s.deletedAt === null && startKey(s.startAt) === key,
				),
			};
		});
	}, [scenes, history.messages]);

	const run = async (
		perform: (store: ChatStore) => Promise<void>,
	): Promise<boolean> => {
		if (!store || !ownsStore(store)) {
			onClose();
			return false;
		}
		setPending(true);
		setError(null);
		try {
			await perform(store);
			return true;
		} catch (failure) {
			if (failure instanceof ChatSceneAudienceError) {
				setError(
					failure.reason === "too_many"
						? t("scene.pickTooMany", { max: CHAT_SCENE_MAX_MEMBERS })
						: t("scene.pickEmpty"),
				);
				return false;
			}
			console.error("[chat] a scene operation failed", failure);
			setError(t("scene.failed"));
			return false;
		} finally {
			setPending(false);
		}
	};

	const start = async (audience: ChatSceneAudience) => {
		if (historyAdoptionNeeded(history.messages, scenes)) {
			setAdoption(HISTORY_ADOPTION_DEFAULT);
			setView({ kind: "adopt", audience });
			return;
		}
		const ok = await run((chat) =>
			executeScenePlan(
				chat,
				planStartScene({
					roomId: room.id,
					scenes,
					lastMessage,
					audience,
					nowIso: nowIso(),
				}),
			),
		);
		if (ok) setView({ kind: "home" });
	};

	const adoptAndStart = async (audience: ChatSceneAudience) => {
		const ok = await run(async (chat) => {
			await executeScenePlan(
				chat,
				planHistoryAdoption({
					roomId: room.id,
					choice: adoption,
					firstMessage: earliestMessage(history.messages),
				}),
			);
			/** Re-read: the start plan must see the scene the adoption just wrote. */
			const fresh = await chat.listScenes(room.id);
			await executeScenePlan(
				chat,
				planStartScene({
					roomId: room.id,
					scenes: fresh,
					lastMessage,
					audience,
					nowIso: nowIso(),
				}),
			);
		});
		if (ok) setView({ kind: "home" });
	};

	const classify = (choice: HistoryAdoptionChoice) =>
		void run((chat) =>
			executeScenePlan(
				chat,
				planHistoryAdoption({
					roomId: room.id,
					choice,
					firstMessage: unclassified?.first ?? null,
				}),
			),
		);

	const end = () =>
		void run((chat) =>
			executeScenePlan(
				chat,
				planEndScene({
					roomId: room.id,
					scenes,
					lastMessage,
					nowIso: nowIso(),
				}),
			),
		);

	const nowLine = !active
		? t("scene.now.none")
		: active.audience.kind === "room"
			? t("scene.now.everyone")
			: active.audience.kind === "narrator"
				? t("scene.now.narrator")
				: t("scene.now.participants", {
						names: active.names.join(", ") || t("scene.unknownNames"),
					});
	const narrowed = active !== null && active.audience.kind !== "room";
	const pickInitial: ChatSceneAudience =
		active?.audience.kind === "participants"
			? active.audience
			: { kind: "participants", members: ["user"] };

	return (
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			<DialogContent
				closeButtonDisabled={pending}
				placement="adaptive"
				className="top-auto bottom-0 max-h-[85dvh] w-full max-w-full flex flex-col gap-0 rounded-t-xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:max-w-lg sm:rounded-xl"
			>
				<DialogHeader className="min-w-0 border-b px-5 py-4 text-left">
					<DialogTitle>{t("scene.title")}</DialogTitle>
					<DialogDescription>{t("scene.description")}</DialogDescription>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-4">
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}

					{view.kind === "pick" ? (
						<AudiencePicker
							cast={cast}
							initial={pickInitial}
							label={t("scene.pickLabel")}
							submitLabel={narrowed ? t("scene.apply") : t("scene.start")}
							pending={pending || generating || history.loading}
							onCancel={() => setView({ kind: "home" })}
							onSubmit={(audience) => void start(audience)}
						/>
					) : view.kind === "adopt" ? (
						<fieldset className="flex flex-col gap-3">
							<legend className="mb-3 text-sm font-medium">
								{t("scene.history.question")}
							</legend>
							{HISTORY_ADOPTION_CHOICES.map((choice) => (
								<label
									key={choice}
									className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm has-checked:border-primary"
								>
									<input
										type="radio"
										name={adoptionName}
										value={choice}
										className="mt-0.5 accent-primary"
										checked={adoption === choice}
										disabled={pending}
										onChange={() => setAdoption(choice)}
									/>
									<span className="flex flex-col gap-0.5">
										<span className="font-medium">
											{t(`scene.history.${choice}`)}
										</span>
										<span className="text-muted-foreground">
											{t(`scene.history.${choice}Effect`)}
										</span>
									</span>
								</label>
							))}
							<div className="flex justify-end gap-2">
								<Button
									size="sm"
									variant="outline"
									disabled={pending}
									onClick={() => setView({ kind: "home" })}
								>
									{t("common:actions.cancel")}
								</Button>
								<Button
									size="sm"
									disabled={pending || generating}
									onClick={() => void adoptAndStart(view.audience)}
								>
									{t("scene.start")}
								</Button>
							</div>
						</fieldset>
					) : (
						<>
							<section className="flex flex-col gap-2.5">
								<p className="text-sm">{nowLine}</p>
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant={narrowed ? "outline" : "default"}
										disabled={pending || generating}
										onClick={() => {
											setError(null);
											setView({ kind: "pick" });
										}}
									>
										{narrowed ? t("scene.change") : t("scene.start")}
									</Button>
									{narrowed && (
										<Button
											size="sm"
											variant="outline"
											disabled={pending || generating}
											onClick={end}
										>
											{t("scene.end")}
										</Button>
									)}
								</div>
								{generating ? (
									<p className="text-sm text-muted-foreground">
										{t("scene.waitForReply")}
									</p>
								) : narrowed ? (
									<p className="text-sm text-muted-foreground">
										{t("scene.endHint")}
									</p>
								) : null}
							</section>

							{unclassified && unclassified.count > 0 && (
								<section className="flex flex-col gap-2 rounded-lg border p-3">
									<p className="text-sm">
										{t("scene.history.unclassified", {
											count: unclassified.count,
										})}
									</p>
									<ul className="flex flex-col gap-1 text-sm text-muted-foreground">
										<li>
											<span className="font-medium text-foreground">
												{t("scene.history.shared")}
											</span>{" "}
											· {t("scene.history.sharedEffect")}
										</li>
										<li>
											<span className="font-medium text-foreground">
												{t("scene.history.private")}
											</span>{" "}
											· {t("scene.history.privateEffect")}
										</li>
									</ul>
									<div className="flex flex-wrap gap-2">
										<Button
											size="sm"
											variant="outline"
											disabled={pending}
											onClick={() => classify("shared")}
										>
											{t("scene.history.shared")}
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={pending}
											onClick={() => classify("private")}
										>
											{t("scene.history.private")}
										</Button>
									</div>
								</section>
							)}

							{entries.length > 0 && (
								<section className="flex flex-col gap-2">
									<h3 className="text-xs font-semibold text-muted-foreground">
										{t("scene.list.title")}
									</h3>
									<ul className="flex flex-col gap-2">
										{entries.map((entry) => {
											const excerpt = entry.first
												? messageExcerpt(entry.first.content)
												: t("scene.list.noMessages");
											const record = [...entry.records].sort((a, b) =>
												a.updatedAt < b.updatedAt ? 1 : -1,
											)[0];
											return (
												<li
													key={entry.key}
													className="flex flex-col gap-2 rounded-lg border p-3"
												>
													<div className="flex min-w-0 flex-col gap-0.5">
														<span className="truncate text-sm text-muted-foreground">
															{excerpt}
														</span>
														<span className="text-sm font-medium">
															{entry.audience.kind === "room"
																? t("scene.list.everyone")
																: entry.audience.kind === "narrator"
																	? t("scene.list.narrator")
																	: namesOf(entry.audience.members)}
														</span>
													</div>
													{view.kind === "correct" &&
													view.key === entry.key &&
													record ? (
														<AudiencePicker
															cast={cast}
															initial={entry.audience}
															kinds
															label={t("scene.pickLabel")}
															note={t("scene.list.correctNote")}
															submitLabel={t("scene.apply")}
															pending={pending}
															onCancel={() => setView({ kind: "home" })}
															onSubmit={(audience) =>
																void run((chat) =>
																	executeScenePlan(
																		chat,
																		planCorrectScene(record, audience),
																	),
																).then((ok) => {
																	if (ok) setView({ kind: "home" });
																})
															}
														/>
													) : view.kind === "delete" &&
														view.key === entry.key ? (
														<div className="flex flex-col gap-2">
															<p className="text-sm text-muted-foreground">
																{t("scene.list.deleteWarning")}
															</p>
															<div className="flex justify-end gap-2">
																<Button
																	size="sm"
																	variant="outline"
																	disabled={pending}
																	onClick={() => setView({ kind: "home" })}
																>
																	{t("common:actions.cancel")}
																</Button>
																<Button
																	size="sm"
																	variant="destructive"
																	disabled={pending}
																	onClick={() =>
																		void run((chat) =>
																			executeScenePlan(chat, {
																				set: [],
																				remove: entry.records.map((s) => s.id),
																			}),
																		).then((ok) => {
																			if (ok) setView({ kind: "home" });
																		})
																	}
																>
																	{t("common:actions.delete")}
																</Button>
															</div>
														</div>
													) : (
														<div className="flex justify-end gap-1">
															<Button
																size="sm"
																variant="ghost"
																aria-label={t("scene.list.correctFor", {
																	excerpt,
																})}
																disabled={pending || !record}
																onClick={() => {
																	setError(null);
																	setView({ kind: "correct", key: entry.key });
																}}
															>
																{t("scene.list.correct")}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																className="text-destructive hover:text-destructive"
																aria-label={t("scene.list.deleteFor", {
																	excerpt,
																})}
																disabled={pending}
																onClick={() => {
																	setError(null);
																	setView({ kind: "delete", key: entry.key });
																}}
															>
																{t("scene.list.delete")}
															</Button>
														</div>
													)}
												</li>
											);
										})}
									</ul>
								</section>
							)}
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
