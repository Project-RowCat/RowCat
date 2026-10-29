# 크리에이터 런타임 — 네이티브 실행 환경 결정 기록 (Phase 4A)

> 상태: **결정됨.** 2026-09-02. Phase 3 결정 기록(`vm-poc.md`)의 §9-1을 닫는다.
>
> 이 문서는 무엇을 쟀고 무엇이 나왔고 왜 그쪽을 골랐는가를 적는다. 숫자는 벤치마크가 아니라
> "재앙적인 비용이 있는가"의 답이고 실행마다 흔들린다.

## 1. 결론

```text
운영 네이티브 런타임 호스트    **WebView WASM 호스트를 쓴다** (Option A)
거절한 대안                   네이티브 QuickJS 호스트 (Option B — JSI/Expo 모듈 위의 quickjs-ng)
안드로이드 Phase 3 스위트     PASS  (19/19 · 에뮬레이터)
안전한 스택 상한(4 플랫폼)    128KiB  (Node · Web Worker · WKWebView · Android WebView 전부 실측)
```

**한 문장으로**: 두 후보 모두 동작하고 자원 한도도 둘 다 세울 수 있다. 갈리는 것은 세 축이고
— 격리(프로세스 경계), 유지보수(엔진 사본 하나 vs 둘), 정책(WebKit이 돌리는 스크립트) — 셋 다
WebView 쪽이고, 네이티브가 이기는 축은 호스트 왕복 지연 하나다. 그 지연은 **구조로** 값을 줄인다
(§6). 그래서 지금은 WebView이고, 그 결정을 다시 여는 조건은 §8에 측정 가능한 수로 적는다.

**⚠︎ 가장 큰 남은 위험은 안드로이드의 다리다.** 에뮬레이터에서 호스트 왕복이 **68ms**로
iOS 시뮬레이터(4.5ms)의 15배이고, 그 수 그대로면 §8-1의 재개 조건(32ms)을 이미 넘는다. 이
결정은 그 수가 **에뮬레이터의 것**(소프트웨어 렌더링 · UI 스레드 정체 — `Davey!` 프레임이
로그에 찍힌다)이고 PoC 다리가 **가장 느린 경로**(`postMessage` + `injectJavaScript`, 호출마다
UI 스레드 왕복 둘)라는 두 사실 위에 선다. Phase 4B의 네이티브 어댑터는 그 경로를 쓰지 않는다
(§7). 실기기에서 다시 잰 수가 §8-1을 넘으면 이 문서는 다시 열린다 — 그것이 "결정됨"과
"probably WebView"의 차이다.

## 2. 안드로이드 — Phase 3 스위트 실행

**실기기가 아니라 에뮬레이터다.** 그 구분이 이 절의 첫 줄이다 — 아래 수는 아키텍처 검증
(WASM이 있는가·스택이 새는가·한도가 서는가)에는 충분하고 제품 지연 예산의 근거로는 부족하다.
실기기 재측정은 Phase 4B의 첫 하네스 실행에서 한다.

```text
기기       Android Emulator · Pixel 10 Pro XL 이미지 (sdk_gphone16k_arm64 · arm64-v8a · 16KB 페이지)
OS         Android 17 (API 37)
WebView    com.google.android.webview 149.0.7827.5
앱         expo run:android 디버그 빌드 · Hermes · Metro 개발 번들 · /dev-tools의 구획
호스트     Android System WebView 안의 @rowcat/runtime-host · 능력은 Hermes가 답한다
```

```text
19/19 PASS  (autorun · 두 번 돌려 같은 결과)
  compiled artifact: evaluate, call export, cycle, singleton, JSX   24 ms
  warm session timings                                              53 ms
  unknown module cannot fall back to host resolution                41 ms
  artifact validation rejects unknown built-ins                     30 ms
  wire round trip through export call                              402 ms   ← 다리 왕복 여섯이 든다
  host rejection is caught by creator without host details          96 ms
  creator throw after await is a creator error with module frames  156 ms
  unknown capability fails                                          27 ms
  nested host calls from async continuations                       716 ms   ← 다리 왕복 셋 + 측정 250회
  hidden globals                                                     0 ms
  dynamic code blocked                                               0 ms
  recursion is contained and the VM survives                         2 ms
  async host completion resumes the creator promise               1434 ms   ← 다리 왕복 21회
  console routes serialized values to the host                       4 ms
  infinite loop is interrupted by the execution budget              22 ms
  memory growth is bounded                                          73 ms
  host call flooding is bounded                                      5 ms
  dispose during a pending host call cancels it and aborts the signal 69 ms
  dispose is idempotent and the session cannot be re-entered        22 ms
```

```text
cold session(WASM 컴파일 포함)   22.3 ms   ← 두 번째 실행의 수라 WASM 모듈이 이미 컴파일되어 있다(첫 실행은 화면에서 읽지 못했다)
warm session                     52.5 ms   (create vm 20.1 · bootstrap 32.0 · evaluate graph 0.4)   ← 부트스트랩이 생성된 모듈 13개를 세운다
call round trip(add)             124 µs
host round trip(sync echo)       68,092 µs (68 ms) ← WebView → postMessage → Hermes → injectJavaScript → WebView
async host round trip            69,705 µs (70 ms)   ← 같은 왕복 + setTimeout(0)
dispose                          0.30 ms
baseline linear memory           16.0 MiB
WebView 렌더러 프로세스               PSS 88 MiB · RSS 206 MiB  (sandboxed_process0 · 세션 하나 유휴 · dumpsys meminfo)
```

