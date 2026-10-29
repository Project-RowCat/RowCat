---
title: 저수준 API
description: 평범한 작품에서 부를 일이 없는 판정 함수와 상수. 있다는 사실을 적어 두는 페이지입니다.
group: reference
order: 10
symbols: isRuntimeHostComponent, runtimeHostKindOf, RuntimeHostComponent, RuntimeHostKind, isRuntimeElement, isStoryStateDefinition, isPersistentStateDefinition, isSerializable, STORY_STATE_VERSION_MAX, PERSISTENT_STATE_VERSION_MAX
---

# 저수준 API

`@rowcat/runtime`이 내보내지만 **작품을 만드는 코드에서 부를 이유가 거의 없는** 이름들입니다.
값의 종류를 실행 중에 판정하는 함수와, 계약의 상한을 말하는 상수입니다. 여기 적는 이유는
자동완성에 나타나는 이름이 무엇인지 답하기 위해서이지 쓰라는 뜻이 아닙니다.

## 판정 함수

| 이름 | 답하는 것 |
| --- | --- |
| `isRuntimeHostComponent(value)` | 값이 런타임 부품(`Stack` 등)인가 |
| `runtimeHostKindOf(value)` | 부품이면 그 종류 이름(`"stack"`·`"text"`…), 아니면 `null` |
| `isRuntimeElement(value)` | 값이 TSX 태그가 만든 원소인가 |
| `isStoryStateDefinition(value)` | 값이 `defineStoryState`의 정의인가 |
| `isPersistentStateDefinition(value)` | 값이 `definePersistentState`의 정의인가 |
| `isSerializable(value)` | 값을 저장할 수 있는가(함수·`Date`·순환·`NaN`이 없는가) |

`isSerializable`은 그중 쓸 일이 있을 수 있는 하나입니다 — 계산해서 만든 값을 저장 상태에 넣기
전에 확인하는 자리입니다. 다만 `initial`의 타입 검사가 대부분을 이미 잡습니다.

## 형

- `RuntimeHostComponent<TProps>` — 부품의 형. 호출 가능하지만 실제로 부르면 던집니다.
- `RuntimeHostKind` — 부품 종류 이름의 유니온(`"screen"`·`"view"`·`"stack"`·`"row"`·
  `"scroll"`·`"text"`·`"image"`·`"button"`·`"pressable"`·`"progress"`·`"text-input"`·
  `"text-area"`).

## 상수

- `STORY_STATE_VERSION_MAX` · `PERSISTENT_STATE_VERSION_MAX` — `version`이 가질 수 있는
  최댓값(`Number.MAX_SAFE_INTEGER`). 실제로 닿을 일은 없습니다.
