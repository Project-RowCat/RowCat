import {
	type ChatRoom,
	type ChatUserTool,
	userToolActiveIn,
} from "@rowcat/chat";
import { CHAT_MAX_TOOLS } from "@rowcat/contracts/chat";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import { Switch } from "@rowcat/ui-web/components/switch";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toolKindLabel } from "#/features/tools/tool-form.ts";
import { useToolLibrary } from "#/features/tools/use-tool-library.ts";
import { useLocalUserTools } from "#/lib/local-chat/hooks.ts";
import { roomOverridesTool } from "./tool-copy.ts";

/**
 * The tools section of room settings: which of the user's own tools are on in this conversation.
 *
 * Each switch shows the effective state (`userToolActiveIn`: the room's choice, else the tool's
 * default), not the override. A switch that showed only "this room said something" would read off
 * for a tool that is in fact on everywhere by default.
 *
 * A switch that differs from the tool's default is marked and can be reset. Reset is not the same
 * as flipping the switch back: flipping writes an explicit choice, which stops this room from
 * following later changes to the tool's default. "Follows default" is its own state
 * (`setRoomToolOverride(…, null)`), and only a separate action reaches it.
 *
 * Each press saves at once, like narration and intensity: a choice from two values costs nothing to
 * revert, and a save button over switches would be a second step that people forget.
 *
 * What a tool is and does is edited in /settings/tools, not here; this view only links there.
 * The work's own tools are not listed: the creator decided those, and the room has no switch for
 * them.
 */
export function RoomSettingsTools({
	room,
	onLeave,
}: {
	room: ChatRoom;
	/** Closes the dialog before navigating away, so the dialog is not left open over the new page. */
	onLeave: () => void;
}) {
	const { t } = useTranslation("tools");
	const { items, loading } = useLocalUserTools();
	const library = useToolLibrary();
	const [error, setError] = useState<string | null>(null);

	const set = (toolId: string, enabled: boolean | null): void => {
		setError(null);
		void library
			.setRoomOverride(room.id, toolId, enabled)
			.catch((failure: unknown) => {
				console.error("[chat] couldn't change a room tool", failure);
				setError(t("room.saveFailed"));
			});
	};

	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">{t("room.description")}</p>

			{loading ? null : items.length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("room.empty")}</p>
			) : (
				<ul className="flex flex-col divide-y">
					{items.map((tool) => (
						<RoomToolRow
							key={tool.id}
							tool={tool}
							active={userToolActiveIn(room, tool)}
							overridden={roomOverridesTool(room, tool.id)}
							disabled={!library.ready}
							onChange={(enabled) => set(tool.id, enabled)}
							onReset={() => set(tool.id, null)}
						/>
					))}
				</ul>
			)}

			{error && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}

			{/*
			 * The cap is the registry's (`chatConversationTools`): past it, tools are silently left out of
			 * the request. Saying so here is the only place a person switching on a ninth tool can learn
			 * why it is never called.
			 */}
			<p className="text-muted-foreground text-xs">
				{t("room.limit", { max: CHAT_MAX_TOOLS })}
			</p>

			<div>
				<Link
					to="/settings/tools"
					onClick={onLeave}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					{t("room.manage")}
				</Link>
			</div>
		</div>
	);
}

function RoomToolRow({
	tool,
	active,
	overridden,
	disabled,
	onChange,
	onReset,
}: {
	tool: ChatUserTool;
	active: boolean;
	overridden: boolean;
	disabled: boolean;
	onChange: (enabled: boolean) => void;
	onReset: () => void;
}) {
	const { t } = useTranslation("tools");
	const id = useId();
	const name = tool.tool.declaration.name;
	return (
		<li className="flex items-start gap-3 py-3">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<label htmlFor={id} className="truncate font-medium font-mono text-sm">
					{name}
				</label>
				<p className="text-muted-foreground text-xs">
					{toolKindLabel(tool.tool.action.kind)}
					{" · "}
					{overridden ? t("room.changedHere") : t("room.followsDefault")}
				</p>
				{overridden && (
					<Button
						variant="link"
						size="xs"
						className="h-auto self-start px-0"
						aria-label={t("room.resetLabel", { name })}
						disabled={disabled}
						onClick={onReset}
					>
						{t("room.reset")}
					</Button>
				)}
			</div>
			<Switch
				id={id}
				checked={active}
				disabled={disabled}
				aria-label={t("room.toggleLabel", { name })}
				onCheckedChange={(next) => onChange(next)}
			/>
		</li>
	);
}
