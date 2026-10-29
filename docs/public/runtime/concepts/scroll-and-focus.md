---
title: 스크롤과 초점
description: 목록을 최신으로 내리고 입력 칸에 초점을 주는 방법. 조종기, 붙이는 규칙, 부르는 자리, 순서.
group: concepts
order: 7
---

# 스크롤과 초점

메시지를 하나 덧붙이면 화면은 그 메시지가 보이는 자리로 내려가야 합니다. 선택지를 눌러
답장 칸이 나타나면 거기에 커서가 있어야 합니다. 이 둘은 화면을 **그리는** 일이 아니라 화면에
**한 번 시키는** 일이고, 런타임은 그 자리를 위해 **조종기**를 줍니다.

```tsx example=scroll-and-focus file=src/main.tsx
import {
	Button,
	Screen,
	ScrollView,
	Stack,
	Text,
	TextInput,
	useScrollController,
	useState,
	useTextEntryController,
} from "@rowcat/runtime";

export default function App() {
	const scroll = useScrollController();
	const reply = useTextEntryController();
	const [lines, setLines] = useState<string[]>([]);
	const [draft, setDraft] = useState("");

	function send() {
		if (draft.length === 0) return;
		setLines((current) => [...current, draft]);
		setDraft("");
		scroll.scrollToEnd();
	}

	return (
		<Screen>
			<ScrollView controller={scroll} style={{ grow: 1 }}>
				<Stack gap={8} style={{ padding: 16 }}>
					{lines.map((line, index) => (
						<Text key={`${index}-${line}`}>{line}</Text>
					))}
				</Stack>
			</ScrollView>
			<Stack gap={8} style={{ padding: 16 }}>
				<TextInput
					controller={reply}
					value={draft}
					onChangeText={setDraft}
					onSubmit={send}
					placeholder="메시지"
				/>
				<Button onPress={() => reply.focus()}>답장하기</Button>
			</Stack>
		</Screen>
	);
}
```

## 조종기는 ref가 아닙니다

React에 익숙하다면 `useRef`에 부품을 담아 `ref.current.focus()`를 부르는 모양이 떠오를
것입니다. 런타임에는 그 길이 없습니다.

```tsx
// 이런 코드는 런타임에 없습니다
const input = useRef<HTMLInputElement>(null);
<TextInput ref={input} />;
input.current.focus();
```

`useRef`는 렌더 사이에 값을 담아 두는 **순수한 칸**이고, 부품을 가리키지 않습니다. 대신
조종기가 있습니다.

| | 조종기 | DOM/네이티브 ref |
| --- | --- | --- |
| 무엇을 쥐는가 | 능력 몇 개짜리 손잡이 | 플랫폼 객체 전부 |
| 읽을 수 있는 것 | 없음 | 크기·좌표·부모·자식·HTML |
| 웹과 앱 | 같은 코드, 같은 뜻 | 서로 다른 객체 |

조종기 안에는 아무것도 들어 있지 않습니다. `controller.current`도 `controller.node`도
없고, 있는 것은 아래의 메서드뿐입니다.

## 스크롤 조종기

```ts
scroll.scrollToStart();          // 콘텐츠의 처음으로
scroll.scrollToEnd();            // 콘텐츠의 끝으로
scroll.scrollTo({ offset: 240 }); // 시작에서 240만큼
```

- 축은 그 `ScrollView`의 `horizontal`이 정합니다. 세로면 위에서, 가로면 시작 쪽에서 잽니다.
- `offset`의 단위는 스타일의 길이와 같습니다. **0 이상의 유한한 수**여야 하고, 그렇지
  않으면 `runtime_scroll_invalid_offset`입니다.
- 콘텐츠보다 큰 `offset`은 플랫폼이 끝에 붙입니다. 콘텐츠가 화면보다 짧으면 아무 일도
  일어나지 않습니다.
