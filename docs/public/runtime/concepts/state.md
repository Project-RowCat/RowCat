---
title: 상태
description: 화면의 상태, 플레이스루의 상태, 회차를 넘는 상태 — 셋의 수명이 다르고 쓰는 훅이 다릅니다.
group: concepts
order: 4
---

# 상태

런타임에는 **상태의 수명이 셋** 있습니다. 어느 훅을 쓰는가가 곧 그 값이 얼마나 오래 사는가를
정합니다.

```text
useState             이 실행 동안만            다시 시작하면 사라진다
useStoryState        이 플레이스루 동안         다시 열어도 이어진다 · 플레이 초기화가 지운다
usePersistentState   이 플레이어 + 이 작품 동안  플레이 초기화를 넘어 남는다
```

값을 어느 수명에 둘지는 "**무엇이 이것을 지워도 되는가**"로 정합니다.

## 화면의 상태 — `useState` · `useReducer`

컴포넌트가 갖는 값입니다. 지금 열린 탭, 펼친 패널, 아직 보내지 않은 입력, 대기 중 표시 —
런타임이 다시 시작되면 처음으로 돌아가도 괜찮은 것들입니다.

```tsx
const [tab, setTab] = useState<"chat" | "profile">("chat");
const [draft, setDraft] = useState("");
const [pending, setPending] = useState(false);
```

`useState`는 초기값으로 함수도 받습니다(`useState(() => expensive())`). 그 함수는 첫 렌더에서만
돕니다. `useReducer`는 값이 여러 갈래로 바뀌는 화면의 어휘입니다 — 모양은 React와 같습니다.

**이 값은 저장되지 않습니다.** 작품의 진행을 `useState`에 두면 플레이어가 작품을 닫는 순간
사라집니다.

## 플레이스루의 상태 — `defineStoryState` · `useStoryState`

**이 플레이스루의 진행**입니다. 현재 장, 신뢰도, 인벤토리, 모은 단서, 내린 결정, 주고받은
대화 — 작품을 닫았다 열어도 이어져야 하는 것들입니다. 플레이어가 **플레이 초기화**를 누르면
비워집니다(새 게임).

정의는 **모듈 최상단에서 한 번**, 읽고 쓰는 것은 컴포넌트 안에서 훅으로 합니다.

```tsx example=story-state file=src/main.tsx
import {
	Button,
	Screen,
	Stack,
	Text,
	defineStoryState,
	useStoryState,
} from "@rowcat/runtime";

const progress = defineStoryState({
	key: "progress",
	version: 1,
	initial: {
		chapter: 1,
		trust: 40,
		clues: [] as string[],
	},
});

export default function App() {
	const [state, setState] = useStoryState(progress);

	return (
		<Screen>
			<Stack gap={8} style={{ padding: 16 }}>
				<Text>{state.chapter}장 · 신뢰 {state.trust}</Text>
				<Text>단서 {state.clues.length}개</Text>
				<Button
					onPress={() =>
						setState((current) => ({
							...current,
							trust: Math.min(100, current.trust + 5),
							clues: current.clues.includes("열쇠")
								? current.clues
								: [...current.clues, "열쇠"],
						}))
					}
				>
					서랍을 열어 본다
				</Button>
			</Stack>
		</Screen>
	);
}
```

- **`key`** — 저장의 이름. 영문으로 시작하고 영문·숫자·`_`·`-`만 씁니다(64자 이내). 같은
  `key`를 두 번 정의하면 오류입니다.