### 스택 안전 (§7 스펙)

```text
128 KiB   contained · contained · contained
192 KiB   contained · contained · contained
256 KiB   contained · contained · contained
320 KiB   leaked      ← 호스트 RangeError가 새고 그 세션의 런타임이 손상된다. WebView와 앱은 살았다
```

프로브는 상한 후보마다 세션을 열어 재귀 폭주 → `RangeError`로 잡힘 → 같은 세션이 답함 → 폐기를
**세 번** 반복한다(`runRuntimeVmPoc`의 `stackProbe`). 128KiB는 세 번 다 잡혔고 그 위의 첫 실패
지점이 위 표다. 플랫폼 표(`packages/runtime-host/src/vm/stack-limits.ts`)의 안드로이드 값은
그래서 128KiB이고 `validated: true`다. 새는 상한에서도 **앱 프로세스는 살았다** — 손상되는 것은
WebView의 JS realm(그 세션의 WASM 인스턴스)까지이고, 그 사실이 §5의 격리 행이다.

### 이 실행이 잡은 것

- **`@expo/ui`를 두 플랫폼에서 빼 두면 안드로이드 앱이 뜨지 않는다.** expo-router 57.0.17의
  안드로이드 전용 툴바 모듈이 그것을 import 시점에 요구한다. iOS 링크 실패 때문에 뺀 목록이
  iOS 시뮬레이터로만 검증되어 있었고, 안드로이드를 실제로 돌리는 첫 실행이 잡았다. 지금은
  `expo.autolinking.ios.exclude`다(`apps/mobile/AGENTS.md`).
- **JDK 25로는 gradle이 `react-native-worklets`의 CMake 구성에서 죽는다**(restricted method).
  JDK 21로 빌드했다. 저장소가 고치는 것이 아니라 개발 기계의 사실이라 여기 적어 둔다.

## 2b. 같은 스위트의 Phase 4A 재실행 — Web · Node · iOS

Phase 4A의 호스트(생성된 런타임 13모듈 · 스케줄러 · 시계 포트)로 세 플랫폼을 다시 돌렸다.
Phase 3의 수(`vm-poc.md` §8)와 견주면 부트스트랩이 조금 늘고(스텁 셋 → 생성 모듈 열셋)
나머지는 같은 자릿수다.

```text
Web   Chrome 148 워커 · 19/19 PASS
      cold 39.7 ms · warm 4.2 ms (create 1.0 · bootstrap 2.7 · graph 0.3)
      call 34 µs · host 100 µs · async host 3.8 ms(setTimeout 0의 최소 지연) · dispose 0.3 ms · 16.0 MiB
      stack: 128 KiB contained · **192 KiB leaked**  ← 네 플랫폼 중 여유가 가장 적다

Node  22.23 · vitest · 19/19 PASS
      cold 23.7 ms · warm 4.8 ms (create 1.9 · bootstrap 2.4 · graph 0.3)
      call 34 µs · host 91 µs · async host 1.5 ms · dispose 0.3 ms · 16.0 MiB
      stack: 128 KiB contained (256 KiB는 Phase 3에서 샜다 — 다시 돌리지 않는다, 워커를 손상시킨다)

iOS   iPhone 17 Pro 시뮬레이터 · iOS 27.0 · WKWebView · 19/19 PASS (autorun · 두 번 돌려 같은 결과)
      cold 114 ms(앱 콜드 스타트 직후) / 58 ms(두 번째) · warm 13 ms (create 6 · bootstrap 4 · graph 1)
      call 40 µs · host 4,420 µs (4.4 ms) · async host 3.5 ms · dispose 1 ms · 16.0 MiB
      stack: 128 · 192 · 256 · 320 KiB contained · **512 KiB leaked** (첫 번은 잡히고 그 뒤 두 번은
      runtime_internal_vm_error — 한 번 샌 뒤의 새 세션도 서지 않았다: 그 WebView realm은 버린다)
```

플랫폼 표(`vm/stack-limits.ts`)는 그래서 넷 다 **128KiB**이고, 새기 시작한 지점을 함께
적는다(web-worker 192 · node 256 · android-webview 320 · ios-webview 512). 웹 워커가
가장 좁다는 사실이 값을 한다 — 상한을 올리자는 제안이 오면 그 플랫폼에서 먼저 재야 한다.

## 3. 네이티브 엔진 스파이크 (Option B의 증거)

**기기가 아니라 이 맥(arm64 · clang -O2)에서 quickjs-ng 0.12.1을 그대로 컴파일해 C 하네스로
돌렸다**(`quickjs-ng` v0.12.1 태그 · `libqjs.a`). 스펙 §10의 최소 목록 그대로다 — 만들고, 평가하고,
내보내기를 부르고, 호스트 콜백을 받고, 비동기 결과를 잡 펌프로 돌리고, 무한 루프를 끊고, 폐기한다.
JSI·Expo 모듈은 만들지 않았다(§4가 그 이유를 적는다).

