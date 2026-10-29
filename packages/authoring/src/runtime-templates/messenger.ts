import type { RuntimeTemplate } from "./types.ts";

/**
 * Messenger is a free-text AI conversation with three lifetimes:
 * - useState: input line, waiting state, tabs. Lost on restart.
 * - useStoryState: the conversation log. Kept across restarts.
 * - useGeneration: the trusted RowCat generation stack. The creator does not choose the provider,
 *   model, or pricing. Replies used to be a pre-written script, justified by the absence of a
 *   generation API. Once that basis disappeared, the script was removed too. Choice buttons are not
 *   this template's main interaction. The model is never asked to return hidden JSON or tokens such
 *   as [UNLOCK:key]. That approach is brittle and would teach that parsing model text is the save
 *   rule. The AI produces one piece of text; the creator's code decides whether it enters the
 *   conversation.
 */
export const MESSENGER_TEMPLATE: RuntimeTemplate = {
	id: "messenger",
	name: "Messenger",
	description:
		"A conversation screen where the AI replies to messages you type. The conversation is saved.",
	category: "social",
	complexity: "intermediate",
	demonstrates: [
		"Free input received with TextInput",
		"RowCat AI called with useGeneration()",
		"Screen useState and progress useStoryState",
		"Your message stays on failure, with retry",
	],
	entry: "src/main.tsx",
	files: [
		{
			path: "src/character.ts",
			content: `/**
 * Who Sena is: **this is where the creator edits.**
 *
 * These sentences become the \`instructions\` of \`useGeneration()\` as they are. They do not
 * replace the host's safety instructions; they are application content that stands **between**
 * them, so writing "ignore previous instructions" here does nothing.
 *
 * To change the character, edit only this file. Neither the screen nor saving reads these sentences.
 */

export const CONTACT = {
	name: "Sena",
	role: "Same club · library assistant",
	status: "Online",
};

export const CHARACTER_PROMPT = [
	"You are Sena, a high school student who works as the library assistant in the book club.",
	"Reply briefly, as in a messenger chat. One or two sentences at a time is enough.",
	"Do not narrate the other person's (the player's) words or actions. Write only what Sena says.",
	"Do not write stage directions or narration in parentheses. Write exactly what you would send in a messenger.",
	"",
	"Yesterday Sena saw that the old reading room, locked for ten years, was open.",
	"It has been on her mind, so she brought it up first.",
	"Do not pour out everything unasked at once; tell the story only as far as the conversation goes.",
	"She is quiet, but once she starts a story she finishes it.",
].join("\\n");

/**
 * **How much recent conversation** goes to the model.
 *
 * The whole stored record is not sent for two reasons: longer requests cost more, and the runtime has
 * a request limit. The screen still draws everything stored.
 */
export const CONTEXT_MESSAGES = 24;

/**
 * The **maximum number of lines** kept in saved state.
 *
 * Saved state has a limit, and the demo is not left to grow until it hits that limit. Past it,
 * the oldest lines are dropped first: the point is to choose one rule explicitly.
 */
export const MAX_SAVED_MESSAGES = 80;
`,
		},
		{
			path: "src/state.ts",
			content: `import { defineStoryState } from "@rowcat/runtime";
import { MAX_SAVED_MESSAGES } from "./character";

/**
 * Saved state **belongs to this playthrough**.
 *
 * \`\`\`text
 * useStoryState   conversation log          continues after restart
 * useState        input · waiting · tab     starts over after restart
 * \`\`\`
 *
 * The AI's reply enters saved state at **one setter the creator calls**. The host does not quietly
 * append messages, so this file decides what to keep and in what order.
 */

export interface Message {
	id: number;
	role: "user" | "assistant";
	content: string;
}

export interface MessengerProgress {
	messages: Message[];
	/** The next message's number. No time or random values, because saving must be deterministic. */
	nextId: number;
}

const START: MessengerProgress = { messages: [], nextId: 1 };

export const messengerProgress = defineStoryState<MessengerProgress>({
	key: "messenger",
	version: 1,
	initial: START,
});

/** Drops the oldest lines first: one rule, and the screen and the request see the same list. */
function capped(messages: Message[]): Message[] {
	if (messages.length <= MAX_SAVED_MESSAGES) return messages;
	return messages.slice(messages.length - MAX_SAVED_MESSAGES);
}

/** Adds one line. Pure, and gives the same result for the same input. */
export function appendMessage(
	progress: MessengerProgress,
	role: "user" | "assistant",
	content: string,
): MessengerProgress {
	const message: Message = { id: progress.nextId, role, content };
	return {
		messages: capped([...progress.messages, message]),
		nextId: progress.nextId + 1,
	};
}

/** Whether the last line is my message still awaiting a reply: what qualifies \`Retry\` to stand. */
export function awaitsReply(progress: MessengerProgress): boolean {
	const last = progress.messages[progress.messages.length - 1];
	return last !== undefined && last.role === "user";
}
`,
		},
		{
			path: "src/components/contact-header.tsx",
			content: `import { Row, Stack, Text, View, color } from "@rowcat/runtime";

export interface ContactHeaderProps {
	name: string;
	status: string;
}

export function ContactHeader({ name, status }: ContactHeaderProps) {
	return (
		<Row gap={12} style={{ padding: 16, align: "center" }}>
			{/* Until an asset host is attached, the face slot holds one initial. */}
			<View
				style={{
					width: 40,
					height: 40,
					borderRadius: 20,
					justify: "center",
					align: "center",
					backgroundColor: color("#2f6df6"),
				}}
			>
				<Text
					style={{ color: color("#ffffff"), fontSize: 16, fontWeight: "bold" }}
				>
					{name.slice(0, 1)}
				</Text>
			</View>
			<Stack gap={2}>
				<Text
					style={{
						color: color("#f2f5fa"),
						fontSize: 16,
						fontWeight: "medium",
					}}
				>
					{name}
				</Text>
				<Text style={{ color: color("#79839a"), fontSize: 12 }}>{status}</Text>
			</Stack>
		</Row>
	);
}
`,
		},
		{
			path: "src/components/chat-bubble.tsx",
			content: `import { Row, Text, View, color } from "@rowcat/runtime";

export interface ChatBubbleProps {
	mine: boolean;
	text: string;
}

/**
 * Only alignment and surface color differ by sender.
 * It is not split into two components because there is one rule.
 */
export function ChatBubble({ mine, text }: ChatBubbleProps) {
	return (
		<Row style={{ justify: mine ? "end" : "start" }}>
			<View
				style={{
					padding: 12,
					borderRadius: 16,
					width: "78%",
					backgroundColor: mine ? color("#2f6df6") : color("#1a1f2b"),
				}}
			>
				<Text
					style={{
						color: mine ? color("#ffffff") : color("#dde3ee"),
						fontSize: 15,
					}}
				>
					{text}
				</Text>
			</View>
		</Row>
	);
}
`,
		},
		{
			path: "src/components/app-tabs.tsx",
			content: `import { Pressable, Row, Text, color } from "@rowcat/runtime";

export type TabId = "chat" | "profile";

export const TABS: readonly { id: TabId; label: string }[] = [
	{ id: "chat", label: "Chat" },
	{ id: "profile", label: "Profile" },
];

export interface AppTabsProps {
	active: TabId;
	onSelect: (id: TabId) => void;
}

export function AppTabs({ active, onSelect }: AppTabsProps) {
	return (
		<Row gap={8} style={{ padding: 12 }}>
			{TABS.map((tab) => (
				<Pressable
					key={tab.id}
					onPress={() => onSelect(tab.id)}
					style={{
						grow: 1,
						padding: 10,
						borderRadius: 12,
						justify: "center",
						align: "center",
						backgroundColor:
							tab.id === active ? color("#232b3b") : color("#12161f"),
					}}
				>
					<Text
						style={{
							fontSize: 13,
							fontWeight: tab.id === active ? "bold" : "regular",
							color: tab.id === active ? color("#ffffff") : color("#79839a"),
						}}
					>
						{tab.label}
					</Text>
				</Pressable>
			))}
		</Row>
	);
}
`,
		},
		{
			path: "src/components/composer.tsx",
			content: `import {
	Button,
	Row,
	type RuntimeTextEntryController,
	TextInput,
	color,
	type RuntimeColor,
} from "@rowcat/runtime";

export interface ComposerProps {
	value: string;
	pending: boolean;
	/**
	 * A handle that moves this input's focus from outside. It is the value \`useTextEntryController()\` made,
	 * neither a DOM element nor a native reference: it opens only \`focus()\` and \`blur()\`.
	 */
	controller: RuntimeTextEntryController;
	onChange: (value: string) => void;
	onSend: () => void;
}

const SURFACE: RuntimeColor = color("#0d1117");

/**
 * The input row: **one controlled input and one button.**
 *
 * \`value\` is required, so state outside this component always knows what is written now. Enter
 * arrives as \`onSubmit\`, and Enter while composing Korean, Japanese or Chinese **does not arrive** (the platform treats it
 * as the confirm key).
 */
export function Composer({
	value,
	pending,
	controller,
	onChange,
	onSend,
}: ComposerProps) {
	const empty = value.trim().length === 0;
	return (
		<Row
			gap={8}
			style={{ padding: 12, align: "center", backgroundColor: SURFACE }}
		>
			<TextInput
				controller={controller}
				value={value}
				placeholder={pending ? "Waiting for a reply…" : "Type a message…"}
				disabled={pending}
				onChangeText={onChange}
				onSubmit={onSend}
				style={{ grow: 1, backgroundColor: color("#12161f") }}
				textStyle={{ color: color("#e6ecf7"), fontSize: 15 }}
			/>
			<Button tone="primary" disabled={pending || empty} onPress={onSend}>
				Send
			</Button>
		</Row>
	);
}
`,
		},
		{
			path: "src/main.tsx",
			content: `import {
	Pressable,
	RUNTIME_ERROR_CODE,
	Row,
	RuntimeError,
	Screen,
	ScrollView,
	Stack,
	Text,
	View,
	color,
	useGeneration,
	useMemo,
	useScrollController,
	useState,
	useStoryState,
	useTextEntryController,
} from "@rowcat/runtime";
import { AppTabs, type TabId } from "./components/app-tabs";
import { ChatBubble } from "./components/chat-bubble";
import { Composer } from "./components/composer";
import { ContactHeader } from "./components/contact-header";
import { CHARACTER_PROMPT, CONTACT, CONTEXT_MESSAGES } from "./character";
import {
	appendMessage,
	awaitsReply,
	messengerProgress,
	type MessengerProgress,
} from "./state";

/**
 * Free-input AI conversation: **there are no choices.**
 *
 * \`\`\`text
 * input (useState)  →  Send  →  my message is kept in saved state first
 *                                ↓  useGeneration().generate(...)
 *                            the trusted RowCat generation stack (we do not choose provider, model or cost)
 *                                ↓
 *                            **the creator** puts the returned text into saved state
 * \`\`\`
 *
 * ## My message stays even on failure
 *
 * When generation fails, the message just sent is not rolled back: the user really sent it, and the
 * provider's refusal has nothing to do with that fact. Instead \`Retry\` stands, and it regenerates
 * **from the same log** (the same message is not stacked twice).
 *
 * ## Nothing is called on mount
 *
 * No first greeting is made with \`useEffect\`. Otherwise merely opening the draft would spend someone's
 * key, and once more on every restart. The first request is always a \`Send\` a person pressed.
 */

/** Failure reason → the one line the user reads. The provider's original sentence never reaches the screen. */
function messageFor(error: unknown): string {
	const code = error instanceof RuntimeError ? error.code : null;
	if (code === RUNTIME_ERROR_CODE.generationUnavailable)
		return "AI is off in this preview. Turn it on in the preview header, then restart.";
	if (code === RUNTIME_ERROR_CODE.generationNotAuthorized)
		return "Replies aren't available right now.";
	if (code === RUNTIME_ERROR_CODE.generationBusy)
		return "The previous reply is still on its way.";
	if (code === RUNTIME_ERROR_CODE.generationCancelled)
		return "Stopped while waiting for a reply.";
	return "Couldn't get a reply. Please try again in a moment.";
}

export default function App() {
	/** Which tab is open is the screen's business: a restart returns to the chat. */
	const [tab, setTab] = useState<TabId>("chat");
	/** Text not yet sent: not saved. A restart leaves the field empty. */
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	/** The conversation log belongs to the playthrough: it continues after a restart. */
	const [progress, setProgress] = useStoryState(messengerProgress);

	const generation = useGeneration();
	/**
	 * Handles for the conversation list and the input: these two are all of this screen's "do it once" commands.
	 *
	 * They are the same objects while mounted, so passing them as props does not resend them every commit.
	 */
	const scroll = useScrollController();
	const composer = useTextEntryController();
	const canRetry = useMemo(
		() => !pending && awaitsReply(progress),
		[pending, progress],
	);

	/**
	 * Gets a reply for one log and appends it: **sending and retrying go through the same function.**
	 *
	 * Taking the log as an argument is the point. Sending passes the list just extended and retrying passes
	 * the current list as is, so the two stacking the same message twice is not expressible.
	 */
	async function reply(history: MessengerProgress) {
		setPending(true);
		setFailure(null);
		try {
			const recent = history.messages.slice(-CONTEXT_MESSAGES);
			const result = await generation.generate({
				instructions: CHARACTER_PROMPT,
				messages: recent.map((message) => ({
					role: message.role,
					content: message.content,
				})),
				maxOutputCharacters: 600,
			});
			const answer = result.text.trim();
			if (answer.length === 0) {
				setFailure("The reply was empty. Please try again.");
				return;
			}
			/**
			 * A functional update, so nothing is lost even if another update happened meanwhile. The AI's result
			 * is a **suggestion**, and this one line is what puts it into the conversation.
			 */
			setProgress((current) => appendMessage(current, "assistant", answer));
			/**
			 * Goes down **after** the reply is appended. Commands apply after that state change reaches the
			 * screen, so there is nothing to wait for or defer here.
			 */
			scroll.scrollToEnd();
		} catch (error) {
			/** My message stays as is: rolling it back would make a conversation the user never sent. */
			setFailure(messageFor(error));
		} finally {
			setPending(false);
		}
	}

	function send() {
		const text = draft.trim();
		if (text.length === 0 || pending) return;
		const next = appendMessage(progress, "user", text);
		setDraft("");
		setProgress(next);
		/** To where the message just added is visible: the end **after** it grew. */
		scroll.scrollToEnd();
		void reply(next);
	}

	function retry() {
		if (pending) return;
		void reply(progress);
	}

	return (
		<Screen background={color("#0a0d14")}>
			<Stack style={{ height: "100%" }}>
				<ContactHeader name={CONTACT.name} status={CONTACT.status} />

				{tab === "chat" && (
					<Stack style={{ grow: 1 }}>
						<ScrollView controller={scroll} style={{ grow: 1, padding: 16 }}>
							<Stack gap={10}>
								{progress.messages.length === 0 && (
									<Text style={{ color: color("#79839a"), fontSize: 14 }}>
										{"Say something to " + CONTACT.name + " first."}
									</Text>
								)}
								{progress.messages.map((message) => (
									<ChatBubble
										key={String(message.id)}
										mine={message.role === "user"}
										text={message.content}
									/>
								))}
								{pending && (
									<Text style={{ color: color("#79839a"), fontSize: 13 }}>
										{CONTACT.name + " is typing…"}
									</Text>
								)}
							</Stack>
						</ScrollView>

						{failure !== null && (
							<Row gap={8} style={{ padding: 12, align: "center" }}>
								<View style={{ grow: 1 }}>
									<Text style={{ color: color("#ff9a9a"), fontSize: 13 }}>
										{failure}
									</Text>
								</View>
								{canRetry && (
									<Pressable
										onPress={retry}
										style={{
											padding: 8,
											borderRadius: 10,
											backgroundColor: color("#232b3b"),
										}}
									>
										<Text style={{ color: color("#c7d2e6"), fontSize: 13 }}>
											Retry
										</Text>
									</Pressable>
								)}
							</Row>
						)}

						<Composer
							value={draft}
							pending={pending}
							controller={composer}
							onChange={setDraft}
							onSend={send}
						/>
					</Stack>
				)}

				{tab === "profile" && (
					<ScrollView style={{ grow: 1, padding: 16 }}>
						<Stack gap={16}>
							<Stack gap={4}>
								<Text
									style={{
										color: color("#f2f5fa"),
										fontSize: 18,
										fontWeight: "bold",
									}}
								>
									{CONTACT.name}
								</Text>
								<Text style={{ color: color("#79839a"), fontSize: 13 }}>
									{CONTACT.role}
								</Text>
							</Stack>

							<Stack gap={6}>
								<Text
									style={{
										color: color("#79839a"),
										fontSize: 12,
										fontWeight: "medium",
									}}
								>
									Chat
								</Text>
								<Text style={{ color: color("#c7d2e6"), fontSize: 13 }}>
									{"Messages exchanged: " +
										String(progress.messages.length) +
										""}
								</Text>
								<Text style={{ color: color("#79839a"), fontSize: 12 }}>
									The conversation is saved progress. It stays after a restart, and the input
									is cleared.
								</Text>
							</Stack>
						</Stack>
					</ScrollView>
				)}

				<AppTabs
					active={tab}
					onSelect={(next) => {
						setTab(next);
						/**
						 * Makes the input ready to use on returning to the chat: **one explicit command**.
						 * The runtime does not give focus on its own just because an input was drawn.
						 */
						if (next === "chat") composer.focus();
					}}
				/>
			</Stack>
		</Screen>
	);
}
`,
		},
	],
};