- **스크롤에는 애니메이션이 없습니다.** 지금 판의 스크롤은 즉시 옮깁니다. 스타일의
  [전이](/docs/runtime/concepts/styling#전이)는 이 축과 무관합니다 — 그쪽은 `opacity`와 변환만
  다룹니다.

## 초점 조종기

```ts
reply.focus();
reply.blur();
```

- `disabled`인 입력에 `focus()`를 부르면 **아무 일도 일어나지 않습니다.**
- A에 초점이 있을 때 B에 `focus()`를 부르면 초점은 B로 옮겨 갑니다.
- **키보드가 반드시 올라온다고 약속하지 않습니다.** 초점은 런타임이 옮기지만 화면 키보드를
  띄울지는 기기의 정책입니다.

## 붙이는 규칙

조종기는 `controller` 프롭으로 붙입니다.

| 조종기 | 붙는 곳 |
| --- | --- |
| `useScrollController()` | `ScrollView` |
| `useTextEntryController()` | `TextInput` · `TextArea` |

- **조종기 하나는 살아 있는 부품 하나에만 붙습니다.** 같은 조종기를 두 곳에 적으면 그
  렌더가 `runtime_host_control_already_bound`로 거절됩니다. 목록이 둘이면 조종기도 둘입니다.
- 다른 종류에 붙이면 `runtime_host_control_wrong_kind`입니다.
- 아직 그려지지 않았거나 이미 사라진 부품의 조종기에 명령하면 **아무 일도 일어나지 않고**
  콘솔에 한 줄이 남습니다(`runtime_host_control_unbound`). 조건부로 그려지는 입력의
  조종기는 그것이 없는 동안 정상적으로도 붙어 있지 않습니다 — 오류가 아닙니다.

## 부르는 자리

명령은 **렌더 중에 부를 수 없습니다.**

```tsx
function App() {
	const scroll = useScrollController();
	scroll.scrollToEnd(); // runtime_host_command_invalid_phase
	return <Screen>…</Screen>;
}
```

부를 수 있는 자리는 상태를 바꿀 수 있는 자리와 같습니다 — 이벤트 핸들러, 효과, 정리 함수,
그리고 `await` 뒤의 이어짐입니다.

```tsx
async function ask() {
	const result = await generation.generate({ messages });
	setLines((current) => [...current, result.text]);
	scroll.scrollToEnd(); // 여기도 됩니다
}
```

## 순서 — 화면이 자란 **뒤에** 옮깁니다

이 두 줄이 이 기능의 가장 흔한 모양입니다.

```tsx
setLines((current) => [...current, next]);
scroll.scrollToEnd();
```

`scrollToEnd()`는 **그 상태 변화가 화면에 닿은 뒤에** 적용됩니다. 그래서 `setTimeout`도,
"한 프레임 기다리기"도, 다른 요령도 필요하지 않습니다. 순서를 뒤집어 적어도(먼저
`scrollToEnd()`, 그다음 `setLines`) 결과는 같습니다 — 명령은 언제나 그 실행이 만든 커밋
뒤에 갑니다.

같은 실행에서 명령을 여러 번 부르면 **적은 순서대로** 적용됩니다. `scrollToStart()` 다음에
`scrollToEnd()`를 부르면 끝에 섭니다.

## 자주 쓰는 모양

**메신저** — 보내면 최신으로

```tsx
function send() {
	setMessages((current) => [...current, mine(draft)]);
	setDraft("");
	reply.blur();
	scroll.scrollToEnd();
}
```

**선택지가 입력 칸을 열 때**

```tsx
function chooseFreeAnswer() {
	setMode("free");
	reply.focus();
}
```

**긴 기록의 처음으로**

```tsx
<Button onPress={() => log.scrollToStart()}>처음부터</Button>
```

## 여기 없는 것

- **자동 스크롤·자동 초점.** 메시지가 늘었다고 런타임이 알아서 내려가지 않고, 입력 칸이
  나타났다고 알아서 초점을 주지 않습니다. 그 둘은 작품의 결정이라 당신이 부릅니다.
- **스크롤 위치 읽기.** 지금 몇 픽셀에 있는지, 끝에 닿았는지 알 수 있는 방법이 없습니다.
- **부드러운 스크롤·지속 시간·곡선.** 시간과 움직임은 아직 런타임의 어휘가 아닙니다.
- **선택 영역·커서 위치·키보드 종류.** 초점 조종기가 여는 것은 `focus()`와 `blur()`뿐입니다.
- **매 프레임 도는 스크롤.** 한 번의 조작에서 보낼 수 있는 명령의 수에는 상한이 있습니다.
