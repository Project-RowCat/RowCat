import type { ByoProvider } from "@rowcat/chat";
import { Button } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode, RefObject } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldCloseDialog } from "#/lib/dialog/dismiss.ts";
import { BYO_PROVIDERS, providerLabel } from "#/lib/generation/availability.ts";
import { useProviderConnections } from "#/lib/local-provider/hooks.ts";
import { useProviderScope } from "#/lib/local-provider/scope.ts";
import { useExitGuard } from "#/lib/motion/exit-guard.ts";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import { labelSwapIn, labelSwapOut } from "#/lib/motion/label-swap.ts";
import { useViewerCapability } from "#/lib/query/viewer-capability.ts";
import { ProviderConnectionDialog } from "./provider-connection-dialog.tsx";
import { SETTINGS_ROW_FRAME_CLASS, SettingsGroup } from "./settings-parts.tsx";

/**
 * AI provider: what this device can generate with.
 *
 * Model selection is kept separate from provider connection for the whole design:
 * - Model selection writes to GenerationPreferenceStore: what the user wants to generate with.
 * - Provider connection writes to ProviderConnectionStore: whether this device can do it.
 *
 * Merging them (choosing a model asks for a key) would need one transaction across both stores,
 * which does not exist, and would report half-success as success. That is why this section also has
 * no bottom save button. Each operation completes in its owner's terms. The two sections share the
 * screen only, and a model waiting on a connection leads the user here.
 *
 * RowCat is not listed. Managed access is a product capability, not a user credential, so there is
 * nothing to connect or disconnect. Listing it would create a meaningless `Disconnect RowCat` action.
 *
 * This section should not grow into a provider dashboard. Usage graphs, balances, per-model
 * permissions and key previews belong in the provider's console. Drawing them would require
 * querying with the user's key.
 *
 * A connection is a fact about this device. It binds to member plus device, not to the account, so
 * a connection made on a Mac leaves a phone unconnected. The copy must say so, because otherwise a
 * user sees a blocked conversation on another device as a malfunction.
 */

export function ProviderConnectionsGroup({
	/**
	 * The landing point of the recovery button on a model row, which is this section's heading. Moving
	 * focus there is the point: scrolling alone does nothing for a user who is not looking at the
	 * screen.
	 */
	headingRef,
}: {
	headingRef?: RefObject<HTMLHeadingElement | null>;
} = {}) {
	const { t } = useTranslation(["settings", "common"]);
	return (
		<SettingsGroup
			title={t("providerConnections.aiProviders")}
			description={t("providerConnections.connectAPersonalApiKey")}
			headingRef={headingRef}
		>
			<ProviderList />
		</SettingsGroup>
	);
}

