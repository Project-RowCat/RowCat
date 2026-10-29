// Generated from docs/public/runtime/**/*.md — example projects from the docs; tests run them through the real compiler.
// Do not edit directly.
//
// Edit the source md and regenerate with `pnpm --filter web gen:runtime-docs`. If this file drifts
// from its source, runtime-docs-source.test.ts breaks. (examples)

export interface RuntimeDocExampleFile {
	path: string;
	content: string;
}

export interface RuntimeDocExample {
	id: string;
	/** Slug of the doc this example is written in. */
	doc: string;
	entry: string;
	files: readonly RuntimeDocExampleFile[];
}

export const RUNTIME_DOC_EXAMPLES: readonly RuntimeDocExample[] = [
	{
		id: "audio",
		doc: "reference/components",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import { Audio, Button, Stack, asset, useState } from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst [playing, setPlaying] = useState(false);\n\n\treturn (\n\t\t<Stack>\n\t\t\t<Audio\n\t\t\t\tsource={asset(\"audio/bgm/main\")}\n\t\t\t\tplaying={playing}\n\t\t\t\tloop\n\t\t\t\tvolume={0.5}\n\t\t\t/>\n\n\t\t\t<Button onPress={() => setPlaying((value) => !value)}>\n\t\t\t\t{playing ? \"음악 끄기\" : \"음악 켜기\"}\n\t\t\t</Button>\n\t\t</Stack>\n\t);\n}\n" },
		],
	},
	{
		id: "generation",
		doc: "concepts/generation",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import {\n\tButton,\n\tRow,\n\tScreen,\n\tScrollView,\n\tStack,\n\tText,\n\tTextInput,\n\tcolor,\n\tdefineStoryState,\n\tuseGeneration,\n\tuseState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\ninterface Line {\n\trole: \"user\" | \"assistant\";\n\tcontent: string;\n}\n\nconst chat = defineStoryState({\n\tkey: \"chat\",\n\tversion: 1,\n\tinitial: { lines: [] as Line[] },\n});\n\nconst SENA =\n\t\"당신은 세나입니다. 도서부 사서 보조 학생이고, 메신저로 대화하듯 한국어로 한두 문장만 답합니다.\";\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(chat);\n\tconst [draft, setDraft] = useState(\"\");\n\tconst [pending, setPending] = useState(false);\n\tconst [failure, setFailure] = useState<string | null>(null);\n\tconst generation = useGeneration();\n\n\tasync function reply(lines: Line[]) {\n\t\tsetPending(true);\n\t\tsetFailure(null);\n\t\ttry {\n\t\t\tconst result = await generation.generate({\n\t\t\t\tinstructions: SENA,\n\t\t\t\tmessages: lines.slice(-10),\n\t\t\t\tmaxOutputCharacters: 600,\n\t\t\t});\n\t\t\tsetState((current) => ({\n\t\t\t\tlines: [...current.lines, { role: \"assistant\", content: result.text }],\n\t\t\t}));\n\t\t} catch {\n\t\t\tsetFailure(\"답장을 받지 못했습니다. 다시 시도해 주세요.\");\n\t\t} finally {\n\t\t\tsetPending(false);\n\t\t}\n\t}\n\n\tfunction send() {\n\t\tconst text = draft.trim();\n\t\tif (text.length === 0 || pending) return;\n\t\tconst lines: Line[] = [...state.lines, { role: \"user\", content: text }];\n\t\tsetDraft(\"\");\n\t\tsetState({ lines });\n\t\tvoid reply(lines);\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack style={{ height: \"100%\", padding: 16, gap: 8 }}>\n\t\t\t\t<ScrollView style={{ grow: 1 }}>\n\t\t\t\t\t<Stack gap={6}>\n\t\t\t\t\t\t{state.lines.map((line, index) => (\n\t\t\t\t\t\t\t<Text\n\t\t\t\t\t\t\t\tkey={index}\n\t\t\t\t\t\t\t\tstyle={{\n\t\t\t\t\t\t\t\t\talign: line.role === \"user\" ? \"end\" : \"start\",\n\t\t\t\t\t\t\t\t\tcolor: line.role === \"user\" ? color(\"#7dd3fc\") : color(\"#f5f7fa\"),\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t{line.content}\n\t\t\t\t\t\t\t</Text>\n\t\t\t\t\t\t))}\n\t\t\t\t\t</Stack>\n\t\t\t\t</ScrollView>\n\t\t\t\t{failure !== null && (\n\t\t\t\t\t<Row gap={8}>\n\t\t\t\t\t\t<Text style={{ color: color(\"#fca5a5\") }}>{failure}</Text>\n\t\t\t\t\t\t<Button tone=\"secondary\" onPress={() => reply(state.lines)}>\n\t\t\t\t\t\t\t다시 시도\n\t\t\t\t\t\t</Button>\n\t\t\t\t\t</Row>\n\t\t\t\t)}\n\t\t\t\t<Row gap={8}>\n\t\t\t\t\t<TextInput\n\t\t\t\t\t\tvalue={draft}\n\t\t\t\t\t\tplaceholder={pending ? \"세나가 입력 중…\" : \"메시지\"}\n\t\t\t\t\t\tdisabled={pending}\n\t\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\t\tonSubmit={send}\n\t\t\t\t\t\tstyle={{ grow: 1 }}\n\t\t\t\t\t/>\n\t\t\t\t\t<Button onPress={send} disabled={pending || draft.trim().length === 0}>\n\t\t\t\t\t\t보내기\n\t\t\t\t\t</Button>\n\t\t\t\t</Row>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n" },
		],
	},
	{
		id: "managed-image",
		doc: "concepts/assets",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import { Image, Stack, Text, asset } from \"@rowcat/runtime\";\n\nexport default function App() {\n\treturn (\n\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t<Image\n\t\t\t\tsource={asset(\"characters/sena/smile\")}\n\t\t\t\talt=\"세나\"\n\t\t\t\tfit=\"cover\"\n\t\t\t\tstyle={{ width: 96, height: 96, borderRadius: 48 }}\n\t\t\t/>\n\t\t\t<Text>세나가 카운터 뒤에서 고개를 들었다.</Text>\n\t\t</Stack>\n\t);\n}\n" },
		],
	},
	{
		id: "migration",
		doc: "concepts/state",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import { Screen, Text, useStoryState } from \"@rowcat/runtime\";\nimport { progress } from \"./state\";\n\nexport default function App() {\n\tconst [state] = useStoryState(progress);\n\treturn (\n\t\t<Screen>\n\t\t\t<Text>{state.chapter}장</Text>\n\t\t</Screen>\n\t);\n}\n" },
			{ path: "src/state.ts", content: "import { defineStoryState } from \"@rowcat/runtime\";\n\ninterface ProgressV2 {\n\tchapter: number;\n\tclues: string[];\n}\n\nexport const progress = defineStoryState({\n\tkey: \"progress\",\n\tversion: 2,\n\tinitial: { chapter: 1, clues: [] } as ProgressV2,\n\tmigrate: (stored, fromVersion): ProgressV2 => {\n\t\tif (fromVersion === 1) {\n\t\t\t// 1판에는 clues가 없었다\n\t\t\tconst old = stored as { chapter: number };\n\t\t\treturn { chapter: old.chapter, clues: [] };\n\t\t}\n\t\tthrow new Error(`알 수 없는 판: ${fromVersion}`);\n\t},\n});\n" },
		],
	},
	{
		id: "multi-file",
		doc: "project-structure",
		entry: "src/main.tsx",
		files: [
			{ path: "src/components/CharacterCard.tsx", content: "import { Row, Stack, Text } from \"@rowcat/runtime\";\nimport type { Character } from \"../game\";\n\nexport function CharacterCard({ character }: { character: Character }) {\n\treturn (\n\t\t<Stack gap={4} style={{ padding: 12, borderRadius: 8 }}>\n\t\t\t<Text style={{ fontWeight: \"bold\" }}>{character.name}</Text>\n\t\t\t<Row gap={8}>\n\t\t\t\t<Text>신뢰</Text>\n\t\t\t\t<Text>{character.trust}</Text>\n\t\t\t</Row>\n\t\t</Stack>\n\t);\n}\n" },
			{ path: "src/game.ts", content: "import { defineStoryState } from \"@rowcat/runtime\";\n\nexport interface Character {\n\tname: string;\n\ttrust: number;\n}\n\nexport const party = defineStoryState({\n\tkey: \"party\",\n\tversion: 1,\n\tinitial: {\n\t\tmembers: [\n\t\t\t{ name: \"세나\", trust: 40 },\n\t\t\t{ name: \"민재\", trust: 10 },\n\t\t] as Character[],\n\t},\n});\n\n/** 신뢰는 0~100 사이에서만 움직인다 — 규칙은 화면이 아니라 여기 있다. */\nexport function adjustTrust(character: Character, delta: number): Character {\n\treturn {\n\t\t...character,\n\t\ttrust: Math.max(0, Math.min(100, character.trust + delta)),\n\t};\n}\n" },
			{ path: "src/main.tsx", content: "import { Button, Screen, Stack, useStoryState } from \"@rowcat/runtime\";\nimport { CharacterCard } from \"./components/CharacterCard\";\nimport { adjustTrust, party } from \"./game\";\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(party);\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t\t{state.members.map((member) => (\n\t\t\t\t\t<CharacterCard key={member.name} character={member} />\n\t\t\t\t))}\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\tmembers: current.members.map((member) =>\n\t\t\t\t\t\t\t\tmember.name === \"세나\" ? adjustTrust(member, 5) : member,\n\t\t\t\t\t\t\t),\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t세나와 이야기하기\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n" },
		],
	},
	{
		id: "persistent-state",
		doc: "concepts/state",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tdefinePersistentState,\n\tdefineStoryState,\n\tusePersistentState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst run = defineStoryState({\n\tkey: \"run\",\n\tversion: 1,\n\tinitial: { scene: \"intro\" as \"intro\" | \"ending\" },\n});\n\nconst record = definePersistentState({\n\tkey: \"record\",\n\tversion: 1,\n\tinitial: { endings: [] as string[], runs: 0 },\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(run);\n\tconst [meta, setMeta] = usePersistentState(record);\n\n\tfunction finish(ending: string) {\n\t\tsetState({ scene: \"ending\" });\n\t\tsetMeta((current) => ({\n\t\t\truns: current.runs + 1,\n\t\t\tendings: current.endings.includes(ending)\n\t\t\t\t? current.endings\n\t\t\t\t: [...current.endings, ending],\n\t\t}));\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<Text>본 엔딩 {meta.endings.length}개 · {meta.runs}회차</Text>\n\t\t\t\t{state.scene === \"intro\" ? (\n\t\t\t\t\t<Button onPress={() => finish(\"새벽\")}>새벽 엔딩으로</Button>\n\t\t\t\t) : (\n\t\t\t\t\t<Text>끝. 플레이 초기화로 새 회차를 시작하세요.</Text>\n\t\t\t\t)}\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n" },
		],
	},
	{
		id: "quick-start",
		doc: "quick-start",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tcolor,\n\tdefineStoryState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst game = defineStoryState({\n\tkey: \"game\",\n\tversion: 1,\n\tinitial: {\n\t\tchapter: 1,\n\t},\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(game);\n\n\treturn (\n\t\t<Screen background={color(\"#0b0d12\")}>\n\t\t\t<Stack gap={12} style={{ padding: 24 }}>\n\t\t\t\t<Text style={{ color: color(\"#f5f7fa\"), fontSize: 22, fontWeight: \"bold\" }}>\n\t\t\t\t\t{state.chapter}장\n\t\t\t\t</Text>\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\tchapter: current.chapter + 1,\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t계속\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n" },
		],
	},
	{
		id: "remote-image",
		doc: "concepts/assets",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import { Image, Stack, Text, asset } from \"@rowcat/runtime\";\n\nexport default function App() {\n\treturn (\n\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t<Image\n\t\t\t\tsource={asset(\"https://cdn.example.com/characters/sena.webp\")}\n\t\t\t\talt=\"세나\"\n\t\t\t\tfit=\"cover\"\n\t\t\t\tstyle={{ width: 96, height: 96, borderRadius: 48 }}\n\t\t\t/>\n\t\t\t<Text>세나가 카운터 뒤에서 고개를 들었다.</Text>\n\t\t</Stack>\n\t);\n}\n" },
		],
	},
	{
		id: "scroll-and-focus",
		doc: "concepts/scroll-and-focus",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import {\n\tButton,\n\tScreen,\n\tScrollView,\n\tStack,\n\tText,\n\tTextInput,\n\tuseScrollController,\n\tuseState,\n\tuseTextEntryController,\n} from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst scroll = useScrollController();\n\tconst reply = useTextEntryController();\n\tconst [lines, setLines] = useState<string[]>([]);\n\tconst [draft, setDraft] = useState(\"\");\n\n\tfunction send() {\n\t\tif (draft.length === 0) return;\n\t\tsetLines((current) => [...current, draft]);\n\t\tsetDraft(\"\");\n\t\tscroll.scrollToEnd();\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<ScrollView controller={scroll} style={{ grow: 1 }}>\n\t\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t\t{lines.map((line, index) => (\n\t\t\t\t\t\t<Text key={`${index}-${line}`}>{line}</Text>\n\t\t\t\t\t))}\n\t\t\t\t</Stack>\n\t\t\t</ScrollView>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<TextInput\n\t\t\t\t\tcontroller={reply}\n\t\t\t\t\tvalue={draft}\n\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\tonSubmit={send}\n\t\t\t\t\tplaceholder=\"메시지\"\n\t\t\t\t/>\n\t\t\t\t<Button onPress={() => reply.focus()}>답장하기</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n" },
		],
	},
	{
		id: "story-state",
		doc: "concepts/state",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tdefineStoryState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst progress = defineStoryState({\n\tkey: \"progress\",\n\tversion: 1,\n\tinitial: {\n\t\tchapter: 1,\n\t\ttrust: 40,\n\t\tclues: [] as string[],\n\t},\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(progress);\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<Text>{state.chapter}장 · 신뢰 {state.trust}</Text>\n\t\t\t\t<Text>단서 {state.clues.length}개</Text>\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\t...current,\n\t\t\t\t\t\t\ttrust: Math.min(100, current.trust + 5),\n\t\t\t\t\t\t\tclues: current.clues.includes(\"열쇠\")\n\t\t\t\t\t\t\t\t? current.clues\n\t\t\t\t\t\t\t\t: [...current.clues, \"열쇠\"],\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t서랍을 열어 본다\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n" },
		],
	},
	{
		id: "text-input",
		doc: "concepts/events",
		entry: "src/main.tsx",
		files: [
			{ path: "src/main.tsx", content: "import {\n\tButton,\n\tRow,\n\tScreen,\n\tStack,\n\tText,\n\tTextInput,\n\tuseState,\n} from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst [draft, setDraft] = useState(\"\");\n\tconst [sent, setSent] = useState<string[]>([]);\n\n\tfunction send() {\n\t\tconst text = draft.trim();\n\t\tif (text.length === 0) return;\n\t\tsetSent((current) => [...current, text]);\n\t\tsetDraft(\"\");\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t{sent.map((line, index) => (\n\t\t\t\t\t<Text key={index}>{line}</Text>\n\t\t\t\t))}\n\t\t\t\t<Row gap={8}>\n\t\t\t\t\t<TextInput\n\t\t\t\t\t\tvalue={draft}\n\t\t\t\t\t\tplaceholder=\"할 말을 적으세요\"\n\t\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\t\tonSubmit={send}\n\t\t\t\t\t\tstyle={{ grow: 1 }}\n\t\t\t\t\t/>\n\t\t\t\t\t<Button onPress={send} disabled={draft.trim().length === 0}>\n\t\t\t\t\t\t보내기\n\t\t\t\t\t</Button>\n\t\t\t\t</Row>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n" },
		],
	},
];