```text
create runtime+context            0.39 ms
compile+evaluate module           0.32 ms
call export (add)                 0.016 µs
host round trip (C 함수)          0.028 µs
async host (promise + job pump)   1.97 µs
interrupt(100ms 예산)             InternalError: interrupted · 100.0 ms
recursion                         RangeError 잡힘 · 128KiB 한도에서 깊이 132 · VM 생존
memory limit 24 MiB               InternalError: out of memory · 14.8 ms · RSS 증가 22.5 MiB
dispose after memory failure      0.06 ms · abort 없음
50 × (create · overflow · dispose) 0.18 ms each · 프로세스 RSS 최대 25.7 MiB
```

**읽는 법.**

- **`JS_SetMemoryLimit`이 네이티브에서는 동작한다.** WASM 빌드의 결함(`malloc_usable_size`
  부재)은 Emscripten의 것이지 QuickJS의 것이 아니다 — 네이티브는 24MiB 한도에서 RSS가
  22.5MiB 늘고 멈췄다. 세는 것은 QuickJS의 할당(`malloc_size` 회계), 세지 않는 것은 엔진
  밖의 호스트 할당이다. 그러니 네이티브를 고른다면 §46의 질문은 답이 있다.
- **호스트 왕복이 세 자릿수 나노초다.** JSI를 얹어도 마이크로초 단위일 것이고, WebView의
  밀리초와 세 자릿수 차이다. 이것이 Option B가 이기는 유일한 축이고, 그 크기는 크다.
- **네이티브 스택 한 프레임이 WASM보다 크다.** 같은 128KiB에서 깊이 132(WASM은 약 800).
  네이티브를 고르면 상한을 다시 재야 하는 것은 같다.
- **폐기가 손상되지 않는다.** 메모리 한도 뒤의 `JS_FreeRuntime`이 abort하지 않았다 —
  Emscripten 빌드의 누수 단언은 그 빌드의 것이다.

## 4. 왜 여기서 멈췄는가 — JSI 스파이크를 만들지 않은 이유

스펙 §10은 "증거가 모자라면 최소 스파이크"라 했고, §10의 마지막 줄이 멈춤 조건이다:
*네이티브 스파이크가 호스트 프로토콜 전체를 복제해야 하면 멈추고 어댑터 경계를 다시 본다.*

어댑터 경계(`RuntimeVmInstance`)를 세어 보면 네이티브 구현이 채워야 하는 것은 열두 조작이고
그중 넷이 **동기 콜백**을 요구한다 — 모듈 로더·정규화기(VM → 호스트 → VM, 평가 도중),
`hostCall`(VM 슬라이스 안에서 동기), `log`. JSI 위에서 그것을 세우는 일은 스파이크가 아니라
어댑터 하나를 통째로 쓰는 일이고(C++ 다리 + Kotlin/Swift 모듈 + CMake/Pod + 두 플랫폼 빌드),
그 결과가 답하는 질문은 §3이 이미 답한 것(엔진이 네이티브에서 한도를 세우는가)과 §5의 표가
답하는 것(그것을 골라도 되는가)뿐이다. 그래서 엔진 스파이크에서 멈췄다.

## 5. 기준표 (§9 스펙의 열넷)

| 기준 | Option A · WebView WASM | Option B · 네이티브 QuickJS | 이기는 쪽 |
| --- | --- | --- | --- |
| 의미 동일성 | 웹과 **같은 WASM 바이트** — 엔진 사본이 하나다 | 같은 소스의 다른 빌드. 메모리 회계·스택 깊이·빌드 옵션이 갈린다(§3) | A |
| 격리 | WASM 선형 메모리 **+ OS 프로세스 경계**(Android 샌드박스 렌더러 · WKWebView 콘텐츠 프로세스). 엔진의 C 결함이 앱 프로세스에 닿지 않는다 | 인프로세스. QuickJS의 메모리 안전 결함 하나가 곧 앱 프로세스의 것이다 | **A** |
| 자원 한도 | `WebAssembly.Memory` 상한(실측) · 인터럽트 · 스택 128KiB | `JS_SetMemoryLimit`(실측 동작) · 인터럽트 · 스택 | 동률 |
| 인터럽트 | 있다(100ms) | 있다(100ms) | 동률 |
| 모듈 | 정적 ESM·순환·TLA 그대로 | 같다 | 동률 |
| 비동기 호스트 다리 | postMessage/injectJavaScript — **밀리초** (iOS 4.5ms · Android 68ms/에뮬레이터) | JSI — 마이크로초 | **B** |
| 시작 비용 | WebView 생성 + WASM 컴파일(cold 141ms/iOS · 22ms(재컴파일 없음)/Android) | 0.4ms + 모듈 적재 | B |
| 호스트 왕복(VM 안) | 30–64µs | 0.03µs(C) | B |
| 메모리 발자국 | 렌더러 프로세스 하나 + 세션 16MiB 하한 | 세션당 수 MiB | B |
| 바이너리 | WASM 1MiB(지금은 base64로 JS 번들 안 — 자산으로 옮길 수 있다) | ABI마다 libqjs ~1.2MB × 4 | 동률 |
| 수명주기 | 렌더러가 OS에 죽을 수 있다(`onRenderProcessGone`) — 세션 상태를 잃는다 | 앱과 같이 산다 | B |
| 유지보수 | npm 의존 하나(quickjs-emscripten). 엔진 갱신이 웹과 한 번이다 | C 빌드·패치·두 툴체인·엔진 판을 WASM과 맞추는 일 | **A** |
| 디버깅 | Chrome/Safari 인스펙터가 그대로 붙는다 | lldb | A |
| Expo/EAS | 없음(`react-native-webview`가 이미 의존이다) | 새 네이티브 모듈 + prebuild + 두 플랫폼 CI | A |
| **스토어 정책** | WebKit이 실행하는 JavaScript — App Store 심사 지침 2.5.2가 명시적으로 허용하는 갈래 | 앱이 내려받은 코드를 자체 엔진으로 실행 — 같은 지침이 금하는 문장에 가깝다(법률 판단이 아니라 위험이다) | **A** |

