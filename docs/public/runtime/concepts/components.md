---
title: 컴포넌트와 TSX
description: 런타임 컴포넌트가 무엇이고, React와 어디가 같고 어디가 다른가.
group: concepts
order: 1
---

# 컴포넌트와 TSX

런타임의 화면은 **컴포넌트**로 만듭니다. 컴포넌트는 프롭을 받아 화면 조각을 돌려주는 함수이고,
그 조각은 TSX로 적습니다.

```tsx
import { Row, Text } from "@rowcat/runtime";

function Score({ label, value }: { label: string; value: number }) {
	return (
		<Row gap={8}>
			<Text>{label}</Text>
			<Text style={{ fontWeight: "bold" }}>{value}</Text>
		</Row>
	);
}
```

## React를 닮았지만 React가 아닙니다

컴포넌트·TSX·훅·상태·이벤트 핸들러 — 모양은 React에서 가져왔습니다. 이미 아는 것을 다시 배우게
하지 않기 위해서입니다. 하지만 **런타임은 React가 아니고, React를 쓰지도 않습니다.**

그 차이가 실제로 뜻하는 것은 다음과 같습니다.

- `react`·`react-dom`·`react-native`를 설치하거나 가져올 수 없습니다. 훅과 컴포넌트는
  전부 `@rowcat/runtime`에서 옵니다.
- React 라이브러리(상태 관리·UI 키트·라우터)는 쓸 수 없습니다.
- `<div>`·`<span>` 같은 HTML 태그도, `<View>`를 React Native에서 가져오는 것도 안 됩니다.
  쓸 수 있는 태그는 런타임이 내보내는 [열두 부품](/docs/runtime/reference/components)뿐입니다.
- `useContext`·`useLayoutEffect`·`forwardRef`·`memo`·`Suspense`·`lazy`·에러 바운더리·
  포털·클래스 컴포넌트는 없습니다. 있는 훅은 [아홉](/docs/runtime/reference/hooks)입니다.
- `props.children`은 있습니다. `key`도 있습니다.

## 프리미티브와 조합

`@rowcat/runtime`이 내보내는 `Screen`·`Stack`·`Text` 같은 것들은 **런타임이 그리는 부품**
(프리미티브)입니다. 당신이 만드는 컴포넌트는 그 부품을 조합한 함수이고, 둘의 쓰임은 같습니다 —
TSX 태그로 씁니다.

프리미티브는 함수처럼 직접 부를 수 없습니다. `Stack({ gap: 8 })`은 오류이고 `<Stack gap={8}>`이
맞습니다.

## 컴포넌트가 돌려주는 것

컴포넌트는 다음 중 하나를 돌려줍니다.

- 태그 하나(`<Stack>…</Stack>`)
- 문자열이나 숫자 — 그대로 글자가 됩니다
- `null`·`undefined`·`false`·`true` — 아무것도 그리지 않습니다
- 위의 것들의 배열

배열을 돌려주거나 목록을 `map`으로 그릴 때는 **`key`를 주세요.** `key`는 같은 부모 아래에서
어느 항목이 어느 항목인지 알려 주고, 없으면 자리 번호로 판정합니다. 항목이 끼어들거나 빠질
때 `key`가 없으면 뒤 항목들의 상태가 엉뚱한 항목으로 옮겨 갑니다. 중복된 `key`는 경고이고
그 항목은 자리로 판정됩니다.

```tsx
{clues.map((clue) => (
	<Text key={clue.id}>{clue.title}</Text>
))}
```

## 렌더는 순수해야 합니다

컴포넌트 함수는 **읽기만** 합니다. 렌더 도중에 상태를 바꾸면(`setState`를 조건 없이 부르면)
거절됩니다. 상태를 바꾸는 자리는 이벤트 핸들러와 효과입니다.

```tsx
function Bad() {
	const [n, setN] = useState(0);
	setN(n + 1); // 렌더 중의 갱신 — 오류
	return <Text>{n}</Text>;
}
```

컴포넌트는 동기 함수입니다. `async` 컴포넌트와 프로미스를 돌려주는 컴포넌트는 없습니다.
AI 응답처럼 기다려야 하는 값은 [이벤트 핸들러에서 받아 상태에 넣습니다](/docs/runtime/concepts/generation).

## 훅의 규칙

훅은 컴포넌트(또는 훅을 부르는 다른 함수)의 **최상단에서, 매번 같은 순서로** 부릅니다.
조건문·반복문·이벤트 핸들러 안에서 훅을 부르면 안 됩니다. 런타임은 이 규칙을 실행 중에
확인하고, 같은 컴포넌트가 렌더마다 다른 훅을 부르면 오류(`runtime_hook_order_changed`)를 냅니다.

## 다음

- [스타일](/docs/runtime/concepts/styling) — 부품에 모양을 주는 방법.
- [이벤트와 입력](/docs/runtime/concepts/events) — 누름과 글 입력.
- [상태](/docs/runtime/concepts/state) — 값이 얼마나 오래 사는가.