function ProviderList() {
	const { t } = useTranslation(["settings", "common"]);
	const { connections, loading } = useProviderConnections();
	/**
	 * Under-14 accounts cannot open connections at all. The section still shows the row, with the
	 * reason written in place. Hiding it would make the screen look broken (it appears on other
	 * devices) or make users think the feature was removed. They would also have no way to learn that
	 * it opens at age 14.
	 *
	 * Saved keys are not deleted. Device credentials are the user's own private data, and deleting a
	 * key only because the age check passed is not this product's call. An already connected row
	 * therefore still offers disconnect, since actions that reduce data stay open.
	 */
	const capability = useViewerCapability();
	const byoLocked = !capability.loading && !capability.byo;
	const [connecting, setConnecting] = useState<ByoProvider | null>(null);
	const [disconnecting, setDisconnecting] = useState<ByoProvider | null>(null);

	return (
		<>
			{/*
			 * State the reason once. Repeating it on every row turns the list into a wall of warnings, and
			 * the sentence that matters stops being read. The sentence must not end in unavailable. It has
			 * to say both what works now (RowCat-provided models) and when the rest opens (age 14).
			 * Otherwise the screen reads as if the whole conversation feature is blocked.
			 */}
			{byoLocked && (
				<p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground">
					{t("providerConnections.membersUnder14CanT")}
				</p>
			)}

			<ul className="flex flex-col">
				{BYO_PROVIDERS.map((provider) => {
					const connection =
						connections.find((entry) => entry.provider === provider) ?? null;
					return (
						/*
						 * Row padding and dividers reuse the settings row's own values. If only this list used a
						 * different rhythm, two kinds of rows would appear on the same screen.
						 */
						<li key={provider} className={SETTINGS_ROW_FRAME_CLASS}>
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
								<div className="min-w-0">
									<p className="text-sm font-medium">
										{providerLabel(provider)}
									</p>
									{/*
									 * Do not draw not connected before the connection state has loaded. Doing so would make a
									 * user who is connected see their status vanish and reappear every time settings opens. For the
									 * same reason the whole list is client-only (see settings-ai-page.tsx).
									 */}
									{loading ? (
										<Skeleton className="mt-1 h-4 w-20" />
									) : (
										/*
										 * The result of a connection is this word. When the dialog closes, the row is the only
										 * thing that changes on screen, so the changed word is read in place instead of showing
										 * an extra success toast (the design rule against success toasts).
										 *
										 * The row itself never appears or disappears; the row count is fixed at the number of
										 * providers this release supports. Connect and disconnect change text inside the row, so
										 * the word swaps in place (lib/motion/label-swap.ts) rather than entering or leaving. The
										 * login method list makes the same choice.
										 *
										 * mode="wait" is the counterpart of that rhythm. If the two words overlap, assistive
										 * technology reads `Linked` and `Not connected` together. The placeholder sits outside this
										 * presence: opening the store is not something the user did, so an entrance animation on
										 * arrival would make the status appear on every visit.
										 */
										<p className="mt-0.5 text-sm text-muted-foreground">
											<AnimatePresence initial={false} mode="wait">
												<m.span
													key={connection ? "connected" : "disconnected"}
													initial={labelSwapIn.initial}
													animate={labelSwapIn.animate}
													exit={labelSwapOut}
													transition={labelSwapIn.transition}
													className="inline-block"
												>
													{connection
														? t("providerConnections.connected")
														: t("providerConnections.notConnected")}
												</m.span>
											</AnimatePresence>
										</p>
									)}
								</div>

								{/*
								 * Actions are always visible. A reveal on hover is unreachable on touch, and tucking disconnect
								 * into an overflow menu puts a destructive action one more layer away. Reduce visual weight
								 * instead: both actions on a connected row are quiet buttons, and only `Connect` on an unconnected
								 * row has a border, since that row has exactly one thing the user wants to do.
								 */}
								<div className="flex shrink-0 items-center gap-1">
									{loading ? (
										<Skeleton className="h-9 w-24 sm:h-8" />
									) : (
										<AnimatePresence initial={false} mode="wait">
											{connection ? (
												<ProviderRowActions key="connected">
													{/*
													 * Replacing a key saves a new key, so it is closed to child accounts. Disconnect (below) stays
													 * open. It reduces data, and a restricted account should not be blocked from removing its own
													 * data.
													 */}
													<Button
														variant="ghost"
														size="sm"
														className="h-9 sm:h-8"
														disabled={byoLocked}
														onClick={() => setConnecting(provider)}
													>
														{t("providerConnections.replaceKey")}
													</Button>
													<Button
														variant="ghost"
														size="sm"
														className="h-9 text-destructive hover:text-destructive sm:h-8"
														onClick={() => setDisconnecting(provider)}
													>
														{t("providerConnections.disconnect")}
													</Button>
												</ProviderRowActions>
											) : (
												<ProviderRowActions key="disconnected">
													<Button
														variant="outline"
														size="sm"
														className="h-9 sm:h-8"
														disabled={byoLocked}
														onClick={() => setConnecting(provider)}
													>
														{t("providerConnections.connect")}
													</Button>
												</ProviderRowActions>
											)}
										</AnimatePresence>
									)}
								</div>
							</div>
						</li>
					);
				})}
			</ul>

			{/*
			 * The dialog mounts once. Mounting one per row would keep as many dialogs in the tree as there
			 * are providers, with the value living in only one of them.
			 */}
			{connecting && (
				<ProviderConnectionDialog
					provider={connecting}
					replacing={connections.some((entry) => entry.provider === connecting)}
					onClose={() => setConnecting(null)}
				/>
			)}
			{disconnecting && (
				<DisconnectDialog
					provider={disconnecting}
					onClose={() => setDisconnecting(null)}
				/>
			)}
		</>
	);
}