## 6. 결정의 근거

1. **격리가 이 제품의 첫 요구다.** 이 런타임이 돌리는 것은 남의 코드다. WASM 안의 QuickJS는
   엔진 자체의 C 결함까지 선형 메모리 안에 가두고, WebView는 그 위에 OS 프로세스 경계를 한 겹
   더 준다. 네이티브 QuickJS는 그 두 겹을 전부 잃는다 — 인프로세스 C 엔진의 취약점은 곧 세션
   쿠키·SQLite·SecureStore가 있는 프로세스의 취약점이다.
2. **엔진 사본이 하나여야 의미가 하나다.** 스펙 §11이 요구하는 동일 의미는 "같은 소스"가 아니라
   같은 바이트에서 가장 싸게 온다. 네이티브 빌드는 §3에서 이미 두 축(메모리 회계·스택 깊이)이
   갈렸고, 그 갈림을 관리하는 비용은 매 엔진 갱신마다 든다.
3. **네이티브가 이기는 축은 지연이고, 그 지연은 구조가 값을 줄인다.** 스펙 §41이 묻는 "어느
   realm이 스케줄러를 갖는가"의 답이 여기 있다 — **WebView realm이다.** `@rowcat/runtime-host`
   (스케줄러·리컨사일러·패치 생성)가 VM 옆에서 돌고, 다리를 건너는 것은 능력 호출 하나하나가
   아니라 **프레임당 패치 묶음 하나와 이벤트 하나**다. 그러면 밀리초 비용은 호출당이 아니라
   상호작용당이고, iOS 실측(4.5ms × 2 왕복 ≈ 9ms)은 한 프레임(16.7ms) 안이다.
4. **정책 위험이 한쪽에만 있다.** 표의 마지막 줄이다. 확정된 법률 판단이 아니지만, 심사에서
   되돌아오는 비용은 엔진 하나를 다시 쓰는 비용보다 크다.

## 7. 받아들인 대가

- **호스트 왕복이 밀리초다 — 안드로이드에서는 수십 밀리초일 수 있다.** §6-3의 구조가 그것을
  상호작용당 비용으로 만들지만, 능력 호출이 프레임마다 여럿 일어나는 설계(예: 매 렌더마다 자산
  조회)는 이 호스트에서 성립하지 않는다. Phase 4B의 능력 설계가 그 제약 아래에서 이루어져야
  한다(자산 참조는 배치·캐시로). 그리고 **안드로이드 어댑터는 PoC의 다리를 그대로 쓰지 않는다**:
  `injectJavaScript`는 호출마다 UI 스레드에서 스크립트를 평가하는 가장 느린 길이고, 같은 WebView
  위에 더 싼 길이 둘 있다 — `WebMessagePort`(`WebViewCompat.createWebMessageChannel`, 양방향·
  직렬화 한 번)와 `addJavascriptInterface`(JS → 네이티브가 동기). 그 다리를 세우고 실기기에서
  재는 것이 Phase 4B 네이티브 렌더러 작업의 **진입 조건**이고, VM 쪽 작업(디스패처·리컨사일러)은
  호스트와 무관하므로 그것을 기다리지 않는다.
- **렌더러 프로세스가 죽을 수 있다.** 세션 상태는 VM 안에 있고 그 프로세스가 죽으면 잃는다.
  대응은 복구가 아니라 **재시작**이다 — 저장 상태(Phase 4B 이후)는 호스트 쪽에 있고 VM은
  그것으로 다시 세운다. `onRenderProcessGone`·`onContentProcessDidTerminate`를 세션 종료
  신호로 다루는 것이 네이티브 어댑터의 일이다.
- **WASM 생성물이 번들에 있다.** 1MiB base64가 JS 번들에 실려 있고 릴리스에도 딸려 간다.
  자산 파일로 옮기는 것은 Phase 4B의 첫 정리 항목이다(하네스 구조가 그대로라 옮기는 자리는
  `wasmBinary` 하나다).
- **에뮬레이터 수다.** 실기기(특히 저사양 안드로이드)의 다리 지연·시작 비용은 다시 잰다.

## 8. 이 결정을 다시 여는 조건 — 측정 가능한 수로

아래 중 하나라도 실기기에서 재현되면 Option B(또는 그 사이의 셋째 안)를 다시 연다. 그 검토가
시작되는 자리는 `RuntimeVmEngine` 어댑터 하나이고 세션·스케줄러·와이어·능력은 그대로다.

