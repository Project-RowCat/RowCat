import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import {
	COMPOSER_BUTTON,
	COMPOSER_FIELD_MIN_H,
	COMPOSER_FRAME,
	COMPOSER_SURFACE,
	LIST_PADDING_END_PX,
	LIST_PADDING_START_PX,
	MESSAGE_ACTION_BAR_HEIGHT_PX,
	MESSAGE_STACK_GAP,
	ROW_GAP_PX,
} from "./chat-geometry.ts";
import { CHAT_COLUMN } from "./chat-shell.tsx";

/**
 * Conversation placeholder and the only body the server renders. The server cannot see room
 * contents (they live in IndexedDB), and an empty screen would look dead until hydration, so this
 * reserves the geometry the content will fill. It carries no title, message count or text, since
 * invented values would briefly lie.
 *
 * It sets its own width from `CHAT_COLUMN`, because the shell hands width down to content; without
 * it the lines stretch to the canvas edge and snap back on hydration.
 *
 * Every dimension comes from `chat-geometry.ts`, never a local copy. A hand-written copy went stale
 * when the composer changed shape and produced a visible jump on hydration.
 */
export function ChatSkeleton() {
	return (
		<div
			className={`flex min-h-0 flex-1 flex-col ${CHAT_COLUMN}`}
			aria-hidden="true"
		>
			<div className="min-h-0 flex-1 overflow-hidden">
				<ChatHistorySkeleton />
			</div>
			<ComposerSkeleton />
		</div>
	);
}

/**
 * History placeholder. The virtualized list draws the same shape (`message-list.tsx`), so the
 * server frame, hydration and the local read share one rhythm. Every turn reserves its action-bar
 * space; leaving it out makes the history grow about 36px per turn when it arrives.
 */
export function ChatHistorySkeleton() {
	return (
		<div
			className="flex flex-col"
			style={{
				gap: ROW_GAP_PX,
				paddingTop: LIST_PADDING_START_PX,
				paddingBottom: LIST_PADDING_END_PX,
			}}
			aria-hidden="true"
		>
			<AssistantSkeleton widths={["w-full", "w-11/12", "w-2/3"]} />
			<UserSkeleton width="w-2/5" />
			<AssistantSkeleton widths={["w-full", "w-10/12", "w-full", "w-1/2"]} />
			<UserSkeleton width="w-1/4" />
		</div>
	);
}

/**
 * Assistant reply: no bubble, reading-width lines. `h-4` bars with `gap-3.5` (14px) give the 30px
 * prose line height. `py-[7px]` is half the leading that real text leaves above and below, so a
 * paragraph does not come out 14px short. The pending-token indicator (`PendingIndicator` in
 * `message-list.tsx`) uses the same rhythm, so opening a room and waiting for a reply look alike.
 */
function AssistantSkeleton({ widths }: { widths: string[] }) {
	return (
		<div className={`flex flex-col ${MESSAGE_STACK_GAP}`}>
			<div className="flex flex-col gap-3.5 py-[7px]">
				{widths.map((width, index) => (
					<Skeleton
						// biome-ignore lint/suspicious/noArrayIndexKey: placeholder lines have no identity.
						key={index}
						className={`h-4 ${width}`}
					/>
				))}
			</div>
			<ActionsReserve />
		</div>
	);
}

/**
 * User turn: a filled bubble attached to the right, with the same asymmetric corner as the real
 * bubble. A different silhouette would change a corner on arrival, which reads as a second draw.
 * `h-12` is the height of a one-line utterance without a speaker line.
 */
function UserSkeleton({ width }: { width: string }) {
	return (
		<div className={`flex flex-col items-end ${MESSAGE_STACK_GAP}`}>
			<Skeleton className={`h-12 ${width} rounded-[1.375rem] rounded-br-md`} />
			<ActionsReserve />
		</div>
	);
}

/**
 * Reserves the action bar's height without drawing it. The real bar is invisible until hover, and
 * drawing it would promise buttons that are not there. Only the physical height is reserved
 * (`MESSAGE_ACTION_BAR_HEIGHT_PX`): the gap above comes from the parent (`MESSAGE_STACK_GAP`), so
 * the combined reserve constant would count that gap twice. That mistake once made each placeholder
 * turn 4px taller than the live turns; `chat-geometry.test.ts` locks the two constants' relation by
 * value.
 */
function ActionsReserve() {
	return <div style={{ height: MESSAGE_ACTION_BAR_HEIGHT_PX }} />;
}

/**
 * Composer placeholder. It does not mount the real input, which would pull `useState`, IME handling
 * and the generation callbacks into the server bundle. It reads the surface geometry from the same
 * constants in `chat-geometry.ts`, so height and corner radius match after hydration.
 *
 * The surface is drawn idle: the real one lights up on focus, and an active surface drawn early
 * would recede once at hydration.
 */
function ComposerSkeleton() {
	return (
		<div className={COMPOSER_FRAME}>
			<div className={COMPOSER_SURFACE}>
				<Skeleton className={`${COMPOSER_FIELD_MIN_H} w-full rounded-2xl`} />
				{/* The ghost emphasis button and the send button, sized like the real composer's two targets. */}
				<Skeleton className={`size-9 ${COMPOSER_BUTTON}`} />
				<Skeleton className={`size-10 ${COMPOSER_BUTTON}`} />
			</div>
		</div>
	);
}