- **`version`** — 값의 **모양**의 판. 1 이상의 정수. 모양을 바꿀 때 올립니다(아래
  [마이그레이션](#마이그레이션)).
- **`initial`** — 처음 값. 저장된 것이 없을 때와 플레이 초기화 뒤에 이 값으로 시작합니다.

같은 정의를 여러 컴포넌트에서 읽으면 **같은 값**입니다. 한쪽에서 바꾸면 다른 쪽의 다음 렌더에
보입니다. 값을 부품 사이에 프롭으로 나를 필요가 없습니다 — 정의를 파일에 두고 필요한 곳에서
가져오면 됩니다.

### 값은 직렬화 가능해야 합니다

저장되는 값이므로 **JSON으로 적을 수 있는 것**만 담습니다: `null`·불리언·숫자·문자열·배열·
평범한 객체. 함수·`Date`·`Map`·`Set`·클래스 인스턴스·`NaN`·`undefined`·순환 참조는 안
됩니다. 타입 검사가 `initial`에서 이것을 잡고, 실행 중에는 저장 직전에 한 번 더 확인합니다.
날짜는 문자열이나 숫자로, 집합은 배열로 적습니다.

### 마이그레이션

플레이어의 기기에는 **옛 판으로 저장된 값**이 남아 있을 수 있습니다. 값의 모양을 바꿨다면
`version`을 올리고 `migrate`로 옛 값을 새 모양으로 옮깁니다.

```ts example=migration file=src/state.ts
import { defineStoryState } from "@rowcat/runtime";

interface ProgressV2 {
	chapter: number;
	clues: string[];
}

export const progress = defineStoryState({
	key: "progress",
	version: 2,
	initial: { chapter: 1, clues: [] } as ProgressV2,
	migrate: (stored, fromVersion): ProgressV2 => {
		if (fromVersion === 1) {
			// 1판에는 clues가 없었다
			const old = stored as { chapter: number };
			return { chapter: old.chapter, clues: [] };
		}
		throw new Error(`알 수 없는 판: ${fromVersion}`);
	},
});
```

```tsx example=migration file=src/main.tsx
import { Screen, Text, useStoryState } from "@rowcat/runtime";
import { progress } from "./state";

export default function App() {
	const [state] = useStoryState(progress);
	return (
		<Screen>
			<Text>{state.chapter}장</Text>
		</Screen>
	);
}
```

- `migrate(stored, fromVersion)`는 저장된 값과 그 판을 받아 **지금 모양**을 돌려줍니다.
  결정적이어야 합니다 — 같은 입력에 같은 결과.
- 마이그레이션이 던지면 런타임이 서지 않습니다. 조용히 초기값으로 떨어뜨리지 않습니다 —
  그러면 마이그레이션의 버그가 플레이어의 진행 삭제가 됩니다.
- `migrate`가 없는데 옛 판이 저장되어 있으면 역시 실패합니다. 모양을 바꾼 적이 있다면
  마이그레이션은 선택이 아닙니다.
- 저장된 판이 코드의 판보다 **높으면**(더 새 코드로 만든 저장을 옛 코드가 열려는 경우)
  실패합니다. 자동으로 낮추지 않습니다.

## 회차를 넘는 상태 — `definePersistentState` · `usePersistentState`

**이 플레이어와 이 작품 사이의 긴 진행**입니다. 본 엔딩 목록, 업적, 해금, 회차 수 — 새 게임을
시작해도 지워지면 안 되는 것들입니다. 플레이 초기화가 이 값을 건드리지 않습니다.

```tsx example=persistent-state file=src/main.tsx
import {
	Button,
	Screen,
	Stack,
	Text,
	definePersistentState,
	defineStoryState,
	usePersistentState,
	useStoryState,
} from "@rowcat/runtime";

const run = defineStoryState({
	key: "run",
	version: 1,
	initial: { scene: "intro" as "intro" | "ending" },
});

const record = definePersistentState({
	key: "record",
	version: 1,
	initial: { endings: [] as string[], runs: 0 },
});

export default function App() {
	const [state, setState] = useStoryState(run);
	const [meta, setMeta] = usePersistentState(record);

	function finish(ending: string) {
		setState({ scene: "ending" });
		setMeta((current) => ({
			runs: current.runs + 1,
			endings: current.endings.includes(ending)
				? current.endings
				: [...current.endings, ending],
		}));
	}

	return (
		<Screen>
			<Stack gap={8} style={{ padding: 16 }}>
				<Text>본 엔딩 {meta.endings.length}개 · {meta.runs}회차</Text>
				{state.scene === "intro" ? (
					<Button onPress={() => finish("새벽")}>새벽 엔딩으로</Button>
				) : (
					<Text>끝. 플레이 초기화로 새 회차를 시작하세요.</Text>
				)}
			</Stack>
		</Screen>
	);
}
```

규칙은 플레이스루 상태와 같습니다(`key`·`version`·`initial`·`migrate`·직렬화). 다른 것은
**수명뿐**입니다. `key`는 두 수명 사이에서 겹쳐도 됩니다 — 같은 `"progress"`를 양쪽에 두어도
충돌하지 않습니다.

두 정의는 **타입이 다릅니다.** `useStoryState(영구 정의)`도 `usePersistentState(플레이스루
정의)`도 컴파일에서 막힙니다. 그 실수의 증상이 몇 달치 진행이 사라지는 것이라, 실행 중이 아니라
타입에서 잡습니다.

## 갱신의 규칙

세 훅의 설정 함수는 모양이 같습니다. 새 값을 주거나, 지금 값을 받아 새 값을 돌려주는 함수를
줍니다.

```ts
setState({ chapter: 2 });
setState((current) => ({ ...current, chapter: current.chapter + 1 }));
```

- 함수형 갱신을 쓰면 그 사이에 다른 갱신이 있어도 잃지 않습니다. AI 응답을 기다린 뒤 대화에
  넣는 자리에서 특히 그렇습니다.
- 같은 값(`Object.is`)으로 갱신하면 다시 그리지 않습니다. 객체는 **새 객체**를 만들어야
  바뀐 것으로 봅니다 — `current.clues.push(…)`처럼 제자리에서 고치면 화면이 낡습니다.
- 렌더 중에는 갱신할 수 없습니다.
- 사라진 컴포넌트의 설정 함수를 부르면(늦게 끝난 비동기 작업) 경고 하나가 남고 무시됩니다.
  런타임은 멈추지 않습니다.

## 한도

| 항목 | 한도 |
| --- | --- |
| 정의의 수(수명마다) | 128개 |
| 정의 하나의 값 크기 | 64 KiB(직렬화한 길이) |
| 발행된 작품의 저장 전체 | 256 KiB(플레이스루·영구 각각) |

대화 기록처럼 자라는 값은 **최근 것만 남기는** 규칙을 코드에 두세요. 한도를 넘은 갱신은 그
렌더가 실패하고 화면은 이전 상태로 남습니다.

## AI 응답과 상태

AI가 만든 글은 **제안**입니다. 그것을 어느 수명에 넣을지, 그리고 넣을지 말지는 당신의 코드가
정합니다. 작품의 규칙(단서를 얻었는가, 신뢰가 올랐는가)은 AI의 문장을 읽어 판정하지 말고
결정적인 코드로 바꾸세요 — 자세한 것은 [AI 생성](/docs/runtime/concepts/generation#정본-상태와-ai의-글)에
있습니다.
