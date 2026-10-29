---
title: 컴포넌트
description: 런타임이 그리는 열두 부품의 프롭과 쓰임.
group: reference
order: 2
symbols: Screen, View, Stack, Row, ScrollView, Text, Image, Button, Pressable, TextInput, TextArea, Progress, Audio
---

# 컴포넌트

열두 부품 전부 `@rowcat/runtime`에서 가져오고 TSX 태그로 씁니다. 함수처럼 직접 부르면
`runtime_host_component_called`로 던집니다.

모든 부품이 `children`을 받는 것은 아닙니다. 표에 `children`이 없으면 자식을 둘 수 없습니다.
프롭 형의 이름(`StackProps` 등)은 [타입 레퍼런스](/docs/runtime/reference/types)에 있습니다.

## `Screen`

한 화면 전체. 런타임 앱의 가장 바깥에 둡니다.

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `background` | `RuntimeColor` | 화면 전체의 바탕. 안전 영역 바깥까지 덮습니다 |
| `children` | 노드 | |

```tsx
<Screen background={color("#0b0d12")}>…</Screen>
```

## `View`

아무 배치도 강제하지 않는 상자.

| 프롭 | 형 |
| --- | --- |
| `style` | `RuntimeStyle` |
| `children` | 노드 |

## `Stack`

자식을 **세로로** 쌓습니다.

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `gap` | `number` | 자식 사이의 간격. `style.gap`보다 우선합니다 |
| `style` | `RuntimeStyle` | |
| `children` | 노드 | |

```tsx
<Stack gap={8} style={{ padding: 16 }}>
	<Text>첫 줄</Text>
	<Text>둘째 줄</Text>
</Stack>
```

## `Row`

자식을 **가로로** 늘어놓습니다. 프롭은 `Stack`과 같습니다.

```tsx
<Row gap={8} style={{ align: "center" }}>
	<Text>신뢰</Text>
	<Progress value={0.4} style={{ width: 120 }} />
</Row>
```

## `ScrollView`

내용이 넘치면 스크롤합니다.

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `horizontal` | `boolean` | 참이면 가로 스크롤 |
| `controller` | `RuntimeScrollController` | `useScrollController()`가 만든 손잡이 |
| `style` | `RuntimeStyle` | |
| `children` | 노드 | |

스크롤 영역이 화면의 남는 공간을 차지하게 하려면 부모가 `Stack`이고 이 부품에 `style={{ grow: 1 }}`을
줍니다.

## `Text`

글자 한 덩어리. 자식으로 문자열·숫자·다른 `Text`를 받습니다.

| 프롭 | 형 |
| --- | --- |
| `style` | `RuntimeTextStyle` |
| `children` | 노드 |

```tsx
<Text style={{ fontSize: 18, fontWeight: "bold", lines: 2 }}>{title}</Text>
```

글자는 반드시 `Text` 안에 있어야 합니다. `Stack` 바로 아래에 맨 문자열을 두어도 그려지지만,
스타일을 줄 수 없고 앱에서는 기본 글꼴로 나옵니다.

## `Image`

그림 하나. `asset("characters/sena/smile")`처럼 RowCat에 올린 이미지의 이름이거나
`asset("https://…")`처럼 외부 HTTPS 주소입니다 — [자산](/docs/runtime/concepts/assets)을
먼저 읽으세요. 맨 문자열은 받지 않습니다(`source="https://…"`는 컴파일 오류입니다).

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `source` | `AssetRef` | `asset()`이 만든 참조(필수) |
| `alt` | `string` | 스크린리더가 읽는 이름 |
| `style` | `RuntimeStyle` | |
| `fit` | `"cover"` · `"contain"` · `"fill"` | 상자에 맞추는 방식 |

## `Button`

라벨이 있는 조작.

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `onPress` | `() => void \| Promise<void>` | 눌렀을 때 |
| `disabled` | `boolean` | 참이면 눌리지 않습니다 |
| `tone` | `"primary"` · `"secondary"` · `"ghost"` | 시각 위계 |
| `children` | 노드 | 라벨 |

```tsx
<Button tone="secondary" onPress={retry} disabled={pending}>
	다시 시도
</Button>
```

## `Pressable`

임의의 내용을 누를 수 있게 감쌉니다.

| 프롭 | 형 |
| --- | --- |
| `onPress` | `() => void \| Promise<void>` |
| `disabled` | `boolean` |
| `style` | `RuntimeStyle` |
| `children` | 노드 |

```tsx
<Pressable onPress={() => choose(option.id)} style={{ padding: 12, borderRadius: 8 }}>
	<Text>{option.label}</Text>
</Pressable>
```

## `TextInput`