/**
 * One action group at the right of a row. Its contents switch as a unit (`Connect` versus `Replace key` and
 * `Disconnect`) instead of each button appearing separately. Buttons appearing one after another would read
 * as two changes on the row, when the reality is one state change.
 *
 * mode="wait" has the same reason as the label: the two groups have different widths (one button
 * versus two). Overlapping them would stretch the row's right side to the combined width and then
 * shrink it back.
 *
 * Nothing in a leaving group can be pressed. The exit frame keeps the old group on screen after the
 * product state has moved on, and a click there would disconnect the provider a second time. The
 * guard is not attached to the exit target; see lib/motion/exit-guard.ts. On a tab that receives no
 * animation frames it would never apply, and that is exactly when the exiting group stays longest.
 *
 * The 1px movement exists because this area sits next to a 44pt target. A group that visibly moves
 * would force the finger aiming at it to follow.
 */
function ProviderRowActions({ children }: { children: ReactNode }) {
	const exiting = useExitGuard();
	return (
		<m.div
			className="flex items-center gap-1"
			style={exiting}
			initial={{ opacity: 0, y: 1 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, transition: feedbackExit.transition }}
			transition={feedbackEnter.transition}
		>
			{children}
		</m.div>
	);
}

/**
 * Disconnect confirmation. Confirmation is required because reconnecting needs the key again. The
 * user must fetch it from the provider's console, since saved keys are never shown, so the result
 * is expensive to trigger by accident.
 *
 * The copy must not say that preferences are cleared, because they are not. The global and room
 * settings that selected this provider remain, and reconnecting brings them back without any
 * action. Writing `settings will be reset` would promise something false.
 */
function DisconnectDialog({
	provider,
	onClose,
}: {
	provider: ByoProvider;
	onClose: () => void;
}) {
	const { t } = useTranslation(["settings", "common"]);
	const { store } = useProviderScope();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const label = providerLabel(provider);

	const disconnect = async (): Promise<void> => {
		if (!store) return;
		setPending(true);
		setError(null);
		try {
			await store.disconnect(provider);
			onClose();
		} catch {
			setError(t("providerConnections.couldnTDisconnectPleaseTry"));
			setPending(false);
		}
	};

	return (
		/*
		 * The dialog does not disappear while disconnect runs. It follows the same policy as the connect
		 * dialog (lib/dialog/dismiss.ts). If the confirmation vanished during an irreversible operation,
		 * the user would believe they cancelled while the key was in fact being deleted. The mismatch
		 * would show up only when the next conversation was blocked.
		 */
		<Dialog
			open
			onOpenChange={(next, details) => {
				if (!next && shouldCloseDialog(details.reason, pending)) onClose();
			}}
		>
			{/*
			 * This sheet alone has no internal scroll region: it has a header, one error line and a footer.
			 * It therefore takes outer scrolling with the same vertical cap as its sibling sheets
			 * (max-h-[85dvh]). A three-sentence description can become six lines on a narrow screen,
			 * pushing `Disconnect` off-screen. Because the sheet is fixed, page scrolling cannot reach it.
			 */}
			<DialogContent
				closeButtonDisabled={pending}
				placement="adaptive"
				className="top-auto bottom-0 max-h-[85dvh] w-full max-w-full flex flex-col gap-0 overflow-y-auto rounded-t-xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:max-w-md sm:rounded-xl"
			>
				<DialogHeader className="border-b px-5 py-4 text-left">
					<DialogTitle>{t("providers.disconnectTitle", { label })}</DialogTitle>
					{/*
					 * Each of the three sentences is a fact. The copy does not say the key will be revoked at the
					 * provider, or that connections on other devices are dropped too. RowCat can do neither. A user
					 * who read those claims would believe a still-live key had been revoked.
					 */}
					<DialogDescription>
						{t("providerConnections.deletesTheApiKeyStored")}
					</DialogDescription>
				</DialogHeader>

				{/*
				 * The failure stays inside this open dialog. The retry button is directly below, and leaving
				 * this spot would lose the user's place. There is deliberately no presence animation on this
				 * sentence. The footer row sits beneath it: when retry is pressed, the sentence fades while the
				 * two buttons wait to move back into place. On a tab that receives no animation frames they wait
				 * forever (lib/motion/feedback.ts records this test). A sentence that determines layout should
				 * disappear immediately.
				 */}
				{error && (
					<p role="alert" className="px-5 pt-4 text-sm text-destructive">
						{error}
					</p>
				)}

				<div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end">
					<Button variant="outline" onClick={onClose} disabled={pending}>
						{t("common:actions.cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => void disconnect()}
						disabled={pending || !store}
					>
						{pending
							? t("providerConnections.disconnecting")
							: t("providerConnections.disconnect")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
