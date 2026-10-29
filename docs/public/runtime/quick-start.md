---
title: 빠른 시작
description: 런타임을 켜고 첫 화면을 만들어 미리보기까지 확인하는 가장 짧은 길입니다.
group: getting-started
order: 2
---

# 빠른 시작

이 페이지를 끝내면 **누르면 장이 넘어가는 화면** 하나가 미리보기에서 돌고 있을 것입니다.
TypeScript를 읽을 수 있으면 충분합니다.

## 1. 런타임 켜기

작품 초안을 열고 편집기에서 **커스텀 인터랙티브 경험 만들기** 구획을 찾습니다. 시작 버튼을
누르면 템플릿 갤러리가 열립니다 — 처음이라면 **Blank**를 고르세요. 파일 하나(`src/main.tsx`)
로 시작하는 가장 작은 프로젝트입니다.

런타임을 켜도 지금 쓰고 있는 프롬프트·로어·시작 장면은 그대로 남습니다. 켜는 일은 되돌릴
수 있고, 끄는 일도 파일을 지우지 않습니다.

## 2. 스튜디오 둘러보기

런타임 스튜디오는 세 칸입니다.

```text
파일          프로젝트의 파일 목록
코드          지금 고치고 있는 파일 — 자동완성과 타입 검사가 붙어 있습니다
미리보기       실행 버튼을 누르면 이 자리에서 실제로 돕니다
```

머리말의 검사 상태(`이상 없음` · `문제 N개`)를 누르면 바닥 패널의 `Problems`가 열립니다.
저장은 자동입니다.

## 3. 첫 화면 쓰기

`src/main.tsx`의 내용을 아래로 바꿉니다.

```tsx example=quick-start file=src/main.tsx
import {
	Button,
	Screen,
	Stack,
	Text,
	color,
	defineStoryState,
	useStoryState,
} from "@rowcat/runtime";

const game = defineStoryState({
	key: "game",
	version: 1,
	initial: {
		chapter: 1,
	},
});

export default function App() {
	const [state, setState] = useStoryState(game);

	return (
		<Screen background={color("#0b0d12")}>
			<Stack gap={12} style={{ padding: 24 }}>
				<Text style={{ color: color("#f5f7fa"), fontSize: 22, fontWeight: "bold" }}>
					{state.chapter}장
				</Text>
				<Button
					onPress={() =>
						setState((current) => ({
							chapter: current.chapter + 1,
						}))
					}
				>
					계속
				</Button>
			</Stack>
		</Screen>
	);
}
```

줄마다 무엇을 하는지 보겠습니다.

- **`import ... from "@rowcat/runtime"`** — 런타임 코드가 가져올 수 있는 이름은 전부 이
  패키지에서 옵니다. `react`도 `react-native`도 없습니다.
- **`defineStoryState`** — 이 플레이스루 동안 저장되는 상태 하나를 **모듈 최상단에서**
  선언합니다. `key`는 저장의 이름, `version`은 모양의 판, `initial`은 처음 값입니다.
- **`export default function App()`** — 진입 파일이 기본 내보내기로 내놓는 컴포넌트가
  작품의 첫 화면입니다.
- **`useStoryState(game)`** — 선언해 둔 상태를 읽고 바꿉니다. 돌려주는 모양은
  `[값, 설정 함수]`입니다.
- **`<Screen>` · `<Stack>` · `<Text>` · `<Button>`** — 런타임이 그리는 부품입니다. HTML
  태그(`<div>`)는 쓸 수 없습니다.
- **`onPress`** — 누름 하나. 인자가 없고, 이벤트 객체도 없습니다.

## 4. 미리보기로 돌리기

미리보기 칸의 **미리보기 실행**을 누릅니다. `1장`과 `계속` 버튼이 보이고, 누를 때마다 수가
오릅니다.

코드를 고치면 미리보기는 **저절로 다시 돌지 않습니다.** `변경사항 있음`이 뜨고 **다시 시작**이
그 코드를 새로 돌립니다. 다시 시작해도 `chapter`는 이어집니다 — 그것이 저장 상태이기
때문입니다. 처음으로 되돌리려면 **플레이 초기화**를 누릅니다.

## 5. 발행하기

스튜디오를 나와 초안 편집기에서 평소처럼 **발행**합니다. 발행된 작품의 상세 화면에는
`대화 시작` 대신 **플레이**가 서고, 그 버튼이 당신의 런타임을 엽니다. 플레이어의 진행은 그
사람의 계정에 저장되어 기기 사이를 건너갑니다.

## 다음

- [프로젝트 구조](/docs/runtime/project-structure) — 파일을 나누고 서로 가져오는 방법.
- [상태](/docs/runtime/concepts/state) — `useState`·`useStoryState`·`usePersistentState`가
  각각 얼마나 오래 사는가.
- [AI 생성](/docs/runtime/concepts/generation) — 플레이어의 입력에 인물이 답하게 하기.
