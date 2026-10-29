---
title: 이벤트와 입력
description: 누름과 글 입력이 어떤 모양으로 오는가. 통제된 입력, Enter와 한글 조합, 비활성.
group: concepts
order: 3
---

# 이벤트와 입력

런타임의 이벤트는 **결과만** 건넵니다. 눌렸다는 사실, 바뀐 뒤의 글 전체, 확정했다는 사실 —
그뿐입니다. 이벤트 객체(`MouseEvent`·`KeyboardEvent`·좌표·`preventDefault`)는 없습니다. 같은
코드가 웹과 앱에서 같은 뜻을 갖게 하려는 선택입니다.

## 누름

`Button`과 `Pressable`이 `onPress`를 받습니다. 인자가 없습니다.

```tsx
<Button onPress={() => setState((current) => ({ ...current, chapter: current.chapter + 1 }))}>
	계속
</Button>
```

`onPress`는 `async` 함수여도 됩니다. AI 응답을 기다리는 자리가 대개 여기입니다.

`Button`은 라벨이 있는 조작이고 `tone`으로 시각 위계를 고릅니다(`"primary"`·`"secondary"`·
`"ghost"`). `Pressable`은 임의의 내용을 누를 수 있게 감싸고 `style`을 받습니다 — 카드 하나를
통째로 누르게 하는 자리입니다.

`disabled={true}`인 부품은 눌리지 않습니다. 시각 효과가 아니라 실제로 핸들러가 불리지 않습니다.

## 글 입력

`TextInput`(한 줄)과 `TextArea`(여러 줄)이 글을 받습니다. 둘 다 **통제된 입력**입니다 — 지금
적혀 있는 글은 언제나 당신의 상태이고, `value`가 필수입니다.

```tsx example=text-input file=src/main.tsx
import {
	Button,
	Row,
	Screen,
	Stack,
	Text,
	TextInput,
	useState,
} from "@rowcat/runtime";

export default function App() {
	const [draft, setDraft] = useState("");
	const [sent, setSent] = useState<string[]>([]);

	function send() {
		const text = draft.trim();
		if (text.length === 0) return;
		setSent((current) => [...current, text]);
		setDraft("");
	}

	return (
		<Screen>
			<Stack gap={8} style={{ padding: 16 }}>
				{sent.map((line, index) => (
					<Text key={index}>{line}</Text>
				))}
				<Row gap={8}>
					<TextInput
						value={draft}
						placeholder="할 말을 적으세요"
						onChangeText={setDraft}
						onSubmit={send}
						style={{ grow: 1 }}
					/>
					<Button onPress={send} disabled={draft.trim().length === 0}>
						보내기
					</Button>
				</Row>
			</Stack>
		</Screen>
	);
}
```

- **`onChangeText(value)`** — 글자가 바뀔 때마다 **바뀐 뒤의 전체 글**을 받습니다. 그 값을
  상태에 넣지 않으면 입력칸은 당신의 `value`로 되돌아갑니다(통제된 입력이라 그렇습니다).
- **`onSubmit()`** — `TextInput`에서 Enter(앱에서는 완료)를 눌렀을 때. 인자가 없습니다.
  `TextArea`에는 없습니다 — 여러 줄에서 Enter는 줄바꿈입니다.
- **`disabled`** — 잠긴 입력칸은 글자를 받지 않고 `onSubmit`도 부르지 않습니다.

### 한글·일본어·중국어 조합 중의 Enter

조합 중(글자가 완성되기 전)에 누른 Enter는 **제출이 아닙니다.** 런타임이 그 판정을 갖고
`onSubmit`을 부르지 않으므로, 당신의 코드는 이것을 신경 쓰지 않아도 됩니다. 조합이 끝난 뒤의
Enter만 `onSubmit`으로 옵니다.

### 값을 지우는 것도 상태입니다

보낸 뒤 입력칸을 비우려면 `setDraft("")`를 부릅니다. 입력칸 자체에 "비우기" 메서드는 없습니다 —
ref로 부품을 잡는 방법이 없기 때문입니다.

## 이벤트가 오는 순서

핸들러 안에서 여러 번 상태를 바꿔도 화면은 **한 번** 다시 그려집니다. 핸들러의 동기 구간과
그 안의 `await`가 없는 이어짐은 한 묶음이고, AI 응답을 `await`한 뒤의 갱신은 새 묶음입니다.

## 없는 것

- 마우스 좌표·스크롤 위치·키 코드·포커스 이벤트
- 길게 누르기·더블 탭·드래그·제스처
- `onFocus`·`onBlur`·`onKeyDown`
- 부품에 대한 ref(`useRef`는 값을 담는 칸이지 부품을 가리키지 않습니다)

이 목록에 있는 것이 필요하다면 지금은 상태로 표현할 방법을 찾아야 합니다. 예를 들어 "어느
카드가 선택되었는가"는 `Pressable` 여러 개와 `useState` 하나로 만듭니다.