1. **상호작용 지연**: 제작자 이벤트(터치) → VM → 패치 적용까지가 저사양 실기기에서 **32ms**
   (두 프레임)를 넘는 중앙값 — 다리 왕복 둘 + VM 턴의 합이다.
2. **렌더러 종료율**: 세션 시간당 `onRenderProcessGone`/콘텐츠 프로세스 종료가 **1%**를 넘는다.
3. **메모리**: 유휴 세션 하나의 렌더러 프로세스 RSS가 저사양 기기 기준 **150MiB**를 넘는다.
4. **정책**: 심사 지침이 WebKit 안의 스크립트 실행을 좁히거나, 반대로 자체 엔진을 명시적으로
   허용하는 쪽으로 바뀐다.
5. **엔진**: quickjs-emscripten이 유지보수를 멈추거나 quickjs-ng의 WASM 빌드가 갈라진다.

## 9. 이 결정이 바꾼 것

- `packages/runtime-host/src/vm/stack-limits.ts` — 네 플랫폼의 표, 전부 128KiB·실측.
- `createQuickJsEngine`의 `stackCeilingBytes` — 플랫폼 어댑터가 표의 값을 넘긴다.
- `runRuntimeVmPoc`의 `stackProbe` — 두 하네스가 마지막 단계로 돌린다(새는 상한에서 멈춘다).
- 스케줄러의 시계 포트 — 웹 워커와 WebView 하네스가 `MessageChannel`을 꽂는다.
- 모바일 하네스는 **남는다**(회귀·실기기 재측정의 재료). 릴리스 번들에서 빼는 일은 Phase 4B.

## 10. Phase 4B 뒤의 상태 — 무엇이 닫혔고 무엇이 열려 있는가

> 2026-09-03. 컴포넌트 런타임(리컨사일러·훅·패치 묶음)이 VM 안에 들어왔다
> (`docs/creator-runtime/patch-protocol.md`). 이 절은 §7·§8이 Phase 4B에 넘긴 셋의 상태다.

```text
VM 쪽 구조(§6-3)        닫혔다   리컨사일러가 VM 옆에서 돌고 상호작용당 다리 왕복이 둘이다
                                 (이벤트 메시지 하나 · 커밋 묶음 하나). Node 테스트가 값으로 본다
안드로이드 다리(§7)       열려 있다  WebMessagePort/addJavascriptInterface 어댑터를 세우지 않았다.
                                 하네스는 여전히 PoC의 postMessage + injectJavaScript다
실기기 32ms 게이트(§8-1)  미검증    저사양 실기기에서 재지 않았다. 통과로 적지 않는다
WASM 자산 이동(§7)       열려 있다  1MiB WASM이 여전히 하네스 HTML 안의 base64이고 그 HTML이
                                 JS 번들 안의 base64다(`harness.generated.ts`, 1,145 KiB)
```

**왜 셋이 열려 있는가.** 셋 다 네이티브 인프라 작업이고 VM 쪽 런타임과 무관하다(§7이
그렇게 적었다). Phase 4B는 VM 쪽을 끝냈고, 이 셋은 **네이티브 렌더러(Phase 5B의 RN 쪽)의
진입 조건**으로 남는다 — 웹 렌더러는 이 셋 없이 시작할 수 있었고 실제로 그렇게 됐다
(Phase 5A, `web-renderer.md`). **Phase 5A는 이 셋 중 어느 것도 닫지 않았다**: 안드로이드
다리는 여전히 PoC의 postMessage이고, 실기기 32ms는 여전히 재지 않았으며, WASM은 여전히
`harness.generated.ts`의 base64다. RN 렌더러도 만들지 않았다.

**닫는 순서**(Phase 5 네이티브 작업의 첫 항목):

1. 하네스에 커밋 묶음 하나를 네이티브로 나르는 메시지(`{ kind: "commit", batch }`)와 이벤트
   하나를 WebView로 나르는 메시지(`{ kind: "event", handlerId }`)를 더한다 — 지금의
   `HarnessToNative`·`NativeToHarness` 어휘에 각각 한 갈래다.
2. 안드로이드에서 그 두 메시지를 `WebViewCompat.createWebMessageChannel`(양방향 포트)로
   보내는 어댑터를 세운다. `react-native-webview`는 그 API를 열지 않으므로 Expo 모듈 하나가
   필요하다 — 그 모듈이 §7이 말한 "PoC의 다리를 그대로 쓰지 않는다"의 실체다.
3. 저사양 실기기에서 §8-1의 모양(터치 → WebView → VM 핸들러 → 렌더 → 묶음 → 네이티브 수신)의
   중앙값을 잰다. 32ms를 넘으면 §8이 다시 열린다.
4. WASM 바이트를 하네스 HTML에서 떼어 앱 자산으로 옮긴다. 옮기는 자리는 하네스의
   `wasmBinary` 하나다. 조건은 셋이다 — 번들에 base64 런타임 문자열이 없을 것, 자산 조회가
   결정적일 것(`require`로 고정된 자산), 하네스가 그대로 돌 것.

## 11. Phase 5B 뒤의 상태 — 다리·자산·렌더러

