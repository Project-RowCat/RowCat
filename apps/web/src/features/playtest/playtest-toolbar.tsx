import type { PlaytestStartScene } from "@rowcat/authoring";
import type { GenerationPreference } from "@rowcat/chat";
import { resolveEffectiveGeneration } from "@rowcat/chat";
import { generationModelsQueryOptions } from "@rowcat/query";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bug, SlidersHorizontal } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { reasoningEffortLabel } from "#/features/generation/reasoning-effort-field.tsx";
import { responseLengthLabel } from "#/features/generation/response-length-field.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { useGlobalGenerationState } from "#/lib/local-generation/hooks.ts";
import { useConnectedProviders } from "#/lib/local-provider/hooks.ts";
import { useViewerCapability } from "#/lib/query/viewer-capability.ts";
import { playtestConfigurationSummary } from "./playtest-configuration-summary.ts";

/**
 * Header of the playtest: context, the current conditions, and the door to the inspector. The
 * largest area on this screen should be the conversation. Previously the condition controls sat
 * open above it, which made the settings the body and the conversation an afterthought, the
 * opposite of a test workspace. Instead of hiding the controls, this component keeps the conditions
 * readable even when they are collapsed. Hiding alone would let the user send messages without
 * knowing what they are testing with.
 *
 * The `Testing` badge is deliberately absent. A badge that is always on and marks no state is not
 * read; the fact that this is a test is already stated by the entry path and the note just below.
 *
 * The summary is not computed here. Priority resolution and availability checks are pure functions
 * (`playtest-configuration-summary.ts`, which defers to `@rowcat/chat`). This file only collects
 * the values those functions ask for and draws the result.
 *
 * The lookup set (catalog, connections, account credentials) is the same one the inspector's
 * `ModelTargetField` uses. Identical keys are merged, so no extra request is made, and the lists
 * the inspector will need are warmed while the summary draws (the conversation settings home made
 * the same decision).
 */
export function PlaytestToolbar({
	draftId,
	title,
	preference,
	startSceneId,
	startScenes,
	inspectorId,
	inspectorOpen,
	onToggleInspector,
	debuggerId,
	debuggerOpen,
	onToggleDebugger,
}: {
	draftId: string;
	title: string;
	/** Overrides for this test only. This is the innermost layer of the resolver. */
	preference: GenerationPreference;
	startSceneId: string | null;
	startScenes: readonly PlaytestStartScene[];
	/** The inspector's DOM id. The trigger points at it only while the inspector is open. */
	inspectorId: string;
	inspectorOpen: boolean;
	onToggleInspector: () => void;
	/** The debugger panel's id. The trigger points at nothing while it is closed. */
	debuggerId: string;
	debuggerOpen: boolean;
	onToggleDebugger: () => void;
}) {
	const { t } = useTranslation(["playtest", "common"]);
	const global = useGlobalGenerationState();
	const catalog = useQuery(generationModelsQueryOptions(getRowCatClient()));
	const { providers: connected, loading: connectionsLoading } =
		useConnectedProviders();
	const capability = useViewerCapability();

	/**
	 * The playtest-only override goes into the innermost layer of the resolver, the slot the resolver
	 * calls `room`. That name comes from its only consumer so far and does not mean storage. Writing
	 * `preference.target ?? global.effective.target` here would create a second copy of the precedence
	 * rule, and that copy would eventually diverge from the value the inspector shows.
	 */
	const effective = resolveEffectiveGeneration({
		global: global.global,
		room: preference,
	});

	const summary = playtestConfigurationSummary({
		loading:
			global.loading ||
			catalog.isPending ||
			connectionsLoading ||
			capability.loading,
		effective,
		models: catalog.data ?? [],
		catalogLoaded: catalog.isSuccess,
		connected,
		byoAllowed: capability.byo,
		responseLengthLabel: responseLengthLabel(effective.responseLength),
		reasoningEffortLabel,
		/**
		 * Only the title of the chosen scene is passed, not its id. The id is not a value the user sees
		 * (neither `__default__` nor a UUID is meaningful on screen), and passing ids would force the
		 * pure function to know the scene list.
		 */
		startSceneTitle:
			startSceneId === null
				? null
				: (startScenes.find((scene) => scene.id === startSceneId)?.title ??
					null),
	});

	return (
		<header className="flex shrink-0 flex-col gap-1.5 border-b pb-2">
			<div className="flex min-w-0 items-center gap-2">
				{/*
				 * The way back to editing lives inside this screen. The shell's context slot shows only
				 * the draft title (it is not a navigation surface), and the sidebar's `Create` goes to the
				 * list, so the only action back to the document being edited is here.
				 */}
				<Link
					to="/create/$draftId"
					params={{ draftId }}
					className={buttonVariants({
						variant: "ghost",
						size: "sm",
						className: "shrink-0",
					})}
				>
					{t("playtestToolbar.backToEditing")}
				</Link>
				<h1 className="min-w-0 truncate text-base font-semibold">{title}</h1>
			</div>

			{/*
			 * The condition line and trigger. On narrow screens the summary wraps onto new lines
			 * instead of being squeezed into one row. Truncating it would make the start scene vanish
			 * entirely at 390px, and the start scene is the axis the user changes most often on this
			 * screen.
			 */}
			<div className="flex min-w-0 items-start justify-between gap-2">
				{summary.text === null ? (
					/* Do not draw the product default before the values arrive; reserve the space only. */
					<Skeleton className="mt-0.5 h-4 w-56 max-w-full" />
				) : (
					<p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
						{summary.parts.map((part, index) => (
							<Fragment key={part.label}>
								{index > 0 && (
									<span aria-hidden="true" className="text-muted-foreground/50">
										·
									</span>
								)}
								<span className="max-w-full truncate">
									{/*
									 * A line of joined values is just three words to a user who cannot see the screen. Each
									 * axis name must be read along with its value for the line to say what it means.
									 */}
									<span className="sr-only">{part.label} </span>
									{part.value}
								</span>
							</Fragment>
						))}
						{/*
						 * A target that cannot be used must stay visible even when collapsed. If the controls move
						 * one level deeper and this is hidden too, the user sends a message without knowing why
						 * the conversation is blocked. This is the same sentence as on the conversation settings
						 * home.
						 */}
						{summary.blocked && (
							<span className="max-w-full truncate text-destructive">
								{t("playtestToolbar.notAvailableOnThisDevice")}
							</span>
						)}
					</p>
				)}

				<div className="flex shrink-0 items-center gap-2">
					{/*
					 * The debugger is a panel of a different nature from the settings, so its trigger stands
					 * on its own. The settings choose how the next response is generated; the debugger reads
					 * why the response just produced came out that way. Folding both into one panel would
					 * force someone who opened it to change conditions to go through the log every time.
					 */}
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						aria-expanded={debuggerOpen}
						aria-controls={debuggerOpen ? debuggerId : undefined}
						onClick={onToggleDebugger}
					>
						<Bug aria-hidden="true" />
						{debuggerOpen
							? t("playtestToolbar.closeDebugger")
							: t("playtestToolbar.debugger")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						aria-expanded={inspectorOpen}
						/**
						 * While closed there is no element to point at. Omitting the attribute is more accurate than
						 * pointing at a nonexistent id; the state is conveyed by `aria-expanded`.
						 */
						aria-controls={inspectorOpen ? inspectorId : undefined}
						onClick={onToggleInspector}
					>
						<SlidersHorizontal aria-hidden="true" />
						{inspectorOpen
							? t("playtestToolbar.closeSettings")
							: t("playtestToolbar.testSettings")}
					</Button>
				</div>
			</div>
		</header>
	);
}
