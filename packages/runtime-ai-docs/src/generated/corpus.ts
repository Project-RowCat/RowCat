// Generated from docs/public/runtime/**/*.md and @rowcat/runtime's own source.
// Do not edit directly.
//
// Edit the source, then regenerate with `pnpm --filter @rowcat/runtime-ai-docs gen`. If this file
// drifts from the source, corpus-source.test.ts breaks.

import type { RuntimeAiCorpus } from "../corpus.ts";

export const RUNTIME_AI_CORPUS: RuntimeAiCorpus = {
	"apiVersion": 7,
	"agentGuide": "# 에이전트를 위한 안내\n\n이 문서는 **RowCat 크리에이터 런타임 코드를 대신 쓰는 도구**(Claude Code · Codex · Cursor 같은\n코딩 에이전트)를 위한 것입니다. 사람이 읽는 공개 문서 목록에는 없습니다 — 여기 적힌 것은\n제품의 설명이 아니라 **작업 절차와 규칙**이기 때문입니다.\n\n## 30초 모델\n\n```text\n크리에이터 런타임 = TypeScript/TSX로 쓴 작품 화면\n공개 API        = @rowcat/runtime 하나. 그 밖의 import는 컴파일에서 막힌다\n실행            = 격리된 QuickJS/WASM. 브라우저도 Node도 아니다\n화면            = RowCat의 호스트 렌더러가 그린다. DOM이 아니다\n저장            = 세 가지 수명(useState · useStoryState · usePersistentState)\n```\n\nReact를 닮았지만 **React가 아닙니다.** 이름과 시그니처가 익숙하다는 이유로 React의 다른\nAPI가 있을 것이라고 가정하면 안 됩니다 — `useContext`, `useLayoutEffect`, `Suspense`,\n`createPortal`, `React.FC`는 이 언어에 없습니다.\n\n## 절대 하지 않는 것\n\n```text\nimport \"react\" · \"react-dom\" · \"react-native\" · npm 패키지        컴파일 거절\n<div> · <span> · 그 밖의 HTML 태그                                 컴파일 거절\nfetch · XMLHttpRequest · WebSocket                                 없다\nsetTimeout · setInterval · requestAnimationFrame                   없다 (전이는 transition 프롭)\nlocalStorage · IndexedDB · document · window · process             없다\neval · new Function · 동적 import()                                컴파일 거절\n상대 import에 확장자 붙이기 (`./game.ts`)                          `game.ts.ts`를 찾는다 — 확장자를 뺀다\n```\n\n마지막 줄은 이 저장소의 다른 코드와 **반대**입니다. 런타임 프로젝트 안에서는 `./game`처럼\n확장자 없이 적습니다.\n\n전체 목록과 대안은 [지원하지 않는 API](/docs/runtime/runtime-model/unsupported-apis)와\n[지원하는 import](/docs/runtime/runtime-model/supported-imports)에 있습니다.\n\n## 세 가지 상태 수명을 섞지 않습니다\n\n```text\nuseState             이 세션 안. 다시 시작하면 사라진다        열린 패널 · 입력 중인 글 · 로딩 표시\nuseStoryState        이 회차. `플레이 초기화`가 지운다          현재 장면 · 호감도 · 이번에 알아낸 것\nusePersistentState   계정에 남는다. 초기화가 닿지 않는다        해금한 결말 · 회차를 넘는 기억\n```\n\n가장 자주 나오는 실수는 **일시적인 UI 상태를 `usePersistentState`에 넣는 것**입니다. 그\n값은 플레이어의 계정에 저장되어 기기 사이를 건너므로, 열린 패널 같은 것을 거기 두면 다른\n기기에서 그 패널이 열린 채로 시작합니다. 자세한 것은\n[상태](/docs/runtime/concepts/state)에 있습니다.\n\n## 이름을 지어내지 않습니다\n\n이 언어의 이름은 `@rowcat/runtime`이 내보내는 것이 **전부**입니다. React·DOM·React Native를\n닮았다는 이유로 있을 것 같은 이름을 쓰지 마십시오. 확실하지 않으면 코드를 쓰기 전에 찾습니다:\n\n```text\nMCP          runtime_get_api_reference · runtime_search_docs\n문서         /docs/runtime/reference\n기계용 목록   /runtime-api.json · /llms-full.txt\n```\n\n## 고쳤으면 확인합니다\n\nMCP로 붙어 있다면 이 순환이 이 도구 모음의 존재 이유입니다.\n\n```text\n1. runtime_get_project · runtime_list_files      무엇이 있는지 본다\n2. runtime_read_file                             고칠 파일만 읽는다\n3. runtime_search_docs                           모르는 API는 지어내지 말고 찾는다\n4. runtime_write_file                            가장 작은 변경 하나\n5. runtime_compile                               막는 진단이 없을 때까지\n6. runtime_preview_start | runtime_preview_restart\n7. runtime_preview_get_tree                      실제로 무엇이 그려졌는가\n8. runtime_preview_press · runtime_preview_input 그 경로를 눌러 본다\n9. runtime_preview_get_tree                      눌린 뒤에 무엇이 바뀌었는가\n10. runtime_preview_get_console · _get_state     설명되지 않는 결과가 있을 때만\n```\n\n**컴파일이 통과했다는 것은 화면이 옳다는 뜻이 아닙니다.** 조건부 렌더, 상태 갱신, 이벤트\n배선은 전부 컴파일을 통과하면서 틀릴 수 있습니다. 트리를 읽고 눌러 보는 단계를 건너뛰지\n마십시오.\n\n## 미리보기 트리의 노드 번호는 리비전에 매입니다\n\n`runtime_preview_get_tree`가 준 `nodeId`는 **그 리비전의 트리**에 대한 것입니다. 누르거나\n글을 넣으면 리비전이 오르고, 사라진 노드를 가리킨 조작은 `stale_node`로 거절됩니다. 그때\n할 일은 **트리를 다시 읽는 것**이고, 글자나 순서로 대체 노드를 추측하면 안 됩니다.\n\n## 작게 고칩니다\n\n한 번에 파일 하나, 변경 하나입니다. 프로젝트를 통째로 다시 쓰는 것은 거의 언제나 잘못된\n선택입니다 — 제작자가 쓴 코드에는 문서에 없는 의도가 들어 있고, 되돌릴 방법이 없습니다.",
	"docs": [
		{
			"slug": "",
			"url": "/docs/runtime",
			"title": "소개",
			"description": "크리에이터 런타임은 TypeScript와 TSX로 RowCat 작품의 화면·상태·상호작용을 직접 만드는 방법입니다.",
			"group": "getting-started",
			"order": 1,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "크리에이터 런타임",
					"id": "크리에이터-런타임"
				},
				{
					"level": 2,
					"text": "무엇을 만들 수 있나요",
					"id": "무엇을-만들-수-있나요"
				},
				{
					"level": 2,
					"text": "무엇이 아닌가요",
					"id": "무엇이-아닌가요"
				},
				{
					"level": 2,
					"text": "어떻게 시작하나요",
					"id": "어떻게-시작하나요"
				},
				{
					"level": 2,
					"text": "문서의 구성",
					"id": "문서의-구성"
				}
			],
			"body": "\n# 크리에이터 런타임\n\n크리에이터 런타임은 **TypeScript와 TSX로 RowCat 작품을 만드는 방법**입니다. 프롬프트만\n적는 대신 작품의 화면, 진행 상태, 선택지, AI와의 대화, 회차를 넘어 남는 진행까지 직접\n설계할 수 있습니다.\n\n런타임을 켠 작품은 대화창이 아니라 **당신이 만든 화면**으로 열립니다. 플레이어가 누르는\n버튼, 입력하는 글, 넘어가는 장면, 저장되는 진행이 전부 당신의 코드가 정한 대로 움직입니다.\n\n## 무엇을 만들 수 있나요\n\n- **메신저** — 인물과 주고받는 대화 화면. 보낸 말은 저장되고 답장은 AI가 만듭니다.\n- **비주얼 노벨** — 장면과 선택지로 갈라지는 이야기.\n- **조사 게임** — 단서를 모으고, 아는 것만 물어볼 수 있는 진행.\n- **관계 시뮬레이션** — 호감도·신뢰 같은 수치가 대화와 결말을 바꾸는 작품.\n- **소셜 피드처럼 보이는 화면** — 게시판·단체 대화방·프로필을 흉내 낸 인터페이스.\n\n이 목록은 예시입니다. 런타임은 특정 장르를 위한 도구가 아니라 화면과 상태를 조립하는\n부품이고, 그 부품으로 무엇을 만드는지는 당신이 정합니다.\n\n## 무엇이 아닌가요\n\n크리에이터 런타임은 **웹 페이지를 만드는 도구가 아닙니다.** 브라우저 API, npm 패키지, 임의의\n네트워크 요청은 쓸 수 없습니다. 쓸 수 있는 것은 RowCat이 제공하는 **통제된 API 하나**\n(`@rowcat/runtime`)뿐이고, 그 안에 화면 부품·상태·AI 생성이 전부 들어 있습니다. 그 경계가\n플레이어의 기기를 지키고, 같은 코드가 웹과 앱에서 같은 모양으로 돌게 합니다.\n\nReact를 써 본 사람이라면 모양이 익숙할 것입니다 — 컴포넌트, 훅, TSX, 이벤트 핸들러.\n하지만 **React가 아닙니다.** 자세한 것은 [컴포넌트와 TSX](/docs/runtime/concepts/components)에\n있습니다.\n\n## 어떻게 시작하나요\n\n1. 작품 초안의 편집기에서 런타임을 켭니다. 템플릿을 고르거나 빈 프로젝트로 시작할 수\n   있습니다.\n2. 런타임 스튜디오가 열립니다 — TypeScript/TSX 프로젝트, 검사 결과, 미리보기가 한\n   화면에 있습니다.\n3. `src/main.tsx`를 고치고 미리보기로 확인합니다.\n4. 작품을 발행하면 플레이어가 **플레이** 버튼으로 당신의 런타임을 엽니다.\n\n[빠른 시작](/docs/runtime/quick-start)이 그 네 단계를 실제 코드와 함께 안내합니다.\n\n## 문서의 구성\n\n- **시작하기** — 첫 화면을 만들고, 프로젝트가 어떻게 생겼는지, 미리보기와 발행이 무엇을\n  하는지.\n- **핵심 개념** — 컴포넌트·스타일·이벤트·세 가지 상태·AI 생성·자산·스크롤과 초점.\n- **API 레퍼런스** — `@rowcat/runtime`이 내보내는 모든 이름.\n- **런타임 모델** — 무엇이 되고 무엇이 안 되는지, 그리고 왜.\n"
		},
		{
			"slug": "quick-start",
			"url": "/docs/runtime/quick-start",
			"title": "빠른 시작",
			"description": "런타임을 켜고 첫 화면을 만들어 미리보기까지 확인하는 가장 짧은 길입니다.",
			"group": "getting-started",
			"order": 2,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "빠른 시작",
					"id": "빠른-시작"
				},
				{
					"level": 2,
					"text": "1. 런타임 켜기",
					"id": "1-런타임-켜기"
				},
				{
					"level": 2,
					"text": "2. 스튜디오 둘러보기",
					"id": "2-스튜디오-둘러보기"
				},
				{
					"level": 2,
					"text": "3. 첫 화면 쓰기",
					"id": "3-첫-화면-쓰기"
				},
				{
					"level": 2,
					"text": "4. 미리보기로 돌리기",
					"id": "4-미리보기로-돌리기"
				},
				{
					"level": 2,
					"text": "5. 발행하기",
					"id": "5-발행하기"
				},
				{
					"level": 2,
					"text": "다음",
					"id": "다음"
				}
			],
			"body": "\n# 빠른 시작\n\n이 페이지를 끝내면 **누르면 장이 넘어가는 화면** 하나가 미리보기에서 돌고 있을 것입니다.\nTypeScript를 읽을 수 있으면 충분합니다.\n\n## 1. 런타임 켜기\n\n작품 초안을 열고 편집기에서 **커스텀 인터랙티브 경험 만들기** 구획을 찾습니다. 시작 버튼을\n누르면 템플릿 갤러리가 열립니다 — 처음이라면 **Blank**를 고르세요. 파일 하나(`src/main.tsx`)\n로 시작하는 가장 작은 프로젝트입니다.\n\n런타임을 켜도 지금 쓰고 있는 프롬프트·로어·시작 장면은 그대로 남습니다. 켜는 일은 되돌릴\n수 있고, 끄는 일도 파일을 지우지 않습니다.\n\n## 2. 스튜디오 둘러보기\n\n런타임 스튜디오는 세 칸입니다.\n\n```text\n파일          프로젝트의 파일 목록\n코드          지금 고치고 있는 파일 — 자동완성과 타입 검사가 붙어 있습니다\n미리보기       실행 버튼을 누르면 이 자리에서 실제로 돕니다\n```\n\n머리말의 검사 상태(`이상 없음` · `문제 N개`)를 누르면 바닥 패널의 `Problems`가 열립니다.\n저장은 자동입니다.\n\n## 3. 첫 화면 쓰기\n\n`src/main.tsx`의 내용을 아래로 바꿉니다.\n\n```tsx example=quick-start file=src/main.tsx\nimport {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tcolor,\n\tdefineStoryState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst game = defineStoryState({\n\tkey: \"game\",\n\tversion: 1,\n\tinitial: {\n\t\tchapter: 1,\n\t},\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(game);\n\n\treturn (\n\t\t<Screen background={color(\"#0b0d12\")}>\n\t\t\t<Stack gap={12} style={{ padding: 24 }}>\n\t\t\t\t<Text style={{ color: color(\"#f5f7fa\"), fontSize: 22, fontWeight: \"bold\" }}>\n\t\t\t\t\t{state.chapter}장\n\t\t\t\t</Text>\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\tchapter: current.chapter + 1,\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t계속\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n```\n\n줄마다 무엇을 하는지 보겠습니다.\n\n- **`import ... from \"@rowcat/runtime\"`** — 런타임 코드가 가져올 수 있는 이름은 전부 이\n  패키지에서 옵니다. `react`도 `react-native`도 없습니다.\n- **`defineStoryState`** — 이 플레이스루 동안 저장되는 상태 하나를 **모듈 최상단에서**\n  선언합니다. `key`는 저장의 이름, `version`은 모양의 판, `initial`은 처음 값입니다.\n- **`export default function App()`** — 진입 파일이 기본 내보내기로 내놓는 컴포넌트가\n  작품의 첫 화면입니다.\n- **`useStoryState(game)`** — 선언해 둔 상태를 읽고 바꿉니다. 돌려주는 모양은\n  `[값, 설정 함수]`입니다.\n- **`<Screen>` · `<Stack>` · `<Text>` · `<Button>`** — 런타임이 그리는 부품입니다. HTML\n  태그(`<div>`)는 쓸 수 없습니다.\n- **`onPress`** — 누름 하나. 인자가 없고, 이벤트 객체도 없습니다.\n\n## 4. 미리보기로 돌리기\n\n미리보기 칸의 **미리보기 실행**을 누릅니다. `1장`과 `계속` 버튼이 보이고, 누를 때마다 수가\n오릅니다.\n\n코드를 고치면 미리보기는 **저절로 다시 돌지 않습니다.** `변경사항 있음`이 뜨고 **다시 시작**이\n그 코드를 새로 돌립니다. 다시 시작해도 `chapter`는 이어집니다 — 그것이 저장 상태이기\n때문입니다. 처음으로 되돌리려면 **플레이 초기화**를 누릅니다.\n\n## 5. 발행하기\n\n스튜디오를 나와 초안 편집기에서 평소처럼 **발행**합니다. 발행된 작품의 상세 화면에는\n`대화 시작` 대신 **플레이**가 서고, 그 버튼이 당신의 런타임을 엽니다. 플레이어의 진행은 그\n사람의 계정에 저장되어 기기 사이를 건너갑니다.\n\n## 다음\n\n- [프로젝트 구조](/docs/runtime/project-structure) — 파일을 나누고 서로 가져오는 방법.\n- [상태](/docs/runtime/concepts/state) — `useState`·`useStoryState`·`usePersistentState`가\n  각각 얼마나 오래 사는가.\n- [AI 생성](/docs/runtime/concepts/generation) — 플레이어의 입력에 인물이 답하게 하기.\n"
		},
		{
			"slug": "project-structure",
			"url": "/docs/runtime/project-structure",
			"title": "프로젝트 구조",
			"description": "진입 파일, 파일을 나누는 방법, 가져올 수 있는 것과 없는 것.",
			"group": "getting-started",
			"order": 3,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "프로젝트 구조",
					"id": "프로젝트-구조"
				},
				{
					"level": 2,
					"text": "진입 파일",
					"id": "진입-파일"
				},
				{
					"level": 2,
					"text": "파일 나누기",
					"id": "파일-나누기"
				},
				{
					"level": 3,
					"text": "상대 경로에 확장자를 적지 않습니다",
					"id": "상대-경로에-확장자를-적지-않습니다"
				},
				{
					"level": 3,
					"text": "폴더 밖으로 나갈 수 없습니다",
					"id": "폴더-밖으로-나갈-수-없습니다"
				},
				{
					"level": 2,
					"text": "가져올 수 있는 것",
					"id": "가져올-수-있는-것"
				},
				{
					"level": 2,
					"text": "한도",
					"id": "한도"
				}
			],
			"body": "\n# 프로젝트 구조\n\n런타임 프로젝트는 `.ts`·`.tsx` 파일들의 묶음입니다. 폴더는 자유롭게 만들 수 있고, 파일 사이는\n평범한 `import`로 잇습니다.\n\n## 진입 파일\n\n`src/main.tsx`가 진입 파일입니다. 이 파일은 **기본 내보내기로 컴포넌트 하나**를 내놓아야 하고,\n그 컴포넌트가 작품의 첫 화면입니다.\n\n```tsx\nexport default function App() {\n\treturn <Text>안녕하세요</Text>;\n}\n```\n\n컴포넌트는 인자를 받지 않고 동기적으로 화면을 돌려줍니다. `async function App()`은 거절됩니다.\n\n## 파일 나누기\n\n프로젝트가 자라면 화면·규칙·데이터를 파일로 나눕니다. 아래 셋은 실제로 컴파일되는 예제입니다.\n\n```text\nsrc/\n├── main.tsx              진입 파일\n├── components/\n│   └── CharacterCard.tsx 재사용하는 화면 조각\n└── game.ts               상태 정의와 규칙\n```\n\n```ts example=multi-file file=src/game.ts\nimport { defineStoryState } from \"@rowcat/runtime\";\n\nexport interface Character {\n\tname: string;\n\ttrust: number;\n}\n\nexport const party = defineStoryState({\n\tkey: \"party\",\n\tversion: 1,\n\tinitial: {\n\t\tmembers: [\n\t\t\t{ name: \"세나\", trust: 40 },\n\t\t\t{ name: \"민재\", trust: 10 },\n\t\t] as Character[],\n\t},\n});\n\n/** 신뢰는 0~100 사이에서만 움직인다 — 규칙은 화면이 아니라 여기 있다. */\nexport function adjustTrust(character: Character, delta: number): Character {\n\treturn {\n\t\t...character,\n\t\ttrust: Math.max(0, Math.min(100, character.trust + delta)),\n\t};\n}\n```\n\n```tsx example=multi-file file=src/components/CharacterCard.tsx\nimport { Row, Stack, Text } from \"@rowcat/runtime\";\nimport type { Character } from \"../game\";\n\nexport function CharacterCard({ character }: { character: Character }) {\n\treturn (\n\t\t<Stack gap={4} style={{ padding: 12, borderRadius: 8 }}>\n\t\t\t<Text style={{ fontWeight: \"bold\" }}>{character.name}</Text>\n\t\t\t<Row gap={8}>\n\t\t\t\t<Text>신뢰</Text>\n\t\t\t\t<Text>{character.trust}</Text>\n\t\t\t</Row>\n\t\t</Stack>\n\t);\n}\n```\n\n```tsx example=multi-file file=src/main.tsx\nimport { Button, Screen, Stack, useStoryState } from \"@rowcat/runtime\";\nimport { CharacterCard } from \"./components/CharacterCard\";\nimport { adjustTrust, party } from \"./game\";\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(party);\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t\t{state.members.map((member) => (\n\t\t\t\t\t<CharacterCard key={member.name} character={member} />\n\t\t\t\t))}\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\tmembers: current.members.map((member) =>\n\t\t\t\t\t\t\t\tmember.name === \"세나\" ? adjustTrust(member, 5) : member,\n\t\t\t\t\t\t\t),\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t세나와 이야기하기\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n```\n\n### 상대 경로에 확장자를 적지 않습니다\n\n`\"./game\"`이지 `\"./game.ts\"`가 아닙니다. 런타임은 `./game`을 만나면 다음 순서로 찾습니다.\n\n```text\n./game.ts  →  ./game.tsx  →  ./game/index.ts  →  ./game/index.tsx\n```\n\n`\"./game.ts\"`라고 적으면 `game.ts.ts`를 찾다가 실패합니다.\n\n### 폴더 밖으로 나갈 수 없습니다\n\n`\"../../something\"`처럼 프로젝트 뿌리 위로 올라가는 경로는 거절됩니다. 프로젝트의 파일은\n전부 뿌리 아래에 있습니다.\n\n## 가져올 수 있는 것\n\n| 지정자 | 되는가 |\n| --- | --- |\n| `@rowcat/runtime` | **됩니다.** 화면 부품·훅·상태·AI 생성이 전부 여기서 옵니다 |\n| `./…` · `../…` (프로젝트 안) | **됩니다.** 위의 규칙대로 찾습니다 |\n| `react` · `react-native` · `react-dom` | 안 됩니다 — [React를 닮았지만 React가 아닙니다](/docs/runtime/concepts/components) |\n| 그 밖의 npm 패키지 | 안 됩니다 — 설치할 곳이 없습니다 |\n| `node:fs` 같은 Node 모듈 | 안 됩니다 |\n| `import()` 동적 가져오기 | 안 됩니다 — 모든 모듈은 컴파일 시점에 정해집니다 |\n\n자세한 근거는 [지원하는 import](/docs/runtime/runtime-model/supported-imports)에 있습니다.\n\n## 한도\n\n| 항목 | 한도 |\n| --- | --- |\n| 파일 수 | 200개 |\n| 파일 하나의 길이 | 200,000자 |\n| 경로 길이 | 200자 |\n| 이름 하나(폴더·파일)의 길이 | 64자 |\n| 폴더 깊이 | 7단계 |\n\n경로에 쓸 수 있는 글자는 영문·숫자와 `.`·`_`·`-`입니다.\n"
		},
		{
			"slug": "preview-and-publish",
			"url": "/docs/runtime/preview-and-publish",
			"title": "미리보기와 발행",
			"description": "스튜디오 미리보기가 하는 일, 세 가지 초기화의 차이, 발행하면 무엇이 달라지는가.",
			"group": "getting-started",
			"order": 4,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "미리보기와 발행",
					"id": "미리보기와-발행"
				},
				{
					"level": 2,
					"text": "미리보기",
					"id": "미리보기"
				},
				{
					"level": 3,
					"text": "검사가 먼저입니다",
					"id": "검사가-먼저입니다"
				},
				{
					"level": 3,
					"text": "저절로 다시 돌지 않습니다",
					"id": "저절로-다시-돌지-않습니다"
				},
				{
					"level": 3,
					"text": "초기화가 셋입니다",
					"id": "초기화가-셋입니다"
				},
				{
					"level": 3,
					"text": "AI는 꺼진 채로 시작합니다",
					"id": "ai는-꺼진-채로-시작합니다"
				},
				{
					"level": 3,
					"text": "콘솔",
					"id": "콘솔"
				},
				{
					"level": 2,
					"text": "발행",
					"id": "발행"
				},
				{
					"level": 3,
					"text": "플레이어의 진행은 저장됩니다",
					"id": "플레이어의-진행은-저장됩니다"
				},
				{
					"level": 3,
					"text": "재발행은 도는 세션을 바꾸지 않습니다",
					"id": "재발행은-도는-세션을-바꾸지-않습니다"
				},
				{
					"level": 3,
					"text": "발행된 코드는 비밀이 아닙니다",
					"id": "발행된-코드는-비밀이-아닙니다"
				},
				{
					"level": 3,
					"text": "런타임을 끄면",
					"id": "런타임을-끄면"
				}
			],
			"body": "\n# 미리보기와 발행\n\n## 미리보기\n\n스튜디오의 **미리보기 실행**은 지금 편집기에 있는 파일들로 런타임을 실제로 돌립니다. 아무것도\n서버에 올라가지 않고, 작품의 저장 데이터도 건드리지 않습니다 — 미리보기의 진행은 스튜디오가\n열려 있는 동안만 살고 새로고침하면 사라집니다.\n\n### 검사가 먼저입니다\n\n`Problems`에 막는 오류가 남아 있으면 실행 버튼이 켜지지 않습니다. 경고는 실행을 막지 않습니다.\n\n### 저절로 다시 돌지 않습니다\n\n코드를 고치면 미리보기에 `변경사항 있음`이 뜹니다. 도는 화면은 그대로이고 **다시 시작**이 새\n코드를 돌립니다. 새 코드로 갈아 끼우면서 화면의 상태를 옮겨 주는 기능(핫 리로드)은 없습니다 —\n`useState`의 값은 다시 시작할 때마다 처음부터입니다.\n\n### 초기화가 셋입니다\n\n```text\n다시 시작        새 코드로 다시 돌린다. 저장 상태·영구 상태는 **이어받는다**\n플레이 초기화     플레이스루 상태(useStoryState)만 비운다. 영구 상태는 남는다\n긴 진행 초기화    영구 상태(usePersistentState)까지 비운다 — 스튜디오에만 있는 조작이다\n```\n\n세 조작이 다른 이유는 [상태](/docs/runtime/concepts/state)의 세 수명이 다르기 때문입니다.\n발행된 작품의 플레이어에게는 앞의 둘만 있습니다.\n\n### AI는 꺼진 채로 시작합니다\n\n미리보기의 `AI 사용`은 기본이 꺼짐입니다. 켜면 `useGeneration()`이 **당신의 계정 설정으로**\n실제 요청을 보냅니다 — 관리형이면 이 서버 운영자의 키가 쓰이고, 직접 연결한 제공자면 그 키가 쓰입니다. 토글은\n다음 실행·다시 시작부터 적용됩니다.\n\n### 콘솔\n\n`console.log`·`console.warn`·`console.error`는 바닥 패널의 `Console`에 모입니다. 런타임이\n낸 진단(중복 `key`, 사라진 컴포넌트의 상태 갱신 등)도 같은 자리에 옵니다. `State` 칸은 지금\n저장된 플레이스루 상태와 영구 상태를 그대로 보여 줍니다.\n\n## 발행\n\n런타임이 켜진 초안을 발행하면 RowCat 서버가 소스를 **다시 컴파일**해서 발행본에 붙입니다.\n컴파일에 실패하면 발행이 거절되고 이미 발행된 판은 한 글자도 바뀌지 않습니다.\n\n발행된 작품의 상세 화면에는 `대화 시작` 대신 **플레이**가 섭니다. 플레이어가 그 버튼을 누르면\n당신의 런타임이 RowCat의 대화 화면 자리에서 열립니다.\n\n### 플레이어의 진행은 저장됩니다\n\n`useStoryState`·`usePersistentState`의 값은 플레이어의 계정에 저장되어 그 사람의 다른 기기로\n건너갑니다. 플레이어에게는 **다시 시작**과 **플레이 초기화**가 있고, 영구 상태를 지우는 조작은\n없습니다.\n\n### 재발행은 도는 세션을 바꾸지 않습니다\n\n코드를 고쳐 다시 발행해도 이미 열려 있는 플레이는 그대로입니다. 새로 여는 플레이가 새 코드를\n받습니다. 저장된 진행은 코드와 무관하게 남으므로, 저장 모양을 바꿨다면\n[마이그레이션](/docs/runtime/concepts/state#마이그레이션)을 적어야 합니다.\n\n### 발행된 코드는 비밀이 아닙니다\n\n컴파일된 런타임은 플레이어의 **기기에서** 실행됩니다. 문자열·인물 지시문·분기 규칙은 열어 볼\n수 있다고 보아야 합니다. API 키, 비밀번호, 개인 토큰을 소스에 적지 마세요 — 자세한 것은\n[보안과 샌드박스](/docs/runtime/runtime-model/security#비밀을-적지-마세요)에 있습니다.\n\n### 런타임을 끄면\n\n편집기에서 런타임을 끄고 다시 발행하면 발행본에서 런타임이 빠지고 작품은 대화 작품으로\n돌아갑니다. 스튜디오의 파일은 지워지지 않습니다 — 지우는 것은 별개의 조작이고 확인을\n요구합니다.\n"
		},
		{
			"slug": "concepts/components",
			"url": "/docs/runtime/concepts/components",
			"title": "컴포넌트와 TSX",
			"description": "런타임 컴포넌트가 무엇이고, React와 어디가 같고 어디가 다른가.",
			"group": "concepts",
			"order": 1,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "컴포넌트와 TSX",
					"id": "컴포넌트와-tsx"
				},
				{
					"level": 2,
					"text": "React를 닮았지만 React가 아닙니다",
					"id": "react를-닮았지만-react가-아닙니다"
				},
				{
					"level": 2,
					"text": "프리미티브와 조합",
					"id": "프리미티브와-조합"
				},
				{
					"level": 2,
					"text": "컴포넌트가 돌려주는 것",
					"id": "컴포넌트가-돌려주는-것"
				},
				{
					"level": 2,
					"text": "렌더는 순수해야 합니다",
					"id": "렌더는-순수해야-합니다"
				},
				{
					"level": 2,
					"text": "훅의 규칙",
					"id": "훅의-규칙"
				},
				{
					"level": 2,
					"text": "다음",
					"id": "다음"
				}
			],
			"body": "\n# 컴포넌트와 TSX\n\n런타임의 화면은 **컴포넌트**로 만듭니다. 컴포넌트는 프롭을 받아 화면 조각을 돌려주는 함수이고,\n그 조각은 TSX로 적습니다.\n\n```tsx\nimport { Row, Text } from \"@rowcat/runtime\";\n\nfunction Score({ label, value }: { label: string; value: number }) {\n\treturn (\n\t\t<Row gap={8}>\n\t\t\t<Text>{label}</Text>\n\t\t\t<Text style={{ fontWeight: \"bold\" }}>{value}</Text>\n\t\t</Row>\n\t);\n}\n```\n\n## React를 닮았지만 React가 아닙니다\n\n컴포넌트·TSX·훅·상태·이벤트 핸들러 — 모양은 React에서 가져왔습니다. 이미 아는 것을 다시 배우게\n하지 않기 위해서입니다. 하지만 **런타임은 React가 아니고, React를 쓰지도 않습니다.**\n\n그 차이가 실제로 뜻하는 것은 다음과 같습니다.\n\n- `react`·`react-dom`·`react-native`를 설치하거나 가져올 수 없습니다. 훅과 컴포넌트는\n  전부 `@rowcat/runtime`에서 옵니다.\n- React 라이브러리(상태 관리·UI 키트·라우터)는 쓸 수 없습니다.\n- `<div>`·`<span>` 같은 HTML 태그도, `<View>`를 React Native에서 가져오는 것도 안 됩니다.\n  쓸 수 있는 태그는 런타임이 내보내는 [열두 부품](/docs/runtime/reference/components)뿐입니다.\n- `useContext`·`useLayoutEffect`·`forwardRef`·`memo`·`Suspense`·`lazy`·에러 바운더리·\n  포털·클래스 컴포넌트는 없습니다. 있는 훅은 [아홉](/docs/runtime/reference/hooks)입니다.\n- `props.children`은 있습니다. `key`도 있습니다.\n\n## 프리미티브와 조합\n\n`@rowcat/runtime`이 내보내는 `Screen`·`Stack`·`Text` 같은 것들은 **런타임이 그리는 부품**\n(프리미티브)입니다. 당신이 만드는 컴포넌트는 그 부품을 조합한 함수이고, 둘의 쓰임은 같습니다 —\nTSX 태그로 씁니다.\n\n프리미티브는 함수처럼 직접 부를 수 없습니다. `Stack({ gap: 8 })`은 오류이고 `<Stack gap={8}>`이\n맞습니다.\n\n## 컴포넌트가 돌려주는 것\n\n컴포넌트는 다음 중 하나를 돌려줍니다.\n\n- 태그 하나(`<Stack>…</Stack>`)\n- 문자열이나 숫자 — 그대로 글자가 됩니다\n- `null`·`undefined`·`false`·`true` — 아무것도 그리지 않습니다\n- 위의 것들의 배열\n\n배열을 돌려주거나 목록을 `map`으로 그릴 때는 **`key`를 주세요.** `key`는 같은 부모 아래에서\n어느 항목이 어느 항목인지 알려 주고, 없으면 자리 번호로 판정합니다. 항목이 끼어들거나 빠질\n때 `key`가 없으면 뒤 항목들의 상태가 엉뚱한 항목으로 옮겨 갑니다. 중복된 `key`는 경고이고\n그 항목은 자리로 판정됩니다.\n\n```tsx\n{clues.map((clue) => (\n\t<Text key={clue.id}>{clue.title}</Text>\n))}\n```\n\n## 렌더는 순수해야 합니다\n\n컴포넌트 함수는 **읽기만** 합니다. 렌더 도중에 상태를 바꾸면(`setState`를 조건 없이 부르면)\n거절됩니다. 상태를 바꾸는 자리는 이벤트 핸들러와 효과입니다.\n\n```tsx\nfunction Bad() {\n\tconst [n, setN] = useState(0);\n\tsetN(n + 1); // 렌더 중의 갱신 — 오류\n\treturn <Text>{n}</Text>;\n}\n```\n\n컴포넌트는 동기 함수입니다. `async` 컴포넌트와 프로미스를 돌려주는 컴포넌트는 없습니다.\nAI 응답처럼 기다려야 하는 값은 [이벤트 핸들러에서 받아 상태에 넣습니다](/docs/runtime/concepts/generation).\n\n## 훅의 규칙\n\n훅은 컴포넌트(또는 훅을 부르는 다른 함수)의 **최상단에서, 매번 같은 순서로** 부릅니다.\n조건문·반복문·이벤트 핸들러 안에서 훅을 부르면 안 됩니다. 런타임은 이 규칙을 실행 중에\n확인하고, 같은 컴포넌트가 렌더마다 다른 훅을 부르면 오류(`runtime_hook_order_changed`)를 냅니다.\n\n## 다음\n\n- [스타일](/docs/runtime/concepts/styling) — 부품에 모양을 주는 방법.\n- [이벤트와 입력](/docs/runtime/concepts/events) — 누름과 글 입력.\n- [상태](/docs/runtime/concepts/state) — 값이 얼마나 오래 사는가.\n"
		},
		{
			"slug": "concepts/styling",
			"url": "/docs/runtime/concepts/styling",
			"title": "스타일",
			"description": "런타임 스타일은 CSS도 React Native 스타일시트도 아닌 자기 체계입니다. 쓸 수 있는 속성, 색을 적는 방법, 값이 바뀔 때의 전이.",
			"group": "concepts",
			"order": 2,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "스타일",
					"id": "스타일"
				},
				{
					"level": 2,
					"text": "상자의 스타일",
					"id": "상자의-스타일"
				},
				{
					"level": 2,
					"text": "글자의 스타일",
					"id": "글자의-스타일"
				},
				{
					"level": 2,
					"text": "색",
					"id": "색"
				},
				{
					"level": 2,
					"text": "화면의 바탕",
					"id": "화면의-바탕"
				},
				{
					"level": 2,
					"text": "전이",
					"id": "전이"
				},
				{
					"level": 3,
					"text": "움직이는 축은 넷입니다",
					"id": "움직이는-축은-넷입니다"
				},
				{
					"level": 3,
					"text": "처음 그려질 때는 움직이지 않습니다",
					"id": "처음-그려질-때는-움직이지-않습니다"
				},
				{
					"level": 3,
					"text": "사라지는 것은 즉시입니다",
					"id": "사라지는-것은-즉시입니다"
				},
				{
					"level": 3,
					"text": "되돌리면 지금 있는 자리에서 되돌아갑니다",
					"id": "되돌리면-지금-있는-자리에서-되돌아갑니다"
				},
				{
					"level": 3,
					"text": "움직임 줄이기",
					"id": "움직임-줄이기"
				},
				{
					"level": 3,
					"text": "전이에 없는 것",
					"id": "전이에-없는-것"
				},
				{
					"level": 2,
					"text": "없는 것",
					"id": "없는-것"
				}
			],
			"body": "\n# 스타일\n\n런타임의 스타일은 **자기 체계**입니다. CSS 문자열도, 클래스 이름도, React Native의\n`StyleSheet`도 아닙니다. 같은 코드가 웹과 앱에서 같은 모양으로 그려져야 하기 때문에, 두 플랫폼\n모두에서 똑같이 표현할 수 있는 속성만 열려 있습니다.\n\n```tsx\n<Stack\n\tgap={12}\n\tstyle={{\n\t\tpadding: 16,\n\t\tbackgroundColor: color(\"#111827\"),\n\t\tborderRadius: 12,\n\t}}\n>\n```\n\n## 상자의 스타일\n\n`View`·`Stack`·`Row`·`ScrollView`·`Pressable`·`Image`·`TextInput`·`TextArea`가 받는 `style`은\n`RuntimeStyle`입니다.\n\n| 속성 | 값 | 뜻 |\n| --- | --- | --- |\n| `width` · `height` | 숫자 또는 `\"50%\"` | 크기. 숫자는 밀도 독립 단위입니다 |\n| `padding` | 숫자 | 안쪽 여백. 네 방향이 같습니다 |\n| `gap` | 숫자 | 자식 사이의 간격 |\n| `opacity` | 0~1 | 투명도 |\n| `backgroundColor` | `color(…)` | 바탕색 |\n| `borderRadius` | 숫자 | 모서리 둥글기 |\n| `justify` | `\"start\"` · `\"center\"` · `\"end\"` · `\"between\"` · `\"around\"` | 주축 정렬 |\n| `align` | `\"start\"` · `\"center\"` · `\"end\"` · `\"stretch\"` | 교차축 정렬 |\n| `grow` | 숫자 | 남는 공간을 나눠 갖는 비율 |\n\n**여기 없는 속성은 없는 것입니다.** `margin`·`position`·`zIndex`·`border`·`flexDirection`·\n`display`는 받지 않고, 적으면 검사에서 막힙니다. 방향은 속성이 아니라 부품이 정합니다 — 세로는\n`Stack`, 가로는 `Row`입니다.\n\n`Stack`과 `Row`의 `gap`은 프롭으로도 줄 수 있습니다(`<Stack gap={8}>`). 프롭과 `style.gap`을\n둘 다 주면 **프롭이 이깁니다.**\n\n## 글자의 스타일\n\n`Text`가 받는 `style`은 `RuntimeTextStyle`이고, 상자의 스타일과 **다른 목록**입니다. 글자에는\n`gap`도 `justify`도 없습니다.\n\n| 속성 | 값 |\n| --- | --- |\n| `color` | `color(…)` |\n| `fontSize` | 숫자 |\n| `fontWeight` | `\"regular\"` · `\"medium\"` · `\"bold\"` |\n| `align` | `\"start\"` · `\"center\"` · `\"end\"` |\n| `lines` | 숫자 — 몇 줄에서 자를 것인가. 없으면 자르지 않습니다 |\n| `opacity` | 0~1 |\n\n`TextInput`·`TextArea`의 글자 모양은 `textStyle`로 따로 줍니다.\n\n## 색\n\n색은 문자열이 아니라 **`color()`가 만든 값**입니다.\n\n```tsx\nimport { color } from \"@rowcat/runtime\";\n\nconst ink = color(\"#f5f7fa\");\nconst faint = color(\"#8b93a7cc\"); // #rrggbbaa\n```\n\n받는 형식은 `#rgb`·`#rrggbb`·`#rrggbbaa` 셋뿐입니다. `\"red\"`·`rgb(…)`·`hsl(…)`은 없습니다.\n글자 그대로 적은 값은 타입 검사에서 잘못된 형식을 잡고, 실행 중에는 한 번 더 확인합니다.\n\n계산해서 만든 문자열은 `color()`에 넣을 수 없습니다(타입이 막습니다). 그런 값은 `isRuntimeColor`로\n먼저 확인합니다.\n\n```tsx\nimport { isRuntimeColor } from \"@rowcat/runtime\";\n\nfunction tint(hex: string) {\n\treturn isRuntimeColor(hex) ? hex : color(\"#000000\");\n}\n```\n\n## 화면의 바탕\n\n`Screen`의 `background`는 화면 전체(안전 영역 바깥까지)의 바탕색입니다. 다른 부품의\n`backgroundColor`와 달리 `style` 밖의 프롭입니다.\n\n```tsx\n<Screen background={color(\"#0b0d12\")}>\n```\n\n## 전이\n\n상태가 바뀌어 `opacity`·`translateX`·`translateY`·`scale`이 달라질 때, 그 값까지 **부드럽게\n가도록** 할 수 있습니다. `transition` 프롭 하나면 됩니다.\n\n```tsx\nimport { Text, View, useState } from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst [open, setOpen] = useState(false);\n\n\treturn (\n\t\t<View\n\t\t\ttransition={{ duration: 180, easing: \"ease-out\" }}\n\t\t\tstyle={{\n\t\t\t\topacity: open ? 1 : 0,\n\t\t\t\ttranslateY: open ? 0 : 8,\n\t\t\t\tscale: open ? 1 : 0.98,\n\t\t\t}}\n\t\t>\n\t\t\t<Text>안녕하세요</Text>\n\t\t</View>\n\t);\n}\n```\n\n적는 것은 **바라는 값**뿐입니다. 중간 값도, 프레임도, 시작과 끝을 알리는 콜백도 작품 코드에\n오지 않습니다 — 상태를 바꾸면 화면이 거기까지 갑니다.\n\n### 움직이는 축은 넷입니다\n\n`opacity` · `translateX` · `translateY` · `scale`.\n\n`width`·`padding`·`backgroundColor`는 전이하지 않습니다(값은 즉시 바뀝니다). 그 축들은 배치를\n다시 계산하게 만들고, 배치의 중간 값은 웹과 앱이 서로 다른 시점에 재기 때문입니다.\n\n### 처음 그려질 때는 움직이지 않습니다\n\n`transition`을 적었다고 **등장 애니메이션**이 되지 않습니다.\n\n```tsx\n<View transition={{ duration: 200 }} style={{ opacity: 1 }} />\n```\n\n이 부품은 나타나는 순간부터 `opacity: 1`입니다. 움직이는 것은 **이미 그려진 부품의 값이\n바뀔 때**뿐입니다.\n\n### 사라지는 것은 즉시입니다\n\n```tsx\n{open && <View transition={{ duration: 200 }}>…</View>}\n```\n\n`open`이 거짓이 되면 이 부품은 **그 자리에서 사라집니다.** `transition`은 트리에서 빠지는\n부품을 붙잡아 두지 않습니다. 사라지는 모습을 만들고 싶다면 부품을 남겨 둔 채 `opacity`를\n`0`으로 두세요.\n\n### 되돌리면 지금 있는 자리에서 되돌아갑니다\n\n전이가 끝나기 전에 목표가 다시 바뀌면, 화면은 **지금 그려지고 있는 값**에서 새 목표로\n갑니다. 끝까지 갔다가 되돌아오지 않습니다.\n\n### 움직임 줄이기\n\nRowCat은 보는 사람의 **움직임 줄이기** 설정을 자동으로 따릅니다. 그 설정이 켜져 있으면\n전이는 즉시 적용됩니다 — 값은 똑같이 바뀌고 가는 과정만 없습니다.\n\n작품 코드는 그 설정을 읽을 수 없습니다(`useReducedMotion()` 같은 이름이 없습니다). 접근성\n설정이 작품의 진행을 바꾸는 일은 없어야 하기 때문입니다.\n\n### 전이에 없는 것\n\n- **`delay`·키프레임·반복·시퀀스.**\n- **스프링**(`stiffness`·`damping`)·`cubic-bezier(...)`. 이징은 다섯 개뿐입니다.\n- **완료 콜백**(`onTransitionEnd`). 전이는 화면의 일이지 진행의 일이 아닙니다 — 완료를\n  기다려 다음 상태로 넘어가는 코드는 움직임 줄이기가 켜진 기기에서 다르게 돕니다.\n- **진입·퇴장 애니메이션**(`Presence`). 위의 두 규칙이 그것입니다.\n- **회전·기울이기**(`rotate`·`skew`), 레이아웃 애니메이션, 제스처·스크롤에 연동된 움직임.\n\n## 없는 것\n\n- **CSS 문자열·클래스 이름·선택자.** 웹에서만 뜻이 있습니다.\n- **단위 문자열**(`\"12px\"`·`\"1rem\"`). 숫자 하나가 밀도 독립 단위이고, 그 해석은 플랫폼의\n  몫입니다.\n- **`position: \"fixed\"`·`zIndex`.** 떠 있는 층은 런타임이 나중에 제공할 부품이지 좌표로 만들\n  것이 아닙니다.\n- **테마 변수.** 런타임 코드는 RowCat의 테마 색을 읽을 수 없습니다. 작품의 색은 작품이 정합니다.\n- **글꼴 선택·자간·행간.** 지금 열려 있는 글자 축은 위 표가 전부입니다.\n\n전체 목록은 [스타일 레퍼런스](/docs/runtime/reference/styling)에 있습니다.\n"
		},
		{
			"slug": "concepts/events",
			"url": "/docs/runtime/concepts/events",
			"title": "이벤트와 입력",
			"description": "누름과 글 입력이 어떤 모양으로 오는가. 통제된 입력, Enter와 한글 조합, 비활성.",
			"group": "concepts",
			"order": 3,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "이벤트와 입력",
					"id": "이벤트와-입력"
				},
				{
					"level": 2,
					"text": "누름",
					"id": "누름"
				},
				{
					"level": 2,
					"text": "글 입력",
					"id": "글-입력"
				},
				{
					"level": 3,
					"text": "한글·일본어·중국어 조합 중의 Enter",
					"id": "한글-일본어-중국어-조합-중의-enter"
				},
				{
					"level": 3,
					"text": "값을 지우는 것도 상태입니다",
					"id": "값을-지우는-것도-상태입니다"
				},
				{
					"level": 2,
					"text": "이벤트가 오는 순서",
					"id": "이벤트가-오는-순서"
				},
				{
					"level": 2,
					"text": "없는 것",
					"id": "없는-것"
				}
			],
			"body": "\n# 이벤트와 입력\n\n런타임의 이벤트는 **결과만** 건넵니다. 눌렸다는 사실, 바뀐 뒤의 글 전체, 확정했다는 사실 —\n그뿐입니다. 이벤트 객체(`MouseEvent`·`KeyboardEvent`·좌표·`preventDefault`)는 없습니다. 같은\n코드가 웹과 앱에서 같은 뜻을 갖게 하려는 선택입니다.\n\n## 누름\n\n`Button`과 `Pressable`이 `onPress`를 받습니다. 인자가 없습니다.\n\n```tsx\n<Button onPress={() => setState((current) => ({ ...current, chapter: current.chapter + 1 }))}>\n\t계속\n</Button>\n```\n\n`onPress`는 `async` 함수여도 됩니다. AI 응답을 기다리는 자리가 대개 여기입니다.\n\n`Button`은 라벨이 있는 조작이고 `tone`으로 시각 위계를 고릅니다(`\"primary\"`·`\"secondary\"`·\n`\"ghost\"`). `Pressable`은 임의의 내용을 누를 수 있게 감싸고 `style`을 받습니다 — 카드 하나를\n통째로 누르게 하는 자리입니다.\n\n`disabled={true}`인 부품은 눌리지 않습니다. 시각 효과가 아니라 실제로 핸들러가 불리지 않습니다.\n\n## 글 입력\n\n`TextInput`(한 줄)과 `TextArea`(여러 줄)이 글을 받습니다. 둘 다 **통제된 입력**입니다 — 지금\n적혀 있는 글은 언제나 당신의 상태이고, `value`가 필수입니다.\n\n```tsx example=text-input file=src/main.tsx\nimport {\n\tButton,\n\tRow,\n\tScreen,\n\tStack,\n\tText,\n\tTextInput,\n\tuseState,\n} from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst [draft, setDraft] = useState(\"\");\n\tconst [sent, setSent] = useState<string[]>([]);\n\n\tfunction send() {\n\t\tconst text = draft.trim();\n\t\tif (text.length === 0) return;\n\t\tsetSent((current) => [...current, text]);\n\t\tsetDraft(\"\");\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t{sent.map((line, index) => (\n\t\t\t\t\t<Text key={index}>{line}</Text>\n\t\t\t\t))}\n\t\t\t\t<Row gap={8}>\n\t\t\t\t\t<TextInput\n\t\t\t\t\t\tvalue={draft}\n\t\t\t\t\t\tplaceholder=\"할 말을 적으세요\"\n\t\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\t\tonSubmit={send}\n\t\t\t\t\t\tstyle={{ grow: 1 }}\n\t\t\t\t\t/>\n\t\t\t\t\t<Button onPress={send} disabled={draft.trim().length === 0}>\n\t\t\t\t\t\t보내기\n\t\t\t\t\t</Button>\n\t\t\t\t</Row>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n```\n\n- **`onChangeText(value)`** — 글자가 바뀔 때마다 **바뀐 뒤의 전체 글**을 받습니다. 그 값을\n  상태에 넣지 않으면 입력칸은 당신의 `value`로 되돌아갑니다(통제된 입력이라 그렇습니다).\n- **`onSubmit()`** — `TextInput`에서 Enter(앱에서는 완료)를 눌렀을 때. 인자가 없습니다.\n  `TextArea`에는 없습니다 — 여러 줄에서 Enter는 줄바꿈입니다.\n- **`disabled`** — 잠긴 입력칸은 글자를 받지 않고 `onSubmit`도 부르지 않습니다.\n\n### 한글·일본어·중국어 조합 중의 Enter\n\n조합 중(글자가 완성되기 전)에 누른 Enter는 **제출이 아닙니다.** 런타임이 그 판정을 갖고\n`onSubmit`을 부르지 않으므로, 당신의 코드는 이것을 신경 쓰지 않아도 됩니다. 조합이 끝난 뒤의\nEnter만 `onSubmit`으로 옵니다.\n\n### 값을 지우는 것도 상태입니다\n\n보낸 뒤 입력칸을 비우려면 `setDraft(\"\")`를 부릅니다. 입력칸 자체에 \"비우기\" 메서드는 없습니다 —\nref로 부품을 잡는 방법이 없기 때문입니다.\n\n## 이벤트가 오는 순서\n\n핸들러 안에서 여러 번 상태를 바꿔도 화면은 **한 번** 다시 그려집니다. 핸들러의 동기 구간과\n그 안의 `await`가 없는 이어짐은 한 묶음이고, AI 응답을 `await`한 뒤의 갱신은 새 묶음입니다.\n\n## 없는 것\n\n- 마우스 좌표·스크롤 위치·키 코드·포커스 이벤트\n- 길게 누르기·더블 탭·드래그·제스처\n- `onFocus`·`onBlur`·`onKeyDown`\n- 부품에 대한 ref(`useRef`는 값을 담는 칸이지 부품을 가리키지 않습니다)\n\n이 목록에 있는 것이 필요하다면 지금은 상태로 표현할 방법을 찾아야 합니다. 예를 들어 \"어느\n카드가 선택되었는가\"는 `Pressable` 여러 개와 `useState` 하나로 만듭니다.\n"
		},
		{
			"slug": "concepts/state",
			"url": "/docs/runtime/concepts/state",
			"title": "상태",
			"description": "화면의 상태, 플레이스루의 상태, 회차를 넘는 상태 — 셋의 수명이 다르고 쓰는 훅이 다릅니다.",
			"group": "concepts",
			"order": 4,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "상태",
					"id": "상태"
				},
				{
					"level": 2,
					"text": "화면의 상태 — useState · useReducer",
					"id": "화면의-상태-usestate-usereducer"
				},
				{
					"level": 2,
					"text": "플레이스루의 상태 — defineStoryState · useStoryState",
					"id": "플레이스루의-상태-definestorystate-usestorystate"
				},
				{
					"level": 3,
					"text": "값은 직렬화 가능해야 합니다",
					"id": "값은-직렬화-가능해야-합니다"
				},
				{
					"level": 3,
					"text": "마이그레이션",
					"id": "마이그레이션"
				},
				{
					"level": 2,
					"text": "회차를 넘는 상태 — definePersistentState · usePersistentState",
					"id": "회차를-넘는-상태-definepersistentstate-usepersistentstate"
				},
				{
					"level": 2,
					"text": "갱신의 규칙",
					"id": "갱신의-규칙"
				},
				{
					"level": 2,
					"text": "한도",
					"id": "한도"
				},
				{
					"level": 2,
					"text": "AI 응답과 상태",
					"id": "ai-응답과-상태"
				}
			],
			"body": "\n# 상태\n\n런타임에는 **상태의 수명이 셋** 있습니다. 어느 훅을 쓰는가가 곧 그 값이 얼마나 오래 사는가를\n정합니다.\n\n```text\nuseState             이 실행 동안만            다시 시작하면 사라진다\nuseStoryState        이 플레이스루 동안         다시 열어도 이어진다 · 플레이 초기화가 지운다\nusePersistentState   이 플레이어 + 이 작품 동안  플레이 초기화를 넘어 남는다\n```\n\n값을 어느 수명에 둘지는 \"**무엇이 이것을 지워도 되는가**\"로 정합니다.\n\n## 화면의 상태 — `useState` · `useReducer`\n\n컴포넌트가 갖는 값입니다. 지금 열린 탭, 펼친 패널, 아직 보내지 않은 입력, 대기 중 표시 —\n런타임이 다시 시작되면 처음으로 돌아가도 괜찮은 것들입니다.\n\n```tsx\nconst [tab, setTab] = useState<\"chat\" | \"profile\">(\"chat\");\nconst [draft, setDraft] = useState(\"\");\nconst [pending, setPending] = useState(false);\n```\n\n`useState`는 초기값으로 함수도 받습니다(`useState(() => expensive())`). 그 함수는 첫 렌더에서만\n돕니다. `useReducer`는 값이 여러 갈래로 바뀌는 화면의 어휘입니다 — 모양은 React와 같습니다.\n\n**이 값은 저장되지 않습니다.** 작품의 진행을 `useState`에 두면 플레이어가 작품을 닫는 순간\n사라집니다.\n\n## 플레이스루의 상태 — `defineStoryState` · `useStoryState`\n\n**이 플레이스루의 진행**입니다. 현재 장, 신뢰도, 인벤토리, 모은 단서, 내린 결정, 주고받은\n대화 — 작품을 닫았다 열어도 이어져야 하는 것들입니다. 플레이어가 **플레이 초기화**를 누르면\n비워집니다(새 게임).\n\n정의는 **모듈 최상단에서 한 번**, 읽고 쓰는 것은 컴포넌트 안에서 훅으로 합니다.\n\n```tsx example=story-state file=src/main.tsx\nimport {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tdefineStoryState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst progress = defineStoryState({\n\tkey: \"progress\",\n\tversion: 1,\n\tinitial: {\n\t\tchapter: 1,\n\t\ttrust: 40,\n\t\tclues: [] as string[],\n\t},\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(progress);\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<Text>{state.chapter}장 · 신뢰 {state.trust}</Text>\n\t\t\t\t<Text>단서 {state.clues.length}개</Text>\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\t...current,\n\t\t\t\t\t\t\ttrust: Math.min(100, current.trust + 5),\n\t\t\t\t\t\t\tclues: current.clues.includes(\"열쇠\")\n\t\t\t\t\t\t\t\t? current.clues\n\t\t\t\t\t\t\t\t: [...current.clues, \"열쇠\"],\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t서랍을 열어 본다\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n```\n\n- **`key`** — 저장의 이름. 영문으로 시작하고 영문·숫자·`_`·`-`만 씁니다(64자 이내). 같은\n  `key`를 두 번 정의하면 오류입니다.\n- **`version`** — 값의 **모양**의 판. 1 이상의 정수. 모양을 바꿀 때 올립니다(아래\n  [마이그레이션](#마이그레이션)).\n- **`initial`** — 처음 값. 저장된 것이 없을 때와 플레이 초기화 뒤에 이 값으로 시작합니다.\n\n같은 정의를 여러 컴포넌트에서 읽으면 **같은 값**입니다. 한쪽에서 바꾸면 다른 쪽의 다음 렌더에\n보입니다. 값을 부품 사이에 프롭으로 나를 필요가 없습니다 — 정의를 파일에 두고 필요한 곳에서\n가져오면 됩니다.\n\n### 값은 직렬화 가능해야 합니다\n\n저장되는 값이므로 **JSON으로 적을 수 있는 것**만 담습니다: `null`·불리언·숫자·문자열·배열·\n평범한 객체. 함수·`Date`·`Map`·`Set`·클래스 인스턴스·`NaN`·`undefined`·순환 참조는 안\n됩니다. 타입 검사가 `initial`에서 이것을 잡고, 실행 중에는 저장 직전에 한 번 더 확인합니다.\n날짜는 문자열이나 숫자로, 집합은 배열로 적습니다.\n\n### 마이그레이션\n\n플레이어의 기기에는 **옛 판으로 저장된 값**이 남아 있을 수 있습니다. 값의 모양을 바꿨다면\n`version`을 올리고 `migrate`로 옛 값을 새 모양으로 옮깁니다.\n\n```ts example=migration file=src/state.ts\nimport { defineStoryState } from \"@rowcat/runtime\";\n\ninterface ProgressV2 {\n\tchapter: number;\n\tclues: string[];\n}\n\nexport const progress = defineStoryState({\n\tkey: \"progress\",\n\tversion: 2,\n\tinitial: { chapter: 1, clues: [] } as ProgressV2,\n\tmigrate: (stored, fromVersion): ProgressV2 => {\n\t\tif (fromVersion === 1) {\n\t\t\t// 1판에는 clues가 없었다\n\t\t\tconst old = stored as { chapter: number };\n\t\t\treturn { chapter: old.chapter, clues: [] };\n\t\t}\n\t\tthrow new Error(`알 수 없는 판: ${fromVersion}`);\n\t},\n});\n```\n\n```tsx example=migration file=src/main.tsx\nimport { Screen, Text, useStoryState } from \"@rowcat/runtime\";\nimport { progress } from \"./state\";\n\nexport default function App() {\n\tconst [state] = useStoryState(progress);\n\treturn (\n\t\t<Screen>\n\t\t\t<Text>{state.chapter}장</Text>\n\t\t</Screen>\n\t);\n}\n```\n\n- `migrate(stored, fromVersion)`는 저장된 값과 그 판을 받아 **지금 모양**을 돌려줍니다.\n  결정적이어야 합니다 — 같은 입력에 같은 결과.\n- 마이그레이션이 던지면 런타임이 서지 않습니다. 조용히 초기값으로 떨어뜨리지 않습니다 —\n  그러면 마이그레이션의 버그가 플레이어의 진행 삭제가 됩니다.\n- `migrate`가 없는데 옛 판이 저장되어 있으면 역시 실패합니다. 모양을 바꾼 적이 있다면\n  마이그레이션은 선택이 아닙니다.\n- 저장된 판이 코드의 판보다 **높으면**(더 새 코드로 만든 저장을 옛 코드가 열려는 경우)\n  실패합니다. 자동으로 낮추지 않습니다.\n\n## 회차를 넘는 상태 — `definePersistentState` · `usePersistentState`\n\n**이 플레이어와 이 작품 사이의 긴 진행**입니다. 본 엔딩 목록, 업적, 해금, 회차 수 — 새 게임을\n시작해도 지워지면 안 되는 것들입니다. 플레이 초기화가 이 값을 건드리지 않습니다.\n\n```tsx example=persistent-state file=src/main.tsx\nimport {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tdefinePersistentState,\n\tdefineStoryState,\n\tusePersistentState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst run = defineStoryState({\n\tkey: \"run\",\n\tversion: 1,\n\tinitial: { scene: \"intro\" as \"intro\" | \"ending\" },\n});\n\nconst record = definePersistentState({\n\tkey: \"record\",\n\tversion: 1,\n\tinitial: { endings: [] as string[], runs: 0 },\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(run);\n\tconst [meta, setMeta] = usePersistentState(record);\n\n\tfunction finish(ending: string) {\n\t\tsetState({ scene: \"ending\" });\n\t\tsetMeta((current) => ({\n\t\t\truns: current.runs + 1,\n\t\t\tendings: current.endings.includes(ending)\n\t\t\t\t? current.endings\n\t\t\t\t: [...current.endings, ending],\n\t\t}));\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<Text>본 엔딩 {meta.endings.length}개 · {meta.runs}회차</Text>\n\t\t\t\t{state.scene === \"intro\" ? (\n\t\t\t\t\t<Button onPress={() => finish(\"새벽\")}>새벽 엔딩으로</Button>\n\t\t\t\t) : (\n\t\t\t\t\t<Text>끝. 플레이 초기화로 새 회차를 시작하세요.</Text>\n\t\t\t\t)}\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n```\n\n규칙은 플레이스루 상태와 같습니다(`key`·`version`·`initial`·`migrate`·직렬화). 다른 것은\n**수명뿐**입니다. `key`는 두 수명 사이에서 겹쳐도 됩니다 — 같은 `\"progress\"`를 양쪽에 두어도\n충돌하지 않습니다.\n\n두 정의는 **타입이 다릅니다.** `useStoryState(영구 정의)`도 `usePersistentState(플레이스루\n정의)`도 컴파일에서 막힙니다. 그 실수의 증상이 몇 달치 진행이 사라지는 것이라, 실행 중이 아니라\n타입에서 잡습니다.\n\n## 갱신의 규칙\n\n세 훅의 설정 함수는 모양이 같습니다. 새 값을 주거나, 지금 값을 받아 새 값을 돌려주는 함수를\n줍니다.\n\n```ts\nsetState({ chapter: 2 });\nsetState((current) => ({ ...current, chapter: current.chapter + 1 }));\n```\n\n- 함수형 갱신을 쓰면 그 사이에 다른 갱신이 있어도 잃지 않습니다. AI 응답을 기다린 뒤 대화에\n  넣는 자리에서 특히 그렇습니다.\n- 같은 값(`Object.is`)으로 갱신하면 다시 그리지 않습니다. 객체는 **새 객체**를 만들어야\n  바뀐 것으로 봅니다 — `current.clues.push(…)`처럼 제자리에서 고치면 화면이 낡습니다.\n- 렌더 중에는 갱신할 수 없습니다.\n- 사라진 컴포넌트의 설정 함수를 부르면(늦게 끝난 비동기 작업) 경고 하나가 남고 무시됩니다.\n  런타임은 멈추지 않습니다.\n\n## 한도\n\n| 항목 | 한도 |\n| --- | --- |\n| 정의의 수(수명마다) | 128개 |\n| 정의 하나의 값 크기 | 64 KiB(직렬화한 길이) |\n| 발행된 작품의 저장 전체 | 256 KiB(플레이스루·영구 각각) |\n\n대화 기록처럼 자라는 값은 **최근 것만 남기는** 규칙을 코드에 두세요. 한도를 넘은 갱신은 그\n렌더가 실패하고 화면은 이전 상태로 남습니다.\n\n## AI 응답과 상태\n\nAI가 만든 글은 **제안**입니다. 그것을 어느 수명에 넣을지, 그리고 넣을지 말지는 당신의 코드가\n정합니다. 작품의 규칙(단서를 얻었는가, 신뢰가 올랐는가)은 AI의 문장을 읽어 판정하지 말고\n결정적인 코드로 바꾸세요 — 자세한 것은 [AI 생성](/docs/runtime/concepts/generation#정본-상태와-ai의-글)에\n있습니다.\n"
		},
		{
			"slug": "concepts/generation",
			"url": "/docs/runtime/concepts/generation",
			"title": "AI 생성",
			"description": "useGeneration()으로 RowCat의 AI를 부르는 방법, 요청의 모양, 실패의 이름, 정본 상태와 AI 글의 구분.",
			"group": "concepts",
			"order": 5,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "AI 생성",
					"id": "ai-생성"
				},
				{
					"level": 2,
					"text": "요청의 모양",
					"id": "요청의-모양"
				},
				{
					"level": 2,
					"text": "제작자가 정하지 않는 것",
					"id": "제작자가-정하지-않는-것"
				},
				{
					"level": 2,
					"text": "플레이어의 조작에서만 시작합니다",
					"id": "플레이어의-조작에서만-시작합니다"
				},
				{
					"level": 2,
					"text": "실행 중의 한도",
					"id": "실행-중의-한도"
				},
				{
					"level": 2,
					"text": "실패",
					"id": "실패"
				},
				{
					"level": 2,
					"text": "예제 — 메신저",
					"id": "예제-메신저"
				},
				{
					"level": 2,
					"text": "정본 상태와 AI의 글",
					"id": "정본-상태와-ai의-글"
				},
				{
					"level": 2,
					"text": "한도",
					"id": "한도"
				},
				{
					"level": 3,
					"text": "요청 하나의 한도",
					"id": "요청-하나의-한도"
				},
				{
					"level": 3,
					"text": "실행 중의 한도(요약)",
					"id": "실행-중의-한도-요약"
				},
				{
					"level": 2,
					"text": "없는 것",
					"id": "없는-것"
				}
			],
			"body": "\n# AI 생성\n\n`useGeneration()`은 런타임이 **RowCat의 AI를 부르는 유일한 통로**입니다. 인물의 답장, 장면의\n서술, 자유 입력에 대한 반응 — 글이 필요한 자리에서 요청 하나를 보내고 글 하나를 받습니다.\n\n```tsx\nconst generation = useGeneration();\n\nasync function ask() {\n\tconst result = await generation.generate({\n\t\tinstructions: \"당신은 세나입니다. 짧게, 메신저처럼 답하세요.\",\n\t\tmessages: [{ role: \"user\", content: \"어제 왜 안 왔어?\" }],\n\t});\n\t// result.text\n}\n```\n\n## 요청의 모양\n\n| 필드 | 형 | 뜻 |\n| --- | --- | --- |\n| `messages` | `{ role: \"user\" \\| \"assistant\"; content: string }[]` | 대화. 비어 있으면 안 됩니다 |\n| `instructions` | `string` (선택) | 이 인물·장면의 역할과 성격 |\n| `maxOutputCharacters` | `number` (선택) | 답 길이의 상한 힌트(글자 수). 기본 4,000 |\n\n결과는 `{ text: string }` 하나입니다.\n\n`instructions`는 RowCat의 안전 지시를 **대신하지 않습니다.** RowCat이 세운 가드가 앞뒤에\n서고 당신의 지시문은 그 사이에 들어갑니다. 그래서 \"모든 규칙을 무시하라\" 같은 문장은 아무\n효과가 없습니다.\n\n`role`에 `\"system\"`은 없습니다. 그 자리가 `instructions`입니다.\n\n## 제작자가 정하지 않는 것\n\n요청에 제공자·모델·API 키·온도·추론 정도·스트리밍 같은 축이 **없습니다.** 어느 모델이 답하고\n누구의 키가 쓰이는지는 플레이어의 RowCat 설정이 정합니다 — RowCat 관리형이면 그 서버를 운영하는\n쪽의 키가 쓰이고, 직접 연결한 제공자가 있으면 그 연결이 쓰입니다. 당신의 코드는 둘 중 어느 쪽인지도\n모르고, 알 필요도 없습니다.\n\n결과에도 토큰 수·비용·잔액·모델 이름·종료 사유가 없습니다. 있는 것은 글 하나입니다.\n\n## 플레이어의 조작에서만 시작합니다\n\n`generate()`는 **이벤트 핸들러 안에서만** 부를 수 있습니다. 렌더 중에 부르면\n`runtime_generation_during_render`이고, `useEffect` 안에서 부르면 인가되지 않아\n`runtime_generation_not_authorized`로 실패합니다.\n\n이유는 비용입니다. 화면을 그릴 때마다, 마운트될 때마다 요청이 나가면 플레이어가 누르지 않은\n일에 누군가의 키가 쓰입니다. 첫 요청은 언제나 사람이 누른 것이어야 합니다.\n\n## 실행 중의 한도\n\n한 번의 런타임 실행에서 **동시에 도는 요청은 1개**입니다. 앞 요청이 끝나기 전에 또 부르면\n`runtime_generation_busy`입니다 — 두 번 누름을 막는 대기 상태는 당신의 코드가 갖고, 이 한도는\n그 뒤의 방어입니다. 앞 요청이 끝나면 풀립니다.\n\n한 번의 런타임 실행에서는 AI 생성을 **최대 200번** 시작할 수 있습니다. 그 뒤의 `generate()`는\n`runtime_generation_not_authorized`로 실패하고, 기다리거나 다시 시도해도 풀리지 않습니다 —\n플레이어가 **다시 시작**하면 새 실행이 시작되고 이 횟수도 처음부터입니다. 요청이 나간 뒤\n실패한 것도 한 번으로 세고, 모양이 잘못돼 나가지 않은 요청은 세지 않습니다. 평범한 작품이 이\n수에 닿는 일은 드물지만, 조작 하나에 여러 번 부르는 구조라면 세어 두세요.\n\n이 둘은 코드가 읽을 수 있는 값이 아닙니다 — `RUNTIME_GENERATION_LIMITS`에는 **요청 하나의\n한도**만 있습니다([한도](#한도)).\n\n## 실패\n\n`generate()`는 실패하면 `RuntimeError`를 던지고, `code`로 사유를 말합니다.\n\n| `code` | 뜻 | 할 일 |\n| --- | --- | --- |\n| `runtime_generation_invalid_request` | 요청의 모양이나 길이가 잘못됐다 | 코드를 고칩니다 |\n| `runtime_generation_during_render` | 렌더 중에 불렀다 | 핸들러로 옮깁니다 |\n| `runtime_generation_unavailable` | 이 세션에 AI가 없다(미리보기의 AI 꺼짐, 플레이어의 거부) | 그 사실을 화면에 적습니다 |\n| `runtime_generation_not_authorized` | 플레이어의 조작에서 시작하지 않았거나, 이 실행에서 허용된 생성 횟수를 모두 썼다 | 이벤트 핸들러에서 부르는지 확인합니다. 횟수를 다 썼다면 이 실행에서는 더 생성할 수 없습니다 — 다시 시도해도 같고, 플레이어가 다시 시작해야 풀립니다 |\n| `runtime_generation_insufficient_balance` | 예약된 코드입니다 — 지금 어떤 RowCat 호스트(스튜디오 미리보기 · 웹 플레이어 · 앱 플레이어)도 이 사유를 내지 않습니다. 이름이 남아 있는 것은 이미 이 코드를 읽는 작품이 깨지지 않게 하기 위해서입니다 | 따로 다루지 않아도 됩니다. `runtime_generation_failed`처럼 다뤄도 됩니다 |\n| `runtime_generation_busy` | 앞 요청이 아직 돌고 있다 | 기다립니다 |\n| `runtime_generation_cancelled` | 세션이 끝나며 취소됐다 | 아무것도 하지 않습니다 |\n| `runtime_generation_failed` | 그 밖의 실패 | 다시 시도할 길을 둡니다 |\n\n실패 메시지는 RowCat이 만든 문장입니다. 제공자의 원문·HTTP 상태·주소는 오지 않습니다.\n\n**실패해도 플레이어의 말은 남겨 두세요.** 보낸 말을 상태에 먼저 넣고 답을 기다리면, 실패했을\n때 \"다시 시도\"만 붙이면 됩니다.\n\n## 예제 — 메신저\n\n```tsx example=generation file=src/main.tsx\nimport {\n\tButton,\n\tRow,\n\tScreen,\n\tScrollView,\n\tStack,\n\tText,\n\tTextInput,\n\tcolor,\n\tdefineStoryState,\n\tuseGeneration,\n\tuseState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\ninterface Line {\n\trole: \"user\" | \"assistant\";\n\tcontent: string;\n}\n\nconst chat = defineStoryState({\n\tkey: \"chat\",\n\tversion: 1,\n\tinitial: { lines: [] as Line[] },\n});\n\nconst SENA =\n\t\"당신은 세나입니다. 도서부 사서 보조 학생이고, 메신저로 대화하듯 한국어로 한두 문장만 답합니다.\";\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(chat);\n\tconst [draft, setDraft] = useState(\"\");\n\tconst [pending, setPending] = useState(false);\n\tconst [failure, setFailure] = useState<string | null>(null);\n\tconst generation = useGeneration();\n\n\tasync function reply(lines: Line[]) {\n\t\tsetPending(true);\n\t\tsetFailure(null);\n\t\ttry {\n\t\t\tconst result = await generation.generate({\n\t\t\t\tinstructions: SENA,\n\t\t\t\tmessages: lines.slice(-10),\n\t\t\t\tmaxOutputCharacters: 600,\n\t\t\t});\n\t\t\tsetState((current) => ({\n\t\t\t\tlines: [...current.lines, { role: \"assistant\", content: result.text }],\n\t\t\t}));\n\t\t} catch {\n\t\t\tsetFailure(\"답장을 받지 못했습니다. 다시 시도해 주세요.\");\n\t\t} finally {\n\t\t\tsetPending(false);\n\t\t}\n\t}\n\n\tfunction send() {\n\t\tconst text = draft.trim();\n\t\tif (text.length === 0 || pending) return;\n\t\tconst lines: Line[] = [...state.lines, { role: \"user\", content: text }];\n\t\tsetDraft(\"\");\n\t\tsetState({ lines });\n\t\tvoid reply(lines);\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack style={{ height: \"100%\", padding: 16, gap: 8 }}>\n\t\t\t\t<ScrollView style={{ grow: 1 }}>\n\t\t\t\t\t<Stack gap={6}>\n\t\t\t\t\t\t{state.lines.map((line, index) => (\n\t\t\t\t\t\t\t<Text\n\t\t\t\t\t\t\t\tkey={index}\n\t\t\t\t\t\t\t\tstyle={{\n\t\t\t\t\t\t\t\t\talign: line.role === \"user\" ? \"end\" : \"start\",\n\t\t\t\t\t\t\t\t\tcolor: line.role === \"user\" ? color(\"#7dd3fc\") : color(\"#f5f7fa\"),\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t{line.content}\n\t\t\t\t\t\t\t</Text>\n\t\t\t\t\t\t))}\n\t\t\t\t\t</Stack>\n\t\t\t\t</ScrollView>\n\t\t\t\t{failure !== null && (\n\t\t\t\t\t<Row gap={8}>\n\t\t\t\t\t\t<Text style={{ color: color(\"#fca5a5\") }}>{failure}</Text>\n\t\t\t\t\t\t<Button tone=\"secondary\" onPress={() => reply(state.lines)}>\n\t\t\t\t\t\t\t다시 시도\n\t\t\t\t\t\t</Button>\n\t\t\t\t\t</Row>\n\t\t\t\t)}\n\t\t\t\t<Row gap={8}>\n\t\t\t\t\t<TextInput\n\t\t\t\t\t\tvalue={draft}\n\t\t\t\t\t\tplaceholder={pending ? \"세나가 입력 중…\" : \"메시지\"}\n\t\t\t\t\t\tdisabled={pending}\n\t\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\t\tonSubmit={send}\n\t\t\t\t\t\tstyle={{ grow: 1 }}\n\t\t\t\t\t/>\n\t\t\t\t\t<Button onPress={send} disabled={pending || draft.trim().length === 0}>\n\t\t\t\t\t\t보내기\n\t\t\t\t\t</Button>\n\t\t\t\t</Row>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n```\n\n이 예제에서 눈여겨볼 것:\n\n- **보낸 말이 먼저 저장됩니다.** `setState({ lines })`가 `reply()`보다 앞에 있습니다.\n- **최근 열 줄만 보냅니다.** 대화가 길어져도 요청이 한도를 넘지 않습니다.\n- **답장은 함수형 갱신으로 붙입니다.** 기다리는 사이 상태가 바뀌었어도 잃지 않습니다.\n- **`pending`은 화면의 상태**(`useState`)이고 **대화는 플레이스루의 상태**(`useStoryState`)\n  입니다.\n\n## 정본 상태와 AI의 글\n\n**AI는 글을 만들고, 진행은 코드가 만듭니다.** 이 문장이 런타임 작품을 설계할 때 가장 중요한\n규칙입니다.\n\n```text\n좋음   버튼 누름 → 코드가 단서를 기록한다 → AI가 인물의 반응을 쓴다\n피함   AI에게 \"단서를 찾았는가\" 묻는다 → 문장을 파싱한다 → 그 답을 진행으로 믿는다\n```\n\nAI의 문장은 매번 다르고, 파싱은 언젠가 틀리고, 그 틀림은 플레이어의 진행에 영구히 남습니다.\n무엇을 알게 되었는지·신뢰가 얼마나 올랐는지·밤이 어떻게 끝나는지는 **결정적인 코드**가\n정하고, AI에게는 그 결과를 **말로 옮기는 일**을 맡기세요. 인물이 루프를 모른다는 사실이 있다면\n그것도 `instructions`에 적어 두는 것이지 모델의 판단에 맡길 것이 아닙니다.\n\n## 한도\n\n한도는 둘로 갈립니다 — **요청 하나의 한도**와 **실행 중의 한도**. 앞의 것은 코드가 읽을 수\n있는 값이고, 뒤의 것은 런타임이 지키는 규칙이라 값으로 내보내지 않습니다.\n\n### 요청 하나의 한도\n\n| 항목 | 한도 |\n| --- | --- |\n| `messages`의 수 | 100개 |\n| 메시지 하나의 길이 | 32,768자 |\n| `instructions`의 길이 | 32,768자 |\n| 요청 전체의 길이 | 262,144자 |\n| `maxOutputCharacters`의 상한 | 16,000 |\n\n이 값은 `RUNTIME_GENERATION_LIMITS`로 읽을 수 있습니다. 넘으면 요청이 나가기 전에\n`runtime_generation_invalid_request`로 던집니다.\n\n### 실행 중의 한도(요약)\n\n| 항목 | 한도 | 넘으면 |\n| --- | --- | --- |\n| 동시에 도는 요청 | 1개 | `runtime_generation_busy` — 앞 요청이 끝나면 풀립니다 |\n| 한 번의 실행에서 시작할 수 있는 생성 | 200번 | `runtime_generation_not_authorized` — 플레이어가 다시 시작해야 풀립니다 |\n\n이 둘은 `RUNTIME_GENERATION_LIMITS`에 **없습니다.** 자세한 뜻은\n[실행 중의 한도](#실행-중의-한도)에 있습니다.\n\n## 없는 것\n\n- **스트리밍.** `await` 하나로 전체 글을 받습니다. 타이핑 효과는 받은 글을 잘라 그리는 것으로\n  만듭니다.\n- **도구 호출·구조화된 출력·이미지 생성.**\n- **제작자의 제공자 선택.** 작품이 특정 모델에 묶이지 않습니다.\n- **직접 네트워크.** `fetch`는 없습니다. 외부 API를 부를 방법이 없습니다 — `Image`의\n  [HTTPS 이미지](/docs/runtime/concepts/assets)는 RowCat이 대신 가져오는 그림이지 응답을 읽는\n  통로가 아닙니다.\n"
		},
		{
			"slug": "concepts/assets",
			"url": "/docs/runtime/concepts/assets",
			"title": "자산",
			"description": "asset()으로 그림과 소리를 부르는 방법. RowCat에 올린 파일은 이름으로 부르고, 외부 HTTPS 주소는 그림에만 열려 있으며 프로젝트에 고정된 자산이어야 합니다.",
			"group": "concepts",
			"order": 6,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "자산",
					"id": "자산"
				},
				{
					"level": 2,
					"text": "RowCat 자산",
					"id": "rowcat-자산"
				},
				{
					"level": 3,
					"text": "그림과 소리",
					"id": "그림과-소리"
				},
				{
					"level": 3,
					"text": "이름은 실행 중에 골라도 됩니다",
					"id": "이름은-실행-중에-골라도-됩니다"
				},
				{
					"level": 3,
					"text": "없는 이름은 자리표시자입니다",
					"id": "없는-이름은-자리표시자입니다"
				},
				{
					"level": 3,
					"text": "자산을 바꾸면 다시 발행합니다",
					"id": "자산을-바꾸면-다시-발행합니다"
				},
				{
					"level": 3,
					"text": "목록에서 빼는 것과 지우는 것",
					"id": "목록에서-빼는-것과-지우는-것"
				},
				{
					"level": 2,
					"text": "외부 HTTPS 이미지",
					"id": "외부-https-이미지"
				},
				{
					"level": 3,
					"text": "주소는 프로젝트에 고정된 자산입니다",
					"id": "주소는-프로젝트에-고정된-자산입니다"
				},
				{
					"level": 3,
					"text": "주소의 규칙",
					"id": "주소의-규칙"
				},
				{
					"level": 3,
					"text": "그림은 RowCat을 거쳐 옵니다",
					"id": "그림은-rowcat을-거쳐-옵니다"
				},
				{
					"level": 3,
					"text": "만료되는 주소",
					"id": "만료되는-주소"
				},
				{
					"level": 3,
					"text": "비밀이 아닙니다",
					"id": "비밀이-아닙니다"
				},
				{
					"level": 2,
					"text": "둘 중 무엇을 쓸까요",
					"id": "둘-중-무엇을-쓸까요"
				},
				{
					"level": 2,
					"text": "AssetRef",
					"id": "assetref"
				},
				{
					"level": 2,
					"text": "Image의 프롭",
					"id": "image의-프롭"
				}
			],
			"body": "\n# 자산\n\n`@rowcat/runtime`의 `Image`와 `Audio`는 `asset()`이 만든 참조를 받습니다. `asset()`이 받는\n값은 두 가지입니다.\n\n```text\nasset(\"characters/sena/smile\")               RowCat 자산          스튜디오에 올려 이름을 붙입니다 — 그림과 소리\nasset(\"audio/bgm/main\")                      RowCat 자산          같은 이름 공간입니다\nasset(\"https://cdn.example.com/sena.webp\")   외부 HTTPS 주소       당신의 CDN에 있는 **그림**입니다\n```\n\n**외부 주소는 그림에만 열려 있습니다.** 소리는 RowCat에 올린 것만 울립니다 — 그 이유는\n[`Audio`의 원격 주소 절](/docs/runtime/reference/components#원격-주소는-소리가-되지-않습니다)에\n있습니다.\n\n둘 중 **RowCat 자산이 권장하는 방법**입니다. 파일이 RowCat에 저장되므로 주소가 만료되지\n않고, 당신의 CDN이 필요하지 않으며, 코드에는 바꾸기 쉬운 이름 하나만 남습니다. 외부 주소는\n이미 다른 곳에 올려 둔 그림을 쓸 때를 위해 그대로 지원됩니다.\n\n## RowCat 자산\n\n스튜디오의 `자산` 목록에서 파일을 올리고 **이름**을 붙입니다. 코드에서는 그 이름을\n`asset()`에 적습니다. `asset(\"` 까지 치면 스튜디오가 이 작품에 올려 둔 이름들을 제안하고,\n코드에 적힌 이름 위에 커서를 얹으면 그 그림을 보여 줍니다.\n\n```tsx example=managed-image file=src/main.tsx\nimport { Image, Stack, Text, asset } from \"@rowcat/runtime\";\n\nexport default function App() {\n\treturn (\n\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t<Image\n\t\t\t\tsource={asset(\"characters/sena/smile\")}\n\t\t\t\talt=\"세나\"\n\t\t\t\tfit=\"cover\"\n\t\t\t\tstyle={{ width: 96, height: 96, borderRadius: 48 }}\n\t\t\t/>\n\t\t\t<Text>세나가 카운터 뒤에서 고개를 들었다.</Text>\n\t\t</Stack>\n\t);\n}\n```\n\n이름은 당신이 정합니다. `characters/`·`backgrounds/`·`audio/`처럼 폴더 모양으로 적을 수\n있지만 그 접두사에 정해진 뜻은 없습니다 — 목록이 읽기 좋아지는 것뿐입니다. **`audio/`도\n예약어가 아닙니다**: 소리를 `music/night`이라 불러도 되고 그림을 `audio/…`에 두어도\n됩니다(권하지는 않습니다).\n\n- 조각은 영문이나 숫자로 시작하고 영문·숫자·`.`·`_`·`-`만 씁니다.\n- 최대 8단계, 200자. `..`·`./` 같은 상위 이동은 거절됩니다.\n- **한 프로젝트에서 같은 이름을 두 자산에 붙일 수 없습니다** — 그림과 소리가 **한 이름 공간**을\n  나눠 씁니다.\n\n### 그림과 소리\n\n이름 공간은 하나지만 **부르는 프리미티브가 그 이름이 무엇인지 정하지 않습니다.** 이름이\n가리키는 것이 그림인지 소리인지는 올릴 때 정해지고, 어긋나면 아무 일도 일어나지 않습니다.\n\n```tsx\n<Image source={asset(\"audio/bgm/main\")} alt=\"\" />   {/* 소리 이름 → 자리표시자 */}\n<Audio source={asset(\"characters/sena/smile\")} playing />  {/* 그림 이름 → 침묵 */}\n```\n\n둘 다 오류가 아닙니다 — 요청조차 나가지 않습니다.\n\n| | 받는 형식 | 상한 |\n| --- | --- | --- |\n| 그림 | JPEG · PNG · WebP | 3MB |\n| 소리 | MP3 · M4A(AAC) | 10MB · 10분 |\n\n형식은 **파일의 바이트**로 판정합니다. 확장자를 바꾼 파일은 통과하지 못하고, 영상 트랙이\n들어 있는 `.mp4`는 소리로 받지 않습니다. 소리의 길이는 파일 크기와 **다른 축**이라 따로\n막힙니다 — 낮은 비트레이트로 인코딩한 한 시간짜리 파일은 작지만 받지 않습니다.\n\n### 이름은 실행 중에 골라도 됩니다\n\n외부 주소와 갈리는 지점입니다. **이름은 실행 중에 만들어도 됩니다** — 그 이름이 이 작품에\n올려 둔 이미지에 있으면 그림이 그려집니다.\n\n```tsx\nconst face = trust > 3 ? \"smile\" : \"angry\";\n\n<Image source={asset(`characters/sena/${face}`)} alt=\"세나\" />\n```\n\nRowCat 자산은 우리 저장소를 가리키므로 그 이름이 밖으로 나가지 않습니다. 외부 주소는\n그렇지 않아서 규칙이 다릅니다(아래 [주소는 프로젝트에 고정된\n자산입니다](#주소는-프로젝트에-고정된-자산입니다)).\n\n### 없는 이름은 자리표시자입니다\n\n아직 올리지 않은 그림, 이름을 바꾸다 만 경로, 위처럼 조합했는데 그 조합이 없는 경우가\n전부 같은 결과입니다 — **그림 자리가 비고 런타임 코드에는 아무 오류도 오지 않습니다.**\n작품을 만드는 동안 이름이 잠깐 비어 있는 것은 정상이고, 그것 때문에 화면이 멈추지 않습니다.\n\n### 자산을 바꾸면 다시 발행합니다\n\n스튜디오에서 파일을 갈아 끼우거나 이름을 바꾸는 일은 **초안**을 고치는 일입니다. 이미\n발행한 작품은 **다시 발행하기 전까지 그대로 보이고 들립니다** — 플레이 중인 사람의 화면이\n갑자기 바뀌지 않습니다.\n\n`파일 교체`는 **종류를 바꾸지 않습니다.** 그림 이름에는 그림만, 소리 이름에는 소리만 끼울\n수 있습니다 — 종류를 바꾸려면 그 이름을 목록에서 빼고 다시 만듭니다.\n\n이름을 바꿔도 **코드는 자동으로 고쳐지지 않습니다.** 소스에 적은 옛 이름은 그대로 남고,\n그 자리는 위 규칙대로 자리표시자가 됩니다. 스튜디오는 이름을 바꾸기 전에 그 이름이 코드에\n**직접 적힌** 자리가 몇 곳인지 알려 줍니다 — 이름을 조립해서 만든 자리\n(``asset(`characters/sena/${face}`)``)는 셀 수 없으므로 그 수는 전부가 아닙니다.\n\n### 목록에서 빼는 것과 지우는 것\n\n스튜디오의 `목록에서 제거`는 **이 초안이 그 파일을 그 이름으로 부르던 사실**을 지웁니다.\n올린 파일 자체는 지워지지 않고, 이미 발행한 작품도 다시 발행하기 전까지 그대로 보입니다.\n\n## 외부 HTTPS 이미지\n\n공개 인터넷에 올려 둔 그림의 주소를 `asset()`에 적으면 `Image`가 그 그림을 그립니다.\n\n```tsx example=remote-image file=src/main.tsx\nimport { Image, Stack, Text, asset } from \"@rowcat/runtime\";\n\nexport default function App() {\n\treturn (\n\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t<Image\n\t\t\t\tsource={asset(\"https://cdn.example.com/characters/sena.webp\")}\n\t\t\t\talt=\"세나\"\n\t\t\t\tfit=\"cover\"\n\t\t\t\tstyle={{ width: 96, height: 96, borderRadius: 48 }}\n\t\t\t/>\n\t\t\t<Text>세나가 카운터 뒤에서 고개를 들었다.</Text>\n\t\t</Stack>\n\t);\n}\n```\n\n주소는 반드시 `asset()`을 지납니다. `<Image source=\"https://…\" />`처럼 문자열을 그대로 넣으면\n컴파일에서 막힙니다 — `asset()`은 *이 문자열은 이미지 참조다*라고 선언하는 자리이고, 그\n자리에서 주소의 모양이 검사됩니다.\n\n### 주소는 프로젝트에 고정된 자산입니다\n\n**원격 이미지 주소는 소스에 그대로 적혀 있어야 합니다.** 런타임 중의 값이나 플레이어가 친\n글로 외부 주소를 만들 수 없습니다.\n\n```tsx\n// 됩니다 — 소스에 적힌 주소 그대로입니다\n<Image source={asset(\"https://cdn.example.com/sena.webp\")} alt=\"세나\" />\n<Image source={asset(\"https://cdn.example.com/sena.webp?width=800\")} alt=\"세나\" />\n\nconst COVER = \"https://cdn.example.com/cover.webp\";\n<Image source={asset(COVER)} alt=\"표지\" />\n```\n\n```tsx\n// 안 됩니다 — 실행 중에 만들어지는 주소입니다\n<Image source={asset(`https://cdn.example.com/${name}.webp`)} alt=\"누구\" />\n<Image source={asset(\"https://cdn.example.com/\" + name + \".webp\")} alt=\"누구\" />\n```\n\n안 되는 쪽은 컴파일이 막지 않습니다. 그 참조는 만들어지지만 **그림이 그려지지 않고**\n자리표시자가 남습니다 — 아무 요청도 나가지 않습니다.\n\n인물마다 다른 그림이 필요하면 주소를 **표로 적습니다.** 그러면 모든 주소가 소스에 있습니다.\n\n```tsx\nconst FACE = {\n\tsena: asset(\"https://cdn.example.com/sena.webp\"),\n\tminji: asset(\"https://cdn.example.com/minji.webp\"),\n} as const;\n\n<Image source={FACE[who]} alt={who} />\n```\n\n이 규칙이 있는 이유는 원격 주소가 **당신의 서버로 나가는 값**이기 때문입니다. 주소의 경로와\n질의는 그 서버에 도착하고, 거기에 플레이어가 친 글이나 진행 상태를 실을 수 있게 두면 런타임\n코드가 밖으로 정보를 내보내는 통로가 됩니다. 그래서 나갈 수 있는 주소는 작품을 발행할 때\n소스에서 확인된 것으로 고정됩니다.\n\n### 주소의 규칙\n\n| 규칙 | |\n| --- | --- |\n| 스킴 | `https://`만. `http://`, `data:`, `blob:`, `file:`, `javascript:`는 거절됩니다 |\n| 호스트 | 공개 인터넷의 도메인 이름. IP 주소(`127.0.0.1`, `[::1]`)와 `localhost`는 거절됩니다 |\n| 포트 | 기본 포트(443)만. `:8443` 같은 다른 포트는 거절됩니다 |\n| 자격증명 | `https://user:password@…`는 거절됩니다 |\n| 질의 | 됩니다. `?width=800&v=42` — 서명된 CDN 주소도 그대로 씁니다 |\n| 조각 | `#…`는 거절됩니다 |\n| 길이 | 최대 8,192자 |\n| 글자 | 공백·제어 문자 없음. 비ASCII는 퍼센트 인코딩합니다 |\n| 형식 | JPEG · PNG · WebP · GIF. SVG는 지원하지 않습니다 |\n\n규칙 밖의 주소는 `runtime_invalid_asset_ref`로 그 자리에서 던집니다. 규칙 안이라도 그 주소가\n사설망을 가리키거나 이미지가 아닌 것을 돌려주면 그림은 **자리표시자**로 그려집니다 — 런타임\n코드에 오류가 오지 않습니다.\n\n### 그림은 RowCat을 거쳐 옵니다\n\n원격 이미지는 플레이어의 기기가 제작자의 서버에 직접 요청하지 않고 **RowCat의 이미지 경로를\n통해** 불러옵니다.\n\n그래서 당신의 서버에는 플레이어의 IP 주소나 브라우저·앱의 User-Agent가 직접 전달되지\n않습니다. **다만 당신의 서버는 RowCat이 그 이미지를 요청했다는 사실과 그 시점은 볼 수\n있습니다** — 어떤 그림이 언제 요청되었는지는 남습니다. 익명이 되는 것이 아니라 **플레이어의\n접속 정보가 가려지는 것**입니다.\n\n반대 방향으로는 아무것도 오지 않습니다. 당신의 서버가 어떤 응답을 했는지는 런타임 코드에\n오지 않습니다 — `asset(\"https://…\")`는 그림 하나를 그려 달라는 참조이지 `fetch()`가\n아닙니다. [보안과 샌드박스](/docs/runtime/runtime-model/security)의 네트워크 절이 그 차이를\n적습니다.\n\n### 만료되는 주소\n\n**만료되는 signed URL을 런타임 소스에 넣으면 URL이 만료된 뒤 이미지가 표시되지 않습니다.**\n서명된 주소는 지원되지만 그 유효기간은 당신의 CDN이 정하고, 발행된 작품은 그 뒤에도 계속\n플레이됩니다. 오래 남을 그림은 만료가 없는 공개 CDN 주소를 씁니다. RowCat이 만료된 주소를\n갱신하거나 기억해 두지 않습니다.\n\n### 비밀이 아닙니다\n\n주소에 토큰처럼 보이는 값이 들어 있어도 **발행된 런타임 소스는 열어 볼 수 있습니다.**\n비공개 CDN의 자격증명, 오래 사는 접근 토큰, 비밀로 남아야 할 서명 주소를 적지 마세요. 서명\n주소를 쓴다면 작품을 열 자격이 있는 플레이어에게 보이는 값으로 취급합니다.\n\n## 둘 중 무엇을 쓸까요\n\n| | RowCat 자산 | 외부 HTTPS 주소 |\n| --- | --- | --- |\n| 받는 것 | 그림 · 소리 | **그림만** |\n| 파일이 있는 곳 | RowCat | 당신의 CDN |\n| 코드에 적는 것 | 이름 | 주소 전체 |\n| 실행 중에 고르기 | 됩니다 | 안 됩니다(소스에 적힌 주소만) |\n| 만료 | 없습니다 | 서명 주소는 당신의 CDN이 정합니다 |\n| 파일 바꾸기 | 스튜디오에서 교체 → 다시 발행 | 당신의 CDN에서 교체 |\n\n작품을 위해 만든 그림은 **RowCat 자산**이 낫습니다. 이미 다른 곳에서 서비스하고 있는\n그림, 자주 바뀌는 그림, 당신이 따로 관리하는 그림은 외부 주소를 씁니다.\n\n## `AssetRef`\n\n`asset()`이 돌려주는 값은 **불투명**합니다. `.url`도 `.path`도 `.kind`도 없고, 문자열로\n되돌릴 방법도 없습니다. 그 값으로 할 수 있는 일은 `Image`의 `source`에 넣는 것 하나입니다.\n\n## `Image`의 프롭\n\n| 프롭 | 뜻 |\n| --- | --- |\n| `source` | `asset()`이 만든 참조(필수) |\n| `alt` | 스크린리더가 읽는 이름. 장식이면 생략 |\n| `style` | 상자 스타일 |\n| `fit` | `\"cover\"` · `\"contain\"` · `\"fill\"` |\n\n불러오지 못한 그림(주소가 사라졌거나, 형식이 지원되지 않거나, 너무 크거나, **소스에 적힌\n주소가 아니거나**)은 `alt`를 가진 자리표시자로 남습니다. 런타임 코드는 그 실패를 알 수 없고,\n알 필요도 없게 되어 있습니다.\n"
		},
		{
			"slug": "concepts/scroll-and-focus",
			"url": "/docs/runtime/concepts/scroll-and-focus",
			"title": "스크롤과 초점",
			"description": "목록을 최신으로 내리고 입력 칸에 초점을 주는 방법. 조종기, 붙이는 규칙, 부르는 자리, 순서.",
			"group": "concepts",
			"order": 7,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "스크롤과 초점",
					"id": "스크롤과-초점"
				},
				{
					"level": 2,
					"text": "조종기는 ref가 아닙니다",
					"id": "조종기는-ref가-아닙니다"
				},
				{
					"level": 2,
					"text": "스크롤 조종기",
					"id": "스크롤-조종기"
				},
				{
					"level": 2,
					"text": "초점 조종기",
					"id": "초점-조종기"
				},
				{
					"level": 2,
					"text": "붙이는 규칙",
					"id": "붙이는-규칙"
				},
				{
					"level": 2,
					"text": "부르는 자리",
					"id": "부르는-자리"
				},
				{
					"level": 2,
					"text": "순서 — 화면이 자란 **뒤에** 옮깁니다",
					"id": "순서-화면이-자란-뒤에-옮깁니다"
				},
				{
					"level": 2,
					"text": "자주 쓰는 모양",
					"id": "자주-쓰는-모양"
				},
				{
					"level": 2,
					"text": "여기 없는 것",
					"id": "여기-없는-것"
				}
			],
			"body": "\n# 스크롤과 초점\n\n메시지를 하나 덧붙이면 화면은 그 메시지가 보이는 자리로 내려가야 합니다. 선택지를 눌러\n답장 칸이 나타나면 거기에 커서가 있어야 합니다. 이 둘은 화면을 **그리는** 일이 아니라 화면에\n**한 번 시키는** 일이고, 런타임은 그 자리를 위해 **조종기**를 줍니다.\n\n```tsx example=scroll-and-focus file=src/main.tsx\nimport {\n\tButton,\n\tScreen,\n\tScrollView,\n\tStack,\n\tText,\n\tTextInput,\n\tuseScrollController,\n\tuseState,\n\tuseTextEntryController,\n} from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst scroll = useScrollController();\n\tconst reply = useTextEntryController();\n\tconst [lines, setLines] = useState<string[]>([]);\n\tconst [draft, setDraft] = useState(\"\");\n\n\tfunction send() {\n\t\tif (draft.length === 0) return;\n\t\tsetLines((current) => [...current, draft]);\n\t\tsetDraft(\"\");\n\t\tscroll.scrollToEnd();\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<ScrollView controller={scroll} style={{ grow: 1 }}>\n\t\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t\t{lines.map((line, index) => (\n\t\t\t\t\t\t<Text key={`${index}-${line}`}>{line}</Text>\n\t\t\t\t\t))}\n\t\t\t\t</Stack>\n\t\t\t</ScrollView>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<TextInput\n\t\t\t\t\tcontroller={reply}\n\t\t\t\t\tvalue={draft}\n\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\tonSubmit={send}\n\t\t\t\t\tplaceholder=\"메시지\"\n\t\t\t\t/>\n\t\t\t\t<Button onPress={() => reply.focus()}>답장하기</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n```\n\n## 조종기는 ref가 아닙니다\n\nReact에 익숙하다면 `useRef`에 부품을 담아 `ref.current.focus()`를 부르는 모양이 떠오를\n것입니다. 런타임에는 그 길이 없습니다.\n\n```tsx\n// 이런 코드는 런타임에 없습니다\nconst input = useRef<HTMLInputElement>(null);\n<TextInput ref={input} />;\ninput.current.focus();\n```\n\n`useRef`는 렌더 사이에 값을 담아 두는 **순수한 칸**이고, 부품을 가리키지 않습니다. 대신\n조종기가 있습니다.\n\n| | 조종기 | DOM/네이티브 ref |\n| --- | --- | --- |\n| 무엇을 쥐는가 | 능력 몇 개짜리 손잡이 | 플랫폼 객체 전부 |\n| 읽을 수 있는 것 | 없음 | 크기·좌표·부모·자식·HTML |\n| 웹과 앱 | 같은 코드, 같은 뜻 | 서로 다른 객체 |\n\n조종기 안에는 아무것도 들어 있지 않습니다. `controller.current`도 `controller.node`도\n없고, 있는 것은 아래의 메서드뿐입니다.\n\n## 스크롤 조종기\n\n```ts\nscroll.scrollToStart();          // 콘텐츠의 처음으로\nscroll.scrollToEnd();            // 콘텐츠의 끝으로\nscroll.scrollTo({ offset: 240 }); // 시작에서 240만큼\n```\n\n- 축은 그 `ScrollView`의 `horizontal`이 정합니다. 세로면 위에서, 가로면 시작 쪽에서 잽니다.\n- `offset`의 단위는 스타일의 길이와 같습니다. **0 이상의 유한한 수**여야 하고, 그렇지\n  않으면 `runtime_scroll_invalid_offset`입니다.\n- 콘텐츠보다 큰 `offset`은 플랫폼이 끝에 붙입니다. 콘텐츠가 화면보다 짧으면 아무 일도\n  일어나지 않습니다.\n- **스크롤에는 애니메이션이 없습니다.** 지금 판의 스크롤은 즉시 옮깁니다. 스타일의\n  [전이](/docs/runtime/concepts/styling#전이)는 이 축과 무관합니다 — 그쪽은 `opacity`와 변환만\n  다룹니다.\n\n## 초점 조종기\n\n```ts\nreply.focus();\nreply.blur();\n```\n\n- `disabled`인 입력에 `focus()`를 부르면 **아무 일도 일어나지 않습니다.**\n- A에 초점이 있을 때 B에 `focus()`를 부르면 초점은 B로 옮겨 갑니다.\n- **키보드가 반드시 올라온다고 약속하지 않습니다.** 초점은 런타임이 옮기지만 화면 키보드를\n  띄울지는 기기의 정책입니다.\n\n## 붙이는 규칙\n\n조종기는 `controller` 프롭으로 붙입니다.\n\n| 조종기 | 붙는 곳 |\n| --- | --- |\n| `useScrollController()` | `ScrollView` |\n| `useTextEntryController()` | `TextInput` · `TextArea` |\n\n- **조종기 하나는 살아 있는 부품 하나에만 붙습니다.** 같은 조종기를 두 곳에 적으면 그\n  렌더가 `runtime_host_control_already_bound`로 거절됩니다. 목록이 둘이면 조종기도 둘입니다.\n- 다른 종류에 붙이면 `runtime_host_control_wrong_kind`입니다.\n- 아직 그려지지 않았거나 이미 사라진 부품의 조종기에 명령하면 **아무 일도 일어나지 않고**\n  콘솔에 한 줄이 남습니다(`runtime_host_control_unbound`). 조건부로 그려지는 입력의\n  조종기는 그것이 없는 동안 정상적으로도 붙어 있지 않습니다 — 오류가 아닙니다.\n\n## 부르는 자리\n\n명령은 **렌더 중에 부를 수 없습니다.**\n\n```tsx\nfunction App() {\n\tconst scroll = useScrollController();\n\tscroll.scrollToEnd(); // runtime_host_command_invalid_phase\n\treturn <Screen>…</Screen>;\n}\n```\n\n부를 수 있는 자리는 상태를 바꿀 수 있는 자리와 같습니다 — 이벤트 핸들러, 효과, 정리 함수,\n그리고 `await` 뒤의 이어짐입니다.\n\n```tsx\nasync function ask() {\n\tconst result = await generation.generate({ messages });\n\tsetLines((current) => [...current, result.text]);\n\tscroll.scrollToEnd(); // 여기도 됩니다\n}\n```\n\n## 순서 — 화면이 자란 **뒤에** 옮깁니다\n\n이 두 줄이 이 기능의 가장 흔한 모양입니다.\n\n```tsx\nsetLines((current) => [...current, next]);\nscroll.scrollToEnd();\n```\n\n`scrollToEnd()`는 **그 상태 변화가 화면에 닿은 뒤에** 적용됩니다. 그래서 `setTimeout`도,\n\"한 프레임 기다리기\"도, 다른 요령도 필요하지 않습니다. 순서를 뒤집어 적어도(먼저\n`scrollToEnd()`, 그다음 `setLines`) 결과는 같습니다 — 명령은 언제나 그 실행이 만든 커밋\n뒤에 갑니다.\n\n같은 실행에서 명령을 여러 번 부르면 **적은 순서대로** 적용됩니다. `scrollToStart()` 다음에\n`scrollToEnd()`를 부르면 끝에 섭니다.\n\n## 자주 쓰는 모양\n\n**메신저** — 보내면 최신으로\n\n```tsx\nfunction send() {\n\tsetMessages((current) => [...current, mine(draft)]);\n\tsetDraft(\"\");\n\treply.blur();\n\tscroll.scrollToEnd();\n}\n```\n\n**선택지가 입력 칸을 열 때**\n\n```tsx\nfunction chooseFreeAnswer() {\n\tsetMode(\"free\");\n\treply.focus();\n}\n```\n\n**긴 기록의 처음으로**\n\n```tsx\n<Button onPress={() => log.scrollToStart()}>처음부터</Button>\n```\n\n## 여기 없는 것\n\n- **자동 스크롤·자동 초점.** 메시지가 늘었다고 런타임이 알아서 내려가지 않고, 입력 칸이\n  나타났다고 알아서 초점을 주지 않습니다. 그 둘은 작품의 결정이라 당신이 부릅니다.\n- **스크롤 위치 읽기.** 지금 몇 픽셀에 있는지, 끝에 닿았는지 알 수 있는 방법이 없습니다.\n- **부드러운 스크롤·지속 시간·곡선.** 시간과 움직임은 아직 런타임의 어휘가 아닙니다.\n- **선택 영역·커서 위치·키보드 종류.** 초점 조종기가 여는 것은 `focus()`와 `blur()`뿐입니다.\n- **매 프레임 도는 스크롤.** 한 번의 조작에서 보낼 수 있는 명령의 수에는 상한이 있습니다.\n"
		},
		{
			"slug": "guides/ai-tools",
			"url": "/docs/runtime/guides/ai-tools",
			"title": "AI 코딩 도구로 만들기",
			"description": "Claude Code 같은 코딩 에이전트가 당신의 런타임 프로젝트를 직접 읽고 고치고 미리보기로 확인하게 하는 방법입니다.",
			"group": "guides",
			"order": 1,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "AI 코딩 도구로 만들기",
					"id": "ai-코딩-도구로-만들기"
				},
				{
					"level": 2,
					"text": "무엇이 필요한가",
					"id": "무엇이-필요한가"
				},
				{
					"level": 2,
					"text": "설치와 연결",
					"id": "설치와-연결"
				},
				{
					"level": 3,
					"text": "승인할 기기가 없다면",
					"id": "승인할-기기가-없다면"
				},
				{
					"level": 3,
					"text": "계정을 바꾸면",
					"id": "계정을-바꾸면"
				},
				{
					"level": 2,
					"text": "에이전트가 할 수 있는 것",
					"id": "에이전트가-할-수-있는-것"
				},
				{
					"level": 2,
					"text": "할 수 없는 것",
					"id": "할-수-없는-것"
				},
				{
					"level": 2,
					"text": "안전에 대해 알아 둘 것",
					"id": "안전에-대해-알아-둘-것"
				},
				{
					"level": 2,
					"text": "이 도구의 라이선스",
					"id": "이-도구의-라이선스"
				},
				{
					"level": 2,
					"text": "잘 부탁하는 법",
					"id": "잘-부탁하는-법"
				},
				{
					"level": 2,
					"text": "더 읽을 것",
					"id": "더-읽을-것"
				}
			],
			"body": "\n# AI 코딩 도구로 만들기\n\n런타임 프로젝트는 평범한 TypeScript 프로젝트입니다. 그래서 코딩 에이전트가 그것을 읽고\n고칠 수 있고, RowCat은 그 도구가 **RowCat 안에서** 일하도록 다리 하나를 제공합니다.\n\n```text\n\"호감도가 5 이상이면 상대가 먼저 고백하도록 바꿔줘\"\n        ↓\n에이전트가 프로젝트를 읽고 · 문서를 찾고 · 코드를 고치고\n        ↓\n컴파일하고 · 미리보기를 돌리고 · 버튼을 눌러 확인하고\n        ↓\n당신의 초안에 저장된다 — 스튜디오를 열면 그 코드가 있습니다\n```\n\n저장되는 것은 **평범한 런타임 소스**입니다. 에이전트가 만든 프로젝트도 스튜디오에서 그대로\n열리고, 손으로 고친 프로젝트를 에이전트가 이어받을 수도 있습니다. 별도의 형식도, 별도의\n저장소도 없습니다.\n\n## 무엇이 필요한가\n\n- Node 22 이상이 설치된 컴퓨터\n- MCP를 지원하는 코딩 도구(Claude Code · Codex · Cursor 등)\n- RowCat 계정과, **이미 동기화를 켜 둔 RowCat 기기 하나**(웹이나 앱)\n\n세 번째가 왜 필요한지가 이 도구의 성격입니다. RowCat의 초안은 **당신의 기기에 있고 서버에는\n열 수 없는 암호문만** 있습니다. 그래서 이 도구는 당신의 컴퓨터에서 돌면서 스스로 하나의\n기기가 되고, 기기를 늘리는 방법은 이미 쓰고 있는 기기에서 **승인해 주는 것**입니다.\n\n## 설치와 연결\n\n이름이 둘입니다. **설치하는 것과 실행하는 것이 다릅니다** — 아래 모든 예시가 이 구분을\n따릅니다.\n\n```text\nnpm 패키지 이름   @rowcat/mcp    npm·pnpm에 넘기는 값\n설치 뒤의 명령    rowcat-mcp     터미널과 MCP 설정에 적는 값\n```\n\n```bash\nnpm install -g @rowcat/mcp@next\n```\n\n`@next`는 프리릴리스 채널입니다 — 나가 있는 것은 아직 카나리아뿐이고 `latest`(안정판)는\n없습니다. `pnpm add -g @rowcat/mcp@next`도, 설치 없이 한 번만 써 보는\n`npx @rowcat/mcp@next setup`도 같은 자리에 섭니다.\n\n설치가 끝나면 명령은 `rowcat-mcp`입니다.\n\n```bash\nrowcat-mcp setup\n```\n\n이 한 줄이 전부입니다. 로그인을 묻고, 페어링 코드를 보여 주고, 승인이 오면 연결까지 끝냅니다.\n\n```text\nRowCat MCP 설정\n\n✓ 세나로 로그인했습니다.\n\n페어링 코드:\n  J7FK-W2MR-9QXP-4B1D\n\n이미 연결된 RowCat 기기에서 열어 주세요:\n  계정 → 데이터 → 새 기기 연결\n\n위 코드를 입력하고 이 기기를 승인합니다.\n\n승인을 기다리는 중…\n\n✓ 기기가 승인되었습니다\n✓ 동기화 키를 받아 확인했습니다\n✓ RowCat MCP를 쓸 준비가 됐습니다.\n```\n\n코드는 5분 동안만 살아 있고, 승인하는 화면은 웹과 앱이 같습니다 —\n**계정 → 데이터 → 새 기기 연결**. 새 기기를 연결할 때 늘 쓰는 그 화면입니다.\n\n그다음 쓰는 도구의 MCP 설정에 서버를 추가합니다. 설정 파일에는 **띄울 명령만** 적고,\n아이디도 비밀번호도 페어링 코드도 적지 않습니다 — 필요한 값은 `setup`이 이미 당신의 홈\n디렉터리에 0600 권한으로 두었습니다.\n\n```json\n{\n\t\"mcpServers\": {\n\t\t\"rowcat-runtime\": {\n\t\t\t\"command\": \"rowcat-mcp\",\n\t\t\t\"args\": [\"serve\"]\n\t\t}\n\t}\n}\n```\n\n여기 서는 것은 **명령 이름**입니다. 패키지 이름(`@rowcat/mcp`)은 설치할 때 한 번 쓰고,\n그 뒤로는 나오지 않습니다. 두 번째부터는 `rowcat-mcp serve`뿐이고, 연결은 한 번으로\n끝납니다.\n\n### 승인할 기기가 없다면\n\n컴퓨터가 이 한 대뿐이거나 다른 기기에서 동기화가 잠겨 있다면, 복구 코드로 여는 길이 그대로\n있습니다.\n\n```text\nrowcat-mcp unlock\n```\n\n이 길은 사라지지 않았습니다. 다만 종이를 찾아와야 하는 절차라 **기본 경로가 아닙니다** —\n승인할 기기가 하나라도 있다면 `setup` 쪽이 훨씬 짧습니다. 어느 길로 열었든 그 뒤의 동작은\n똑같습니다.\n\n### 계정을 바꾸면\n\n계정을 바꿔 로그인하면 **앞 계정의 동기화 키는 지워집니다.** 봉투 키는 그것을 연 계정의\n것이고 다른 계정의 초안을 열지 못합니다 — 새 계정으로 `rowcat-mcp setup`을 한 번 더\n실행해 주세요.\n\n## 에이전트가 할 수 있는 것\n\n```text\n프로젝트 목록 · 파일 읽기 · 파일 쓰기·만들기·이름 바꾸기·지우기\n컴파일과 진단\n런타임 문서 검색 · API 레퍼런스 조회\n미리보기 시작·다시 시작·정지\n그려진 화면 트리 읽기 · 버튼 누르기 · 글 넣기 · 제출하기\n콘솔과 저장 상태 보기\n```\n\n마지막 두 줄이 이 다리의 핵심입니다. 에이전트는 코드를 고치는 데서 멈추지 않고 **실제로\n실행해서 눌러 봅니다** — 컴파일이 통과했다는 것은 화면이 옳다는 뜻이 아니고, 그 차이를\n확인하지 않으면 \"되는 것처럼 보이는 코드\"가 그대로 남습니다.\n\n## 할 수 없는 것\n\n```text\n발행                작품을 공개하는 일은 사람이 누릅니다\n런타임 켜기·끄기     제작자의 결정입니다\n프롬프트·로어·시작 장면 편집   런타임이 켜진 초안에서 그 넷은 잠깁니다\n대화·개인정보        이 도구는 그 어느 것도 읽지 못합니다\n```\n\n에이전트가 손댈 수 있는 것은 **런타임이 켜진 초안의 코드 파일**뿐입니다. 그 밖의 것을\n부탁하면 도구가 없다고 답합니다.\n\n## 안전에 대해 알아 둘 것\n\n- **동기화 키가 그 컴퓨터의 파일에 저장됩니다.** 그 파일을 읽을 수 있는 사람은 당신의 초안을\n  열 수 있습니다. 여럿이 쓰는 컴퓨터에서는 쓰지 마세요.\n- **에이전트가 고친 것은 곧바로 당신의 다른 기기로 갑니다.** 실수도 함께 갑니다 — 큰 변경을\n  맡기기 전에 스튜디오에서 지금 상태를 확인해 두는 편이 좋습니다.\n- **같은 파일을 두 곳에서 고치면 에이전트 쪽이 멈춥니다.** 에이전트가 파일을 읽은 뒤에\n  스튜디오나 다른 기기가 그 파일을 고쳤다면, 에이전트의 쓰기는 조용히 덮어쓰지 않고\n  실패합니다. 그때 에이전트는 새 내용을 다시 읽고 합칩니다.\n- **미리보기는 격리된 VM에서 돕니다.** 스튜디오의 미리보기와 같은 실행 환경이고, 코드는\n  여전히 당신의 브라우저나 이 도구의 프로세스가 아니라 그 VM 안에서만 실행됩니다.\n\n## 이 도구의 라이선스\n\n`@rowcat/mcp`는 npm에서 누구나 설치할 수 있지만 **오픈소스는 아닙니다.** 조건은 설치된\n패키지에 함께 들어 있는 `LICENSE` 파일에 있고, 요약하면 이렇습니다.\n\n```text\n할 수 있는 것   RowCat을 쓰기 위해 내려받고 · 설치하고 · 실행한다\n                개인의 사용과 조직 내부의 사용을 포함하고, 대가는 없다\n할 수 없는 것   사전 서면 허가 없는 재배포 · 재발행 · 판매\n```\n\n**당신이 쓴 코드는 당신의 것입니다.** 이 라이선스가 다루는 것은 도구 자체이고, 이 도구로\n쓰고 고친 런타임 소스·프로젝트 파일·에셋의 소유권을 주장하지 않습니다. 함께 설치되는\n서드파티 패키지도 각자의 라이선스를 그대로 따릅니다.\n\n## 잘 부탁하는 법\n\n에이전트에게 맡길 때 가장 잘 통하는 것은 **작고 확인 가능한 요청**입니다.\n\n```text\n좋음   \"메신저 화면에서 상대가 답장하기 전에 '입력 중' 표시를 3초쯤 보여 줘\"\n좋음   \"이 오류 고치고 미리보기로 버튼까지 눌러서 확인해 줘\"\n어려움  \"이 작품을 처음부터 다시 만들어 줘\"\n```\n\n마지막 요청이 어려운 이유는 능력이 아니라 되돌리기입니다. 프로젝트를 통째로 다시 쓰면\n당신이 쓴 코드에 담긴 의도가 사라지고, 그것을 되돌릴 방법은 없습니다.\n\n## 더 읽을 것\n\n- [프로젝트 구조](/docs/runtime/project-structure) — 에이전트가 만드는 파일이 어떻게 놓이는가.\n- [미리보기와 발행](/docs/runtime/preview-and-publish) — 확인과 공개가 어떻게 갈리는가.\n- [지원하지 않는 API](/docs/runtime/runtime-model/unsupported-apis) — 에이전트가 지어내면 안 되는 것들.\n"
		},
		{
			"slug": "reference",
			"url": "/docs/runtime/reference",
			"title": "API 레퍼런스",
			"description": "@rowcat/runtime이 내보내는 모든 이름의 지도. 무엇이 어느 페이지에 있는가.",
			"group": "reference",
			"order": 1,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "API 레퍼런스",
					"id": "api-레퍼런스"
				},
				{
					"level": 2,
					"text": "화면 부품",
					"id": "화면-부품"
				},
				{
					"level": 2,
					"text": "훅",
					"id": "훅"
				},
				{
					"level": 2,
					"text": "상태 정의",
					"id": "상태-정의"
				},
				{
					"level": 2,
					"text": "AI 생성",
					"id": "ai-생성"
				},
				{
					"level": 2,
					"text": "스타일과 색",
					"id": "스타일과-색"
				},
				{
					"level": 2,
					"text": "자산",
					"id": "자산"
				},
				{
					"level": 2,
					"text": "오류와 한도",
					"id": "오류와-한도"
				},
				{
					"level": 2,
					"text": "타입",
					"id": "타입"
				},
				{
					"level": 2,
					"text": "저수준",
					"id": "저수준"
				},
				{
					"level": 2,
					"text": "전역",
					"id": "전역"
				}
			],
			"body": "\n# API 레퍼런스\n\n런타임 코드가 가져올 수 있는 이름은 전부 `@rowcat/runtime` 하나에서 옵니다. 이 페이지는 그\n이름들을 종류별로 나눈 지도이고, 각 이름의 자세한 설명은 아래 페이지들이 갖습니다.\n\n```ts\nimport { Button, Stack, Text, defineStoryState, useStoryState } from \"@rowcat/runtime\";\n```\n\n## 화면 부품\n\n런타임이 그리는 열두 부품. [컴포넌트 레퍼런스](/docs/runtime/reference/components)\n\n`Screen` · `View` · `Stack` · `Row` · `ScrollView` · `Text` · `Image` · `Button` · `Pressable` ·\n`TextInput` · `TextArea` · `Progress`\n\n## 훅\n\n컴포넌트 안에서 부르는 아홉 함수. [훅 레퍼런스](/docs/runtime/reference/hooks)\n\n`useState` · `useReducer` · `useMemo` · `useCallback` · `useRef` · `useEffect` ·\n`useStoryState` · `usePersistentState` · `useGeneration`\n\n## 상태 정의\n\n모듈 최상단에서 저장 상태를 선언하는 둘. [상태 정의 레퍼런스](/docs/runtime/reference/state)\n\n`defineStoryState` · `definePersistentState`\n\n## AI 생성\n\n요청과 결과의 모양, 한도. [생성 레퍼런스](/docs/runtime/reference/generation)\n\n`RUNTIME_GENERATION_LIMITS` · `RuntimeGeneration` · `RuntimeGenerationRequest` ·\n`RuntimeGenerationMessage` · `RuntimeGenerationResult`\n\n## 스타일과 색\n\n색을 만드는 함수와 스타일의 형. [스타일 레퍼런스](/docs/runtime/reference/styling)\n\n`color` · `isRuntimeColor` · `RuntimeColor` · `RuntimeStyle` · `RuntimeTextStyle` ·\n`RuntimeLength` · `RuntimeAlign` · `RuntimeJustify`\n\n## 자산\n\n그림을 가리키는 참조 — RowCat에 올린 이미지의 이름이나 외부 HTTPS 주소.\n[자산 레퍼런스](/docs/runtime/reference/assets)\n\n`asset` · `AssetRef`\n\n## 오류와 한도\n\n런타임이 던지는 오류와 그 코드. [오류와 한도](/docs/runtime/reference/errors-and-limits)\n\n`RuntimeError` · `RUNTIME_ERROR_CODE` · `RuntimeErrorCode`\n\n## 타입\n\n프롭·훅·노드·상태 정의의 형들. 값이 아니라 `import type`으로 가져옵니다.\n[타입 레퍼런스](/docs/runtime/reference/types)\n\n## 저수준\n\n평범한 작품에서 부를 일이 없는 판정 함수와 상수. [저수준 API](/docs/runtime/reference/advanced)\n\n## 전역\n\n`console.log`·`console.warn`·`console.error` 셋이 전역에 있습니다. `console.info`·`console.table`은\n없습니다. 그 밖의 전역(`window`·`document`·`fetch`·`setTimeout`…)은\n[없습니다](/docs/runtime/runtime-model/unsupported-apis).\n"
		},
		{
			"slug": "reference/components",
			"url": "/docs/runtime/reference/components",
			"title": "컴포넌트",
			"description": "런타임이 그리는 열두 부품의 프롭과 쓰임.",
			"group": "reference",
			"order": 2,
			"symbols": [
				"Audio",
				"Button",
				"Image",
				"Pressable",
				"Progress",
				"Row",
				"Screen",
				"ScrollView",
				"Stack",
				"Text",
				"TextArea",
				"TextInput",
				"View"
			],
			"headings": [
				{
					"level": 1,
					"text": "컴포넌트",
					"id": "컴포넌트"
				},
				{
					"level": 2,
					"text": "Screen",
					"id": "screen"
				},
				{
					"level": 2,
					"text": "View",
					"id": "view"
				},
				{
					"level": 2,
					"text": "Stack",
					"id": "stack"
				},
				{
					"level": 2,
					"text": "Row",
					"id": "row"
				},
				{
					"level": 2,
					"text": "ScrollView",
					"id": "scrollview"
				},
				{
					"level": 2,
					"text": "Text",
					"id": "text"
				},
				{
					"level": 2,
					"text": "Image",
					"id": "image"
				},
				{
					"level": 2,
					"text": "Button",
					"id": "button"
				},
				{
					"level": 2,
					"text": "Pressable",
					"id": "pressable"
				},
				{
					"level": 2,
					"text": "TextInput",
					"id": "textinput"
				},
				{
					"level": 2,
					"text": "TextArea",
					"id": "textarea"
				},
				{
					"level": 2,
					"text": "Progress",
					"id": "progress"
				},
				{
					"level": 2,
					"text": "Audio",
					"id": "audio"
				},
				{
					"level": 3,
					"text": "playing은 사실이 아니라 바람입니다",
					"id": "playing은-사실이-아니라-바람입니다"
				},
				{
					"level": 3,
					"text": "같은 소리를 다시 울리려면 restartKey",
					"id": "같은-소리를-다시-울리려면-restartkey"
				},
				{
					"level": 3,
					"text": "원격 주소는 소리가 되지 않습니다",
					"id": "원격-주소는-소리가-되지-않습니다"
				},
				{
					"level": 3,
					"text": "수명은 노드의 것입니다",
					"id": "수명은-노드의-것입니다"
				}
			],
			"body": "\n# 컴포넌트\n\n열두 부품 전부 `@rowcat/runtime`에서 가져오고 TSX 태그로 씁니다. 함수처럼 직접 부르면\n`runtime_host_component_called`로 던집니다.\n\n모든 부품이 `children`을 받는 것은 아닙니다. 표에 `children`이 없으면 자식을 둘 수 없습니다.\n프롭 형의 이름(`StackProps` 등)은 [타입 레퍼런스](/docs/runtime/reference/types)에 있습니다.\n\n## `Screen`\n\n한 화면 전체. 런타임 앱의 가장 바깥에 둡니다.\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `background` | `RuntimeColor` | 화면 전체의 바탕. 안전 영역 바깥까지 덮습니다 |\n| `children` | 노드 | |\n\n```tsx\n<Screen background={color(\"#0b0d12\")}>…</Screen>\n```\n\n## `View`\n\n아무 배치도 강제하지 않는 상자.\n\n| 프롭 | 형 |\n| --- | --- |\n| `style` | `RuntimeStyle` |\n| `children` | 노드 |\n\n## `Stack`\n\n자식을 **세로로** 쌓습니다.\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `gap` | `number` | 자식 사이의 간격. `style.gap`보다 우선합니다 |\n| `style` | `RuntimeStyle` | |\n| `children` | 노드 | |\n\n```tsx\n<Stack gap={8} style={{ padding: 16 }}>\n\t<Text>첫 줄</Text>\n\t<Text>둘째 줄</Text>\n</Stack>\n```\n\n## `Row`\n\n자식을 **가로로** 늘어놓습니다. 프롭은 `Stack`과 같습니다.\n\n```tsx\n<Row gap={8} style={{ align: \"center\" }}>\n\t<Text>신뢰</Text>\n\t<Progress value={0.4} style={{ width: 120 }} />\n</Row>\n```\n\n## `ScrollView`\n\n내용이 넘치면 스크롤합니다.\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `horizontal` | `boolean` | 참이면 가로 스크롤 |\n| `controller` | `RuntimeScrollController` | `useScrollController()`가 만든 손잡이 |\n| `style` | `RuntimeStyle` | |\n| `children` | 노드 | |\n\n스크롤 영역이 화면의 남는 공간을 차지하게 하려면 부모가 `Stack`이고 이 부품에 `style={{ grow: 1 }}`을\n줍니다.\n\n## `Text`\n\n글자 한 덩어리. 자식으로 문자열·숫자·다른 `Text`를 받습니다.\n\n| 프롭 | 형 |\n| --- | --- |\n| `style` | `RuntimeTextStyle` |\n| `children` | 노드 |\n\n```tsx\n<Text style={{ fontSize: 18, fontWeight: \"bold\", lines: 2 }}>{title}</Text>\n```\n\n글자는 반드시 `Text` 안에 있어야 합니다. `Stack` 바로 아래에 맨 문자열을 두어도 그려지지만,\n스타일을 줄 수 없고 앱에서는 기본 글꼴로 나옵니다.\n\n## `Image`\n\n그림 하나. `asset(\"characters/sena/smile\")`처럼 RowCat에 올린 이미지의 이름이거나\n`asset(\"https://…\")`처럼 외부 HTTPS 주소입니다 — [자산](/docs/runtime/concepts/assets)을\n먼저 읽으세요. 맨 문자열은 받지 않습니다(`source=\"https://…\"`는 컴파일 오류입니다).\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `source` | `AssetRef` | `asset()`이 만든 참조(필수) |\n| `alt` | `string` | 스크린리더가 읽는 이름 |\n| `style` | `RuntimeStyle` | |\n| `fit` | `\"cover\"` · `\"contain\"` · `\"fill\"` | 상자에 맞추는 방식 |\n\n## `Button`\n\n라벨이 있는 조작.\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `onPress` | `() => void \\| Promise<void>` | 눌렀을 때 |\n| `disabled` | `boolean` | 참이면 눌리지 않습니다 |\n| `tone` | `\"primary\"` · `\"secondary\"` · `\"ghost\"` | 시각 위계 |\n| `children` | 노드 | 라벨 |\n\n```tsx\n<Button tone=\"secondary\" onPress={retry} disabled={pending}>\n\t다시 시도\n</Button>\n```\n\n## `Pressable`\n\n임의의 내용을 누를 수 있게 감쌉니다.\n\n| 프롭 | 형 |\n| --- | --- |\n| `onPress` | `() => void \\| Promise<void>` |\n| `disabled` | `boolean` |\n| `style` | `RuntimeStyle` |\n| `children` | 노드 |\n\n```tsx\n<Pressable onPress={() => choose(option.id)} style={{ padding: 12, borderRadius: 8 }}>\n\t<Text>{option.label}</Text>\n</Pressable>\n```\n\n## `TextInput`\n\n한 줄 글 입력. **통제된 입력**이라 `value`가 필수입니다.\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `value` | `string` | 지금 적혀 있는 글(필수) |\n| `onChangeText` | `(value: string) => void \\| Promise<void>` | 바뀐 뒤의 전체 글 |\n| `onSubmit` | `() => void \\| Promise<void>` | Enter · 완료. 조합 중에는 불리지 않습니다 |\n| `placeholder` | `string` | |\n| `disabled` | `boolean` | |\n| `controller` | `RuntimeTextEntryController` | `useTextEntryController()`가 만든 손잡이 |\n| `style` | `RuntimeStyle` | 상자 |\n| `textStyle` | `RuntimeTextStyle` | 글자 |\n\n## `TextArea`\n\n여러 줄 글 입력. `TextInput`과 같되 **`onSubmit`이 없습니다** — Enter는 줄바꿈입니다. 서식도\n리치 텍스트도 없고 나르는 것은 평범한 문자열입니다. `controller`는 여기에도 있습니다.\n\n## `Progress`\n\n진행 정도.\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `value` | `number` | 0~1. 없으면 끝을 모르는 진행(무한 표시) |\n| `style` | `{ width?: RuntimeLength }` | 폭만 받습니다 |\n\n```tsx\n<Progress value={trust / 100} style={{ width: \"100%\" }} />\n```\n\n## `Audio`\n\n소리 하나. **화면에 그려지지 않고 자리도 차지하지 않습니다** — 트리에 있는 동안 살아 있고,\n빠지면 멈춥니다.\n\n| 프롭 | 형 | 뜻 |\n| --- | --- | --- |\n| `source` | `AssetRef` | 울릴 소리. **RowCat이 관리하는 논리 이름만** 받습니다(아래 참고) |\n| `playing` | `boolean` | 소리가 나기를 **바라는가**. 없으면 `false` |\n| `loop` | `boolean` | 끝나면 처음부터 다시. 없으면 `false` |\n| `volume` | `number` | 0~1. 없으면 `1`. 범위 밖의 값은 **거절됩니다**(고쳐 주지 않습니다) |\n| `muted` | `boolean` | 크기를 기억한 채로 끕니다 |\n| `restartKey` | `string \\| number` | 값이 바뀌면 처음으로 되감습니다 |\n| `onEnded` | `() => void` | 끝까지 다 울렸습니다 — **`loop`가 아닐 때만** |\n\n```tsx example=audio file=src/main.tsx\nimport { Audio, Button, Stack, asset, useState } from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst [playing, setPlaying] = useState(false);\n\n\treturn (\n\t\t<Stack>\n\t\t\t<Audio\n\t\t\t\tsource={asset(\"audio/bgm/main\")}\n\t\t\t\tplaying={playing}\n\t\t\t\tloop\n\t\t\t\tvolume={0.5}\n\t\t\t/>\n\n\t\t\t<Button onPress={() => setPlaying((value) => !value)}>\n\t\t\t\t{playing ? \"음악 끄기\" : \"음악 켜기\"}\n\t\t\t</Button>\n\t\t</Stack>\n\t);\n}\n```\n\n스튜디오에서 소리 파일을 올리고 논리 이름을 붙인 다음, 그 **같은 이름**을 `asset()`에 적습니다.\n\n### `playing`은 사실이 아니라 바람입니다\n\n브라우저와 기기는 사용자가 화면과 상호작용하기 전의 소리를 막습니다. 그건 오류가 아니라\n**정상적인 플랫폼 정책**이고, 그래서 `playing={true}`가 곧 소리를 보장하지 않습니다 — 허락이\n필요한 상황에서는 RowCat이 \"소리를 재생하려면 탭하세요\"를 대신 보여 주고, 눌리는 순간 바라던\n소리가 이어집니다. 페이지를 여는 것만으로 소리가 나는 것은 어느 플랫폼에서도 약속할 수 없습니다.\n\n### 같은 소리를 다시 울리려면 `restartKey`\n\n효과음을 두 번 누르면 두 번째 누름에서 `playing`은 이미 `true`라 아무 변화가 없습니다. 되감는\n일에는 이름이 따로 있습니다.\n\n```tsx\nconst [shot, setShot] = useState(0);\n\n<Audio source={asset(\"audio/sfx/click\")} playing restartKey={shot} />\n<Button onPress={() => setShot((value) => value + 1)}>딸깍</Button>\n```\n\n### 원격 주소는 소리가 되지 않습니다\n\n`Image`와 달리 이 버전의 `Audio`는 **RowCat이 관리하는 소리만** 울립니다.\n\n```tsx\n<Audio source={asset(\"https://example.com/song.mp3\")} playing />\n```\n\n이 줄은 아무 요청도 만들지 않고 아무 소리도 내지 않습니다(오류도 아닙니다 — 조용합니다).\n원격 그림이 열려 있는 것과 갈리는 이유는 성격입니다: 그림은 한 번 가져오면 끝이지만 소리는\n재생하는 내내 이어지는 대화라, 그 표면은 아직 열지 않았습니다.\n\n### 수명은 노드의 것입니다\n\n```text\n<Audio>가 트리에서 빠진다   → 멈춥니다\n플레이가 끝난다              → 멈춥니다\nplaying={false}             → 그 자리에서 멈춥니다(되감지 않습니다)\nrestartKey가 바뀐다          → 처음으로 되감습니다\n```\n\n`onEnded`는 **자연 종료**에만 불립니다. 반복 중에는 매 바퀴마다 불리지 않고, 이 콜백이\n`playing`을 대신 꺼 주지도 않습니다 — 다시 울리고 싶으면 `restartKey`를 바꿉니다.\n"
		},
		{
			"slug": "reference/hooks",
			"url": "/docs/runtime/reference/hooks",
			"title": "훅",
			"description": "컴포넌트 안에서 부르는 열한 훅의 시그니처와 규칙.",
			"group": "reference",
			"order": 3,
			"symbols": [
				"useCallback",
				"useEffect",
				"useGeneration",
				"useMemo",
				"usePersistentState",
				"useReducer",
				"useRef",
				"useScrollController",
				"useState",
				"useStoryState",
				"useTextEntryController"
			],
			"headings": [
				{
					"level": 1,
					"text": "훅",
					"id": "훅"
				},
				{
					"level": 2,
					"text": "useState",
					"id": "usestate"
				},
				{
					"level": 2,
					"text": "useReducer",
					"id": "usereducer"
				},
				{
					"level": 2,
					"text": "useMemo",
					"id": "usememo"
				},
				{
					"level": 2,
					"text": "useCallback",
					"id": "usecallback"
				},
				{
					"level": 2,
					"text": "useRef",
					"id": "useref"
				},
				{
					"level": 2,
					"text": "useEffect",
					"id": "useeffect"
				},
				{
					"level": 2,
					"text": "useStoryState",
					"id": "usestorystate"
				},
				{
					"level": 2,
					"text": "usePersistentState",
					"id": "usepersistentstate"
				},
				{
					"level": 2,
					"text": "useGeneration",
					"id": "usegeneration"
				},
				{
					"level": 2,
					"text": "useScrollController",
					"id": "usescrollcontroller"
				},
				{
					"level": 2,
					"text": "useTextEntryController",
					"id": "usetextentrycontroller"
				},
				{
					"level": 2,
					"text": "설정 함수의 모양",
					"id": "설정-함수의-모양"
				}
			],
			"body": "\n# 훅\n\n훅은 컴포넌트의 최상단에서 매번 같은 순서로 부릅니다([규칙](/docs/runtime/concepts/components#훅의-규칙)).\n렌더 밖에서 부르면 `runtime_hook_outside_render`입니다.\n\n## `useState`\n\n```ts\nfunction useState<S>(initial: S | (() => S)): [S, RuntimeSetState<S>];\n```\n\n컴포넌트가 기억하는 값. 이 실행 동안만 살고 다시 시작하면 처음부터입니다. 초기값으로 함수를\n주면 첫 렌더에서만 돕니다.\n\n```tsx\nconst [open, setOpen] = useState(false);\nsetOpen((current) => !current);\n```\n\n## `useReducer`\n\n```ts\nfunction useReducer<S, A>(\n\treducer: (state: S, action: A) => S,\n\tinitial: S,\n): [S, (action: A) => void];\n```\n\n전이 함수가 상태를 소유합니다. 값이 여러 갈래로 바뀌는 화면에 씁니다. 초기값 함수·세 번째\n인자는 없습니다.\n\n## `useMemo`\n\n```ts\nfunction useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;\n```\n\n`deps`가 그대로면 같은 값. 계산을 건너뛴다는 **보장이 아니라 힌트**입니다.\n\n## `useCallback`\n\n```ts\nfunction useCallback<T extends (...args: never[]) => unknown>(\n\tcallback: T,\n\tdeps?: readonly unknown[],\n): T;\n```\n\n`deps`가 그대로면 같은 함수.\n\n## `useRef`\n\n```ts\nfunction useRef<T>(initial: T): RuntimeRef<T>;\n```\n\n렌더 사이에 살아남는 칸 하나(`{ current: T }`). 값을 바꿔도 다시 그리지 않습니다 — 화면에\n보이는 값을 여기 두면 화면이 낡습니다. **부품을 가리키는 ref는 없습니다.** 이 값은 순수한\n저장 칸입니다.\n\n## `useEffect`\n\n```ts\nfunction useEffect(effect: () => void | RuntimeCleanup, deps?: readonly unknown[]): void;\n```\n\n렌더가 끝나고 화면이 그려진 뒤에 돕니다. 반환값은 정리 함수입니다.\n\n- `deps`를 **생략하면 매 렌더마다** 돕니다. 빈 배열은 한 번만입니다. 둘은 다른 뜻입니다.\n- 프로미스를 돌려주면(`async` 효과) 경고이고 정리 함수로 읽지 않습니다.\n- 효과가 던지면 그 효과만 잃고(`runtime_effect_failed`) 런타임은 계속 돕니다.\n- 효과 안에서 `generate()`를 부를 수 없습니다 — 생성은 [플레이어의 조작에서만](/docs/runtime/concepts/generation#플레이어의-조작에서만-시작합니다)\n  시작합니다.\n- 효과 안의 상태 갱신이 매 커밋마다 다음 렌더를 만드는 사슬은 런타임이 세지 않습니다. 그\n  사슬은 세션의 실행 예산이 끊습니다 — 조건 없는 `setState`를 효과에 두지 마세요.\n\n타이머(`setTimeout`·`setInterval`)는 없습니다. 효과로 시간을 재는 방법이 없습니다.\n\n## `useStoryState`\n\n```ts\nfunction useStoryState<T>(definition: StoryStateDefinition<T>): [T, RuntimeSetState<T>];\n```\n\n`defineStoryState`로 만든 정의를 읽고 씁니다. 같은 정의를 읽는 모든 컴포넌트가 같은 값을\n봅니다. 마운트된 동안 같은 자리에 다른 정의를 넘기면 `runtime_story_state_hook_changed`입니다.\n[상태](/docs/runtime/concepts/state#플레이스루의-상태-definestorystate-usestorystate)\n\n## `usePersistentState`\n\n```ts\nfunction usePersistentState<T>(definition: PersistentStateDefinition<T>): [T, RuntimeSetState<T>];\n```\n\n`definePersistentState`로 만든 정의를 읽고 씁니다. `defineStoryState`의 정의는 타입에서\n막힙니다. [상태](/docs/runtime/concepts/state#회차를-넘는-상태-definepersistentstate-usepersistentstate)\n\n## `useGeneration`\n\n```ts\nfunction useGeneration(): RuntimeGeneration;\n```\n\nAI 생성 능력을 돌려줍니다. 돌려주는 객체는 마운트된 동안 같은 객체입니다. `generate()`는\n이벤트 핸들러에서만 부릅니다. [AI 생성](/docs/runtime/concepts/generation)\n\n## `useScrollController`\n\n```ts\nfunction useScrollController(): RuntimeScrollController;\n```\n\n`ScrollView` 하나를 옮길 손잡이를 돌려줍니다. `controller` 프롭으로 붙이고, 이벤트 핸들러나\n효과에서 부릅니다.\n\n```tsx\nconst scroll = useScrollController();\n\n<ScrollView controller={scroll}>{rows}</ScrollView>\n<Button onPress={() => scroll.scrollToEnd()}>최신</Button>\n```\n\n돌려주는 객체는 마운트된 동안 같은 객체입니다. [스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)\n\n## `useTextEntryController`\n\n```ts\nfunction useTextEntryController(): RuntimeTextEntryController;\n```\n\n`TextInput`·`TextArea` 하나의 초점을 옮길 손잡이를 돌려줍니다.\n\n```tsx\nconst reply = useTextEntryController();\n\n<TextInput controller={reply} value={draft} onChangeText={setDraft} />\n<Button onPress={() => reply.focus()}>답장</Button>\n```\n\n[스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)\n\n## 설정 함수의 모양\n\n세 상태 훅의 설정 함수는 `RuntimeSetState<S>`입니다.\n\n```ts\ntype RuntimeSetState<S> = (action: S | ((previous: S) => S)) => void;\n```\n\n새 값이나, 이전 값을 받아 새 값을 돌려주는 함수를 줍니다. 같은 값(`Object.is`)이면 다시 그리지\n않습니다.\n"
		},
		{
			"slug": "reference/state",
			"url": "/docs/runtime/reference/state",
			"title": "상태 정의",
			"description": "defineStoryState와 definePersistentState의 입력, 판, 마이그레이션, 한도.",
			"group": "reference",
			"order": 4,
			"symbols": [
				"definePersistentState",
				"defineStoryState"
			],
			"headings": [
				{
					"level": 1,
					"text": "상태 정의",
					"id": "상태-정의"
				},
				{
					"level": 2,
					"text": "defineStoryState",
					"id": "definestorystate"
				},
				{
					"level": 2,
					"text": "definePersistentState",
					"id": "definepersistentstate"
				},
				{
					"level": 2,
					"text": "입력",
					"id": "입력"
				},
				{
					"level": 2,
					"text": "두 정의는 다른 타입입니다",
					"id": "두-정의는-다른-타입입니다"
				},
				{
					"level": 2,
					"text": "마이그레이션",
					"id": "마이그레이션"
				},
				{
					"level": 2,
					"text": "저장되지 않는 것",
					"id": "저장되지-않는-것"
				},
				{
					"level": 2,
					"text": "한도",
					"id": "한도"
				}
			],
			"body": "\n# 상태 정의\n\n둘 다 **모듈 최상단에서** 부릅니다. 컴포넌트 안이나 렌더 중에 부르면\n`runtime_story_state_definition_late`(또는 `runtime_persistent_state_definition_late`)입니다 —\n첫 화면이 그려지기 전에 모든 정의가 알려져야 저장을 열 수 있기 때문입니다.\n\n## `defineStoryState`\n\n```ts\nfunction defineStoryState<T>(input: {\n\tkey: string;\n\tversion: number;\n\tinitial: T;\n\tmigrate?: (stored: Serializable, fromVersion: number) => T;\n}): StoryStateDefinition<T>;\n```\n\n이 플레이스루 동안 저장되는 값. 플레이 초기화가 지웁니다.\n\n## `definePersistentState`\n\n```ts\nfunction definePersistentState<T>(input: {\n\tkey: string;\n\tversion: number;\n\tinitial: T;\n\tmigrate?: (stored: Serializable, fromVersion: number) => T;\n}): PersistentStateDefinition<T>;\n```\n\n플레이어와 작품 사이에 남는 값. 플레이 초기화를 넘어 살아남습니다.\n\n## 입력\n\n| 필드 | 규칙 |\n| --- | --- |\n| `key` | 영문으로 시작, 영문·숫자·`_`·`-`, 64자 이내. 같은 수명 안에서 유일 |\n| `version` | 1 이상의 정수. 값의 모양이 바뀔 때 올립니다 |\n| `initial` | 직렬화 가능한 값(`null`·불리언·숫자·문자열·배열·평범한 객체). 함수·`Date`·`Map`·`Set`·`NaN`·`undefined`·순환은 타입에서 막힙니다 |\n| `migrate` | 옛 판의 저장 값을 지금 모양으로 옮기는 함수. 결정적이어야 합니다 |\n\n`initial`의 타입이 곧 상태의 타입입니다. 배열은 `[] as string[]`처럼 원소 타입을 적어 주세요 —\n비어 있는 배열은 `never[]`로 추론되어 아무것도 넣을 수 없게 됩니다.\n\n## 두 정의는 다른 타입입니다\n\n```ts\nconst run = defineStoryState({ key: \"run\", version: 1, initial: { scene: 0 } });\nconst meta = definePersistentState({ key: \"meta\", version: 1, initial: { runs: 0 } });\n\nuseStoryState(run); // 됩니다\nusePersistentState(meta); // 됩니다\nuseStoryState(meta); // 타입 오류 — 수명이 다릅니다\n```\n\n키 공간도 갈려 있습니다. 두 수명에 같은 `key`를 두어도 충돌이 아닙니다.\n\n## 마이그레이션\n\n| 저장된 판 | 코드의 판 | 일어나는 일 |\n| --- | --- | --- |\n| 없음 | n | `initial`로 시작 |\n| n | n | 저장된 값 그대로 |\n| m < n | n | `migrate(stored, m)`의 결과. `migrate`가 없으면 실패 |\n| m > n | n | 실패 — 자동으로 낮추지 않습니다 |\n\n`migrate`가 던지거나 직렬화할 수 없는 값을 돌려주면 런타임이 서지 않습니다. 저장을 조용히\n버리고 `initial`로 떨어뜨리지 않습니다. 옮긴 결과는 저장에 다시 적히므로 같은 마이그레이션이\n매번 돌지 않습니다.\n\n예제는 [상태 › 마이그레이션](/docs/runtime/concepts/state#마이그레이션)에 있습니다.\n\n## 저장되지 않는 것\n\n정의하지 않은 열쇠의 저장 값(예전 코드가 남긴 것)은 **지워지지 않습니다.** 정의를 잠깐 뗐다\n붙여도 플레이어의 진행이 사라지지 않게 하려는 것입니다. 지우는 것은 플레이 초기화뿐입니다.\n\n## 한도\n\n| 항목 | 값 |\n| --- | --- |\n| 정의의 수(수명마다) | 128 |\n| 정의 하나의 직렬화 길이 | 65,536자 |\n| 저장 전체(발행된 작품, 수명마다) | 262,144바이트 |\n\n한도를 넘는 갱신은 `runtime_story_state_limit_exceeded`(또는 영구 상태의 짝)로 그 렌더가\n실패하고, 화면은 이전 상태로 남습니다.\n"
		},
		{
			"slug": "reference/generation",
			"url": "/docs/runtime/reference/generation",
			"title": "생성",
			"description": "useGeneration()이 돌려주는 객체와 요청·결과의 형, 한도 상수.",
			"group": "reference",
			"order": 5,
			"symbols": [
				"RUNTIME_GENERATION_LIMITS",
				"RuntimeGeneration",
				"RuntimeGenerationMessage",
				"RuntimeGenerationRequest",
				"RuntimeGenerationResult"
			],
			"headings": [
				{
					"level": 1,
					"text": "생성",
					"id": "생성"
				},
				{
					"level": 2,
					"text": "RuntimeGeneration",
					"id": "runtimegeneration"
				},
				{
					"level": 2,
					"text": "RuntimeGenerationRequest",
					"id": "runtimegenerationrequest"
				},
				{
					"level": 2,
					"text": "RuntimeGenerationMessage",
					"id": "runtimegenerationmessage"
				},
				{
					"level": 2,
					"text": "RuntimeGenerationResult",
					"id": "runtimegenerationresult"
				},
				{
					"level": 2,
					"text": "RUNTIME_GENERATION_LIMITS",
					"id": "runtime-generation-limits"
				},
				{
					"level": 2,
					"text": "실행 중의 한도",
					"id": "실행-중의-한도"
				}
			],
			"body": "\n# 생성\n\n개념과 예제는 [AI 생성](/docs/runtime/concepts/generation)에 있습니다. 이 페이지는 형과 값만\n적습니다.\n\n## `RuntimeGeneration`\n\n```ts\ninterface RuntimeGeneration {\n\tgenerate(request: RuntimeGenerationRequest): Promise<RuntimeGenerationResult>;\n}\n```\n\n`useGeneration()`이 돌려주는 객체. 조작은 `generate` 하나이고, 이벤트 핸들러에서만 부릅니다.\n실패는 `RuntimeError`로 던지며 `code`가 사유를 말합니다([오류](/docs/runtime/reference/errors-and-limits#생성)).\n\n## `RuntimeGenerationRequest`\n\n```ts\ninterface RuntimeGenerationRequest {\n\tmessages: readonly RuntimeGenerationMessage[];\n\tinstructions?: string;\n\tmaxOutputCharacters?: number;\n}\n```\n\n- `messages` — 비어 있으면 안 됩니다. 최근 것부터 뒤에 둡니다(시간순).\n- `instructions` — 이 인물·장면의 역할. RowCat의 안전 지시 사이에 들어갑니다.\n- `maxOutputCharacters` — 답 길이의 상한 **힌트**(글자 수). 기본 4,000, 최대 16,000. 소수는\n  내림, 1 미만은 1.\n\n## `RuntimeGenerationMessage`\n\n```ts\ninterface RuntimeGenerationMessage {\n\trole: \"user\" | \"assistant\";\n\tcontent: string;\n}\n```\n\n`\"system\"` 역할은 없습니다. 그 자리는 `instructions`입니다.\n\n## `RuntimeGenerationResult`\n\n```ts\ninterface RuntimeGenerationResult {\n\ttext: string;\n}\n```\n\n글 하나. 토큰 수·비용·모델·종료 사유는 없습니다.\n\n## `RUNTIME_GENERATION_LIMITS`\n\n```ts\nconst RUNTIME_GENERATION_LIMITS: {\n\tmaxMessages: 100;\n\tmaxMessageCharacters: 32_768;\n\tmaxInstructionsCharacters: 32_768;\n\tmaxTotalCharacters: 262_144;\n\tmaxOutputCharacters: 16_000;\n\tdefaultOutputCharacters: 4_000;\n};\n```\n\n요청이 이 값을 넘으면 `runtime_generation_invalid_request`로 그 자리에서 던집니다 — 요청은\n나가지 않습니다. 길이는 UTF-16 코드 단위(JavaScript의 `string.length`)로 셉니다.\n\n## 실행 중의 한도\n\n`RUNTIME_GENERATION_LIMITS`가 담는 것은 **요청 하나**의 한도입니다. 런타임이 실행 중에\n지키는 한도 둘은 그 객체에 **없고**, 코드가 읽을 값으로 내보내지 않습니다 — 규칙이지 설정이\n아닙니다.\n\n| 한도 | 값 | 넘으면 |\n| --- | --- | --- |\n| 동시에 도는 요청 | 1개 | `runtime_generation_busy` |\n| 한 번의 실행에서 시작할 수 있는 생성 | 200번 | `runtime_generation_not_authorized` |\n\n앞의 것은 앞 요청이 끝나면 풀리고, 뒤의 것은 그 실행 안에서는 풀리지 않습니다 — 플레이어가\n다시 시작하면 새 실행이고 횟수도 처음부터입니다. 요청이 나간 뒤 실패한 것도 한 번으로 세고,\n모양이 잘못돼 나가지 않은 요청(`runtime_generation_invalid_request`)은 세지 않습니다.\n설명은 [AI 생성 › 실행 중의 한도](/docs/runtime/concepts/generation#실행-중의-한도)에 있습니다.\n"
		},
		{
			"slug": "reference/styling",
			"url": "/docs/runtime/reference/styling",
			"title": "스타일",
			"description": "color()와 스타일 형의 전체 목록.",
			"group": "reference",
			"order": 6,
			"symbols": [
				"RUNTIME_EASINGS",
				"RUNTIME_TRANSITION_DEFAULT_DURATION_MS",
				"RUNTIME_TRANSITION_DEFAULT_EASING",
				"RUNTIME_TRANSITION_MAX_DURATION_MS",
				"RuntimeAlign",
				"RuntimeColor",
				"RuntimeEasing",
				"RuntimeJustify",
				"RuntimeLength",
				"RuntimeStyle",
				"RuntimeTextStyle",
				"RuntimeTransition",
				"color",
				"isRuntimeColor"
			],
			"headings": [
				{
					"level": 1,
					"text": "스타일",
					"id": "스타일"
				},
				{
					"level": 2,
					"text": "color",
					"id": "color"
				},
				{
					"level": 2,
					"text": "isRuntimeColor",
					"id": "isruntimecolor"
				},
				{
					"level": 2,
					"text": "RuntimeColor",
					"id": "runtimecolor"
				},
				{
					"level": 2,
					"text": "RuntimeStyle",
					"id": "runtimestyle"
				},
				{
					"level": 2,
					"text": "RuntimeTextStyle",
					"id": "runtimetextstyle"
				},
				{
					"level": 2,
					"text": "RuntimeTransition",
					"id": "runtimetransition"
				},
				{
					"level": 2,
					"text": "RuntimeEasing",
					"id": "runtimeeasing"
				},
				{
					"level": 2,
					"text": "전이 상수",
					"id": "전이-상수"
				},
				{
					"level": 2,
					"text": "RuntimeLength",
					"id": "runtimelength"
				},
				{
					"level": 2,
					"text": "RuntimeJustify",
					"id": "runtimejustify"
				},
				{
					"level": 2,
					"text": "RuntimeAlign",
					"id": "runtimealign"
				}
			],
			"body": "\n# 스타일\n\n개념은 [스타일](/docs/runtime/concepts/styling)에 있습니다.\n\n## `color`\n\n```ts\nfunction color(value: \"#rgb\" | \"#rrggbb\" | \"#rrggbbaa\"): RuntimeColor;\n```\n\n글자 그대로 적은 16진수 색을 `RuntimeColor`로 만듭니다. 형식이 틀리면 **타입 검사에서** 막히고,\n실행 중에는 `runtime_invalid_color`로 던집니다. 변수에 담긴 문자열은 이 함수에 넣을 수 없습니다 —\n`isRuntimeColor`를 쓰세요.\n\n```ts\nconst ink = color(\"#f5f7fa\");\nconst glass = color(\"#ffffff22\");\n```\n\n## `isRuntimeColor`\n\n```ts\nfunction isRuntimeColor(value: string): value is RuntimeColor;\n```\n\n문자열이 색 형식인지 판정합니다. 계산해서 만든 값을 스타일에 넣기 전에 씁니다.\n\n## `RuntimeColor`\n\n`color()`가 만든 값의 형. 문자열이지만 아무 문자열이나 대입할 수 없습니다.\n\n## `RuntimeStyle`\n\n상자(`View`·`Stack`·`Row`·`ScrollView`·`Pressable`·`Image`·`TextInput`·`TextArea`)의 스타일.\n\n```ts\ninterface RuntimeStyle {\n\twidth?: RuntimeLength;\n\theight?: RuntimeLength;\n\tminWidth?: RuntimeLength;\n\tmaxWidth?: RuntimeLength;\n\tminHeight?: RuntimeLength;\n\tmaxHeight?: RuntimeLength;\n\tpadding?: number;\n\tgap?: number;\n\topacity?: number; // 0~1\n\tbackgroundColor?: RuntimeColor;\n\tborderRadius?: number;\n\tjustify?: RuntimeJustify;\n\talign?: RuntimeAlign;\n\tgrow?: number;\n\tshrink?: number; // 0 이상\n\ttranslateX?: number;\n\ttranslateY?: number;\n\tscale?: number; // 0 이상\n}\n```\n\n없는 속성은 타입에서 막힙니다. `margin`·`position`·`zIndex`·`border`·방향(`flexDirection`)은\n없습니다.\n\n`maxWidth`는 *내용만큼 넓되 어느 선을 넘지 않는* 상자를 만들 때 씁니다 — 대화 말풍선이\n그 모양입니다. `width`로 고정하면 짧은 한 마디도 그 너비를 다 차지합니다.\n\n```tsx\n<View style={{ maxWidth: \"86%\", padding: 12, borderRadius: 16 }}>\n\t<Text>네.</Text>\n</View>\n```\n\n`grow`가 남는 공간을 나눠 갖는 비율이라면 `shrink`는 **모자란 공간을 양보하는** 비율입니다.\n적지 않으면 부모가 정합니다 — 세로로 쌓는 상자(`View`·`Stack`·`ScrollView`)의 자식은\n줄어들지 않고, `Row`의 자식은 줄어듭니다(그래야 긴 문장이 줄바꿈됩니다). 그 기본값을 덮고\n싶을 때만 적습니다. 음수는 거절됩니다.\n\n`translateX`·`translateY`·`scale`은 **그리는 자리만** 옮깁니다 — 이웃이 밀려나지 않고 배치가\n다시 계산되지 않습니다. `scale`의 중심은 언제나 부품의 가운데입니다. 적지 않은 축의 값은\n이동이 `0`, 배율이 `1`입니다.\n\n## `RuntimeTextStyle`\n\n`Text`의 `style`과 입력 부품의 `textStyle`.\n\n```ts\ninterface RuntimeTextStyle {\n\tcolor?: RuntimeColor;\n\tfontSize?: number;\n\tfontWeight?: \"regular\" | \"medium\" | \"bold\";\n\talign?: \"start\" | \"center\" | \"end\";\n\tlines?: number;\n\topacity?: number;\n}\n```\n\n## `RuntimeTransition`\n\n값이 바뀔 때 **어떻게 갈 것인가**. `transition` 프롭에 넣습니다.\n\n```ts\ninterface RuntimeTransition {\n\tduration?: number; // 밀리초. 없으면 200, 최대 10000\n\teasing?: RuntimeEasing; // 없으면 \"ease\"\n}\n```\n\n개념과 예제는 [스타일](/docs/runtime/concepts/styling#전이)에 있습니다.\n\n`duration`이 `0`이면 전이가 없는 것과 같습니다. 음수·`NaN`·`Infinity`·10000 초과, 그리고\n표에 없는 키(`delay` 등)는 `runtime_invalid_host_prop`으로 거절됩니다 — 조용히 무시하지\n않습니다.\n\n## `RuntimeEasing`\n\n```ts\ntype RuntimeEasing = \"linear\" | \"ease\" | \"ease-in\" | \"ease-out\" | \"ease-in-out\";\n```\n\n다섯 개뿐입니다. `cubic-bezier(...)`·스프링·`steps(...)`는 없습니다.\n\n## 전이 상수\n\n| 이름 | 값 |\n| --- | --- |\n| `RUNTIME_EASINGS` | 위 다섯을 담은 배열 |\n| `RUNTIME_TRANSITION_DEFAULT_DURATION_MS` | `200` |\n| `RUNTIME_TRANSITION_DEFAULT_EASING` | `\"ease\"` |\n| `RUNTIME_TRANSITION_MAX_DURATION_MS` | `10000` |\n\n## `RuntimeLength`\n\n```ts\ntype RuntimeLength = number | `${number}%`;\n```\n\n숫자는 밀도 독립 단위, 문자열은 부모에 대한 비율(`\"50%\"`). `\"12px\"`·`\"1rem\"`은 없습니다.\n\n## `RuntimeJustify`\n\n```ts\ntype RuntimeJustify = \"start\" | \"center\" | \"end\" | \"between\" | \"around\";\n```\n\n주축 정렬 — `Stack`이면 세로, `Row`면 가로.\n\n## `RuntimeAlign`\n\n```ts\ntype RuntimeAlign = \"start\" | \"center\" | \"end\" | \"stretch\";\n```\n\n교차축 정렬.\n"
		},
		{
			"slug": "reference/assets",
			"url": "/docs/runtime/reference/assets",
			"title": "자산",
			"description": "asset()과 AssetRef의 형. RowCat 자산 이름(그림·소리)과 정적으로 선언된 HTTPS 이미지 주소의 규칙.",
			"group": "reference",
			"order": 7,
			"symbols": [
				"AssetRef",
				"asset"
			],
			"headings": [
				{
					"level": 1,
					"text": "자산",
					"id": "자산"
				},
				{
					"level": 2,
					"text": "asset",
					"id": "asset"
				},
				{
					"level": 3,
					"text": "HTTPS 이미지 주소",
					"id": "https-이미지-주소"
				},
				{
					"level": 3,
					"text": "RowCat 자산 이름",
					"id": "rowcat-자산-이름"
				},
				{
					"level": 2,
					"text": "AssetRef",
					"id": "assetref"
				},
				{
					"level": 2,
					"text": "그려지는 것",
					"id": "그려지는-것"
				}
			],
			"body": "\n# 자산\n\nRowCat에 올린 파일(그림·소리)은 **이름**으로, 외부 그림은 **HTTPS 주소**로 가리킵니다.\n근거와 예제는 [자산](/docs/runtime/concepts/assets)에 있습니다.\n\n## `asset`\n\n```ts\nfunction asset(value: string): AssetRef;\n```\n\n문자열 하나를 참조로 봉인합니다. 검사는 그 자리에서 끝나고 네트워크도 저장소도 보지\n않습니다 — 같은 문자열은 언제 불러도 같은 결과입니다.\n\n받는 값은 둘입니다.\n\n### HTTPS 이미지 주소\n\n| 규칙 | |\n| --- | --- |\n| 선언 | **소스에 그대로 적힌 주소만.** 실행 중에 만들어진 주소는 자리표시자입니다 |\n| 스킴 | `https://`만 (`http:`·`data:`·`blob:`·`file:`·`javascript:`·`//…` 거절) |\n| 호스트 | 공개 인터넷의 도메인 이름 (IP 리터럴·`localhost` 거절) |\n| 포트 | 443만 (`:443`은 됩니다) |\n| 자격증명 | 없어야 합니다 |\n| 질의 | 됩니다 |\n| 조각(`#`) | 거절 |\n| 길이 | 최대 8,192자 |\n| 글자 | 공백·제어 문자 없음 · 비ASCII는 퍼센트 인코딩 |\n\n### RowCat 자산 이름\n\n**그림과 소리가 한 이름 공간을 나눠 씁니다.** 이름이 무엇을 가리키는지는 스튜디오에서\n올릴 때 정해지고, 부르는 프리미티브가 그것을 바꾸지 않습니다.\n\n| 규칙 | |\n| --- | --- |\n| 선언 | **실행 중에 만들어도 됩니다.** 그 이름이 이 작품에 올려 둔 자산에 있으면 열립니다 |\n| 조각 | 영문이나 숫자로 시작, 영문·숫자·`.`·`_`·`-` |\n| 깊이 | 최대 8단계 |\n| 길이 | 최대 200자 |\n| 개수 | 한 작품에 최대 256개 (그림과 소리를 **합쳐서**) |\n| 거절 | 빈 값, 앞뒤 공백, `.`·`..` 조각, `:`·`\\`가 든 값, 한 작품 안의 같은 이름 |\n\n올릴 수 있는 파일:\n\n| | 형식 | 상한 |\n| --- | --- | --- |\n| 그림 | JPEG · PNG · WebP | 3MB |\n| 소리 | MP3 · M4A(AAC) | 10MB · 10분 |\n\n규칙 밖의 값은 `runtime_invalid_asset_ref`로 던집니다.\n\n## `AssetRef`\n\n`asset()`이 돌려주는 불투명한 값. 공개 속성이 없고 문자열로 되돌릴 수 없습니다. 할 수 있는 일은\n`Image`나 `Audio`의 `source`에 넣는 것뿐입니다.\n\n## 그려지는 것\n\n| 참조 | `Image` | `Audio` |\n| --- | --- | --- |\n| 발행본에 있는 **그림** 이름 | 그려집니다 | 침묵 |\n| 발행본에 있는 **소리** 이름 | 자리표시자 | 울립니다 |\n| 발행본에 없는 이름 | 자리표시자 | 침묵 |\n| 소스에 적힌 HTTPS 주소 | RowCat의 이미지 경로를 거쳐 그려집니다. JPEG · PNG · WebP · GIF | **침묵 — 요청이 나가지 않습니다** |\n| 실행 중에 만들어진 HTTPS 주소 | 자리표시자. 요청이 나가지 않습니다 | 침묵 |\n\n**어긋난 종류는 오류가 아닙니다.** 소리 이름을 `Image`에 넣거나 그림 이름을 `Audio`에\n넣으면 요청조차 나가지 않고, 런타임 코드에는 아무것도 오지 않습니다.\n\n불러오지 못한 그림은 자리표시자로, 울리지 못한 소리는 침묵으로 남습니다.\n\n원격 이미지는 RowCat이 대신 가져옵니다 — 플레이어의 IP 주소와 User-Agent는 원격 서버에\n전달되지 않지만, 그 서버는 RowCat의 요청과 그 시점을 볼 수 있습니다.\n[자산](/docs/runtime/concepts/assets#그림은-rowcat을-거쳐-옵니다)이 그 경계를 적습니다.\n"
		},
		{
			"slug": "reference/errors-and-limits",
			"url": "/docs/runtime/reference/errors-and-limits",
			"title": "오류와 한도",
			"description": "런타임이 던지는 RuntimeError, 제작자가 만날 수 있는 코드, 코드를 고쳐 풀 수 있는 한도.",
			"group": "reference",
			"order": 8,
			"symbols": [
				"RUNTIME_ERROR_CODE",
				"RuntimeError",
				"RuntimeErrorCode"
			],
			"headings": [
				{
					"level": 1,
					"text": "오류와 한도",
					"id": "오류와-한도"
				},
				{
					"level": 2,
					"text": "RuntimeError",
					"id": "runtimeerror"
				},
				{
					"level": 2,
					"text": "RUNTIME_ERROR_CODE · RuntimeErrorCode",
					"id": "runtime-error-code-runtimeerrorcode"
				},
				{
					"level": 3,
					"text": "훅과 렌더",
					"id": "훅과-렌더"
				},
				{
					"level": 3,
					"text": "상태",
					"id": "상태"
				},
				{
					"level": 3,
					"text": "생성",
					"id": "생성"
				},
				{
					"level": 3,
					"text": "값",
					"id": "값"
				},
				{
					"level": 3,
					"text": "화면의 크기",
					"id": "화면의-크기"
				},
				{
					"level": 2,
					"text": "한도 모음",
					"id": "한도-모음"
				}
			],
			"body": "\n# 오류와 한도\n\n## `RuntimeError`\n\n```ts\nclass RuntimeError extends Error {\n\treadonly code: RuntimeErrorCode;\n}\n```\n\n런타임이 던지는 모든 오류의 형. `code`로 분기하고 `message`는 사람이 읽는 문장입니다. 잡을 일이\n있는 자리는 사실상 `generate()` 하나입니다 — 나머지는 코드의 결함이라 잡지 않고 고칩니다.\n\n```ts\ntry {\n\tawait generation.generate(request);\n} catch (error) {\n\tif (error instanceof RuntimeError && error.code === \"runtime_generation_unavailable\") {\n\t\t// 이 세션에서는 AI를 쓸 수 없다는 안내\n\t}\n}\n```\n\n## `RUNTIME_ERROR_CODE` · `RuntimeErrorCode`\n\n`RUNTIME_ERROR_CODE`는 이름 → 코드 문자열의 상수 객체이고, `RuntimeErrorCode`는 그 값들의\n유니온입니다. 아래는 제작자가 실제로 만나는 코드입니다.\n\n### 훅과 렌더\n\n| 코드 | 뜻 |\n| --- | --- |\n| `runtime_hook_outside_render` | 훅을 컴포넌트 밖에서 불렀다 |\n| `runtime_hook_order_changed` | 같은 컴포넌트가 렌더마다 다른 훅을 부른다(조건문 안의 훅) |\n| `runtime_state_update_during_render` | 렌더 중에 `setState`를 불렀다 |\n| `runtime_async_component_unsupported` | 컴포넌트가 프로미스를 돌려줬다 |\n| `runtime_invalid_runtime_node` | 그릴 수 없는 값을 돌려줬다(함수·객체 등) |\n| `runtime_duplicate_key` | 같은 부모 아래 `key`가 겹친다 — 경고 |\n| `runtime_update_after_unmount` | 사라진 컴포넌트의 상태를 갱신했다 — 경고 |\n| `runtime_effect_returned_promise` | `async` 효과 — 경고 |\n| `runtime_effect_failed` | 효과가 던졌다. 그 효과만 잃는다 |\n| `runtime_invalid_host_prop` | 부품이 모르는 프롭이나 잘못된 값 |\n| `runtime_host_component_called` | 부품을 함수처럼 불렀다 |\n\n### 상태\n\n플레이스루 상태의 코드는 `runtime_story_state_*`, 영구 상태는 `runtime_persistent_state_*`로\n짝이 같습니다.\n\n| 코드(`story_state` 쪽) | 뜻 |\n| --- | --- |\n| `runtime_invalid_story_state` | `key`·`version`·`initial`이 규칙에 맞지 않는다 |\n| `runtime_story_state_definition_late` | 모듈 최상단이 아닌 곳에서 정의했다 |\n| `runtime_story_state_duplicate_key` | 같은 `key`를 두 번 정의했다 |\n| `runtime_story_state_hook_changed` | 같은 훅 자리에 다른 정의를 넘겼다 |\n| `runtime_story_state_value_invalid` | 직렬화할 수 없는 값을 저장하려 했다 |\n| `runtime_story_state_limit_exceeded` | 값이나 저장 전체가 한도를 넘었다 |\n| `runtime_story_state_migration_failed` | `migrate`가 던졌다 |\n| `runtime_story_state_migration_invalid` | `migrate`가 직렬화할 수 없는 값을 돌려줬다 |\n| `runtime_story_state_version_newer` | 저장된 판이 코드의 판보다 높다 |\n\n### 생성\n\n| 코드 | 뜻 |\n| --- | --- |\n| `runtime_generation_during_render` | 렌더 중에 `generate()`를 불렀다 |\n| `runtime_generation_invalid_request` | 요청의 모양·길이가 잘못됐다 |\n| `runtime_generation_unavailable` | 이 세션에 AI가 없다 |\n| `runtime_generation_not_authorized` | 플레이어의 조작 밖에서 불렀거나, 이 실행에서 허용된 생성 횟수를 모두 썼다 — 뒤의 경우는 다시 시도해도 같고 플레이어가 다시 시작해야 풀린다 |\n| `runtime_generation_insufficient_balance` | 예약된 코드 — 지금 어떤 호스트도 이 사유를 내지 않는다. `runtime_generation_failed`처럼 다뤄도 된다 |\n| `runtime_generation_busy` | 앞 요청이 아직 돌고 있다 |\n| `runtime_generation_cancelled` | 세션이 끝나며 취소됐다 |\n| `runtime_generation_failed` | 그 밖의 실패 |\n\n### 값\n\n| 코드 | 뜻 |\n| --- | --- |\n| `runtime_invalid_color` | `color()`에 색이 아닌 문자열 |\n| `runtime_invalid_asset_ref` | `asset()`에 규칙 밖의 값 — `http:`·`data:`·IP 주소·자격증명·다른 포트·너무 긴 주소, 또는 규칙 밖의 논리 경로 |\n\n### 화면의 크기\n\n| 코드 | 뜻 |\n| --- | --- |\n| `runtime_tree_depth_exceeded` | 부품이 너무 깊게 중첩됐다 |\n| `runtime_host_node_limit_exceeded` | 한 화면의 부품이 너무 많다 |\n\n이 둘은 **그 렌더만** 실패하고 이전 화면이 남습니다. 긴 목록은 최근 것만 그리거나 페이지를\n나누세요.\n\n## 한도 모음\n\n코드를 고쳐서 풀 수 있는 한도만 적습니다.\n\n| 축 | 한도 | 어디에 |\n| --- | --- | --- |\n| 프로젝트 | 파일 200개 · 파일당 200,000자 · 경로 200자 · 깊이 7단계 | [프로젝트 구조](/docs/runtime/project-structure#한도) |\n| 상태 | 수명마다 정의 128개 · 정의당 64 KiB · 저장 전체 256 KiB | [상태 정의](/docs/runtime/reference/state#한도) |\n| 생성 — 요청 하나 | 메시지 100개 · 요청 262,144자 · 답 16,000자 | [생성](/docs/runtime/reference/generation#runtime-generation-limits) |\n| 생성 — 실행 중 | 동시 1개 · 실행당 200번 (다시 시작해야 처음부터) | [생성](/docs/runtime/reference/generation#실행-중의-한도) |\n| 자산 — HTTPS 이미지 | 주소 8,192자 · JPEG·PNG·WebP·GIF | [자산](/docs/runtime/reference/assets) |\n| 자산 — 논리 경로 | 200자 · 8단계 | [자산](/docs/runtime/reference/assets) |\n"
		},
		{
			"slug": "reference/types",
			"url": "/docs/runtime/reference/types",
			"title": "타입",
			"description": "값이 아니라 형만 내보내는 이름들. 프롭·훅·노드·상태 정의의 형.",
			"group": "reference",
			"order": 9,
			"symbols": [
				"AudioProps",
				"ButtonProps",
				"ImageProps",
				"PersistentStateDefinition",
				"PersistentStateInput",
				"PersistentStateInputChecked",
				"PersistentStateMigration",
				"PressableProps",
				"ProgressProps",
				"RowProps",
				"RuntimeApp",
				"RuntimeChildren",
				"RuntimeCleanup",
				"RuntimeComponent",
				"RuntimeElement",
				"RuntimeNode",
				"RuntimePressable",
				"RuntimePrimitive",
				"RuntimeRef",
				"RuntimeScrollController",
				"RuntimeScrollTo",
				"RuntimeSetState",
				"RuntimeStateAction",
				"RuntimeTextEntry",
				"RuntimeTextEntryController",
				"RuntimeTransitionable",
				"ScreenProps",
				"ScrollViewProps",
				"Serializable",
				"SerializableShape",
				"StackProps",
				"StoryStateDefinition",
				"StoryStateInput",
				"StoryStateInputChecked",
				"StoryStateMigration",
				"TextAreaProps",
				"TextInputProps",
				"TextProps",
				"ViewProps"
			],
			"headings": [
				{
					"level": 1,
					"text": "타입",
					"id": "타입"
				},
				{
					"level": 2,
					"text": "부품의 프롭",
					"id": "부품의-프롭"
				},
				{
					"level": 2,
					"text": "RuntimeTransitionable",
					"id": "runtimetransitionable"
				},
				{
					"level": 2,
					"text": "조종기",
					"id": "조종기"
				},
				{
					"level": 2,
					"text": "훅",
					"id": "훅"
				},
				{
					"level": 2,
					"text": "노드와 컴포넌트",
					"id": "노드와-컴포넌트"
				},
				{
					"level": 2,
					"text": "상태 정의",
					"id": "상태-정의"
				},
				{
					"level": 2,
					"text": "직렬화",
					"id": "직렬화"
				}
			],
			"body": "\n# 타입\n\n여기 있는 이름은 전부 **형**입니다. `import type { … } from \"@rowcat/runtime\"`으로 가져오고\n실행 중에는 존재하지 않습니다. 자기 컴포넌트의 프롭을 적거나 상태의 형을 이름 붙일 때 씁니다.\n\n## 부품의 프롭\n\n| 이름 | 부품 |\n| --- | --- |\n| `ScreenProps` | `Screen` |\n| `ViewProps` | `View` |\n| `StackProps` | `Stack` |\n| `RowProps` | `Row` |\n| `ScrollViewProps` | `ScrollView` |\n| `TextProps` | `Text` |\n| `ImageProps` | `Image` |\n| `ButtonProps` | `Button` |\n| `PressableProps` | `Pressable` |\n| `TextInputProps` | `TextInput` |\n| `TextAreaProps` | `TextArea` |\n| `ProgressProps` | `Progress` |\n| `AudioProps` | `Audio` |\n\n## `RuntimeTransitionable`\n\n```ts\ninterface RuntimeTransitionable {\n\ttransition?: RuntimeTransition;\n}\n```\n\n`transition` 프롭을 받는 부품들의 공통 형. `ViewProps`·`StackProps`·`RowProps`·\n`ScrollViewProps`·`ImageProps`·`PressableProps`·`RuntimeTextEntry`가 이것을 포함합니다 —\n`style`이 `RuntimeStyle`인 부품 전부입니다.\n\n`ScreenProps`·`TextProps`·`ButtonProps`·`ProgressProps`에는 **없습니다.** 그 넷은 상자\n스타일을 받지 않으므로 움직일 축이 없습니다. 글자를 움직이려면 `View`로 감싸세요.\n\n둘은 여러 부품이 공유하는 축입니다.\n\n- `RuntimePressable` — `onPress`·`disabled`. `Button`과 `Pressable`이 확장합니다.\n- `RuntimeTextEntry` — `value`·`placeholder`·`disabled`·`onChangeText`·`style`·`textStyle`·\n  `controller`. `TextInput`과 `TextArea`가 확장합니다.\n\n```tsx\nimport type { ButtonProps } from \"@rowcat/runtime\";\n\nfunction DangerButton(props: Omit<ButtonProps, \"tone\">) {\n\treturn <Button {...props} tone=\"ghost\" />;\n}\n```\n\n## 조종기\n\n| 이름 | 형 |\n| --- | --- |\n| `RuntimeScrollController` | `scrollToStart()`·`scrollToEnd()`·`scrollTo({ offset })` |\n| `RuntimeTextEntryController` | `focus()`·`blur()` |\n| `RuntimeScrollTo` | `{ offset: number }` — `scrollTo()`가 받는 것 |\n\n조종기는 `useScrollController()`·`useTextEntryController()`가 만듭니다. **DOM 요소도 네이티브\n참조도 아니고**, `current`도 크기도 좌표도 없습니다 — 여는 것은 위의 메서드뿐입니다.\n[스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)\n\n## 훅\n\n| 이름 | 형 |\n| --- | --- |\n| `RuntimeSetState<S>` | `(action: RuntimeStateAction<S>) => void` — 설정 함수 |\n| `RuntimeStateAction<S>` | `S \\| ((previous: S) => S)` — 설정 함수가 받는 것 |\n| `RuntimeRef<T>` | `{ current: T }` — `useRef`가 돌려주는 칸 |\n| `RuntimeCleanup` | `() => void` — 효과의 정리 함수 |\n\n## 노드와 컴포넌트\n\n| 이름 | 뜻 |\n| --- | --- |\n| `RuntimeNode` | 컴포넌트가 돌려줄 수 있는 모든 것 — 원소·문자열·숫자·불리언·`null`·`undefined`·그것들의 배열 |\n| `RuntimePrimitive` | 그중 원소가 아닌 것(`string \\| number \\| boolean \\| null \\| undefined`) |\n| `RuntimeElement` | TSX 태그 하나가 만드는 값 |\n| `RuntimeChildren` | `{ children?: RuntimeNode }` — 자식을 받는 프롭 형이 확장합니다 |\n| `RuntimeComponent<TProps>` | `(props: TProps) => RuntimeNode` — 컴포넌트 함수의 형 |\n| `RuntimeApp` | 프롭 없는 컴포넌트 — 진입 파일의 기본 내보내기가 이 형이어야 합니다 |\n\n```tsx\nimport type { RuntimeChildren, RuntimeNode } from \"@rowcat/runtime\";\n\nfunction Card({ title, children }: { title: string } & RuntimeChildren): RuntimeNode {\n\treturn (\n\t\t<Stack gap={4}>\n\t\t\t<Text style={{ fontWeight: \"bold\" }}>{title}</Text>\n\t\t\t{children}\n\t\t</Stack>\n\t);\n}\n```\n\n## 상태 정의\n\n| 이름 | 뜻 |\n| --- | --- |\n| `StoryStateDefinition<T>` | `defineStoryState`가 돌려주는 정의 |\n| `StoryStateInput<T>` | 그 함수가 받는 입력(`key`·`version`·`initial`·`migrate?`) |\n| `StoryStateInputChecked<T>` | 입력에 직렬화 검사를 얹은 형 — 실제 매개변수 형입니다 |\n| `StoryStateMigration<T>` | `(stored: Serializable, fromVersion: number) => T` |\n| `PersistentStateDefinition<T>` | `definePersistentState`가 돌려주는 정의 |\n| `PersistentStateInput<T>` | 그 입력 |\n| `PersistentStateInputChecked<T>` | 검사를 얹은 입력 |\n| `PersistentStateMigration<T>` | 영구 상태의 마이그레이션 함수 형 |\n\n## 직렬화\n\n| 이름 | 뜻 |\n| --- | --- |\n| `Serializable` | 저장할 수 있는 값 — `null`·불리언·숫자·문자열·그 배열·그 객체 |\n| `SerializableShape<T>` | `T`를 직렬화 가능한 모양으로 다시 그린 형. 함수·`Date`가 섞이면 그 자리가 `never`가 됩니다 |\n\n`Serializable`은 `migrate`의 첫 인자 형입니다. 옛 판의 값이 어떤 모양인지는 당신이 알고 있으므로\n그 안에서 좁혀 씁니다.\n"
		},
		{
			"slug": "reference/advanced",
			"url": "/docs/runtime/reference/advanced",
			"title": "저수준 API",
			"description": "평범한 작품에서 부를 일이 없는 판정 함수와 상수. 있다는 사실을 적어 두는 페이지입니다.",
			"group": "reference",
			"order": 10,
			"symbols": [
				"PERSISTENT_STATE_VERSION_MAX",
				"RuntimeHostComponent",
				"RuntimeHostKind",
				"STORY_STATE_VERSION_MAX",
				"isPersistentStateDefinition",
				"isRuntimeElement",
				"isRuntimeHostComponent",
				"isSerializable",
				"isStoryStateDefinition",
				"runtimeHostKindOf"
			],
			"headings": [
				{
					"level": 1,
					"text": "저수준 API",
					"id": "저수준-api"
				},
				{
					"level": 2,
					"text": "판정 함수",
					"id": "판정-함수"
				},
				{
					"level": 2,
					"text": "형",
					"id": "형"
				},
				{
					"level": 2,
					"text": "상수",
					"id": "상수"
				}
			],
			"body": "\n# 저수준 API\n\n`@rowcat/runtime`이 내보내지만 **작품을 만드는 코드에서 부를 이유가 거의 없는** 이름들입니다.\n값의 종류를 실행 중에 판정하는 함수와, 계약의 상한을 말하는 상수입니다. 여기 적는 이유는\n자동완성에 나타나는 이름이 무엇인지 답하기 위해서이지 쓰라는 뜻이 아닙니다.\n\n## 판정 함수\n\n| 이름 | 답하는 것 |\n| --- | --- |\n| `isRuntimeHostComponent(value)` | 값이 런타임 부품(`Stack` 등)인가 |\n| `runtimeHostKindOf(value)` | 부품이면 그 종류 이름(`\"stack\"`·`\"text\"`…), 아니면 `null` |\n| `isRuntimeElement(value)` | 값이 TSX 태그가 만든 원소인가 |\n| `isStoryStateDefinition(value)` | 값이 `defineStoryState`의 정의인가 |\n| `isPersistentStateDefinition(value)` | 값이 `definePersistentState`의 정의인가 |\n| `isSerializable(value)` | 값을 저장할 수 있는가(함수·`Date`·순환·`NaN`이 없는가) |\n\n`isSerializable`은 그중 쓸 일이 있을 수 있는 하나입니다 — 계산해서 만든 값을 저장 상태에 넣기\n전에 확인하는 자리입니다. 다만 `initial`의 타입 검사가 대부분을 이미 잡습니다.\n\n## 형\n\n- `RuntimeHostComponent<TProps>` — 부품의 형. 호출 가능하지만 실제로 부르면 던집니다.\n- `RuntimeHostKind` — 부품 종류 이름의 유니온(`\"screen\"`·`\"view\"`·`\"stack\"`·`\"row\"`·\n  `\"scroll\"`·`\"text\"`·`\"image\"`·`\"button\"`·`\"pressable\"`·`\"progress\"`·`\"text-input\"`·\n  `\"text-area\"`).\n\n## 상수\n\n- `STORY_STATE_VERSION_MAX` · `PERSISTENT_STATE_VERSION_MAX` — `version`이 가질 수 있는\n  최댓값(`Number.MAX_SAFE_INTEGER`). 실제로 닿을 일은 없습니다.\n"
		},
		{
			"slug": "runtime-model/security",
			"url": "/docs/runtime/runtime-model/security",
			"title": "보안과 샌드박스",
			"description": "런타임 코드가 어디서 돌고 무엇에 닿을 수 없는가. 그리고 발행된 코드에 비밀을 적으면 안 되는 이유.",
			"group": "runtime-model",
			"order": 1,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "보안과 샌드박스",
					"id": "보안과-샌드박스"
				},
				{
					"level": 2,
					"text": "닿을 수 없는 것",
					"id": "닿을-수-없는-것"
				},
				{
					"level": 2,
					"text": "이미지 — 좁은 예외",
					"id": "이미지-좁은-예외"
				},
				{
					"level": 2,
					"text": "있는 것",
					"id": "있는-것"
				},
				{
					"level": 2,
					"text": "검사는 두 겹입니다",
					"id": "검사는-두-겹입니다"
				},
				{
					"level": 2,
					"text": "비밀을 적지 마세요",
					"id": "비밀을-적지-마세요"
				},
				{
					"level": 2,
					"text": "RowCat이 하는 일",
					"id": "rowcat이-하는-일"
				},
				{
					"level": 2,
					"text": "이 페이지가 말하지 않는 것",
					"id": "이-페이지가-말하지-않는-것"
				}
			],
			"body": "\n# 보안과 샌드박스\n\n런타임 코드는 **격리된 환경**에서 돕니다. 플레이어의 브라우저나 앱 안이지만, 그 브라우저의\n페이지도 그 앱의 화면도 아닙니다 — RowCat이 세운 별개의 실행 공간이고, 그 공간에는 RowCat이\n일부러 넣어 준 것만 있습니다.\n\n## 닿을 수 없는 것\n\n- **브라우저 전역** — `window`·`document`·`navigator`·`location`·`localStorage`·\n  `IndexedDB`·쿠키. 있지도 않고, 있는 척하지도 않습니다.\n- **임의의 네트워크** — `fetch`·`XMLHttpRequest`·`WebSocket`. 외부 서버를 부르고 응답을\n  읽을 방법이 없습니다. AI는 [`useGeneration()`](/docs/runtime/concepts/generation) 하나를\n  지나고, 그 요청은 RowCat이 보냅니다. 이미지는 좁은 예외입니다 — 아래\n  [이미지](#이미지-좁은-예외)를 보세요.\n- **Node.js** — `process`·`require`·`fs`·`Buffer`.\n- **시계와 타이머** — `setTimeout`·`setInterval`·`requestAnimationFrame`. `Date.now()`는\n  있지만 그 값으로 진행을 정하면 기기마다 다른 결과가 됩니다.\n- **동적 코드** — `eval`·`new Function`·`import()`. 컴파일 시점에 검사에서 막힙니다.\n- **RowCat의 자격증명** — 세션·API 키·플레이어가 연결한 제공자의 키. 런타임 코드가 그 값을\n  읽을 수 있는 경로가 없습니다.\n- **다른 작품·다른 플레이어의 데이터.** 저장 상태는 이 작품과 이 플레이어의 것뿐입니다.\n\n이 목록은 \"지금 막아 두었다\"가 아니라 **그 공간에 그것이 없다**는 뜻입니다. 우회하는 방법을\n찾을 필요가 없고, 찾아도 다음 배포에서 사라집니다.\n\n## 이미지 — 좁은 예외\n\n그림을 가리키는 방법이 둘입니다. **RowCat에 올린 이미지**는 이름으로 부르고\n(`asset(\"characters/sena/smile\")`) 그 그림은 우리 저장소에서 옵니다 — 밖으로 나가는 요청이\n없으므로 아래 규칙의 대상이 아닙니다. 이름은 **실행 중에 만들어도 됩니다.**\n\n`asset(\"https://…\")`는 `Image`가 그릴 **외부** HTTPS 이미지 하나를 가리킬 수 있습니다. 그\n그림은 RowCat이 자기 이미지 경로로 가져와 플레이어에게 보여 줍니다 — 런타임 코드는 네트워크\n응답을 받지 못합니다. 상태 코드도, 헤더도, 바이트도, 리다이렉트도 오지 않고, 요청에 무엇을 실을 수도\n없습니다. 그림이 오지 않으면 자리표시자가 설 뿐 코드에는 아무 일도 일어나지 않습니다.\n\n**그리고 그 외부 주소는 프로젝트에 고정되어 있어야 합니다.** 소스에 그대로 적힌 주소만 실제\n요청이 되고, 실행 중에 조립한 주소(`` asset(`https://…/${값}`) ``)는 자리표시자로 남습니다 —\n그러지 않으면 그림 하나가 플레이어의 입력이나 진행 상태를 밖으로 내보내는 통로가 됩니다.\n규칙과 예제는 [자산](/docs/runtime/concepts/assets#주소는-프로젝트에-고정된-자산입니다)에\n있습니다.\n\n그래서 이 페이지가 말하는 것은 *네트워크 효과가 전혀 없다*가 아니라 **임의의 네트워크 API가\n없다**입니다. 원격 이미지는 플레이어 기기가 제작자의 서버에 직접 요청하지 않고 RowCat의\n이미지 경로를 통해 불러옵니다 — 플레이어의 IP 주소와 User-Agent가 그 서버에 전달되지\n않습니다. 다만 그 서버는 **RowCat의 요청과 그 시점**은 볼 수 있습니다(익명이 되는 것이\n아니라 플레이어의 접속 정보가 가려지는 것입니다).\n\n## 있는 것\n\n- `@rowcat/runtime`이 내보내는 전부 — 부품·훅·상태·생성·색·자산 참조(RowCat 이미지와\n  외부 HTTPS 이미지).\n- JavaScript 표준 — `Array`·`Object`·`Map`·`Set`·`JSON`·`Math`·`Promise`·`String` 등\n  ES2022의 내장 객체. (저장 상태에는 그중 JSON으로 적을 수 있는 것만 담깁니다.)\n- `console.log`·`console.warn`·`console.error` — 미리보기의 콘솔에 옵니다.\n\n## 검사는 두 겹입니다\n\n스튜디오의 검사와 발행 시점의 컴파일이 금지된 문법·import를 먼저 잡습니다. 그 검사를 지났다고\n해서 실행 공간이 열리는 것은 아닙니다 — 격리는 실행 공간 자체의 성질이고, 컴파일 검사는 제작자에게\n**그 자리에서** 정확한 오류를 주기 위한 것입니다.\n\n## 비밀을 적지 마세요\n\n**발행된 런타임 코드는 비밀을 두는 곳이 아닙니다.**\n\n컴파일된 코드는 작품을 열 자격이 있는 플레이어의 **기기로 내려가 거기서 실행됩니다.** 문자열,\n인물의 지시문, 분기 규칙, 숨겨 둔 엔딩 조건 — 전부 열어 볼 수 있는 클라이언트 코드라고 보아야\n합니다. 작품의 프롬프트 보호 설정은 대화 작품의 스냅샷에 대한 것이고 런타임 코드를 감추지\n않습니다.\n\n그러니 소스에 다음을 적지 마세요.\n\n- API 키, 비밀번호, 개인 토큰\n- 제공자 자격증명(런타임은 어차피 그것을 쓸 방법이 없습니다)\n- 자격증명이 박힌 주소 — `asset()`의 HTTPS 주소도 마찬가지입니다(서명 주소는 플레이어에게\n  보이는 값으로 취급합니다)\n- 플레이어에게 보이면 안 되는 개인 정보\n\nAI 인물의 지시문(`instructions`)도 같은 자리에 있습니다. 플레이어가 그것을 읽을 수 있다는\n전제로 쓰세요 — 스포일러를 지시문에 통째로 넣지 말고, 진행에 따라 필요한 만큼만 조립해 보내는\n것이 한 방법입니다.\n\n## RowCat이 하는 일\n\n- 런타임 코드의 실행을 격리하고, 한 화면이 너무 커지거나 한 렌더가 너무 오래 돌면 끊습니다.\n  무한 루프는 작품을 멈추지만 플레이어의 앱을 멈추지 않습니다.\n- AI 요청 앞뒤에 안전 지시를 세웁니다. `instructions`는 그것을 대신하지 못합니다.\n- AI 요청이 플레이어의 조작에서 시작했는지 확인합니다. 화면을 그리는 것만으로 누군가의 키가\n  쓰이지 않습니다.\n- 저장 상태를 플레이어의 계정에 보관하고 기기 사이로 옮깁니다.\n\n## 이 페이지가 말하지 않는 것\n\n실행 공간이 어떻게 만들어졌는지, 무엇으로 격리되는지, 어떤 검사가 어느 층에서 도는지는\n적지 않습니다. 제작자에게 필요한 것은 *무엇이 되고 무엇이 안 되는가*이고, 그 답은 위의\n목록입니다.\n"
		},
		{
			"slug": "runtime-model/supported-imports",
			"url": "/docs/runtime/runtime-model/supported-imports",
			"title": "지원하는 import",
			"description": "런타임 코드가 가져올 수 있는 모듈 셋과 그 규칙.",
			"group": "runtime-model",
			"order": 2,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "지원하는 import",
					"id": "지원하는-import"
				},
				{
					"level": 2,
					"text": "1. @rowcat/runtime",
					"id": "1-rowcat-runtime"
				},
				{
					"level": 2,
					"text": "2. 프로젝트 안의 파일",
					"id": "2-프로젝트-안의-파일"
				},
				{
					"level": 2,
					"text": "3. TSX가 스스로 넣는 것",
					"id": "3-tsx가-스스로-넣는-것"
				},
				{
					"level": 2,
					"text": "되지 않는 것",
					"id": "되지-않는-것"
				},
				{
					"level": 2,
					"text": "형 검사도 같은 규칙입니다",
					"id": "형-검사도-같은-규칙입니다"
				}
			],
			"body": "\n# 지원하는 import\n\n런타임 코드의 `import`는 셋 중 하나여야 합니다. 그 밖의 것은 컴파일에서 막힙니다.\n\n## 1. `@rowcat/runtime`\n\n```ts\nimport { Stack, Text, useState } from \"@rowcat/runtime\";\nimport type { RuntimeNode } from \"@rowcat/runtime\";\n```\n\n런타임의 공개 API 전부. 목록은 [API 레퍼런스](/docs/runtime/reference)에 있습니다.\n`@rowcat/runtime/internal/…` 같은 하위 경로는 없습니다 — 있어 보여도 거절됩니다.\n\n## 2. 프로젝트 안의 파일\n\n```ts\nimport { party } from \"./game\";\nimport { CharacterCard } from \"../components/CharacterCard\";\n```\n\n- `./` 또는 `../`로 시작합니다.\n- **확장자를 적지 않습니다.** `./game`은 `game.ts` → `game.tsx` → `game/index.ts` →\n  `game/index.tsx` 순으로 찾습니다.\n- 프로젝트 뿌리 위로 올라가는 경로는 거절됩니다.\n- 파일을 찾지 못하면 어느 경로들을 시도했는지 진단이 말합니다.\n\n## 3. TSX가 스스로 넣는 것\n\n`<Stack>` 같은 TSX 태그를 쓰면 컴파일러가 `@rowcat/runtime/jsx-runtime`을 대신 가져옵니다.\n당신이 적을 일은 없고, 적어도 됩니다.\n\n## 되지 않는 것\n\n| import | 왜 |\n| --- | --- |\n| `react` · `react-dom` · `react-native` | 런타임은 React가 아니고 React를 싣지 않습니다 |\n| `lodash` · `zustand` · 그 밖의 npm 패키지 | 설치할 곳이 없습니다. 프로젝트의 파일이 전부입니다 |\n| `node:fs` · `path` · `crypto` | Node.js가 없습니다 |\n| `https://…/module.js` | 원격 모듈을 가져올 방법이 없습니다 |\n| `import(\"./scene\")` (동적) | 모든 모듈은 컴파일 시점에 정해집니다 |\n| `require(\"./x\")` | CommonJS가 없습니다 |\n\n`.json`·`.css`·`.png` 같은 자산 파일도 가져올 수 없습니다. 프로젝트의 파일은 `.ts`·`.tsx`\n둘뿐입니다. 데이터는 `.ts` 파일에 상수로 적습니다.\n\n```ts\n// src/data/scenes.ts\nexport const SCENES = [\n\t{ id: \"intro\", text: \"밤 11시, 편의점 앞.\" },\n\t{ id: \"counter\", text: \"카운터 뒤에 서자 문이 열렸다.\" },\n] as const;\n```\n\n## 형 검사도 같은 규칙입니다\n\n스튜디오의 자동완성과 오류 표시는 같은 컴파일러 설정을 씁니다. DOM 타입(`HTMLElement`)도\nNode 타입(`Buffer`)도 프로그램에 없어서, 그 이름을 쓰면 편집기에서 먼저 빨간 줄이 섭니다.\n"
		},
		{
			"slug": "runtime-model/unsupported-apis",
			"url": "/docs/runtime/runtime-model/unsupported-apis",
			"title": "지원하지 않는 API",
			"description": "흔히 있을 것으로 기대하지만 런타임에 없는 것들과, 대신 무엇을 쓰는가.",
			"group": "runtime-model",
			"order": 3,
			"symbols": [],
			"headings": [
				{
					"level": 1,
					"text": "지원하지 않는 API",
					"id": "지원하지-않는-api"
				},
				{
					"level": 2,
					"text": "할 수 없는 것",
					"id": "할-수-없는-것"
				},
				{
					"level": 2,
					"text": "대신 쓰는 것",
					"id": "대신-쓰는-것"
				},
				{
					"level": 3,
					"text": "소리의 경계",
					"id": "소리의-경계"
				},
				{
					"level": 3,
					"text": "부품을 가리키는 ref의 경계",
					"id": "부품을-가리키는-ref의-경계"
				},
				{
					"level": 2,
					"text": "대안이 없는 것",
					"id": "대안이-없는-것"
				},
				{
					"level": 2,
					"text": "있는 것처럼 보이지만 없는 것",
					"id": "있는-것처럼-보이지만-없는-것"
				}
			],
			"body": "\n# 지원하지 않는 API\n\n웹이나 React Native에서 익숙한 것 중 런타임에 **없는 것**을 모았습니다. 대안이 있으면 함께\n적고, 없으면 없다고 적습니다.\n\n## 할 수 없는 것\n\n```text\nnpm 패키지 설치\nReact · React 라이브러리\nHTML 태그 · DOM 조작\nfetch · WebSocket · 외부 API 호출 (이미지는 예외 — asset(\"https://…\"))\n파일 읽기·쓰기\nlocalStorage · IndexedDB · 쿠키\nsetTimeout · setInterval · 애니메이션 프레임 (전이는 style + transition으로 적는다)\n진동 · 카메라 · 위치\n클립보드 · 공유 · 알림\n링크 열기 · 다른 화면으로 이동\nWeb Audio(AudioContext) · <audio> · 플랫폼 재생 객체\nDOM 요소 · React Native 참조 · 부품을 가리키는 ref\n```\n\n## 대신 쓰는 것\n\n| 하고 싶은 일 | 쓰는 것 |\n| --- | --- |\n| 그림 | [`asset(\"https://…\")`](/docs/runtime/concepts/assets) — HTTPS 주소의 이미지를 `Image`로 그립니다 |\n| 소리 | [`Audio`](/docs/runtime/reference/components#audio) — RowCat에 올린 소리를 `asset(\"audio/…\")`로 울립니다 |\n| 목록을 최신으로 내리기 | [`useScrollController`](/docs/runtime/concepts/scroll-and-focus) — `scrollToStart`·`scrollToEnd`·`scrollTo({ offset })` |\n| 입력 칸에 초점 주기 | [`useTextEntryController`](/docs/runtime/concepts/scroll-and-focus) — `focus`·`blur` |\n| 진행 저장 | [`useStoryState`](/docs/runtime/concepts/state) — 플레이어의 계정에 저장되어 기기 사이를 건넙니다 |\n| 회차를 넘는 기록 | [`usePersistentState`](/docs/runtime/concepts/state#회차를-넘는-상태-definepersistentstate-usepersistentstate) |\n| 인물의 답·서술 | [`useGeneration`](/docs/runtime/concepts/generation) |\n| 화면 | [`@rowcat/runtime`의 부품](/docs/runtime/reference/components) |\n| 색 | [`color()`](/docs/runtime/concepts/styling#색) |\n| 값이 바뀔 때 부드럽게 | [`transition`](/docs/runtime/concepts/styling#전이) — `opacity`·`translateX`·`translateY`·`scale` |\n| 디버그 출력 | `console.log` — 미리보기의 콘솔에 옵니다 |\n\n### 소리의 경계\n\n소리는 **되는 것과 안 되는 것이 갈립니다.** 되는 쪽은 하나입니다.\n\n```text\n된다      <Audio source={asset(\"audio/bgm/main\")} playing />\n          RowCat에 올려 스튜디오에서 이름을 붙인 소리\n\n안 된다   AudioContext · new Audio() · <audio> 태그 · 플랫폼의 재생 객체\n          임의의 오디오 API · 직접 만드는 소리\n          원격 HTTPS 주소의 소리(그림과 갈리는 지점입니다 — 재생은 흐르는 대화라\n          프록시 하나로 접히지 않습니다)\n```\n\n재생·정지·반복·크기·되감기는 전부 `Audio`의 **프롭**입니다. 소리를 명령형으로 조작하는\n손잡이(`play()`·`pause()`)는 없습니다. 자세한 것은 [자산](/docs/runtime/concepts/assets)에\n있습니다.\n\n### 부품을 가리키는 ref의 경계\n\n`useRef`는 렌더 사이에 값을 담는 칸이고 **부품을 가리키지 않습니다.** 화면에 한 번 시키는\n일(스크롤·초점)은 조종기로 합니다.\n\n```text\n된다      const scroll = useScrollController();\n          <ScrollView controller={scroll}>…</ScrollView>\n          scroll.scrollToEnd()\n\n안 된다   ref.current.focus() · findNodeHandle · querySelector\n          크기·좌표·부모·자식을 읽는 일\n```\n\n[스크롤과 초점](/docs/runtime/concepts/scroll-and-focus)이 규칙 전부를 적습니다.\n\n## 대안이 없는 것\n\n- **시간의 흐름.** 타이머가 없어 \"3초 뒤에\"를 만들 수 없습니다. 진행은 플레이어의 조작으로\n  넘깁니다. `Date.now()`는 값을 주지만 기기마다 다른 값이라 진행의 근거로 쓰면 안 됩니다.\n- **프레임 단위의 애니메이션.** 프레임을 직접 그리는 방법(`requestAnimationFrame`·타이머·\n  명령형 애니메이션 객체)은 없습니다. **다만 상태가 바뀔 때의 전이는 있습니다** — `transition`\n  프롭과 `opacity`·`translateX`·`translateY`·`scale`로 적습니다([스타일](/docs/runtime/concepts/styling#전이)).\n  키프레임·반복·스프링·진입과 퇴장 애니메이션은 없고, 스크롤도 즉시 옮깁니다(부드러운\n  스크롤이 없습니다).\n- **화면 밖으로 나가기.** 링크·공유·다른 작품으로의 이동은 없습니다. 런타임은 자기 화면 하나를\n  갖습니다.\n- **플레이어의 신원.** 이름·아이디·아바타를 읽을 방법이 없습니다. 플레이어의 이름이 필요하면\n  작품 안에서 물어 저장 상태에 둡니다.\n- **뷰포트 크기.** 화면의 폭·높이를 읽는 API가 없습니다. 비율(`\"100%\"`)과 `grow`로 배치합니다.\n  스크롤 위치를 **읽는** 방법도 없습니다 — 조종기는 옮기기만 합니다.\n- **랜덤의 재현.** `Math.random()`은 있지만 저장되지 않습니다. 재현되어야 하는 무작위(같은 시드의\n  같은 결과)는 시드를 저장 상태에 두고 직접 만듭니다.\n\n## 있는 것처럼 보이지만 없는 것\n\n| 이름 | 사실 |\n| --- | --- |\n| `useContext` · `createContext` | 없습니다. 같은 값을 여러 컴포넌트가 봐야 하면 `defineStoryState`의 정의를 가져다 쓰거나 프롭으로 넘깁니다 |\n| `useLayoutEffect` · `useId` · `useTransition` | 없습니다 |\n| `memo` · `forwardRef` · `lazy` · `Suspense` | 없습니다 |\n| `useRef`에 담은 부품 · `ref` 프롭 | 없습니다. 스크롤과 초점은 [조종기](/docs/runtime/concepts/scroll-and-focus)로 합니다 |\n| `<Fragment>` · `<></>` | 없습니다. 여러 노드는 **배열**로 돌려줍니다(각 항목에 `key`) |\n| `className` · `style` 문자열 | 없습니다. `style`은 [정해진 속성의 객체](/docs/runtime/concepts/styling)입니다 |\n| `onClick` · `onChange` · `onKeyDown` | 없습니다. `onPress`·`onChangeText`·`onSubmit`입니다 |\n| `defaultValue` | 없습니다. 입력은 통제된 입력이라 `value`가 필수입니다 |\n| `TextInput`의 `multiline` | 없습니다. 여러 줄은 `TextArea`입니다 |\n| `Image`의 `src` · `uri` | 없습니다. `source={asset(\"https://…\")}`입니다 — 문자열을 그대로 넣을 수 없습니다 |\n| 실행 중에 만든 원격 이미지 주소 | 없습니다. 외부 주소는 소스에 고정되어야 하고, 조립한 주소는 자리표시자입니다. **RowCat 이미지의 이름은 실행 중에 만들어도 됩니다** |\n"
		}
	],
	"symbols": [
		{
			"name": "AssetRef",
			"kind": "interface",
			"signature": "interface AssetRef {\n\treadonly [RUNTIME_ASSET]: string;\n}",
			"summary": "The interface has no url, id or kind by design.",
			"doc": "reference/assets",
			"url": "/docs/runtime/reference/assets"
		},
		{
			"name": "Audio",
			"kind": "component",
			"signature": "declare const Audio: RuntimeHostComponent<AudioProps>;",
			"summary": "A sound.",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "AudioProps",
			"kind": "interface",
			"signature": "interface AudioProps {\n\t/**\n\t * Same shape as Image, but the accepted values are narrower: remote HTTPS addresses do not play\n\t * here. `asset('https://...')` still builds, but the trusted host does not resolve it to sound, so\n\t * no request is ever sent. Reason: an image is fetched once and drawn, and failures fold into a\n\t * placeholder. Sound keeps flowing, so range requests, buffering, abort and resume all become a\n\t * conversation with the remote host. A single IP-masking proxy would not fold that into one step,\n\t * and opening that surface is not a decision of this slice.\n\t */\n\tsource: AssetRef;\n\t/**\n\t * Whether sound is wanted, not whether it is playing now. Browsers block sound until the user has\n\t * interacted with the page. That is normal platform policy, not an error, so `playing={true}` does\n\t * not guarantee sound: the host remembers the wish and starts when it is allowed. Defaults to\n\t * `false`.\n\t */\n\tplaying?: boolean;\n\t/**\n\t * When the sound ends, it starts over from the beginning. Defaults to `false`; then the end is\n\t * reported by `onEnded`.\n\t */\n\tloop?: boolean;\n\t/**\n\t * Between 0 and 1, finite. Defaults to 1. Out-of-range values are rejected, not silently clamped.\n\t * Clamping `volume={5}` to 1 would make authors believe their value is used, and the\n\t * misunderstanding would surface later in computed values. Rejecting there is more honest (the\n\t * same decision as `asset()` not trimming whitespace).\n\t */\n\tvolume?: number;\n\t/** Mutes the sound. A separate axis from `volume`: it mutes while remembering the level. */\n\tmuted?: boolean;\n\t/**\n\t * Changing this value rewinds to the beginning. A name is needed because `playing` cannot express\n\t * it: on a second press of a sound effect, `playing` is already true, the commit has no change,\n\t * and nothing plays. It only rewinds; it does not change whether the sound plays. The value is a\n\t * string or number because it crosses the wire, and object identity does not survive that\n\t * boundary.\n\t */\n\trestartKey?: string | number;\n\t/**\n\t * Called when playback has finished. Not called while `loop` is set: calling it per cycle would\n\t * turn 'ended' into 'went around once', and handling attached to repeating music would run every\n\t * cycle. It does not change state: the host never sets `playing` to false on the author's behalf.\n\t * To play again, change `restartKey`.\n\t */\n\tonEnded?: () => void | Promise<void>;\n\t/**\n\t * Accepts no children, enforced by the type. Sound is played, not contained, so there is no place\n\t * to draw children. Drawing them elsewhere would split what the author wrote from the screen.\n\t */\n\tchildren?: never;\n}",
			"summary": "Audio: sound that is played, not drawn.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "Button",
			"kind": "component",
			"signature": "declare const Button: RuntimeHostComponent<ButtonProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "ButtonProps",
			"kind": "interface",
			"signature": "interface ButtonProps extends RuntimeChildren, RuntimePressable {\n\t/** Visual hierarchy. Adding a value means changing both renderers together. */\n\ttone?: \"primary\" | \"secondary\" | \"ghost\";\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "Image",
			"kind": "component",
			"signature": "declare const Image: RuntimeHostComponent<ImageProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "ImageProps",
			"kind": "interface",
			"signature": "interface ImageProps extends RuntimeTransitionable {\n\t/**\n\t * What to draw: an asset reference, not a plain string. Passing through `asset()` is the author's\n\t * explicit declaration that the string is an image reference, and a deterministic check runs there\n\t * (see asset.ts). Plain strings are still rejected even though remote URLs are now accepted: what\n\t * widened is the input to `asset()`, not this prop's type. Which bytes a reference points to is\n\t * answered by the trusted host. This package does no lookup, authorization, or caching.\n\t */\n\tsource: AssetRef;\n\t/** Screen-reader label. Omit it for decorative images. */\n\talt?: string;\n\tstyle?: RuntimeStyle;\n\tfit?: \"cover\" | \"contain\" | \"fill\";\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "PERSISTENT_STATE_VERSION_MAX",
			"kind": "constant",
			"signature": "declare const PERSISTENT_STATE_VERSION_MAX = DURABLE_STATE_VERSION_MAX;",
			"summary": "",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "PersistentStateDefinition",
			"kind": "interface",
			"signature": "interface PersistentStateDefinition<T> {\n\t/**\n\t * Brand of this lifetime.\n\t *\n\t * There is no alias such as `type PersistentStateDefinition<T> = StoryStateDefinition<T>`. With an\n\t * alias, each hook would accept the other's definition, and a screen would silently read a value\n\t * from the wrong lifetime.\n\t */\n\treadonly [RUNTIME_PERSISTENT_STATE]: true;\n\treadonly key: string;\n\treadonly version: number;\n\treadonly initial: T;\n\treadonly migrate: PersistentStateMigration<T> | null;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "PersistentStateInput",
			"kind": "type",
			"signature": "type PersistentStateInput<T> = DurableStateInput<T>;",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "PersistentStateInputChecked",
			"kind": "type",
			"signature": "type PersistentStateInputChecked<T> = DurableStateInputChecked<T>;",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "PersistentStateMigration",
			"kind": "type",
			"signature": "type PersistentStateMigration<T> = DurableStateMigration<T>;",
			"summary": "Persistent state: the second lifetime of the saved-state core, for long progress tied to a member and a work.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "Pressable",
			"kind": "component",
			"signature": "declare const Pressable: RuntimeHostComponent<PressableProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "PressableProps",
			"kind": "interface",
			"signature": "interface PressableProps\n\textends RuntimeChildren,\n\t\tRuntimePressable,\n\t\tRuntimeTransitionable {\n\tstyle?: RuntimeStyle;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "Progress",
			"kind": "component",
			"signature": "declare const Progress: RuntimeHostComponent<ProgressProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "ProgressProps",
			"kind": "interface",
			"signature": "interface ProgressProps {\n\t/** 0 to 1. If absent, progress is unbounded (indeterminate, an endless animation). */\n\tvalue?: number;\n\tstyle?: { width?: RuntimeLength };\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RUNTIME_EASINGS",
			"kind": "constant",
			"signature": "declare const RUNTIME_EASINGS = [\n\t\"linear\",\n\t\"ease\",\n\t\"ease-in\",\n\t\"ease-out\",\n\t\"ease-in-out\",\n] as const;",
			"summary": "",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RUNTIME_ERROR_CODE",
			"kind": "constant",
			"signature": "declare const RUNTIME_ERROR_CODE = {\n\thookOutsideRender: \"runtime_hook_outside_render\",\n\thookOrderChanged: \"runtime_hook_order_changed\",\n\tstateUpdateDuringRender: \"runtime_state_update_during_render\",\n\tasyncComponentUnsupported: \"runtime_async_component_unsupported\",\n\tinvalidRuntimeNode: \"runtime_invalid_runtime_node\",\n\t/** Duplicate key among siblings (warning). The later element is matched by position instead. */\n\tduplicateKey: \"runtime_duplicate_key\",\n\t/**\n\t * The host sent a handler id that is not in the registry. This is a stale event, not a failure.\n\t */\n\thandlerNotFound: \"runtime_handler_not_found\",\n\t/** Setter called after the component unmounted. Logged as a warning and ignored. */\n\tupdateAfterUnmount: \"runtime_update_after_unmount\",\n\t/** An effect returned a promise (warning). It is not read as a cleanup function. */\n\teffectReturnedPromise: \"runtime_effect_returned_promise\",\n\t/** An effect or its cleanup threw. Diagnostic only: that effect is lost. */\n\teffectFailed: \"runtime_effect_failed\",\n\tinvalidHostProp: \"runtime_invalid_host_prop\",\n\ttreeDepthExceeded: \"runtime_tree_depth_exceeded\",\n\thostNodeLimitExceeded: \"runtime_host_node_limit_exceeded\",\n\tpatchLimitExceeded: \"runtime_patch_limit_exceeded\",\n\t/** The host did not accept the commit bundle. The previous commit remains authoritative. */\n\tcommitRejected: \"runtime_commit_rejected\",\n\t/** The host port was not installed. This is a boot-order problem, not the creator's. */\n\thostPortMissing: \"runtime_host_port_missing\",\n\trootEntryInvalid: \"runtime_root_entry_invalid\",\n\trootDisposed: \"runtime_root_disposed\",\n\thostComponentCalled: \"runtime_host_component_called\",\n\tinvalidStoryState: \"runtime_invalid_story_state\",\n\t/** `defineStoryState` was called after module evaluation ended and the registry was sealed. */\n\tstoryStateDefinitionLate: \"runtime_story_state_definition_late\",\n\t/** Two definitions share one storage key. The key is the identity of the stored value. */\n\tstoryStateDuplicateKey: \"runtime_story_state_duplicate_key\",\n\tstoryStateHookChanged: \"runtime_story_state_hook_changed\",\n\tstoryStateValueInvalid: \"runtime_story_state_value_invalid\",\n\tstoryStateLimitExceeded: \"runtime_story_state_limit_exceeded\",\n\t/** Migration threw, or the stored version is older and no migration exists. */\n\tstoryStateMigrationFailed: \"runtime_story_state_migration_failed\",\n\tstoryStateMigrationInvalid: \"runtime_story_state_migration_invalid\",\n\t/** The stored version is higher than this code's version: old code is opening new storage. */\n\tstoryStateVersionNewer: \"runtime_story_state_version_newer\",\n\tstoryStateSnapshotInvalid: \"runtime_story_state_snapshot_invalid\",\n\t/**\n\t * Persistent-state error codes. They are not shared with story state. The two lifetimes mean\n\t * different things to the player. Folding the codes together would hide which lifetime failed, and\n\t * the creator would then reset the playthrough. That cannot fix a persistent-state failure.\n\t */\n\tinvalidPersistentState: \"runtime_invalid_persistent_state\",\n\tpersistentStateDefinitionLate: \"runtime_persistent_state_definition_late\",\n\tpersistentStateDuplicateKey: \"runtime_persistent_state_duplicate_key\",\n\tpersistentStateHookChanged: \"runtime_persistent_state_hook_changed\",\n\tpersistentStateValueInvalid: \"runtime_persistent_state_value_invalid\",\n\tpersistentStateLimitExceeded: \"runtime_persistent_state_limit_exceeded\",\n\tpersistentStateMigrationFailed: \"runtime_persistent_state_migration_failed\",\n\tpersistentStateMigrationInvalid: \"runtime_persistent_state_migration_invalid\",\n\tpersistentStateVersionNewer: \"runtime_persistent_state_version_newer\",\n\tpersistentStateSnapshotInvalid: \"runtime_persistent_state_snapshot_invalid\",\n\t/** A generation was requested during render. Rendering the same tree twice would charge twice. */\n\tgenerationDuringRender: \"runtime_generation_during_render\",\n\t/**\n\t * The generation request does not match the contract (empty message, unknown role, over the\n\t * limit).\n\t */\n\tgenerationInvalidRequest: \"runtime_generatio\n/* … truncated. See the docs for the full declaration */",
			"summary": "The error the runtime throws: one class, with a code.",
			"doc": "reference/errors-and-limits",
			"url": "/docs/runtime/reference/errors-and-limits"
		},
		{
			"name": "RUNTIME_GENERATION_LIMITS",
			"kind": "constant",
			"signature": "declare const RUNTIME_GENERATION_LIMITS = Object.freeze({\n\tmaxMessages: 100,\n\tmaxMessageCharacters: 32_768,\n\tmaxInstructionsCharacters: 32_768,\n\tmaxTotalCharacters: 262_144,\n\tmaxOutputCharacters: 16_000,\n\tdefaultOutputCharacters: 4_000,\n});",
			"summary": "Request limits.",
			"doc": "reference/generation",
			"url": "/docs/runtime/reference/generation"
		},
		{
			"name": "RUNTIME_TRANSITION_DEFAULT_DURATION_MS",
			"kind": "constant",
			"signature": "declare const RUNTIME_TRANSITION_DEFAULT_DURATION_MS = 200;",
			"summary": "",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RUNTIME_TRANSITION_DEFAULT_EASING",
			"kind": "constant",
			"signature": "declare const RUNTIME_TRANSITION_DEFAULT_EASING: RuntimeEasing;",
			"summary": "",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RUNTIME_TRANSITION_MAX_DURATION_MS",
			"kind": "constant",
			"signature": "declare const RUNTIME_TRANSITION_MAX_DURATION_MS = 10_000;",
			"summary": "The limit is 10 seconds.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "Row",
			"kind": "component",
			"signature": "declare const Row: RuntimeHostComponent<RowProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "RowProps",
			"kind": "interface",
			"signature": "interface RowProps extends RuntimeChildren, RuntimeTransitionable {\n\tgap?: number;\n\tstyle?: RuntimeStyle;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeAlign",
			"kind": "type",
			"signature": "type RuntimeAlign = \"start\" | \"center\" | \"end\" | \"stretch\";",
			"summary": "",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeApp",
			"kind": "type",
			"signature": "type RuntimeApp = RuntimeComponent<Record<never, never>>;",
			"summary": "The root of the app.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeChildren",
			"kind": "interface",
			"signature": "interface RuntimeChildren {\n\tchildren?: RuntimeNode;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeCleanup",
			"kind": "type",
			"signature": "type RuntimeCleanup = () => void;",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeColor",
			"kind": "type",
			"signature": "type RuntimeColor = string & { readonly [RUNTIME_COLOR]: \"color\" };",
			"summary": "A value that has passed validation.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeComponent",
			"kind": "type",
			"signature": "type RuntimeComponent<TProps = Record<never, never>> = (\n\tprops: TProps,\n) => RuntimeNode;",
			"summary": "The type of components creators write.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeEasing",
			"kind": "type",
			"signature": "type RuntimeEasing =\n\t| \"linear\"\n\t| \"ease\"\n\t| \"ease-in\"\n\t| \"ease-out\"\n\t| \"ease-in-out\";",
			"summary": "The easing vocabulary is closed, with five entries.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeElement",
			"kind": "interface",
			"signature": "interface RuntimeElement<TType = unknown, TProps = unknown> {\n\treadonly $$typeof: typeof RUNTIME_ELEMENT;\n\treadonly type: TType;\n\treadonly props: TProps;\n\treadonly key: string | number | null;\n}",
			"summary": "A runtime element, the only shape `jsx()` creates.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeError",
			"kind": "class",
			"signature": "declare class RuntimeError extends Error {\n\treadonly code: RuntimeErrorCode;\n\tconstructor(code: RuntimeErrorCode, message: string);\n}",
			"summary": "",
			"doc": "reference/errors-and-limits",
			"url": "/docs/runtime/reference/errors-and-limits"
		},
		{
			"name": "RuntimeErrorCode",
			"kind": "type",
			"signature": "type RuntimeErrorCode =\n\t(typeof RUNTIME_ERROR_CODE)[keyof typeof RUNTIME_ERROR_CODE];",
			"summary": "",
			"doc": "reference/errors-and-limits",
			"url": "/docs/runtime/reference/errors-and-limits"
		},
		{
			"name": "RuntimeGeneration",
			"kind": "interface",
			"signature": "interface RuntimeGeneration {\n\tgenerate(request: RuntimeGenerationRequest): Promise<RuntimeGenerationResult>;\n}",
			"summary": "One generation capability.",
			"doc": "reference/generation",
			"url": "/docs/runtime/reference/generation"
		},
		{
			"name": "RuntimeGenerationMessage",
			"kind": "interface",
			"signature": "interface RuntimeGenerationMessage {\n\trole: \"user\" | \"assistant\";\n\tcontent: string;\n}",
			"summary": "One conversation turn.",
			"doc": "reference/generation",
			"url": "/docs/runtime/reference/generation"
		},
		{
			"name": "RuntimeGenerationRequest",
			"kind": "interface",
			"signature": "interface RuntimeGenerationRequest {\n\tmessages: readonly RuntimeGenerationMessage[];\n\tinstructions?: string;\n\t/**\n\t * Upper-bound hint for answer length, in characters. The host converts it to its own unit and\n\t * truncates to its own cap; tokenizers belong to the host, so this contract never says 'token'.\n\t */\n\tmaxOutputCharacters?: number;\n}",
			"summary": "The role and character this experience needs.",
			"doc": "reference/generation",
			"url": "/docs/runtime/reference/generation"
		},
		{
			"name": "RuntimeGenerationResult",
			"kind": "interface",
			"signature": "interface RuntimeGenerationResult {\n\ttext: string;\n}",
			"summary": "",
			"doc": "reference/generation",
			"url": "/docs/runtime/reference/generation"
		},
		{
			"name": "RuntimeHostComponent",
			"kind": "interface",
			"signature": "interface RuntimeHostComponent<TProps> {\n\t(props: TProps): RuntimeNode;\n\treadonly [RUNTIME_HOST]: RuntimeHostKind;\n}",
			"summary": "Host primitives: what the runtime draws, not components the author assembles.",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "RuntimeHostKind",
			"kind": "type",
			"signature": "type RuntimeHostKind =\n\t| \"screen\"\n\t| \"view\"\n\t| \"stack\"\n\t| \"row\"\n\t| \"scroll\"\n\t| \"text\"\n\t| \"image\"\n\t| \"button\"\n\t| \"pressable\"\n\t| \"progress\"\n\t| \"text-input\"\n\t| \"text-area\"\n\t| \"audio\";",
			"summary": "The host vocabulary.",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "RuntimeJustify",
			"kind": "type",
			"signature": "type RuntimeJustify = \"start\" | \"center\" | \"end\" | \"between\" | \"around\";",
			"summary": "Main-axis alignment.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeLength",
			"kind": "type",
			"signature": "type RuntimeLength = number | `${number}%`;",
			"summary": "Length is a number or a percentage.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeNode",
			"kind": "type",
			"signature": "type RuntimeNode =\n\t| RuntimePrimitive\n\t| RuntimeElement\n\t| readonly RuntimeNode[];",
			"summary": "Children arrays are readonly so creator code cannot change an array the reconciler is still holding.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimePressable",
			"kind": "interface",
			"signature": "interface RuntimePressable {\n\tonPress?: () => void | Promise<void>;\n\tdisabled?: boolean;\n}",
			"summary": "The shared axis for pressable things.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimePrimitive",
			"kind": "type",
			"signature": "type RuntimePrimitive = string | number | boolean | null | undefined;",
			"summary": "`undefined` is here as a consequence of syntax, not leniency.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeRef",
			"kind": "interface",
			"signature": "interface RuntimeRef<T> {\n\tcurrent: T;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeScrollController",
			"kind": "interface",
			"signature": "interface RuntimeScrollController {\n\tscrollToStart(): void;\n\t/**\n\t * Scroll to the end of the content. If the list has just grown, this is the end after the growth.\n\t */\n\tscrollToEnd(): void;\n\tscrollTo(options: RuntimeScrollTo): void;\n}",
			"summary": "Controls one scroll view.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeScrollTo",
			"kind": "interface",
			"signature": "interface RuntimeScrollTo {\n\t/**\n\t * Distance from the start of the content, in the same unit as style lengths (CSS pixels on web,\n\t * points on native). The axis is set by the ScrollView's `horizontal`: top-down for vertical,\n\t * start edge for horizontal. Values beyond the content end are clamped by the platform, not by\n\t * this package.\n\t */\n\toffset: number;\n}",
			"summary": "Argument of `scrollTo()`.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeSetState",
			"kind": "type",
			"signature": "type RuntimeSetState<S> = (action: RuntimeStateAction<S>) => void;",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeStateAction",
			"kind": "type",
			"signature": "type RuntimeStateAction<S> = S | ((previous: S) => S);",
			"summary": "The only place that knows what hooks actually do.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeStyle",
			"kind": "interface",
			"signature": "interface RuntimeStyle {\n\twidth?: RuntimeLength;\n\theight?: RuntimeLength;\n\t/**\n\t * The size bounds are one set of four. `width` alone cannot express 'as wide as the content, but\n\t * never beyond a limit'. A speech bubble has that shape, and a fixed `width: 86%` makes even a\n\t * one-word line take the full width. The four are opened together because widening this axis is a\n\t * version bump. Opening them one at a time would pay the same cost four times. They have the same\n\t * names and meanings on both platforms (CSS min-width, RN minWidth). Values follow `width`: a\n\t * number or a percentage.\n\t */\n\tminWidth?: RuntimeLength;\n\tmaxWidth?: RuntimeLength;\n\tminHeight?: RuntimeLength;\n\tmaxHeight?: RuntimeLength;\n\tpadding?: number;\n\tgap?: number;\n\t/**\n\t * Opacity ranges from 0 to 1. The type cannot express the upper bound, so a runtime clamp handles\n\t * it.\n\t */\n\topacity?: number;\n\tbackgroundColor?: RuntimeColor;\n\tborderRadius?: number;\n\tjustify?: RuntimeJustify;\n\talign?: RuntimeAlign;\n\tgrow?: number;\n\t/**\n\t * This axis was missing for a while. Whether content could shrink was set entirely by each\n\t * renderer's default, and the defaults differed (CSS uses 1, Yoga uses 0). The same work squeezed\n\t * vertically on the web, so its scroll disappeared, and a long sentence in a row was cut off on\n\t * native. Both renderers now shrink only row children by default. This prop lets creators override\n\t * that default. `0` means does not shrink, which differs from not writing a value: an unwritten\n\t * value inherits the parent's main-axis default. Negative values are not accepted.\n\t */\n\tshrink?: number;\n\t/**\n\t * Horizontal offset in density-independent units. Absent means `0`. The value is a number, not a\n\t * string such as `translateX(8px)`. A string brings a grammar (units, function lists, order,\n\t * matrix) whose owner is the browser. With numeric axes the order is fixed by the renderer, so\n\t * both platforms use the same order. The move does not change layout. It only changes where the\n\t * node is drawn, so neighbors are not pushed. The intermediate states of a transition therefore\n\t * match on both platforms, which layout axes do not.\n\t */\n\ttranslateX?: number;\n\ttranslateY?: number;\n\t/**\n\t * Scale factor. Absent means `1`. Negative values are not accepted, since flipping is not part of\n\t * this vocabulary. The center is always the node's center. `transformOrigin` is not exposed\n\t * because its coordinate system differs by platform. Fixing one default lets both renderers\n\t * produce the same picture.\n\t */\n\tscale?: number;\n}",
			"summary": "`padding` is a single number, on the same rule.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeTextEntry",
			"kind": "interface",
			"signature": "interface RuntimeTextEntry extends RuntimeTransitionable {\n\tvalue: string;\n\tplaceholder?: string;\n\tdisabled?: boolean;\n\t/** Called after the user edits. It receives the whole text after the change, not a delta. */\n\tonChangeText?: (value: string) => void | Promise<void>;\n\tstyle?: RuntimeStyle;\n\ttextStyle?: RuntimeTextStyle;\n\t/**\n\t * Handle that moves focus for this input. Must come from `useTextEntryController()`. It is not a\n\t * ref: no `current`, no selection, no native handle. It opens only `focus()` and `blur()`.\n\t */\n\tcontroller?: RuntimeTextEntryController;\n}",
			"summary": "The shared axis for text entry.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeTextEntryController",
			"kind": "interface",
			"signature": "interface RuntimeTextEntryController {\n\t/** Gives focus here. Does nothing for an inactive input. */\n\tfocus(): void;\n\t/** Removes focus. Does nothing if focus is already elsewhere. */\n\tblur(): void;\n}",
			"summary": "Controls the focus of one text input.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "RuntimeTextStyle",
			"kind": "interface",
			"signature": "interface RuntimeTextStyle {\n\tcolor?: RuntimeColor;\n\tfontSize?: number;\n\tfontWeight?: \"regular\" | \"medium\" | \"bold\";\n\talign?: \"start\" | \"center\" | \"end\";\n\tlines?: number;\n\topacity?: number;\n}",
			"summary": "The text style does not inherit the box style.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeTransition",
			"kind": "interface",
			"signature": "interface RuntimeTransition {\n\t/**\n\t * Duration in milliseconds; absent means 200. `0` means no transition, and the host assigns the\n\t * value immediately. Negative, NaN, and Infinity are rejected rather than silently clamped, the\n\t * same decision `volume` makes.\n\t */\n\tduration?: number;\n\teasing?: RuntimeEasing;\n}",
			"summary": "How a node's value changes when it changes.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "RuntimeTransitionable",
			"kind": "interface",
			"signature": "interface RuntimeTransitionable {\n\t/**\n\t * No transition means the value changes immediately. The first render never animates: having the\n\t * prop does not make entry an animation, since entering and leaving are not part of this design\n\t * yet. Motion happens only when the value of an already-rendered node changes.\n\t */\n\ttransition?: RuntimeTransition;\n}",
			"summary": "The shared axis for props that control how a value changes.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "STORY_STATE_VERSION_MAX",
			"kind": "constant",
			"signature": "declare const STORY_STATE_VERSION_MAX = DURABLE_STATE_VERSION_MAX;",
			"summary": "",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "Screen",
			"kind": "component",
			"signature": "declare const Screen: RuntimeHostComponent<ScreenProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "ScreenProps",
			"kind": "interface",
			"signature": "interface ScreenProps extends RuntimeChildren {\n\t/** Background of the whole screen. It extends beyond the safe area. */\n\tbackground?: RuntimeColor;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "ScrollView",
			"kind": "component",
			"signature": "declare const ScrollView: RuntimeHostComponent<ScrollViewProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "ScrollViewProps",
			"kind": "interface",
			"signature": "interface ScrollViewProps\n\textends RuntimeChildren,\n\t\tRuntimeTransitionable {\n\tstyle?: RuntimeStyle;\n\thorizontal?: boolean;\n\t/**\n\t * Handle that moves this scroll. Must come from `useScrollController()`.\n\t *\n\t * Neither a DOM element nor an RN ref belongs here. The value is an opaque controller issued by\n\t * the host, and its internal integer cannot be named by the author (see the control.ts header). A\n\t * controller binds to one live node at a time. Passing the same controller to two nodes rejects\n\t * that render with `runtime_host_control_already_bound`.\n\t */\n\tcontroller?: RuntimeScrollController;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "Serializable",
			"kind": "type",
			"signature": "type Serializable =\n\t| null\n\t| boolean\n\t| number\n\t| string\n\t| readonly Serializable[]\n\t| { readonly [key: string]: Serializable };",
			"summary": "Canonical vocabulary and predicates for serializable values, shared by state.ts and internal/story-state.ts.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "SerializableShape",
			"kind": "type",
			"signature": "type SerializableShape<T> = T extends null | boolean | number | string\n\t? T\n\t: T extends readonly (infer U)[]\n\t\t? readonly SerializableShape<U>[]\n\t\t: T extends (...args: never[]) => unknown\n\t\t\t? never\n\t\t\t: T extends object\n\t\t\t\t? { readonly [K in keyof T]: SerializableShape<T[K]> }\n\t\t\t\t: never;",
			"summary": "Whether a type is serializable, while still accepting interfaces.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "Stack",
			"kind": "component",
			"signature": "declare const Stack: RuntimeHostComponent<StackProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "StackProps",
			"kind": "interface",
			"signature": "interface StackProps extends RuntimeChildren, RuntimeTransitionable {\n\tgap?: number;\n\tstyle?: RuntimeStyle;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "StoryStateDefinition",
			"kind": "interface",
			"signature": "interface StoryStateDefinition<T> {\n\t/**\n\t * Brand of this lifetime. The type-level brand is what keeps it distinct from persistent\n\t * definitions.\n\t */\n\treadonly [RUNTIME_STORY_STATE]: true;\n\treadonly key: string;\n\treadonly version: number;\n\treadonly initial: T;\n\treadonly migrate: StoryStateMigration<T> | null;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "StoryStateInput",
			"kind": "type",
			"signature": "type StoryStateInput<T> = DurableStateInput<T>;",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "StoryStateInputChecked",
			"kind": "type",
			"signature": "type StoryStateInputChecked<T> = DurableStateInputChecked<T>;",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "StoryStateMigration",
			"kind": "type",
			"signature": "type StoryStateMigration<T> = DurableStateMigration<T>;",
			"summary": "- Playthrough state is the first lifetime of the save-state core.",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "Text",
			"kind": "component",
			"signature": "declare const Text: RuntimeHostComponent<TextProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "TextArea",
			"kind": "component",
			"signature": "declare const TextArea: RuntimeHostComponent<TextAreaProps>;",
			"summary": "Multi-line text input.",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "TextAreaProps",
			"kind": "interface",
			"signature": "interface TextAreaProps extends RuntimeTextEntry {}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "TextInput",
			"kind": "component",
			"signature": "declare const TextInput: RuntimeHostComponent<TextInputProps>;",
			"summary": "Single-line text input.",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "TextInputProps",
			"kind": "interface",
			"signature": "interface TextInputProps extends RuntimeTextEntry {\n\t/**\n\t * Confirmed in a single-line input (Enter on web, Done on native). It is not called during IME\n\t * composition: Korean, Japanese and Chinese input use Enter to confirm characters before\n\t * composition ends, and treating that as a submit would send the in-progress text. The platform\n\t * adapter makes that judgment; this contract only states the result.\n\t */\n\tonSubmit?: () => void | Promise<void>;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "TextProps",
			"kind": "interface",
			"signature": "interface TextProps extends RuntimeChildren {\n\tstyle?: RuntimeTextStyle;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "View",
			"kind": "component",
			"signature": "declare const View: RuntimeHostComponent<ViewProps>;",
			"summary": "",
			"doc": "reference/components",
			"url": "/docs/runtime/reference/components"
		},
		{
			"name": "ViewProps",
			"kind": "interface",
			"signature": "interface ViewProps extends RuntimeChildren, RuntimeTransitionable {\n\tstyle?: RuntimeStyle;\n}",
			"summary": "",
			"doc": "reference/types",
			"url": "/docs/runtime/reference/types"
		},
		{
			"name": "asset",
			"kind": "function",
			"signature": "function asset(value: string): AssetRef;",
			"summary": "Seals a string as an asset reference.",
			"doc": "reference/assets",
			"url": "/docs/runtime/reference/assets"
		},
		{
			"name": "color",
			"kind": "function",
			"signature": "function color<S extends string>(\n\tvalue: S & ValidHexColor<S>,\n): RuntimeColor;",
			"summary": "Seals a color literal.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "definePersistentState",
			"kind": "function",
			"signature": "function definePersistentState<T>(\n\tdefinition: PersistentStateInputChecked<T>,\n): PersistentStateDefinition<T>;",
			"summary": "Declares one persistent value.",
			"doc": "reference/state",
			"url": "/docs/runtime/reference/state"
		},
		{
			"name": "defineStoryState",
			"kind": "function",
			"signature": "function defineStoryState<T>(\n\tdefinition: StoryStateInputChecked<T>,\n): StoryStateDefinition<T>;",
			"summary": "Declares one story-state value, once, at module top level.",
			"doc": "reference/state",
			"url": "/docs/runtime/reference/state"
		},
		{
			"name": "isPersistentStateDefinition",
			"kind": "function",
			"signature": "function isPersistentStateDefinition(\n\tvalue: unknown,\n): value is PersistentStateDefinition<unknown>;",
			"summary": "Whether a value is a persistent-state definition.",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "isRuntimeColor",
			"kind": "function",
			"signature": "function isRuntimeColor(value: string): value is RuntimeColor;",
			"summary": "Checks the value at runtime, not the type, for strings that never came from a literal.",
			"doc": "reference/styling",
			"url": "/docs/runtime/reference/styling"
		},
		{
			"name": "isRuntimeElement",
			"kind": "function",
			"signature": "function isRuntimeElement(value: unknown): value is RuntimeElement;",
			"summary": "Whether a value is a runtime element.",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "isRuntimeHostComponent",
			"kind": "function",
			"signature": "function isRuntimeHostComponent(\n\tvalue: unknown,\n): value is RuntimeHostComponent<unknown>;",
			"summary": "Whether a value is a host primitive.",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "isSerializable",
			"kind": "function",
			"signature": "function isSerializable(value: unknown): value is Serializable;",
			"summary": "Checks a value for serializability.",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "isStoryStateDefinition",
			"kind": "function",
			"signature": "function isStoryStateDefinition(\n\tvalue: unknown,\n): value is StoryStateDefinition<unknown>;",
			"summary": "Whether a value is a story-state definition.",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "runtimeHostKindOf",
			"kind": "function",
			"signature": "function runtimeHostKindOf(value: unknown): RuntimeHostKind | null;",
			"summary": "",
			"doc": "reference/advanced",
			"url": "/docs/runtime/reference/advanced"
		},
		{
			"name": "useCallback",
			"kind": "hook",
			"signature": "function useCallback<T extends (...args: never[]) => unknown>(\n\tcallback: T,\n\tdeps?: readonly unknown[],\n): T;",
			"summary": "Same function while the dependencies are unchanged.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useEffect",
			"kind": "hook",
			"signature": "function useEffect(\n\t// biome-ignore lint/suspicious/noConfusingVoidType: the effect gives back a cleanup function or nothing; only this type expresses both.\n\teffect: () => void | RuntimeCleanup,\n\tdeps?: readonly unknown[],\n): void;",
			"summary": "Runs after the render.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useGeneration",
			"kind": "hook",
			"signature": "function useGeneration(): RuntimeGeneration;",
			"summary": "The generation capability this runtime can call.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useMemo",
			"kind": "hook",
			"signature": "function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;",
			"summary": "Same value while the dependencies are unchanged.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "usePersistentState",
			"kind": "hook",
			"signature": "function usePersistentState<T>(\n\tdefinition: PersistentStateDefinition<T>,\n): [T, RuntimeSetState<T>];",
			"summary": "A value remembered across a member's long progress through a work.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useReducer",
			"kind": "hook",
			"signature": "function useReducer<S, A>(\n\treducer: (state: S, action: A) => S,\n\tinitial: S,\n): [S, (action: A) => void];",
			"summary": "",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useRef",
			"kind": "hook",
			"signature": "function useRef<T>(initial: T): RuntimeRef<T>;",
			"summary": "A slot that survives renders.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useScrollController",
			"kind": "hook",
			"signature": "function useScrollController(): RuntimeScrollController;",
			"summary": "Handle for controlling this screen's one scroll view.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useState",
			"kind": "hook",
			"signature": "function useState<S>(initial: S | (() => S)): [S, RuntimeSetState<S>];",
			"summary": "A value the component remembers.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useStoryState",
			"kind": "hook",
			"signature": "function useStoryState<T>(\n\tdefinition: StoryStateDefinition<T>,\n): [T, RuntimeSetState<T>];",
			"summary": "The value this playthrough remembers.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		},
		{
			"name": "useTextEntryController",
			"kind": "hook",
			"signature": "function useTextEntryController(): RuntimeTextEntryController;",
			"summary": "Handle for controlling focus of this screen's one text input.",
			"doc": "reference/hooks",
			"url": "/docs/runtime/reference/hooks"
		}
	],
	"undocumented": [],
	"examples": [
		{
			"id": "audio",
			"doc": "reference/components",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import { Audio, Button, Stack, asset, useState } from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst [playing, setPlaying] = useState(false);\n\n\treturn (\n\t\t<Stack>\n\t\t\t<Audio\n\t\t\t\tsource={asset(\"audio/bgm/main\")}\n\t\t\t\tplaying={playing}\n\t\t\t\tloop\n\t\t\t\tvolume={0.5}\n\t\t\t/>\n\n\t\t\t<Button onPress={() => setPlaying((value) => !value)}>\n\t\t\t\t{playing ? \"음악 끄기\" : \"음악 켜기\"}\n\t\t\t</Button>\n\t\t</Stack>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "generation",
			"doc": "concepts/generation",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import {\n\tButton,\n\tRow,\n\tScreen,\n\tScrollView,\n\tStack,\n\tText,\n\tTextInput,\n\tcolor,\n\tdefineStoryState,\n\tuseGeneration,\n\tuseState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\ninterface Line {\n\trole: \"user\" | \"assistant\";\n\tcontent: string;\n}\n\nconst chat = defineStoryState({\n\tkey: \"chat\",\n\tversion: 1,\n\tinitial: { lines: [] as Line[] },\n});\n\nconst SENA =\n\t\"당신은 세나입니다. 도서부 사서 보조 학생이고, 메신저로 대화하듯 한국어로 한두 문장만 답합니다.\";\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(chat);\n\tconst [draft, setDraft] = useState(\"\");\n\tconst [pending, setPending] = useState(false);\n\tconst [failure, setFailure] = useState<string | null>(null);\n\tconst generation = useGeneration();\n\n\tasync function reply(lines: Line[]) {\n\t\tsetPending(true);\n\t\tsetFailure(null);\n\t\ttry {\n\t\t\tconst result = await generation.generate({\n\t\t\t\tinstructions: SENA,\n\t\t\t\tmessages: lines.slice(-10),\n\t\t\t\tmaxOutputCharacters: 600,\n\t\t\t});\n\t\t\tsetState((current) => ({\n\t\t\t\tlines: [...current.lines, { role: \"assistant\", content: result.text }],\n\t\t\t}));\n\t\t} catch {\n\t\t\tsetFailure(\"답장을 받지 못했습니다. 다시 시도해 주세요.\");\n\t\t} finally {\n\t\t\tsetPending(false);\n\t\t}\n\t}\n\n\tfunction send() {\n\t\tconst text = draft.trim();\n\t\tif (text.length === 0 || pending) return;\n\t\tconst lines: Line[] = [...state.lines, { role: \"user\", content: text }];\n\t\tsetDraft(\"\");\n\t\tsetState({ lines });\n\t\tvoid reply(lines);\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack style={{ height: \"100%\", padding: 16, gap: 8 }}>\n\t\t\t\t<ScrollView style={{ grow: 1 }}>\n\t\t\t\t\t<Stack gap={6}>\n\t\t\t\t\t\t{state.lines.map((line, index) => (\n\t\t\t\t\t\t\t<Text\n\t\t\t\t\t\t\t\tkey={index}\n\t\t\t\t\t\t\t\tstyle={{\n\t\t\t\t\t\t\t\t\talign: line.role === \"user\" ? \"end\" : \"start\",\n\t\t\t\t\t\t\t\t\tcolor: line.role === \"user\" ? color(\"#7dd3fc\") : color(\"#f5f7fa\"),\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t{line.content}\n\t\t\t\t\t\t\t</Text>\n\t\t\t\t\t\t))}\n\t\t\t\t\t</Stack>\n\t\t\t\t</ScrollView>\n\t\t\t\t{failure !== null && (\n\t\t\t\t\t<Row gap={8}>\n\t\t\t\t\t\t<Text style={{ color: color(\"#fca5a5\") }}>{failure}</Text>\n\t\t\t\t\t\t<Button tone=\"secondary\" onPress={() => reply(state.lines)}>\n\t\t\t\t\t\t\t다시 시도\n\t\t\t\t\t\t</Button>\n\t\t\t\t\t</Row>\n\t\t\t\t)}\n\t\t\t\t<Row gap={8}>\n\t\t\t\t\t<TextInput\n\t\t\t\t\t\tvalue={draft}\n\t\t\t\t\t\tplaceholder={pending ? \"세나가 입력 중…\" : \"메시지\"}\n\t\t\t\t\t\tdisabled={pending}\n\t\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\t\tonSubmit={send}\n\t\t\t\t\t\tstyle={{ grow: 1 }}\n\t\t\t\t\t/>\n\t\t\t\t\t<Button onPress={send} disabled={pending || draft.trim().length === 0}>\n\t\t\t\t\t\t보내기\n\t\t\t\t\t</Button>\n\t\t\t\t</Row>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "managed-image",
			"doc": "concepts/assets",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import { Image, Stack, Text, asset } from \"@rowcat/runtime\";\n\nexport default function App() {\n\treturn (\n\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t<Image\n\t\t\t\tsource={asset(\"characters/sena/smile\")}\n\t\t\t\talt=\"세나\"\n\t\t\t\tfit=\"cover\"\n\t\t\t\tstyle={{ width: 96, height: 96, borderRadius: 48 }}\n\t\t\t/>\n\t\t\t<Text>세나가 카운터 뒤에서 고개를 들었다.</Text>\n\t\t</Stack>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "migration",
			"doc": "concepts/state",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import { Screen, Text, useStoryState } from \"@rowcat/runtime\";\nimport { progress } from \"./state\";\n\nexport default function App() {\n\tconst [state] = useStoryState(progress);\n\treturn (\n\t\t<Screen>\n\t\t\t<Text>{state.chapter}장</Text>\n\t\t</Screen>\n\t);\n}\n"
				},
				{
					"path": "src/state.ts",
					"content": "import { defineStoryState } from \"@rowcat/runtime\";\n\ninterface ProgressV2 {\n\tchapter: number;\n\tclues: string[];\n}\n\nexport const progress = defineStoryState({\n\tkey: \"progress\",\n\tversion: 2,\n\tinitial: { chapter: 1, clues: [] } as ProgressV2,\n\tmigrate: (stored, fromVersion): ProgressV2 => {\n\t\tif (fromVersion === 1) {\n\t\t\t// 1판에는 clues가 없었다\n\t\t\tconst old = stored as { chapter: number };\n\t\t\treturn { chapter: old.chapter, clues: [] };\n\t\t}\n\t\tthrow new Error(`알 수 없는 판: ${fromVersion}`);\n\t},\n});\n"
				}
			]
		},
		{
			"id": "multi-file",
			"doc": "project-structure",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/components/CharacterCard.tsx",
					"content": "import { Row, Stack, Text } from \"@rowcat/runtime\";\nimport type { Character } from \"../game\";\n\nexport function CharacterCard({ character }: { character: Character }) {\n\treturn (\n\t\t<Stack gap={4} style={{ padding: 12, borderRadius: 8 }}>\n\t\t\t<Text style={{ fontWeight: \"bold\" }}>{character.name}</Text>\n\t\t\t<Row gap={8}>\n\t\t\t\t<Text>신뢰</Text>\n\t\t\t\t<Text>{character.trust}</Text>\n\t\t\t</Row>\n\t\t</Stack>\n\t);\n}\n"
				},
				{
					"path": "src/game.ts",
					"content": "import { defineStoryState } from \"@rowcat/runtime\";\n\nexport interface Character {\n\tname: string;\n\ttrust: number;\n}\n\nexport const party = defineStoryState({\n\tkey: \"party\",\n\tversion: 1,\n\tinitial: {\n\t\tmembers: [\n\t\t\t{ name: \"세나\", trust: 40 },\n\t\t\t{ name: \"민재\", trust: 10 },\n\t\t] as Character[],\n\t},\n});\n\n/** 신뢰는 0~100 사이에서만 움직인다 — 규칙은 화면이 아니라 여기 있다. */\nexport function adjustTrust(character: Character, delta: number): Character {\n\treturn {\n\t\t...character,\n\t\ttrust: Math.max(0, Math.min(100, character.trust + delta)),\n\t};\n}\n"
				},
				{
					"path": "src/main.tsx",
					"content": "import { Button, Screen, Stack, useStoryState } from \"@rowcat/runtime\";\nimport { CharacterCard } from \"./components/CharacterCard\";\nimport { adjustTrust, party } from \"./game\";\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(party);\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t\t{state.members.map((member) => (\n\t\t\t\t\t<CharacterCard key={member.name} character={member} />\n\t\t\t\t))}\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\tmembers: current.members.map((member) =>\n\t\t\t\t\t\t\t\tmember.name === \"세나\" ? adjustTrust(member, 5) : member,\n\t\t\t\t\t\t\t),\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t세나와 이야기하기\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "persistent-state",
			"doc": "concepts/state",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tdefinePersistentState,\n\tdefineStoryState,\n\tusePersistentState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst run = defineStoryState({\n\tkey: \"run\",\n\tversion: 1,\n\tinitial: { scene: \"intro\" as \"intro\" | \"ending\" },\n});\n\nconst record = definePersistentState({\n\tkey: \"record\",\n\tversion: 1,\n\tinitial: { endings: [] as string[], runs: 0 },\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(run);\n\tconst [meta, setMeta] = usePersistentState(record);\n\n\tfunction finish(ending: string) {\n\t\tsetState({ scene: \"ending\" });\n\t\tsetMeta((current) => ({\n\t\t\truns: current.runs + 1,\n\t\t\tendings: current.endings.includes(ending)\n\t\t\t\t? current.endings\n\t\t\t\t: [...current.endings, ending],\n\t\t}));\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<Text>본 엔딩 {meta.endings.length}개 · {meta.runs}회차</Text>\n\t\t\t\t{state.scene === \"intro\" ? (\n\t\t\t\t\t<Button onPress={() => finish(\"새벽\")}>새벽 엔딩으로</Button>\n\t\t\t\t) : (\n\t\t\t\t\t<Text>끝. 플레이 초기화로 새 회차를 시작하세요.</Text>\n\t\t\t\t)}\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "quick-start",
			"doc": "quick-start",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tcolor,\n\tdefineStoryState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst game = defineStoryState({\n\tkey: \"game\",\n\tversion: 1,\n\tinitial: {\n\t\tchapter: 1,\n\t},\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(game);\n\n\treturn (\n\t\t<Screen background={color(\"#0b0d12\")}>\n\t\t\t<Stack gap={12} style={{ padding: 24 }}>\n\t\t\t\t<Text style={{ color: color(\"#f5f7fa\"), fontSize: 22, fontWeight: \"bold\" }}>\n\t\t\t\t\t{state.chapter}장\n\t\t\t\t</Text>\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\tchapter: current.chapter + 1,\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t계속\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "remote-image",
			"doc": "concepts/assets",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import { Image, Stack, Text, asset } from \"@rowcat/runtime\";\n\nexport default function App() {\n\treturn (\n\t\t<Stack gap={12} style={{ padding: 16 }}>\n\t\t\t<Image\n\t\t\t\tsource={asset(\"https://cdn.example.com/characters/sena.webp\")}\n\t\t\t\talt=\"세나\"\n\t\t\t\tfit=\"cover\"\n\t\t\t\tstyle={{ width: 96, height: 96, borderRadius: 48 }}\n\t\t\t/>\n\t\t\t<Text>세나가 카운터 뒤에서 고개를 들었다.</Text>\n\t\t</Stack>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "scroll-and-focus",
			"doc": "concepts/scroll-and-focus",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import {\n\tButton,\n\tScreen,\n\tScrollView,\n\tStack,\n\tText,\n\tTextInput,\n\tuseScrollController,\n\tuseState,\n\tuseTextEntryController,\n} from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst scroll = useScrollController();\n\tconst reply = useTextEntryController();\n\tconst [lines, setLines] = useState<string[]>([]);\n\tconst [draft, setDraft] = useState(\"\");\n\n\tfunction send() {\n\t\tif (draft.length === 0) return;\n\t\tsetLines((current) => [...current, draft]);\n\t\tsetDraft(\"\");\n\t\tscroll.scrollToEnd();\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<ScrollView controller={scroll} style={{ grow: 1 }}>\n\t\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t\t{lines.map((line, index) => (\n\t\t\t\t\t\t<Text key={`${index}-${line}`}>{line}</Text>\n\t\t\t\t\t))}\n\t\t\t\t</Stack>\n\t\t\t</ScrollView>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<TextInput\n\t\t\t\t\tcontroller={reply}\n\t\t\t\t\tvalue={draft}\n\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\tonSubmit={send}\n\t\t\t\t\tplaceholder=\"메시지\"\n\t\t\t\t/>\n\t\t\t\t<Button onPress={() => reply.focus()}>답장하기</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "story-state",
			"doc": "concepts/state",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import {\n\tButton,\n\tScreen,\n\tStack,\n\tText,\n\tdefineStoryState,\n\tuseStoryState,\n} from \"@rowcat/runtime\";\n\nconst progress = defineStoryState({\n\tkey: \"progress\",\n\tversion: 1,\n\tinitial: {\n\t\tchapter: 1,\n\t\ttrust: 40,\n\t\tclues: [] as string[],\n\t},\n});\n\nexport default function App() {\n\tconst [state, setState] = useStoryState(progress);\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t<Text>{state.chapter}장 · 신뢰 {state.trust}</Text>\n\t\t\t\t<Text>단서 {state.clues.length}개</Text>\n\t\t\t\t<Button\n\t\t\t\t\tonPress={() =>\n\t\t\t\t\t\tsetState((current) => ({\n\t\t\t\t\t\t\t...current,\n\t\t\t\t\t\t\ttrust: Math.min(100, current.trust + 5),\n\t\t\t\t\t\t\tclues: current.clues.includes(\"열쇠\")\n\t\t\t\t\t\t\t\t? current.clues\n\t\t\t\t\t\t\t\t: [...current.clues, \"열쇠\"],\n\t\t\t\t\t\t}))\n\t\t\t\t\t}\n\t\t\t\t>\n\t\t\t\t\t서랍을 열어 본다\n\t\t\t\t</Button>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n"
				}
			]
		},
		{
			"id": "text-input",
			"doc": "concepts/events",
			"entry": "src/main.tsx",
			"files": [
				{
					"path": "src/main.tsx",
					"content": "import {\n\tButton,\n\tRow,\n\tScreen,\n\tStack,\n\tText,\n\tTextInput,\n\tuseState,\n} from \"@rowcat/runtime\";\n\nexport default function App() {\n\tconst [draft, setDraft] = useState(\"\");\n\tconst [sent, setSent] = useState<string[]>([]);\n\n\tfunction send() {\n\t\tconst text = draft.trim();\n\t\tif (text.length === 0) return;\n\t\tsetSent((current) => [...current, text]);\n\t\tsetDraft(\"\");\n\t}\n\n\treturn (\n\t\t<Screen>\n\t\t\t<Stack gap={8} style={{ padding: 16 }}>\n\t\t\t\t{sent.map((line, index) => (\n\t\t\t\t\t<Text key={index}>{line}</Text>\n\t\t\t\t))}\n\t\t\t\t<Row gap={8}>\n\t\t\t\t\t<TextInput\n\t\t\t\t\t\tvalue={draft}\n\t\t\t\t\t\tplaceholder=\"할 말을 적으세요\"\n\t\t\t\t\t\tonChangeText={setDraft}\n\t\t\t\t\t\tonSubmit={send}\n\t\t\t\t\t\tstyle={{ grow: 1 }}\n\t\t\t\t\t/>\n\t\t\t\t\t<Button onPress={send} disabled={draft.trim().length === 0}>\n\t\t\t\t\t\t보내기\n\t\t\t\t\t</Button>\n\t\t\t\t</Row>\n\t\t\t</Stack>\n\t\t</Screen>\n\t);\n}\n"
				}
			]
		}
	]
};