> 2026-09-03. 네이티브 렌더러(`@rowcat/runtime-renderer-native`)와 전송 계층
> (`apps/mobile/src/lib/runtime-native/`)이 들어왔다. 이 절은 §10의 넷이 어떻게 닫혔는가와
> **무엇이 여전히 열려 있는가**다.

```text
① 하네스의 런타임 어휘      닫혔다   `hello`·`start`·`event`·`stop` ↔ `ready`·`started`·`commit`·
                                   `console`·`diagnostic`·`root-error`·`failed`·`stopped`.
                                   PoC 스위트와 **같은 채널·같은 판별자**다
② 안드로이드 다리          구현됨   Expo 모듈 하나(`rowcat-runtime-webview`)가 WebView를
                                   소유하고 `WebMessagePort`로 오간다. AAR까지 빌드했다.
                                   **기기·에뮬레이터에서 돌리지 않았다**
③ 실기기 32ms 게이트       미검증   저사양 실기기가 없다. 통과로 적지 않는다
④ WASM 자산 이동          닫혔다   앱 자산이다. JS 번들에 base64 런타임 문자열이 없다
```

**iOS는 기기에서 돌렸다.** 시뮬레이터에서 수용 시나리오가 통과하고(0 → 1 → 2 → 다시 시작 0)
상호작용 330회를 쟀다(§11-6). 그 실행이 **다섯 가지 결함을 잡았고** 다섯 다 단위 테스트로는
드러나지 않는 부류였다 — 그 목록이 §11-8이다.

### 11-1. 다리 — 어휘 하나, 구현 둘

```text
Android   rowcat-runtime-webview(Expo 모듈)  WebMessagePort            운영 경로 · 스크립트 평가 없음
iOS       react-native-webview               postMessage / 주입 스크립트  §9의 결정 그대로
```

어휘는 `apps/mobile/src/lib/runtime-native/protocol.ts` 하나다. PoC 진단과 런타임 세션이
**같은 채널**을 쓰고 판별자도 하나다(`type`) — 갈라 두면 같은 다리 위에 파서가 둘이 되고,
어느 쪽을 지나야 하는지를 메시지의 **모양**으로 짐작하게 된다. 진단 랩이 자기 WebView를
세우지 않는 이유도 같다: 다리가 두 벌이면 그 화면이 재는 수가 운영 경로의 것이 아니다.

**조용한 대체가 없다.** 안드로이드에서 `WebMessagePort`를 세우지 못하면 `injectJavaScript`로
떨어지지 않는다 — 그 대체는 운영 경로를 가장 느린 다리로 되돌리면서 측정값이 어느 길의
것인지 말할 수 없게 만든다. 세우지 못하면 `unavailable`이고 런타임은 시작되지 않는다.
정적 스캔이 안드로이드 정상 경로의 `injectJavaScript`·`evaluateJavascript`·
`addJavascriptInterface` 부재를 잠근다
(`apps/mobile/src/lib/runtime-native/runtime-native-boundaries.test.ts`).

**커밋 하나가 메시지 하나이고 눌림 하나가 메시지 하나다.** 조작마다 다리를 건너지 않으므로
밀리초 비용이 상호작용당이다 — §6-3의 구조가 그대로 걸린다.

### 11-2. WASM — 번들의 문자열에서 앱 자산으로

```text
전           harness.generated.ts   1,175 KiB   (WASM base64 → 번들 → 다시 base64)
후           JS 번들에 없다          0            자산 둘이 네이티브 패키징을 지난다
             modules/rowcat-runtime-webview/assets/runtime/harness.html      175 KiB
             modules/rowcat-runtime-webview/assets/runtime/quickjs-ng.wasm   516 KiB
```

바이트의 출처는 고정된 의존(`@jitl/quickjs-ng-wasmfile-release-sync` 0.32.0)이고
`runtime-vm:harness:check`가 **바이트를 직접 견준다**(해시를 적어 두고 그것만 보면 자산이
사라진 배포에서도 검사가 통과한다). sha256은
`b56fe5094b8751c47b8c32fb5ed4d75afe2dbb43412d3d983ac5d1156af456da`, 528,551바이트다.

**base64로 다리에 태우지 않는다.** 그건 파일을 옮기고 문제를 남기는 일이다 — 하네스는 자기
문서와 **같은 오리진**에서 형제 파일을 가져오고, 그 오리진을 만드는 일은 전송 계층이 한다:

```text
Android   합성 오리진(https://appassets.rowcat.invalid) + shouldInterceptRequest → APK 자산
iOS       리소스 번들 안의 파일 URL + allowingReadAccessToURL(그 디렉터리 하나)
```

iOS에서 `allowFileAccessFromFileURLs`가 켜진 것이 이 슬라이스에서 유일하게 느슨해진 축이고,
그 대가로 WASM이 base64로 다리를 건너지 않는다. 읽기 권한의 범위는 자산 디렉터리 하나이고 그
안에는 우리가 커밋한 두 파일뿐이다.

### 11-3. 네이티브 렌더러

`@rowcat/runtime-renderer-native`가 패치 묶음을 **호스트 트리 저장소**에 명령형으로 적용하고,
React Native는 그 뒤에서 **이미 결정된** 트리를 실체화한다. 리컨사일러는 여전히 VM 안에
하나뿐이다.

