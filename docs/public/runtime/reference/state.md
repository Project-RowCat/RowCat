---
title: 상태 정의
description: defineStoryState와 definePersistentState의 입력, 판, 마이그레이션, 한도.
group: reference
order: 4
symbols: defineStoryState, definePersistentState
---

# 상태 정의

둘 다 **모듈 최상단에서** 부릅니다. 컴포넌트 안이나 렌더 중에 부르면
`runtime_story_state_definition_late`(또는 `runtime_persistent_state_definition_late`)입니다 —
첫 화면이 그려지기 전에 모든 정의가 알려져야 저장을 열 수 있기 때문입니다.

## `defineStoryState`

```ts
function defineStoryState<T>(input: {
	key: string;
	version: number;
	initial: T;
	migrate?: (stored: Serializable, fromVersion: number) => T;
}): StoryStateDefinition<T>;
```

이 플레이스루 동안 저장되는 값. 플레이 초기화가 지웁니다.

## `definePersistentState`

```ts
function definePersistentState<T>(input: {
	key: string;
	version: number;
	initial: T;
	migrate?: (stored: Serializable, fromVersion: number) => T;
}): PersistentStateDefinition<T>;
```

플레이어와 작품 사이에 남는 값. 플레이 초기화를 넘어 살아남습니다.

## 입력

| 필드 | 규칙 |
| --- | --- |
| `key` | 영문으로 시작, 영문·숫자·`_`·`-`, 64자 이내. 같은 수명 안에서 유일 |
| `version` | 1 이상의 정수. 값의 모양이 바뀔 때 올립니다 |
| `initial` | 직렬화 가능한 값(`null`·불리언·숫자·문자열·배열·평범한 객체). 함수·`Date`·`Map`·`Set`·`NaN`·`undefined`·순환은 타입에서 막힙니다 |
| `migrate` | 옛 판의 저장 값을 지금 모양으로 옮기는 함수. 결정적이어야 합니다 |

`initial`의 타입이 곧 상태의 타입입니다. 배열은 `[] as string[]`처럼 원소 타입을 적어 주세요 —
비어 있는 배열은 `never[]`로 추론되어 아무것도 넣을 수 없게 됩니다.

## 두 정의는 다른 타입입니다

```ts
const run = defineStoryState({ key: "run", version: 1, initial: { scene: 0 } });
const meta = definePersistentState({ key: "meta", version: 1, initial: { runs: 0 } });

useStoryState(run); // 됩니다
usePersistentState(meta); // 됩니다
useStoryState(meta); // 타입 오류 — 수명이 다릅니다
```

키 공간도 갈려 있습니다. 두 수명에 같은 `key`를 두어도 충돌이 아닙니다.

## 마이그레이션

| 저장된 판 | 코드의 판 | 일어나는 일 |
| --- | --- | --- |
| 없음 | n | `initial`로 시작 |
| n | n | 저장된 값 그대로 |
| m < n | n | `migrate(stored, m)`의 결과. `migrate`가 없으면 실패 |
| m > n | n | 실패 — 자동으로 낮추지 않습니다 |

`migrate`가 던지거나 직렬화할 수 없는 값을 돌려주면 런타임이 서지 않습니다. 저장을 조용히
버리고 `initial`로 떨어뜨리지 않습니다. 옮긴 결과는 저장에 다시 적히므로 같은 마이그레이션이
매번 돌지 않습니다.

예제는 [상태 › 마이그레이션](/docs/runtime/concepts/state#마이그레이션)에 있습니다.

## 저장되지 않는 것

정의하지 않은 열쇠의 저장 값(예전 코드가 남긴 것)은 **지워지지 않습니다.** 정의를 잠깐 뗐다
붙여도 플레이어의 진행이 사라지지 않게 하려는 것입니다. 지우는 것은 플레이 초기화뿐입니다.

## 한도

| 항목 | 값 |
| --- | --- |
| 정의의 수(수명마다) | 128 |
| 정의 하나의 직렬화 길이 | 65,536자 |
| 저장 전체(발행된 작품, 수명마다) | 262,144바이트 |

한도를 넘는 갱신은 `runtime_story_state_limit_exceeded`(또는 영구 상태의 짝)로 그 렌더가
실패하고, 화면은 이전 상태로 남습니다.
