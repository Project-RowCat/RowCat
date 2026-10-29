import type { RuntimeTemplate } from "./types.ts";

/**
 * Investigation teaches three things:
 * - Separating static content from saved state. Only clue ids are saved; names and text live in
 *   evidence.ts.
 * - Keeping invariants out of the screen. A pure function owns the rule that pressing the same
 *   investigation twice does not add a clue again.
 * - The boundary between derived and saved values. `ready` is derived from clues; `confronted` is
 *   saved because it is something that actually happened.
 */
export const INVESTIGATION_TEMPLATE: RuntimeTemplate = {
	id: "investigation",
	name: "Investigation",
	description:
		"A screen where investigating gathers clues and opens a case. Progress is saved.",
	category: "game",
	complexity: "advanced",
	demonstrates: [
		"Clues and investigation records kept with useStoryState",
		"Progress rules that can't express duplicates",
		"Separating static content from saved ids",
		"A completion state derived from saved values",
	],
	entry: "src/main.tsx",
	files: [
		{
			path: "src/evidence.ts",
			content: `/**
 * The case, investigation and clue tables: **static content** the screen only reads.
 * Saved state holds only ids, not the sentences here (state.ts).
 */

export const CASE = {
	code: "CASE 01",
	title: "The Book in the Reading Room",
	summary: "A book with no checkout record, found lying open in the closed library.",
};

export interface Evidence {
	id: string;
	label: string;
	detail: string;
}

export const EVIDENCE: readonly Evidence[] = [
	{
		id: "library-key",
		label: "Duplicate library key",
		detail: "It was in a third-floor locker, left unlocked.",
	},
	{
		id: "old-record",
		label: "Checkout record from ten years ago",
		detail: "In the empty column, only last week's date is written in pencil.",
	},
	{
		id: "torn-note",
		label: "Bookmark note",
		detail: "Thursday, same seat. That's all it says.",
	},
];

export interface InvestigationAction {
	id: string;
	label: string;
	/** The sentence left in the activity log after finishing. */
	log: string;
	trust: number;
	/** The id of the clue this investigation opens. null if none. */
	unlocks: string | null;
}

export const ACTIONS: readonly InvestigationAction[] = [
	{
		id: "locker",
		label: "Check the third-floor lockers",
		log: "Found a duplicate key in a locker.",
		trust: 8,
		unlocks: "library-key",
	},
	{
		id: "archive",
		label: "Search the checkout ledger",
		log: "Found last week's date in a record from ten years ago.",
		trust: 12,
		unlocks: "old-record",
	},
	{
		id: "storage",
		label: "Check the storeroom door",
		log: "Found a note tucked into a bookmark.",
		trust: 6,
		unlocks: "torn-note",
	},
	{
		id: "sena",
		label: "Ask Sena",
		log: "Sena told you again what she saw that day.",
		trust: 10,
		unlocks: null,
	},
];

export function evidenceOf(id: string): Evidence | null {
	return EVIDENCE.find((item) => item.id === id) ?? null;
}

export function actionOf(id: string): InvestigationAction | null {
	return ACTIONS.find((action) => action.id === id) ?? null;
}
`,
		},
		{
			path: "src/state.ts",
			content: `import { defineStoryState } from "@rowcat/runtime";
import { EVIDENCE, actionOf } from "./evidence";

/**
 * Saved state **belongs to this playthrough**. What was investigated and what was found live here.
 *
 * It holds only ids and counts: saving clue names and content too would make those sentences live in
 * two places, and on the day the manuscript is edited, plays in progress would keep seeing the old text.
 */

export interface InvestigationProgress {
	/** Ids of clues found. An array, but the same value never enters twice. */
	evidence: string[];
	/** Ids of finished investigations. The basis for not counting the same one twice. */
	actions: string[];
	trust: number;
	/**
	 * Whether the accusation is done: **not derived from the clues.**
	 * Having all the clues (ready) and actually accusing are different facts.
	 */
	confronted: boolean;
}

const START: InvestigationProgress = {
	evidence: [],
	actions: [],
	trust: 45,
	confronted: false,
};

export const investigationProgress = defineStoryState<InvestigationProgress>({
	key: "investigation",
	version: 1,
	initial: START,
});

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * Finishes one investigation: **a finished one changes nothing.**
 *
 * This invariant lives here rather than in the screen because there, every new place that opens the
 * action would need the check written again, and one place would eventually miss it.
 */
export function completeAction(
	progress: InvestigationProgress,
	actionId: string,
): InvestigationProgress {
	if (progress.actions.includes(actionId)) return progress;
	const action = actionOf(actionId);
	if (action === null) return progress;
	const evidence =
		action.unlocks === null || progress.evidence.includes(action.unlocks)
			? [...progress.evidence]
			: [...progress.evidence, action.unlocks];
	return {
		evidence,
		actions: [...progress.actions, action.id],
		trust: clamp(progress.trust + action.trust),
		confronted: progress.confronted,
	};
}

/** The accusation happens only when all the clues are in. */
export function confront(
	progress: InvestigationProgress,
): InvestigationProgress {
	if (!caseReady(progress) || progress.confronted) return progress;
	return { ...progress, confronted: true };
}

/** Whether the case can be opened: **a derived value, so it is not saved.** */
export function caseReady(progress: InvestigationProgress): boolean {
	return progress.evidence.length >= EVIDENCE.length;
}

export const isDone = (
	progress: InvestigationProgress,
	actionId: string,
): boolean => progress.actions.includes(actionId);
`,
		},
		{
			path: "src/components/case-header.tsx",
			content: `import { Stack, Text, color } from "@rowcat/runtime";

export interface CaseHeaderProps {
	code: string;
	title: string;
	summary: string;
}

export function CaseHeader({ code, title, summary }: CaseHeaderProps) {
	return (
		<Stack gap={6}>
			<Text
				style={{ color: color("#f6d47a"), fontSize: 12, fontWeight: "bold" }}
			>
				{code}
			</Text>
			<Text
				style={{ color: color("#f4f6fb"), fontSize: 20, fontWeight: "bold" }}
			>
				{title}
			</Text>
			<Text style={{ color: color("#8a93a6"), fontSize: 13, lines: 2 }}>
				{summary}
			</Text>
		</Stack>
	);
}
`,
		},
		{
			path: "src/components/progress-card.tsx",
			content: `import { Progress, Row, Stack, Text, View, color } from "@rowcat/runtime";

export interface ProgressCardProps {
	found: number;
	total: number;
	trust: number;
}

/** Clues and trust share one box: both come straight from saved values. */
export function ProgressCard({ found, total, trust }: ProgressCardProps) {
	return (
		<View
			style={{
				padding: 18,
				borderRadius: 16,
				backgroundColor: color("#141821"),
			}}
		>
			<Stack gap={14}>
				<Stack gap={8}>
					<Row style={{ justify: "between", align: "center" }}>
						<Text
							style={{
								color: color("#8a93a6"),
								fontSize: 12,
								fontWeight: "medium",
							}}
						>
							Clues
						</Text>
						<Text style={{ color: color("#f6d47a"), fontSize: 12 }}>
							{String(found) + " / " + String(total)}
						</Text>
					</Row>
					<Progress value={found / total} style={{ width: "100%" }} />
				</Stack>
				<Stack gap={8}>
					<Row style={{ justify: "between", align: "center" }}>
						<Text
							style={{
								color: color("#8a93a6"),
								fontSize: 12,
								fontWeight: "medium",
							}}
						>
							Trust
						</Text>
						<Text style={{ color: color("#f6d47a"), fontSize: 12 }}>
							{String(trust) + "%"}
						</Text>
					</Row>
					<Progress
						value={Math.min(1, Math.max(0, trust / 100))}
						style={{ width: "100%" }}
					/>
				</Stack>
			</Stack>
		</View>
	);
}
`,
		},
		{
			path: "src/components/investigation-action.tsx",
			content: `import { Button, Stack, Text, View, color } from "@rowcat/runtime";

export interface InvestigationActionProps {
	label: string;
	log: string;
	done: boolean;
	onInvestigate: () => void;
}

/**
 * Before and after finishing split inside the same box.
 * Finished investigations stay in the list because progress has to be visible,
 * and no button remains so there is no place to press the same investigation twice.
 */
export function InvestigationAction({
	label,
	log,
	done,
	onInvestigate,
}: InvestigationActionProps) {
	return (
		<View
			style={{
				padding: 16,
				borderRadius: 14,
				backgroundColor: done ? color("#1a2130") : color("#141821"),
			}}
		>
			{done ? (
				<Stack gap={8}>
					<Text
						style={{
							color: color("#f4f6fb"),
							fontSize: 15,
							fontWeight: "medium",
						}}
					>
						{label}
					</Text>
					<Text style={{ color: color("#b9c4d8"), fontSize: 13 }}>{log}</Text>
				</Stack>
			) : (
				<Button tone="secondary" onPress={onInvestigate}>
					{label}
				</Button>
			)}
		</View>
	);
}
`,
		},
		{
			path: "src/components/evidence-card.tsx",
			content: `import { Stack, Text, View, color } from "@rowcat/runtime";

export interface EvidenceCardProps {
	label: string;
	detail: string;
}

export function EvidenceCard({ label, detail }: EvidenceCardProps) {
	return (
		<View
			style={{
				padding: 14,
				borderRadius: 12,
				backgroundColor: color("#1a2130"),
			}}
		>
			<Stack gap={6}>
				<Text
					style={{
						color: color("#f4f6fb"),
						fontSize: 14,
						fontWeight: "medium",
					}}
				>
					{label}
				</Text>
				<Text style={{ color: color("#b9c4d8"), fontSize: 13 }}>{detail}</Text>
			</Stack>
		</View>
	);
}
`,
		},
		{
			path: "src/main.tsx",
			content: `import {
	Button,
	Screen,
	ScrollView,
	Stack,
	Text,
	View,
	color,
	useMemo,
	useStoryState,
} from "@rowcat/runtime";
import { CaseHeader } from "./components/case-header";
import { EvidenceCard } from "./components/evidence-card";
import { InvestigationAction } from "./components/investigation-action";
import { ProgressCard } from "./components/progress-card";
import { ACTIONS, CASE, EVIDENCE, evidenceOf } from "./evidence";
import {
	caseReady,
	completeAction,
	confront,
	investigationProgress,
	isDone,
} from "./state";

export default function App() {
	/** Investigation progress belongs to the playthrough: it continues after a restart. */
	const [progress, setProgress] = useStoryState(investigationProgress);

	/** Completion is not saved: it comes from the clues found. */
	const ready = useMemo(() => caseReady(progress), [progress]);

	return (
		<Screen background={color("#0a0d14")}>
			<ScrollView style={{ padding: 20 }}>
				<Stack gap={20}>
					<CaseHeader
						code={CASE.code}
						title={CASE.title}
						summary={CASE.summary}
					/>

					<ProgressCard
						found={progress.evidence.length}
						total={EVIDENCE.length}
						trust={progress.trust}
					/>

					<Stack gap={10}>
						<Text
							style={{
								color: color("#8a93a6"),
								fontSize: 12,
								fontWeight: "medium",
							}}
						>
							Investigate
						</Text>
						{ACTIONS.map((action) => (
							<InvestigationAction
								key={action.id}
								label={action.label}
								log={action.log}
								done={isDone(progress, action.id)}
								onInvestigate={() => {
									setProgress((current) => completeAction(current, action.id));
								}}
							/>
						))}
					</Stack>

					<Stack gap={10}>
						<Text
							style={{
								color: color("#8a93a6"),
								fontSize: 12,
								fontWeight: "medium",
							}}
						>
							{"Clues found " +
								String(progress.evidence.length) +
								" / " +
								String(EVIDENCE.length)}
						</Text>
						{progress.evidence.length === 0 ? (
							<Text style={{ color: color("#5f6a7e"), fontSize: 13 }}>
								No clues found yet.
							</Text>
						) : (
							progress.evidence.map((id) => {
								const item = evidenceOf(id);
								return item === null ? null : (
									<EvidenceCard
										key={item.id}
										label={item.label}
										detail={item.detail}
									/>
								);
							})
						)}
					</Stack>

					{ready && (
						<View
							style={{
								padding: 18,
								borderRadius: 16,
								backgroundColor: color("#1c2333"),
							}}
						>
							<Stack gap={12}>
								<Text
									style={{
										color: color("#f6d47a"),
										fontSize: 12,
										fontWeight: "bold",
									}}
								>
									{progress.confronted ? "Case closed" : "Case ready"}
								</Text>
								<Text
									style={{
										color: color("#f4f6fb"),
										fontSize: 15,
										fontWeight: "medium",
									}}
								>
									{progress.confronted
										? "You decided to wait at that seat on Thursday."
										: "You gathered all " +
											String(EVIDENCE.length) +
											" key clues."}
								</Text>
								{!progress.confronted && (
									<Button
										onPress={() => {
											setProgress((current) => confront(current));
										}}
									>
										Accuse with Sena
									</Button>
								)}
							</Stack>
						</View>
					)}
				</Stack>
			</ScrollView>
		</Screen>
	);
}
`,
		},
	],
};
