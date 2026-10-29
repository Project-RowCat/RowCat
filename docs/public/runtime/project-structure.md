---
title: 프로젝트 구조
description: 진입 파일, 파일을 나누는 방법, 가져올 수 있는 것과 없는 것.
group: getting-started
order: 3
---

# 프로젝트 구조

런타임 프로젝트는 `.ts`·`.tsx` 파일들의 묶음입니다. 폴더는 자유롭게 만들 수 있고, 파일 사이는
평범한 `import`로 잇습니다.

## 진입 파일

`src/main.tsx`가 진입 파일입니다. 이 파일은 **기본 내보내기로 컴포넌트 하나**를 내놓아야 하고,
그 컴포넌트가 작품의 첫 화면입니다.

```tsx
export default function App() {
	return <Text>안녕하세요</Text>;
}
```

컴포넌트는 인자를 받지 않고 동기적으로 화면을 돌려줍니다. `async function App()`은 거절됩니다.

## 파일 나누기

프로젝트가 자라면 화면·규칙·데이터를 파일로 나눕니다. 아래 셋은 실제로 컴파일되는 예제입니다.

```text
src/
├── main.tsx              진입 파일
├── components/
│   └── CharacterCard.tsx 재사용하는 화면 조각
└── game.ts               상태 정의와 규칙
```

```ts example=multi-file file=src/game.ts
import { defineStoryState } from "@rowcat/runtime";

export interface Character {
	name: string;
	trust: number;
}

export const party = defineStoryState({
	key: "party",
	version: 1,
	initial: {
		members: [
			{ name: "세나", trust: 40 },
			{ name: "민재", trust: 10 },
		] as Character[],
	},
});

/** 신뢰는 0~100 사이에서만 움직인다 — 규칙은 화면이 아니라 여기 있다. */
export function adjustTrust(character: Character, delta: number): Character {
	return {
		...character,
		trust: Math.max(0, Math.min(100, character.trust + delta)),
	};
}
```

```tsx example=multi-file file=src/components/CharacterCard.tsx
import { Row, Stack, Text } from "@rowcat/runtime";
import type { Character } from "../game";

export function CharacterCard({ character }: { character: Character }) {
	return (
		<Stack gap={4} style={{ padding: 12, borderRadius: 8 }}>
			<Text style={{ fontWeight: "bold" }}>{character.name}</Text>
			<Row gap={8}>
				<Text>신뢰</Text>
				<Text>{character.trust}</Text>
			</Row>
		</Stack>
	);
}
```

```tsx example=multi-file file=src/main.tsx
import { Button, Screen, Stack, useStoryState } from "@rowcat/runtime";
import { CharacterCard } from "./components/CharacterCard";
import { adjustTrust, party } from "./game";

export default function App() {
	const [state, setState] = useStoryState(party);

	return (
		<Screen>
			<Stack gap={12} style={{ padding: 16 }}>
				{state.members.map((member) => (
					<CharacterCard key={member.name} character={member} />
				))}
				<Button
					onPress={() =>
						setState((current) => ({
							members: current.members.map((member) =>
								member.name === "세나" ? adjustTrust(member, 5) : member,
							),
						}))
					}
				>
					세나와 이야기하기
				</Button>
			</Stack>
		</Screen>
	);
}
```

### 상대 경로에 확장자를 적지 않습니다

`"./game"`이지 `"./game.ts"`가 아닙니다. 런타임은 `./game`을 만나면 다음 순서로 찾습니다.

```text
./game.ts  →  ./game.tsx  →  ./game/index.ts  →  ./game/index.tsx
```

`"./game.ts"`라고 적으면 `game.ts.ts`를 찾다가 실패합니다.

### 폴더 밖으로 나갈 수 없습니다

`"../../something"`처럼 프로젝트 뿌리 위로 올라가는 경로는 거절됩니다. 프로젝트의 파일은
전부 뿌리 아래에 있습니다.

## 가져올 수 있는 것

| 지정자 | 되는가 |
| --- | --- |
| `@rowcat/runtime` | **됩니다.** 화면 부품·훅·상태·AI 생성이 전부 여기서 옵니다 |
| `./…` · `../…` (프로젝트 안) | **됩니다.** 위의 규칙대로 찾습니다 |
| `react` · `react-native` · `react-dom` | 안 됩니다 — [React를 닮았지만 React가 아닙니다](/docs/runtime/concepts/components) |
| 그 밖의 npm 패키지 | 안 됩니다 — 설치할 곳이 없습니다 |
| `node:fs` 같은 Node 모듈 | 안 됩니다 |
| `import()` 동적 가져오기 | 안 됩니다 — 모든 모듈은 컴파일 시점에 정해집니다 |

자세한 근거는 [지원하는 import](/docs/runtime/runtime-model/supported-imports)에 있습니다.

## 한도

| 항목 | 한도 |
| --- | --- |
| 파일 수 | 200개 |
| 파일 하나의 길이 | 200,000자 |
| 경로 길이 | 200자 |
| 이름 하나(폴더·파일)의 길이 | 64자 |
| 폴더 깊이 | 7단계 |

경로에 쓸 수 있는 글자는 영문·숫자와 `.`·`_`·`-`입니다.
