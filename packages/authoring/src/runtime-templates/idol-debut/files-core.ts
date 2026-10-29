import type { RuntimeTemplateFile } from "../types.ts";

/**
 * Root files: colors, vocabulary, the five, save state, generation request, conversation hook, and
 * entry point.
 */
export const CORE_FILES: readonly RuntimeTemplateFile[] = [
	{
		path: "src/generation.ts",
		content: `import type { RuntimeGenerationRequest } from "@rowcat/runtime";
import type { Member } from "./members";
import { AGENCY } from "./story/agency";
import { weekOf } from "./story/weeks";
import { recentMessagesFor } from "./systems/dialogue";
import { NOTES, knownNotes, notesOf } from "./systems/notes";
import type { TopicMatch } from "./systems/topics";
import { TRUST_BAND_LABEL, trustBand } from "./systems/relationships";
import { CONDITION_LABEL, memberSkill } from "./systems/stats";
import type { Career, Run } from "./types";

/**
 * Builds the generation request **from the current state**.
 *
 * The character's identity, way of speaking, current trust stage, this week's situation and reply
 * constraints become the instructions, and recent round trips become the messages. Provider, model, key
 * and temperature are not here: RowCat decides those, and this story doesn't even know whether it is managed or BYO.
 *
 * ## The model makes the mood; code makes the progress
 *
 * Replies go only into the dialogue log. What is learned (fragments) and how the eight weeks end are
 * all decided by the deterministic rules in \`systems/progression.ts\` and \`story/endings.ts\`. The
 * model's sentences are not parsed to judge "was it learned": that approach is brittle, and above all
 * it teaches a first-time creator a structure where **parsing the model's answer becomes a save rule**.
 *
 * ## A story not yet opened is not opened by the model either
 *
 * \`guard\` is what that person does not easily say, and before the fragment opens the instructions say to
 * avoid it. Even if that is broken, game state does not move by a character: code does the locking and
 * the instructions only match the texture.
 */
export interface MemberRequestInput {
	member: Member;
	run: Run;
	career: Career;
	/**
	 * The topic that line just touched: without one it is ordinary conversation.
	 *
	 * This value decides the instructions' last paragraph. If opened, *you may tell this story now*;
	 * if not, *still avoid it*. **The decision is already made**, and the only thing done here is putting the
	 * result into words: whatever the model answers, saved state does not move.
	 */
	touched: TopicMatch | null;
}

const TRUST_NOTE = {
	distant:
		"The other person is the manager just assigned to you. You are polite but don't show your feelings yet.",
	working:
		"You've worked together a few weeks. Practice and schedules are easy to talk about; personal things you keep to yourself.",
	trusted:
		"You trust them. You mix in your own thoughts and worries, and mostly answer when asked.",
	close:
		"They are special to you. You're more honest than usual and say things you haven't told the team.",
} as const;

export function buildMemberGenerationRequest({
	member,
	run,
	career,
	touched,
}: MemberRequestInput): RuntimeGenerationRequest {
	const band = trustBand(run.trust[member.id]);
	const week = weekOf(run.week);
	const known = knownNotes(run, career);
	const mine = notesOf(member.id);
	const told = mine.filter((note) => known.includes(note.id));
	const hidden = mine.filter((note) => !known.includes(note.id));

	const instructions = [
		\`You are \${member.name} (\${member.shortName}). You are \${member.age}, a trainee in year \${member.years} at \${AGENCY.company}. In the debut group your role is \${member.position}.\`,
		\`Personality: \${member.personality}\`,
		\`Way of speaking: \${member.speech}\`,
		"",
		\`The other person is this debut group's manager. Relationship: \${TRUST_BAND_LABEL[band]}. \${TRUST_NOTE[band]}\`,
		\`Your current state: skill \${memberSkill(run.skills[member.id])}, condition \${CONDITION_LABEL(run.condition[member.id])}.\`,
		"",
		\`It is now \${week.title}, with \${Math.max(AGENCY.weeks - run.week, 0)} weeks left until the debut evaluation. This week: \${week.brief}\`,
		"",
		"Your stories the other person already knows; you may bring these up:",
		...(told.length === 0
			? ["- None yet."]
			: told.map((note) => \`- \${note.title}: \${note.short}\`)),
		"",
		...(hidden.length === 0
			? []
			: [
					"What you haven't said yet; you don't bring it up first, and even when asked you don't tell it all at once:",
					...hidden.map((note) => \`- \${NOTES[note.id].title}\`),
					"",
				]),
		/**
		 * The result of this line: **puts an already decided fact into words.**
		 *
		 * The opening decision was already made by \`systems/topics.ts\` from the player's sentence. What the
		 * model is asked here is the attitude matching that result, and even if it is broken, game state does not move by a character.
		 */
		...(touched === null
			? []
			: touched.open
				? [
						"The other person just asked about that story, and this time you decide to tell it. Tell what follows in your own words, without pouring it all out at once:",
						\`- \${NOTES[touched.topic.note].body}\`,
						"",
					]
				: [
						\`The other person just asked about that story, but you don't want to talk about it yet. \${touched.topic.deflect} Don't lie, but don't go into detail.\`,
						"",
					]),
		"Answer in English. One or two sentences at a time, three at most.",
		"Do not narrate the other person's (the manager's) words or actions. Write only what you say.",
		"Do not write stage directions or narration in parentheses.",
		"Do not invent facts not given above, and do not reveal in advance whether the group debuts or how the evaluation goes.",
	].join("\\n");

	return {
		instructions,
		messages: recentMessagesFor(run, member.id),
		maxOutputCharacters: 400,
	};
}
`,
	},
	{
		path: "src/main.tsx",
		content: `import {
	Screen,
	ScrollView,
	usePersistentState,
	useState,
	useStoryState,
} from "@rowcat/runtime";
import { AppShell, type ShellTab } from "./components/app-shell";
import { BriefingScreen } from "./screens/briefing";
import { EndingScreen } from "./screens/ending";
import { EvaluationScreen } from "./screens/evaluation";
import { EveningScreen } from "./screens/evening";
import { OpeningScreen } from "./screens/opening";
import { PlannerScreen } from "./screens/planner";
import { ResultScreen } from "./screens/result";
import { RosterScreen } from "./screens/roster";
import { careerState, freshRun, runState } from "./state";
import { evaluationFor } from "./story/evaluations";
import { resolveEnding } from "./story/endings";
import { type Choice, applyChoice } from "./systems/progression";
import { EMPTY_SLOTS, settleWeek } from "./systems/schedule";
import { stageScore } from "./systems/stats";
import { THEME } from "./theme";
import type { Career, MemberId, Run, Slot } from "./types";
import { type ReplyHandle, useMemberReply } from "./use-member-reply";

/**
 * Eight Weeks to Debut: the entry point.
 *
 * \`\`\`text
 * briefing → planning → results (+ event) → evening (topics · free talk) → [review] → next week … → debut evaluation → end
 * \`\`\`
 *
 * ## What this file holds and does not hold
 *
 * It holds one thing: **how a week passes.** Adding numbers is \`systems/\`'s job, the sentences
 * belong to \`story/\`, and drawing is \`screens/\`'s. If this file started touching stats directly,
 * there would be room for the planner's preview and the real result to diverge, and that mismatch
 * looks like a lie to the player.
 *
 * ## Three lifetimes meet here
 *
 * \`\`\`text
 * useState             open tab            gone on restart
 * useStoryState        this debut group    back to the start on restart
 * usePersistentState   what you learned    lives past a play reset
 * \`\`\`
 *
 * The persistent side is written **only once**, when a run ends. Written inside an effect, the same ending
 * would be counted twice, and that mistake cannot be undone, so the update lives in the hand that turns the screen.
 */
export default function App() {
	const [run, setRun] = useStoryState(runState);
	const [career, setCareer] = usePersistentState(careerState);
	const [tab, setTab] = useState<ShellTab>("flow");
	const reply = useMemberReply(run, setRun, career, setCareer);

	/** Moves to the next week: values that lived only for that week are cleared here. */
	const nextWeek = (current: Run): Run => ({
		...current,
		week: current.week + 1,
		phase: "briefing",
		eveningStep: "pick",
		slots: EMPTY_SLOTS,
		lastResult: [],
		event: null,
		tonight: null,
		spoke: false,
		revealed: null,
	});

	const start = (): void => {
		setRun({ ...freshRun(), phase: "briefing" });
		setTab("flow");
	};

	const confirmWeek = (): void => {
		const outcome = settleWeek(run, run.slots);
		setRun({ ...outcome.run, phase: "result", lastResult: outcome.lines });
	};

	/**
	 * One weekly event choice: **the evening has no choices.**
	 *
	 * The evening's progress is decided by the sentence the player types (\`use-member-reply.ts\`), and that
	 * decision goes through the same \`requirementMet\`: two entrances, one lock rule.
	 */
	const choose = (choice: Choice): void => {
		const applied = applyChoice(run, career, choice);
		setCareer(applied.career);
		setRun({ ...applied.run, event: choice.id });
	};

	const finishEvening = (): void => {
		const evaluation = evaluationFor(run.week);
		if (evaluation !== null) {
			setRun({ ...run, phase: "evaluation" });
			return;
		}
		setRun(nextWeek(run));
	};

	/**
	 * The hand that moves past the final evaluation: **the only place that writes persistent state.**
	 *
	 * It decides the ending and writes that ending, the best score and the run count at once. Counting every
	 * time the screen draws would count the same run twice, and that cannot be undone.
	 */
	const finishEvaluation = (): void => {
		const evaluation = evaluationFor(run.week);
		if (evaluation === null || !evaluation.decisive) {
			setRun(nextWeek(run));
			return;
		}
		const ending = resolveEnding(run, career);
		const score = stageScore(run);
		setCareer({
			...career,
			runs: career.runs + 1,
			bestScore: score > career.bestScore ? score : career.bestScore,
			unlockedEndings: career.unlockedEndings.includes(ending)
				? career.unlockedEndings
				: [...career.unlockedEndings, ending],
		});
		setRun({ ...run, phase: "ending", ending });
	};

	const bare = run.phase === "opening" || run.phase === "ending";

	return (
		<Screen background={THEME.background}>
			<ScrollView style={{ height: "100%" }}>
				<AppShell run={run} runs={career.runs} tab={tab} onTab={setTab} bare={bare}>
					{tab === "roster" && !bare ? (
						<RosterScreen run={run} career={career} />
					) : (
						<Flow
								run={run}
								career={career}
								reply={reply}
								onStart={start}
								onPlan={() => setRun({ ...run, phase: "planning" })}
								onSlots={(slots: readonly (Slot | null)[]) =>
									setRun({ ...run, slots })
								}
								onConfirm={confirmWeek}
								onEvent={choose}
								onEvening={() => setRun({ ...run, phase: "evening" })}
								onPick={(memberId: MemberId) =>
									setRun({
										...run,
										tonight: memberId,
										eveningStep: "talk",
										spoke: false,
										revealed: null,
									})
								}
								onEveningDone={finishEvening}
								onEvaluationDone={finishEvaluation}
							onRestart={start}
						/>
					)}
				</AppShell>
			</ScrollView>
		</Screen>
	);
}

interface FlowProps {
	run: Run;
	career: Career;
	reply: ReplyHandle;
	onStart: () => void;
	onPlan: () => void;
	onSlots: (slots: readonly (Slot | null)[]) => void;
	onConfirm: () => void;
	onEvent: (choice: Choice) => void;
	onEvening: () => void;
	onPick: (memberId: MemberId) => void;
	onEveningDone: () => void;
	onEvaluationDone: () => void;
	onRestart: () => void;
}

/**
 * Which screen we are on: **one saved \`phase\` answers.**
 *
 * As screen state, a restart could express progress at week 5 while the screen stands on the briefing.
 * Which screen you were on is progress too.
 */
function Flow(props: FlowProps) {
	const { run, career, reply } = props;
	switch (run.phase) {
		case "opening":
			return <OpeningScreen career={career} onStart={props.onStart} />;
		case "briefing":
			return <BriefingScreen run={run} onPlan={props.onPlan} />;
		case "planning":
			return (
				<PlannerScreen
					run={run}
					onSlots={props.onSlots}
					onConfirm={props.onConfirm}
				/>
			);
		case "result":
			return (
				<ResultScreen
					run={run}
					career={career}
					onChoose={props.onEvent}
					onNext={props.onEvening}
				/>
			);
		case "evening":
			return (
				<EveningScreen
					run={run}
					career={career}
					reply={reply}
					onPick={props.onPick}
					onDone={props.onEveningDone}
				/>
			);
		case "evaluation": {
			const evaluation = evaluationFor(run.week);
			if (evaluation === null) return <BriefingScreen run={run} onPlan={props.onPlan} />;
			return (
				<EvaluationScreen
					run={run}
					evaluation={evaluation}
					onNext={props.onEvaluationDone}
				/>
			);
		}
		case "ending":
			return (
				<EndingScreen
					ending={run.ending ?? "disbanded"}
					run={run}
					career={career}
					onRestart={props.onRestart}
				/>
			);
	}
}
`,
	},
	{
		path: "src/members.ts",
		content: `import type { RuntimeColor } from "@rowcat/runtime";
import { TINT } from "./theme";
import type { MemberId, Skills } from "./types";

/**
 * The static table of five: **not saved.** Only ids are saved.
 *
 * \`personality\`, \`speech\` and \`guard\` are the material for the generation instructions (generation.ts). The
 * three live here because a character's identity must be in one place: writing instructions per screen
 * would make the same person someone else at the counter and in texts.
 *
 * \`guard\` is *what this person does not easily say*. Before the fragment (notes) opens the model
 * avoids that story, and after it opens it can be told: code does the locking and the instructions only
 * receive the result.
 */
export interface Member {
	id: MemberId;
	name: string;
	/** The name that stands in narrow places. It is also the speaker of lines. */
	shortName: string;
	/** The one letter in the initial circle. When assets arrive, this slot becomes a face. */
	initial: string;
	position: string;
	age: number;
	/** Which trainee year. The briefing and the instructions both read it. */
	years: number;
	accent: RuntimeColor;
	accentSoft: RuntimeColor;
	personality: string;
	speech: string;
	guard: string;
	/** The initial values. The five being uneven is this story's starting point. */
	skills: Skills;
	condition: number;
	trust: number;
}

export const MEMBERS: Record<MemberId, Member> = {
	haram: {
		id: "haram",
		name: "Jung Haram",
		shortName: "Haram",
		initial: "H",
		position: "Leader · Main vocal",
		age: 24,
		years: 7,
		accent: TINT.haram.on,
		accentSoft: TINT.haram.off,
		personality:
			"Has practiced the longest of the five and is therefore the most careful. Takes the team's mistakes as their own and lets nothing slide for themself.",
		speech:
			"Mixes formal and casual speech. Short sentences that don't trail off. Changes the subject when praised.",
		guard:
			"That this is their last debut group, and that they were cut from the last team. They don't bring it up first.",
		skills: { vocal: 62, dance: 44, expression: 48 },
		condition: 70,
		trust: 30,
	},
	yeonwoo: {
		id: "yeonwoo",
		name: "Seo Yeonwoo",
		shortName: "Yeonwoo",
		initial: "Y",
		position: "Main dancer",
		age: 21,
		years: 3,
		accent: TINT.yeonwoo.on,
		accentSoft: TINT.yeonwoo.off,
		personality:
			"Says little and answers with the body instead. Stays in the practice room the latest. Never says it hurts.",
		speech:
			"Never goes past one sentence. Answers when asked but never starts a conversation. Expresses feelings with actions rather than adjectives.",
		guard: "The knee. They haven't told anyone since when it has hurt.",
		skills: { vocal: 34, dance: 71, expression: 52 },
		condition: 62,
		trust: 24,
	},
	siha: {
		id: "siha",
		name: "Moon Siha",
		shortName: "Siha",
		initial: "S",
		position: "Rapper · Lyricist",
		age: 22,
		years: 2,
		accent: TINT.siha.on,
		accentSoft: TINT.siha.off,
		personality:
			"Came from the underground scene and asks why about everything the company wants changed. Not rude, but doesn't back down either.",
		speech:
			"Close to casual and blunt. Sometimes answers a question with a question. Talks at length only about lyrics.",
		guard: "The crew left behind, and the lyrics that went out under someone else's name.",
		skills: { vocal: 41, dance: 46, expression: 66 },
		condition: 74,
		trust: 28,
	},
	roun: {
		id: "roun",
		name: "Han Roun",
		shortName: "Roun",
		initial: "R",
		position: "Youngest · Sub vocal",
		age: 18,
		years: 4,
		accent: TINT.roun.on,
		accentSoft: TINT.roun.off,
		personality:
			"Acts cheerful but thinks of that as work. Reads other people's faces too well, and so is always a little tired.",
		speech:
			"Polite, with lots of exclamations. Asked if they're okay, they always answer that they're okay first.",
		guard: "How many auditions they failed, and that they can't sleep lately.",
		skills: { vocal: 55, dance: 50, expression: 43 },
		condition: 58,
		trust: 36,
	},
	jio: {
		id: "jio",
		name: "Yoon Jio",
		shortName: "Jio",
		initial: "J",
		position: "Visual · Sub rapper",
		age: 20,
		years: 1,
		accent: TINT.jio.on,
		accentSoft: TINT.jio.off,
		personality:
			"Was street-cast, and that fact weighs on them all the time. Can't stop calculating that they started later than the others.",
		speech:
			"Careful at the ends of sentences, folds their own story partway through. Takes praise as a joke.",
		guard: "That they still don't know why they were picked. The math they do in front of the mirror.",
		skills: { vocal: 38, dance: 40, expression: 58 },
		condition: 80,
		trust: 20,
	},
};

/** The list the screen uses to draw in order. Position order, not skill order. */
export const MEMBER_ORDER: readonly MemberId[] = [
	"haram",
	"yeonwoo",
	"siha",
	"roun",
	"jio",
];
`,
	},
	{
		path: "src/state.ts",
		content: `import { definePersistentState, defineStoryState } from "@rowcat/runtime";
import { EMPTY_SLOTS } from "./systems/schedule";
import {
	initialCondition,
	initialSkills,
	initialTrust,
} from "./systems/stats";
import type { Career, Run } from "./types";

/**
 * Two saved states: **different lifetimes, and in this story that difference is the story.**
 *
 * \`\`\`text
 * useState             the screen's business   open panel · slots being planned · input · waiting   gone on restart
 * useStoryState        this debut group        week · stats · condition · trust · sync · dialogue  back to the start on restart
 * usePersistentState   what I know             the five's stories · endings seen · best score       lives past a play reset
 * \`\`\`
 *
 * The third holding no stats is this story's rule. The next debut group starts again from zero skill,
 * and only **what you learned about the people** remains: without that asymmetry this would just be a
 * raising sim that gets stronger every run.
 *
 * Both are defined once at the module top level. Their key spaces are separate, so the same name would not
 * collide, but the names are kept apart for the reader.
 */

/** One new debut group. The definition's \`initial\` and \`Restart\` after the end use the same value. */
export function freshRun(): Run {
	return {
		week: 1,
		phase: "opening",
		eveningStep: "pick",
		slots: EMPTY_SLOTS,
		skills: initialSkills(),
		condition: initialCondition(),
		trust: initialTrust(),
		sync: 20,
		buzz: 12,
		lastResult: [],
		event: null,
		resolved: [],
		tonight: null,
		opened: [],
		spoke: false,
		revealed: null,
		messages: [],
		nextMessageId: 1,
		evaluations: [],
		ending: null,
	};
}

export const runState = defineStoryState<Run>({
	key: "run",
	version: 1,
	initial: freshRun(),
});

export const INITIAL_CAREER: Career = {
	runs: 0,
	notes: [],
	unlockedEndings: [],
	bestScore: 0,
};

export const careerState = definePersistentState<Career>({
	key: "career",
	version: 1,
	initial: INITIAL_CAREER,
});
`,
	},
	{
		path: "src/theme.ts",
		content: `import { type RuntimeColor, color } from "@rowcat/runtime";

/**
 * Colors and dimensions are decided only here: screen files do not scatter \`color("#…")\` or \`fontSize: 13\`
 * around.
 *
 * There are no assets, so this story's impression comes entirely from **type, spacing and surface colors**. A
 * practice room at night: stage-light gold over a purplish dark, with one light per member.
 *
 * ## Five surface tiers and a separate \`line\` are this screen's structure
 *
 * This runtime has no borders or shadows, so the only way to make depth is **stacking surfaces**, and for
 * the stacking's edges to show, the line color has to be separate from the surface colors (\`components/panel.tsx\` holds
 * that method). There are five tiers because the layers stacked on one screen really reach four:
 * floor · card · a cell inside the card · the value inside that cell.
 *
 * ## Dimensions live here too
 *
 * Writing sizes and spacing per screen would make headings of the same rank stand at different sizes on
 * different screens, and that mismatch is invisible when you look at one screen. \`TYPE\` and \`SPACE\` are that one place.
 */
export const THEME = {
	/** The screen's floor. The only surface darker than this is \`sunken\`. */
	background: color("#0b0910"),
	sunken: color("#07060c"),
	surface: color("#16131f"),
	raised: color("#1e1a2b"),
	high: color("#2a2439"),
	line: color("#2f2842"),
	lineSoft: color("#221d31"),
	/**
	 * The empty side of a bar: **must be lighter than the surface to show.**
	 *
	 * For a while it used the darkest surface (\`sunken\`), and then the unfilled part couldn't be told from
	 * the background, so the bar read as "one line" rather than "how full".
	 */
	track: color("#2c2540"),

	text: color("#f4f1fa"),
	textSoft: color("#c9c3dc"),
	muted: color("#948dae"),
	faint: color("#635d7b"),

	/** Stage light. This story's accent color and the color of debut and success. */
	gold: color("#f5c45e"),
	goldSoft: color("#3a2c12"),
	/**
	 * Text on a gold surface: **does not reuse the background color.**
	 *
	 * \`background\` is tinged purple, so on gold the colors mix and turn muddy. The value here is a
	 * brownish ink for that one place.
	 */
	goldInk: color("#191207"),
	/** The color of the company and the system. The briefing and the evaluation use it. */
	stage: color("#a78bfa"),
	stageSoft: color("#292150"),

	rise: color("#6fd6ae"),
	riseSoft: color("#123329"),
	fall: color("#ff8ba0"),
	fallSoft: color("#3a1824"),
	warn: color("#f0a45c"),
	warnSoft: color("#3a2713"),

	/** Where my lines stand. Members' lines use each member's light color. */
	mine: color("#332c57"),
} as const;

/**
 * Members' lights: **kept apart from semantic colors.**
 *
 * For a while the five shared \`gold\`, \`stage\`, \`rise\`, \`warn\` and \`fall\`, and then Roun's color was
 * the color of *condition warnings* and Jio's the color of *decline*. With both on one screen you could not
 * tell whether a color pointed at a person or a state.
 *
 * The five being distinguishable is this table's only condition, so lightness is kept similar and only hue is spread.
 */
export const TINT = {
	haram: { on: color("#f5c45e"), off: color("#3a2c12") },
	yeonwoo: { on: color("#8fb8ff"), off: color("#17223f") },
	siha: { on: color("#6fd6ae"), off: color("#12332a") },
	roun: { on: color("#ffb0cf"), off: color("#3a1c2c") },
	jio: { on: color("#c4a6ff"), off: color("#2a2350") },
} as const;

/**
 * The type ladder: **seven steps.**
 *
 * More steps become noise, not hierarchy. With 13 and 14 on the same screen, they don't read as
 * different ranks; they just look misaligned.
 */
export const TYPE = {
	display: 30,
	title: 21,
	head: 16,
	body: 14,
	small: 12,
	label: 11,
	/** A spot that stands as one number. Only the overall and evaluation scores use it. */
	figure: 34,
} as const;

/** The spacing ladder: the screen's vertical rhythm is built from these four alone. */
export const SPACE = {
	tight: 8,
	row: 12,
	block: 18,
	section: 26,
} as const;

/** The cap on body width: the reason is in the header of \`components/app-shell.tsx\`. */
export const CONTENT_WIDTH = 620;

export type ThemeColor = RuntimeColor;
`,
	},
	{
		path: "src/types.ts",
		content: `/**
 * This story's vocabulary: saved state, static tables and screens use the same names.
 *
 * String unions because saved state is JSON. What is saved is always an **id** (member, activity,
 * fragment, ending), and the sentences, colors and rules that id points at belong to static modules.
 * Saving sentences would make plays in progress keep seeing old text after the manuscript changed.
 */

export type MemberId = "haram" | "yeonwoo" | "siha" | "roun" | "jio";

export const MEMBER_IDS: readonly MemberId[] = [
	"haram",
	"yeonwoo",
	"siha",
	"roun",
	"jio",
];

/** The three skill axes a member has. The group score derives from these values for all five. */
export type SkillId = "vocal" | "dance" | "expression";

export const SKILL_IDS: readonly SkillId[] = ["vocal", "dance", "expression"];

export type Skills = Record<SkillId, number>;

/**
 * An activity for one week. **Only individual coaching has a target**, which is why planning has two steps.
 */
export type ActivityId =
	| "vocal-lesson"
	| "choreo"
	| "expression"
	| "conditioning"
	| "content"
	| "sync"
	| "private"
	| "rest";

/** One planned slot. \`target\` is \`null\` unless it is individual coaching. */
export interface Slot {
	activity: ActivityId;
	target: MemberId | null;
}

/**
 * The flow of a week. This one value is saved, and the screen branches on it.
 *
 * \`evaluation\` stands only at the end of weeks 2 and 5 and in the final week. It is saved as a value rather
 * than derived from the week because whether that screen was read and passed is progress.
 */
export type Phase =
	| "opening"
	| "briefing"
	| "planning"
	| "result"
	| "evening"
	| "evaluation"
	| "ending";

/** Where you can go in the evening. Progress, not the screen's business, so it is saved. */
export type EveningStep = "pick" | "talk";

/**
 * **One fragment of a story learned** about a member. It lasts across runs (persistent state).
 *
 * Five members × three. The last fragment opens only after the first two: that lock is what persistent
 * state does in this story, and \`systems/notes.ts\` alone owns the decision.
 */
export type NoteId =
	| "haram-cut"
	| "haram-throat"
	| "haram-quit"
	| "yeonwoo-knee"
	| "yeonwoo-stage"
	| "yeonwoo-home"
	| "siha-crew"
	| "siha-credit"
	| "siha-why"
	| "roun-audition"
	| "roun-sleep"
	| "roun-parents"
	| "jio-cast"
	| "jio-mirror"
	| "jio-first";

export type EndingId = "disbanded" | "debut" | "five" | "encore";

/** Trust stages: derived from the value and not saved (systems/relationships.ts). */
export type TrustBand = "distant" | "working" | "trusted" | "close";

export type MessageRole = "user" | "assistant";

export interface DialogueMessage {
	id: number;
	memberId: MemberId;
	role: MessageRole;
	content: string;
}

/** One weekly settlement line. A value the screen reads and draws, not the source of a save. */
export interface ResultLine {
	label: string;
	detail: string;
	delta: number;
}

/**
 * **This debut group**: everything in one run. A restart returns this value to the start.
 */
export interface Run {
	week: number;
	phase: Phase;
	eveningStep: EveningStep;
	/**
	 * The three slots being planned now. Cleared when the week changes.
	 *
	 * The length is always three and an empty slot is \`null\`: with a shorter array, filling slot 3 first
	 * would require putting something in slots 1 and 2, and an activity nobody chose would stand on screen.
	 */
	slots: readonly (Slot | null)[];
	skills: Record<MemberId, Skills>;
	condition: Record<MemberId, number>;
	trust: Record<MemberId, number>;
	/** How well the five fit together. Half of the stage is this value. */
	sync: number;
	/** How well known they are outside the company. */
	buzz: number;
	/** This week's settlement result. Replaced when the next week starts. */
	lastResult: readonly ResultLine[];
	/** What happened this week. \`null\` means a week without an event. */
	event: string | null;
	/** Event choices made. Keeps the same week's event from being chosen twice. */
	resolved: readonly string[];
	/** The member you agreed to meet in the evening. */
	tonight: MemberId | null;
	/** Fragments opened this run. They go into persistent state too. */
	opened: readonly NoteId[];
	/**
	 * Whether you talked to this person this evening: trust attaches only to the first line.
	 *
	 * The number of times you talked is not counted because that number would become a currency of trust.
	 * Sending anything ten times must not beat learning one story.
	 */
	spoke: boolean;
	/** The fragment opened this evening. The screen learns here whether to stand a card. */
	revealed: NoteId | null;
	messages: readonly DialogueMessage[];
	nextMessageId: number;
	evaluations: readonly number[];
	ending: EndingId | null;
}

/**
 * **What lasts across runs.** The side the product's \`Reset play\` does not reach.
 *
 * Only three things live here, and all three are *what I learned*: neither stats nor condition remain.
 * The next debut group starts from scratch, but someone who knows the five starts it.
 */
export interface Career {
	runs: number;
	notes: readonly NoteId[];
	unlockedEndings: readonly EndingId[];
	bestScore: number;
}
`,
	},
	{
		path: "src/use-member-reply.ts",
		content: `import {
	RUNTIME_ERROR_CODE,
	RuntimeError,
	type RuntimeSetState,
	useGeneration,
	useState,
} from "@rowcat/runtime";
import { buildMemberGenerationRequest } from "./generation";
import { MEMBERS } from "./members";
import { appendMessage, awaitsReply } from "./systems/dialogue";
import { applyFirstWord, applyTopicOpen } from "./systems/progression";
import { matchTopic, type TopicMatch } from "./systems/topics";
import type { Career, MemberId, Run } from "./types";

/**
 * **The one channel** for speaking to a member and getting an answer.
 *
 * The evening input row and the member detail input row go through the same hook. If each called
 * \`useGeneration()\`, there would be two waiting states, one could send again while the other waits, and the generation
 * logic (building requests · folding failures · saving) would exist twice.
 *
 * \`\`\`text
 * send()   keep my line in saved state first  →  generate()  →  put the answer into saved state
 * retry()  call again with the same log: my line is not stacked twice
 * \`\`\`
 *
 * ## My line stays on failure, and **what was learned stays too**
 *
 * The provider's refusal has nothing to do with the fact that the user said it. No fake answer is made;
 * \`Retry\` stands instead. The failure sentence is ours: the provider's original error never reaches the screen.
 *
 * What is learned is decided **at the moment of sending** (\`matchTopic\`). That decision standing **before**
 * generation is this hook's whole order: what is learned comes from the player asking, not from the model
 * answering, so progress stands even in a preview with AI off.
 *
 * ## Retry does not reopen
 *
 * The fragment is already open, so \`retry()\` **does not decide again**: a state where the same line opens
 * twice must not be expressible (\`applyTopicOpen\` returns known fragments as is, but it cannot stop trust
 * rising twice), and above all a retry is *the same request once more*.
 */
export interface ReplyHandle {
	pending: boolean;
	/** Whose answer we are waiting for now. */
	pendingFor: MemberId | null;
	failure: string | null;
	send(memberId: MemberId, text: string): void;
	retry(memberId: MemberId): void;
	canRetry(memberId: MemberId): boolean;
	dismissFailure(): void;
}

/** The topic the last line touched: held so a retry uses the same instructions. */
interface LastTouch {
	memberId: MemberId;
	match: TopicMatch | null;
}

function messageFor(error: unknown): string {
	const code = error instanceof RuntimeError ? error.code : null;
	if (code === RUNTIME_ERROR_CODE.generationUnavailable)
		return "AI is off in this preview. Turn it on in the preview header, then restart.";
	if (code === RUNTIME_ERROR_CODE.generationBusy)
		return "The previous answer is still on its way.";
	if (code === RUNTIME_ERROR_CODE.generationCancelled)
		return "Stopped while waiting for an answer.";
	return "Couldn't get an answer. Please try again in a moment.";
}

export function useMemberReply(
	run: Run,
	setRun: RuntimeSetState<Run>,
	career: Career,
	setCareer: RuntimeSetState<Career>,
): ReplyHandle {
	const generation = useGeneration();
	const [pendingFor, setPendingFor] = useState<MemberId | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [lastTouch, setLastTouch] = useState<LastTouch | null>(null);

	/**
	 * Gets an answer for one log and appends it: sending and retrying go through the same function.
	 * The request is built from the state passed in, so my line just added is in the request.
	 */
	async function reply(
		history: Run,
		memberId: MemberId,
		touched: TopicMatch | null,
	): Promise<void> {
		setPendingFor(memberId);
		setFailure(null);
		try {
			const request = buildMemberGenerationRequest({
				member: MEMBERS[memberId],
				run: history,
				career,
				touched,
			});
			const result = await generation.generate(request);
			const answer = result.text.trim();
			if (answer.length === 0) {
				setFailure("The answer was empty. Please try again.");
				return;
			}
			/** A functional update: nothing is lost even if other updates happened while waiting. */
			setRun((current) => appendMessage(current, memberId, "assistant", answer));
		} catch (error) {
			setFailure(messageFor(error));
		} finally {
			setPendingFor(null);
		}
	}

	return {
		pending: pendingFor !== null,
		pendingFor,
		failure,
		/**
		 * The order is the rule: **keep my line · decide the topic · then call.**
		 */
		send: (memberId, text) => {
			const trimmed = text.trim();
			if (trimmed.length === 0 || pendingFor !== null) return;
			const touched = matchTopic(run, career, memberId, trimmed);
			let next = appendMessage(run, memberId, "user", trimmed);
			next = applyFirstWord(next, memberId);
			if (touched !== null && touched.open) {
				const spoken = applyTopicOpen(
					next,
					career,
					memberId,
					touched.topic.note,
					touched.topic.trust,
				);
				next = spoken.run;
				if (spoken.career !== career) setCareer(spoken.career);
			}
			setRun(next);
			setLastTouch({ memberId, match: touched });
			void reply(next, memberId, touched);
		},
		retry: (memberId) => {
			if (pendingFor !== null) return;
			if (!awaitsReply(run, memberId)) return;
			void reply(
				run,
				memberId,
				lastTouch !== null && lastTouch.memberId === memberId
					? lastTouch.match
					: null,
			);
		},
		canRetry: (memberId) => pendingFor === null && awaitsReply(run, memberId),
		dismissFailure: () => setFailure(null),
	};
}
`,
	},
];
