---
title: API 레퍼런스
description: "@rowcat/runtime이 내보내는 모든 이름의 지도. 무엇이 어느 페이지에 있는가."
group: reference
order: 1
---

# API 레퍼런스

런타임 코드가 가져올 수 있는 이름은 전부 `@rowcat/runtime` 하나에서 옵니다. 이 페이지는 그
이름들을 종류별로 나눈 지도이고, 각 이름의 자세한 설명은 아래 페이지들이 갖습니다.

```ts
import { Button, Stack, Text, defineStoryState, useStoryState } from "@rowcat/runtime";
```

## 화면 부품

런타임이 그리는 열두 부품. [컴포넌트 레퍼런스](/docs/runtime/reference/components)

`Screen` · `View` · `Stack` · `Row` · `ScrollView` · `Text` · `Image` · `Button` · `Pressable` ·
`TextInput` · `TextArea` · `Progress`

## 훅

컴포넌트 안에서 부르는 아홉 함수. [훅 레퍼런스](/docs/runtime/reference/hooks)

`useState` · `useReducer` · `useMemo` · `useCallback` · `useRef` · `useEffect` ·
`useStoryState` · `usePersistentState` · `useGeneration`

## 상태 정의

모듈 최상단에서 저장 상태를 선언하는 둘. [상태 정의 레퍼런스](/docs/runtime/reference/state)

`defineStoryState` · `definePersistentState`

## AI 생성

요청과 결과의 모양, 한도. [생성 레퍼런스](/docs/runtime/reference/generation)

`RUNTIME_GENERATION_LIMITS` · `RuntimeGeneration` · `RuntimeGenerationRequest` ·
`RuntimeGenerationMessage` · `RuntimeGenerationResult`

## 스타일과 색

색을 만드는 함수와 스타일의 형. [스타일 레퍼런스](/docs/runtime/reference/styling)

`color` · `isRuntimeColor` · `RuntimeColor` · `RuntimeStyle` · `RuntimeTextStyle` ·
`RuntimeLength` · `RuntimeAlign` · `RuntimeJustify`

## 자산

그림을 가리키는 참조 — RowCat에 올린 이미지의 이름이나 외부 HTTPS 주소.
[자산 레퍼런스](/docs/runtime/reference/assets)

`asset` · `AssetRef`

## 오류와 한도

런타임이 던지는 오류와 그 코드. [오류와 한도](/docs/runtime/reference/errors-and-limits)

`RuntimeError` · `RUNTIME_ERROR_CODE` · `RuntimeErrorCode`

## 타입

프롭·훅·노드·상태 정의의 형들. 값이 아니라 `import type`으로 가져옵니다.
[타입 레퍼런스](/docs/runtime/reference/types)

## 저수준

평범한 작품에서 부를 일이 없는 판정 함수와 상수. [저수준 API](/docs/runtime/reference/advanced)

## 전역

`console.log`·`console.warn`·`console.error` 셋이 전역에 있습니다. `console.info`·`console.table`은
없습니다. 그 밖의 전역(`window`·`document`·`fetch`·`setTimeout`…)은
[없습니다](/docs/runtime/runtime-model/unsupported-apis).
