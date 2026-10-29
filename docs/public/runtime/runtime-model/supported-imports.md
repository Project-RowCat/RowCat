---
title: 지원하는 import
description: 런타임 코드가 가져올 수 있는 모듈 셋과 그 규칙.
group: runtime-model
order: 2
---

# 지원하는 import

런타임 코드의 `import`는 셋 중 하나여야 합니다. 그 밖의 것은 컴파일에서 막힙니다.

## 1. `@rowcat/runtime`

```ts
import { Stack, Text, useState } from "@rowcat/runtime";
import type { RuntimeNode } from "@rowcat/runtime";
```

런타임의 공개 API 전부. 목록은 [API 레퍼런스](/docs/runtime/reference)에 있습니다.
`@rowcat/runtime/internal/…` 같은 하위 경로는 없습니다 — 있어 보여도 거절됩니다.

## 2. 프로젝트 안의 파일

```ts
import { party } from "./game";
import { CharacterCard } from "../components/CharacterCard";
```

- `./` 또는 `../`로 시작합니다.
- **확장자를 적지 않습니다.** `./game`은 `game.ts` → `game.tsx` → `game/index.ts` →
  `game/index.tsx` 순으로 찾습니다.
- 프로젝트 뿌리 위로 올라가는 경로는 거절됩니다.
- 파일을 찾지 못하면 어느 경로들을 시도했는지 진단이 말합니다.

## 3. TSX가 스스로 넣는 것

`<Stack>` 같은 TSX 태그를 쓰면 컴파일러가 `@rowcat/runtime/jsx-runtime`을 대신 가져옵니다.
당신이 적을 일은 없고, 적어도 됩니다.

## 되지 않는 것

| import | 왜 |
| --- | --- |
| `react` · `react-dom` · `react-native` | 런타임은 React가 아니고 React를 싣지 않습니다 |
| `lodash` · `zustand` · 그 밖의 npm 패키지 | 설치할 곳이 없습니다. 프로젝트의 파일이 전부입니다 |
| `node:fs` · `path` · `crypto` | Node.js가 없습니다 |
| `https://…/module.js` | 원격 모듈을 가져올 방법이 없습니다 |
| `import("./scene")` (동적) | 모든 모듈은 컴파일 시점에 정해집니다 |
| `require("./x")` | CommonJS가 없습니다 |

`.json`·`.css`·`.png` 같은 자산 파일도 가져올 수 없습니다. 프로젝트의 파일은 `.ts`·`.tsx`
둘뿐입니다. 데이터는 `.ts` 파일에 상수로 적습니다.

```ts
// src/data/scenes.ts
export const SCENES = [
	{ id: "intro", text: "밤 11시, 편의점 앞." },
	{ id: "counter", text: "카운터 뒤에 서자 문이 열렸다." },
] as const;
```

## 형 검사도 같은 규칙입니다

스튜디오의 자동완성과 오류 표시는 같은 컴파일러 설정을 씁니다. DOM 타입(`HTMLElement`)도
Node 타입(`Buffer`)도 프로그램에 없어서, 그 이름을 쓰면 편집기에서 먼저 빨간 줄이 섭니다.