한 줄 글 입력. **통제된 입력**이라 `value`가 필수입니다.

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `value` | `string` | 지금 적혀 있는 글(필수) |
| `onChangeText` | `(value: string) => void \| Promise<void>` | 바뀐 뒤의 전체 글 |
| `onSubmit` | `() => void \| Promise<void>` | Enter · 완료. 조합 중에는 불리지 않습니다 |
| `placeholder` | `string` | |
| `disabled` | `boolean` | |
| `controller` | `RuntimeTextEntryController` | `useTextEntryController()`가 만든 손잡이 |
| `style` | `RuntimeStyle` | 상자 |
| `textStyle` | `RuntimeTextStyle` | 글자 |

## `TextArea`

여러 줄 글 입력. `TextInput`과 같되 **`onSubmit`이 없습니다** — Enter는 줄바꿈입니다. 서식도
리치 텍스트도 없고 나르는 것은 평범한 문자열입니다. `controller`는 여기에도 있습니다.

## `Progress`

진행 정도.

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `value` | `number` | 0~1. 없으면 끝을 모르는 진행(무한 표시) |
| `style` | `{ width?: RuntimeLength }` | 폭만 받습니다 |

```tsx
<Progress value={trust / 100} style={{ width: "100%" }} />
```

## `Audio`

소리 하나. **화면에 그려지지 않고 자리도 차지하지 않습니다** — 트리에 있는 동안 살아 있고,
빠지면 멈춥니다.

| 프롭 | 형 | 뜻 |
| --- | --- | --- |
| `source` | `AssetRef` | 울릴 소리. **RowCat이 관리하는 논리 이름만** 받습니다(아래 참고) |
| `playing` | `boolean` | 소리가 나기를 **바라는가**. 없으면 `false` |
| `loop` | `boolean` | 끝나면 처음부터 다시. 없으면 `false` |
| `volume` | `number` | 0~1. 없으면 `1`. 범위 밖의 값은 **거절됩니다**(고쳐 주지 않습니다) |
| `muted` | `boolean` | 크기를 기억한 채로 끕니다 |
| `restartKey` | `string \| number` | 값이 바뀌면 처음으로 되감습니다 |
| `onEnded` | `() => void` | 끝까지 다 울렸습니다 — **`loop`가 아닐 때만** |

```tsx example=audio file=src/main.tsx
import { Audio, Button, Stack, asset, useState } from "@rowcat/runtime";

export default function App() {
	const [playing, setPlaying] = useState(false);

	return (
		<Stack>
			<Audio
				source={asset("audio/bgm/main")}
				playing={playing}
				loop
				volume={0.5}
			/>

			<Button onPress={() => setPlaying((value) => !value)}>
				{playing ? "음악 끄기" : "음악 켜기"}
			</Button>
		</Stack>
	);
}
```

스튜디오에서 소리 파일을 올리고 논리 이름을 붙인 다음, 그 **같은 이름**을 `asset()`에 적습니다.

### `playing`은 사실이 아니라 바람입니다

브라우저와 기기는 사용자가 화면과 상호작용하기 전의 소리를 막습니다. 그건 오류가 아니라
**정상적인 플랫폼 정책**이고, 그래서 `playing={true}`가 곧 소리를 보장하지 않습니다 — 허락이
필요한 상황에서는 RowCat이 "소리를 재생하려면 탭하세요"를 대신 보여 주고, 눌리는 순간 바라던
소리가 이어집니다. 페이지를 여는 것만으로 소리가 나는 것은 어느 플랫폼에서도 약속할 수 없습니다.

### 같은 소리를 다시 울리려면 `restartKey`

효과음을 두 번 누르면 두 번째 누름에서 `playing`은 이미 `true`라 아무 변화가 없습니다. 되감는
일에는 이름이 따로 있습니다.

```tsx
const [shot, setShot] = useState(0);

<Audio source={asset("audio/sfx/click")} playing restartKey={shot} />
<Button onPress={() => setShot((value) => value + 1)}>딸깍</Button>
```

### 원격 주소는 소리가 되지 않습니다

`Image`와 달리 이 버전의 `Audio`는 **RowCat이 관리하는 소리만** 울립니다.

```tsx
<Audio source={asset("https://example.com/song.mp3")} playing />
```

이 줄은 아무 요청도 만들지 않고 아무 소리도 내지 않습니다(오류도 아닙니다 — 조용합니다).
원격 그림이 열려 있는 것과 갈리는 이유는 성격입니다: 그림은 한 번 가져오면 끝이지만 소리는
재생하는 내내 이어지는 대화라, 그 표면은 아직 열지 않았습니다.

### 수명은 노드의 것입니다

```text
<Audio>가 트리에서 빠진다   → 멈춥니다
플레이가 끝난다              → 멈춥니다
playing={false}             → 그 자리에서 멈춥니다(되감지 않습니다)
restartKey가 바뀐다          → 처음으로 되감습니다
```

`onEnded`는 **자연 종료**에만 불립니다. 반복 중에는 매 바퀴마다 불리지 않고, 이 콜백이
`playing`을 대신 꺼 주지도 않습니다 — 다시 울리고 싶으면 `restartKey`를 바꿉니다.