```text
같다(웹 렌더러와)   패치 프로토콜 · 엄격한 리비전 · 원자적 커밋 · 노드 신원 · 핸들러 번호
                   스타일 축의 어휘 · gap 우선순위 · 자산이 주소가 아니라는 사실
다르다             적용 대상(섀도 DOM ↔ 트리 저장소 + React) · 글자 노드의 자리(RN 제약)
                   `lines`의 표현(CSS 관용구 ↔ numberOfLines) · 등급의 시각
```

- **원자성은 되돌림 일지다.** 트리를 통째로 복사하지 않고 조작마다 되돌리는 함수를 쌓아 역순
  으로 돌린다 — 비용이 `O(적용된 패치 수)`이고 실패한 묶음의 크기만큼만 든다. **실패한 묶음은
  아무 노드의 판도 올리지 않으므로 구독자가 그것을 관찰하지 못한다.**
- **묶음 하나가 알림 하나다.** 패치 백 개짜리 커밋도 구독자를 한 번 부른다. 각 노드는 자기
  판(`nodeVersion`)을 스냅샷으로 읽으므로 글자 하나가 바뀐 커밋이 5,000 노드를 다시 그리지
  않는다.
- **호스트 노드 id가 React 키다.** id는 세션 안에서 재사용되지 않으므로 키 재정렬이 같은
  네이티브 컴포넌트를 옮긴다.
- **`#text`의 자리만 플랫폼이 정한다.** React Native는 `View` 아래의 맨 문자열을 그리지
  못하므로, `Text` 아래면 문자열 그대로이고 그 밖이면 렌더러가 소유한 `Text` 잎이다.
  **패치 프로토콜은 이것 때문에 바뀌지 않았다.**

### 11-4. 수명주기

```text
정상 정지   stop 수용 중단 → unmountRoot(정리 함수) → settle → dispose → stopped
프로세스 사망  Android onRenderProcessGone · iOS onContentProcessDidTerminate
             → 세션을 잃은 것이지 앱이 죽은 것이 아니다 → transport-failed → 재시작을 요구한다
```

VM 힙은 복구하지 않는다. 렌더러 트리는 **남는다** — 마지막으로 그려진 화면이 그대로 서 있고,
상태가 `failed`라고 말한다.

### 11-5. 측정 — 무엇을 어떻게 재는가

```text
t0  Hermes: 이벤트 메시지를 다리에 넣기 직전
      │  다리 → WebView → QuickJS 핸들러 → 상태 갱신 → 리컨사일 → 패치 묶음 → 다리
      ▼
t1  Hermes: 그 묶음을 호스트 트리 저장소에 **적용한 뒤**
```

두 끝이 모두 Hermes다 — WebView의 `performance.now()`와 Hermes의 시계는 기원이 달라, 그 둘을
빼면 나오는 것은 지연이 아니라 기원의 차다. **PoC의 `hostRoundTripUs`를 이 게이트의 답으로
쓰지 않는다**(재는 구간도 시계 realm도 다르다).

백분위는 최근접 순위이고 보간하지 않는다 — 32ms 같은 문턱 근처에서 표본에 없던 수가 판정을
바꾸지 않게 한다. 워밍업 30회를 버리고 300회를 센다.

**이 반복이 재지 않는 구간이 하나 있다**: 터치가 `Pressable`의 `onPress`가 되기까지(제스처
인식·RN 이벤트 배달). 그 뒤는 전부 같은 경로이고, **손으로 누른 눌림도 같은 기록기를
지난다.**

### 11-6. 실측

```text
iOS 시뮬레이터   iPhone 17 Pro · iOS 27.0 · 디버그 빌드(Metro) · ios-webview 다리
                 워밍업 30 · 표본 300
                 중앙값 2 ms · p95 3 ms · p99 4 ms · min 1 ms · max 14 ms
                 {"bridge":"ios-webview","warmup":30,"samples":300,
                  "medianMs":2,"p95Ms":3,"p99Ms":4,"minMs":1,"maxMs":14}

Android 에뮬레이터  재측정하지 않았다. §2의 68ms는 PoC 다리(postMessage + injectJavaScript)의
                   수이고 그 경로는 더 이상 운영 경로가 아니다 — 새 다리의 수는 아직 없다
저사양 실기기       측정하지 않았다
```

**iOS의 수를 읽는 법.** 재는 구간은 §11-5 그대로다(Hermes에서 이벤트를 다리에 넣기 직전 →
그 묶음을 트리에 적용한 뒤). 이 자리에서 §2b의 `host round trip` 4.4ms와 나란히 놓고 싶어지는데
**그 둘은 다른 것이다** — 저쪽은 VM 안에서 잰 능력 호출 하나의 왕복이고 이쪽은 다리 왕복 둘 +
VM 턴 + 리컨사일 + 적용의 합이다. 이 수가 그보다 작은 것이 이상하지 않은 이유가 그것이다(그
왕복은 이 경로에 없다).

**그리고 이 수는 게이트의 답이 아니다.** 시뮬레이터는 맥의 CPU에서 돌고, §8-1이 묻는 것은
저사양 실기기다. 통과로 적지 않는다.

**⚠︎ §8-1의 게이트는 여전히 UNVALIDATED다.** 저사양 실기기가 없고, 시뮬레이터·에뮬레이터의
수는 그 질문에 답하지 못한다(§2가 이미 같은 말을 했다). 이 문서의 결정을 다시 여는 조건은
그대로다.

### 11-8. 시뮬레이터 실행이 잡은 것

**다섯 다 단위 테스트가 초록인 채로 존재했다.** 그 사실이 이 절이 있는 이유다 — 이 층의
결함은 대부분 "두 realm 사이의 약속"이고, 한쪽만 세워 놓고는 관찰되지 않는다.

1. **`file://`에는 HTTP 상태가 없다.** WKWebView는 성공한 파일 요청에도 `status: 0`을 답하고
   `response.ok`가 거짓이다 — 상태만 보던 하네스는 자산이 멀쩡히 읽히는데도 **언제나** 시작에
   실패했다(`runtime wasm asset: HTTP 0`). 지금은 상태가 **있을 때만** 보고 나머지는 바이트가
   판정한다.
2. **다리를 받은 스택 안에서 다시 다리로 들어가면 그 주입이 조용히 버려진다.** 반복이
   커밋 콜백에서 곧바로 다음 눌림을 내면 둘째부터 시간 초과였다. 벤치마크가 반복마다 턴을
   넘긴다 — **사람이 누르는 눌림은 언제나 새 턴에서 온다**는 사실과 같은 모양이다.
3. **핸들러 번호는 커밋마다 바뀐다.** 제작자의 `onPress={() => …}`는 렌더마다 새 함수이고
   리컨사일러가 새 번호를 준다(패치 프로토콜의 규칙 그대로다). 처음 읽은 번호를 들고 반복하면
   둘째 눌림부터 놓인 번호를 가리키고 VM이 그것을 `stale`로 버린다.
4. **문서의 `ready`는 적재될 때 한 번이다.** 다리가 다시 세워지는데 문서는 그대로인 경우
   (Fast Refresh · 세션 교체) 새 다리는 영원히 준비되지 않고 보낸 것이 전부 대기열에 쌓인다.
   `open`이 `hello`를 보내고 문서가 `ready`로 답한다.
5. **세대 번호가 1부터 세면 안 된다.** 조정자는 다시 만들어질 수 있고 그때 카운터는 1로
   돌아가는데 WebView 안의 세션은 살아 있다 — 옛 세션이 교체되며 내는 정리 묶음이 새 트리에
   적용되어 렌더러가 멈췄다(`patch batch revision 3 does not follow 0`). 씨앗이 시계다.

### 11-7. 여전히 열려 있는 것

- **안드로이드 다리를 실제로 돌리지 않았다.** Kotlin은 컴파일되고 AAR이 자산을
  `assets/runtime/` 아래에 담는 것까지 확인했지만, 기기·에뮬레이터에서 포트 핸드셰이크가
  성립하는지는 재지 않았다. 그 실행이 §11-1의 "구현됨"을 "닫혔다"로 바꾸는 자리다.
- **저사양 실기기 게이트.**
- ~~**자산 해석기.**~~ **원격 이미지가 열렸다** — `asset("https://…")`는 재생 화면의 해석기가
  RowCat의 프록시 소스(+ 세션 헤더)로 바꿔 그린다(`features/runtime-player/asset-resolver.ts`,
  `docs/creator-runtime/remote-assets.md`). 논리 참조(`characters/…`)는 여전히 `null`이고 자산
  호스트(업로드·발행·CDN)는 아직 아니다. 랩(`runtime-native-lab`)의 해석기는 그대로 `null`이다.
- ~~**발행 재생 통합.**~~ **Phase 7이 닫았다** — `features/runtime-player`가 이 인프라의
  첫 제품 소비자이고, 다리의 어휘가 저장 스냅샷 둘과 생성 왕복만큼 늘었다
  (`docs/creator-runtime/player.md`). 들이는 자리는 여전히 목록으로 닫혀 있다.

## 12. Phase 7 뒤의 상태

> 2026-09-03. 제품 재생이 붙었다. **열려 있던 것 중 닫힌 것은 하나다.**

```text
발행 재생 통합        닫혔다     제품 재생 화면이 이 인프라를 쓴다
안드로이드 다리 실행   열려 있다   Kotlin은 컴파일되고 자산도 담기지만 기기에서 돌리지 않았다
저사양 실기기 32ms    미검증     **Phase 7이 이것을 닫지 않았다**
자산 해석기           반쯤 닫혔다  원격 HTTPS 이미지는 프록시를 거쳐 그려진다 · 논리 자산은 여전히 `null`이다
```

**⚠️ 기능 통합이 끝났다는 사실이 32ms 측정을 대신하지 않는다.** 계측은 서 있고(두 끝이
모두 Hermes다) 벤치마크도 있지만, 자격을 갖춘 저사양 실기기에서 재지 않았다 —
시뮬레이터·에뮬레이터의 수를 그 답으로 쓰지 않는다는 §2의 규칙이 그대로 걸린다. 그 측정이
없는 동안 이 줄은 `UNVALIDATED`이고, `PASS`도 `FAIL`도 아니다.
