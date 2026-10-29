# 원격 이미지 자산 — `asset("https://…")` 결정 기록

> 2026-09-04. 크리에이터 런타임이 실제로 그림을 그리는 첫 판. 공개 문서는
> `docs/public/runtime/concepts/assets.md`이고 이 문서는 **왜 이렇게 만들었는가**를 적는다.

## 1. 무엇이 바뀌었는가

```text
전         asset("characters/sena/smile")  →  AssetRef  →  { "$asset": path }  →  해석기 null  →  자리표시자
후         asset("https://cdn.example.com/a.webp")                              →  RowCat 프록시  →  그림
           asset("characters/sena/smile")                                        →  해석기 null  →  자리표시자(그대로)
```

`asset()`이 받는 값이 **넓어졌다.** 시그니처(`asset(value: string): AssetRef`)와 `ImageProps.source`의
형과 와이어(`{ "$asset": string }`)는 한 글자도 바뀌지 않았고, `RUNTIME_API_VERSION`도 그대로다.

## 2. 왜 `source: string`으로 돌아가지 않았는가

가장 짧은 변경은 `Image`가 문자열을 받게 하는 것이다. 그러지 않은 이유는 **형이 아무것도
막지 못하게 되기 때문**이다 — `data:`·`javascript:`·상대 경로·이어 붙인 변수가 전부 그 자리에
앉고, 그것들을 나중에 거절하는 것은 좁히는 변경이라 이미 발행된 작품을 깨뜨린다.

`asset()`을 지나게 하면 제작자가 *이 문자열은 이미지 참조다*라고 **명시적으로 선언**하고 그
자리에서 결정적인 검사가 한 번 돈다. 그리고 결과가 불투명하다는 사실이 다음 절반이다 —
`ref.url`이 없으므로 제작자 코드는 그 값을 이어 붙이거나 자르지 못하고, 신뢰된 호스트는 자기가
봉인한 모양만 받는다. 컴파일러 테스트가 네 조합을 잠근다(`asset(논리)`·`asset(https)` 통과,
맨 논리·맨 https 거절, `.url`·`.kind` 접근 거절).

## 3. 왜 와이어에 종류를 적지 않았는가

`{ "$asset": { kind: "remote", url } }`가 더 명시적으로 보인다. 적지 않은 이유는 **이미 발행된
아티팩트**다 — 옛 아티팩트의 논리 참조는 한 글자도 바뀌지 않아야 하고, 새 모양을 두면 옛
클라이언트가 새 아티팩트를 반쯤 읽는다(와이어 판 이관이 필요해진다). 종류는 값에서 결정적으로
파생되므로(`classifyRuntimeAssetValue`) 적을 필요가 없고, 그 함수를 렌더러 둘과 서버가 **같이**
부르므로 세 곳이 같은 문자열을 다른 종류로 읽는 일이 없다.

## 4. 왜 기기가 직접 가져오지 않는가

```text
<img src={제작자의 주소}>   플레이어의 IP · 시각 · User-Agent가 제작자가 고른 호스트에 간다
```

`asset("https://creator.example/pixel?id=…")` 한 줄이면 누가 언제 열었는지 추적된다. 런타임에
`fetch`가 없다는 약속이 그 순간 거짓이 된다 — 그림 하나가 곧 네트워크 채널이다. 그래서 기기는
RowCat에 묻고(`GET /v2/runtime/assets/remote?url=…`) RowCat이 제작자의 호스트에 간다. 주소를
만드는 규칙은 SDK 하나(`media.runtimeAssetUrl`)이고 두 앱의 해석기가 그것을 부른다.

두 렌더러의 테스트가 **"제작자의 주소가 DOM(`src`)·`uri`에 없다"**를 값으로 본다. 그 결함은
화면에서 보이지 않기 때문이다 — 그림은 멀쩡히 뜬다.

**이것이 익명을 만들지는 않는다.** 가려지는 것은 플레이어의 IP와 User-Agent이고, 제작자의
서버는 여전히 **RowCat이 그 그림을 요청했다는 사실과 그 시점**을 본다. 공개 문서가 그 두
문장을 갈라 적는다 — 실제보다 강한 프라이버시를 약속하면 그것을 믿고 링크를 뿌린 사람이
위험해진다(차단 문구가 이미 같은 판단을 했다). 그리고 **주소에 무엇이 실리는가**는 이 절이
답하지 않는다 — §11이 답한다.

## 5. SSRF — 정확성의 조건

제작자가 적은 주소가 **우리 서버에서 나가는 요청**이 된다. `https:`라는 사실도 공개 호스트
이름이라는 사실도 아무것도 보장하지 않는다(이름은 제작자의 DNS가 해석한다). 지키는 것 넷이다
(`apps/api/src/lib/remote-image/fetch.ts`):

```text
이름 → 주소       lookup이 돌려준 주소 전부가 공개여야 한다(하나라도 사설이면 거절)
주소 → 연결       판정한 주소를 https.request의 lookup으로 그대로 넘긴다 — 두 번째 해석이 없다
리다이렉트        Location마다 문법 → DNS → 주소를 처음부터 다시(상한 3)
응답             image/* 넷 · 매직 바이트가 헤더와 같아야 · 10 MiB(스트림을 센다) · 10초
```

- **둘째 줄이 DNS 리바인딩 방어다.** "해석해서 공개면 `fetch(이름)`"은 그 `fetch`가 이름을 한
  번 더 해석하고 그 사이 TTL 0짜리 레코드가 답을 바꾼다. `lookup`을 넘기면 소켓은 판정한
  주소로만 열리고 SNI·`Host`는 여전히 이름이라 인증서 검증은 그대로다. 테스트가 "연결에 실린
  주소 = 해석 결과, 해석은 목적지마다 한 번"을 값으로 본다.
- **범위는 접두사 문자열이 아니다**(`address.ts`). `startsWith("10.")` 목록은 반드시 하나를
  빠뜨리고 그 하나가 `169.254.169.254`나 `100.64.0.0/10`이다. IPv4는 32비트, IPv6는 128비트
  정수로 CIDR을 견주고, IPv6 안의 IPv4(mapped·NAT64·6to4)는 꺼내서 다시 본다.
- **IP 리터럴은 문법에서 거절한다**(`asset()`·서버 둘 다). 이름을 요구하면 사설 주소의 표현
  방식(`0x7f000001`·`2130706433`·`127.1`·`[::ffff:…]`)을 세지 않아도 된다.
- **전송이 주입된다.** DNS와 소켓은 인터페이스 하나 뒤에 있어 테스트가 인터넷 없이 리다이렉트·
  사설 해석·크기·시한을 만든다. 운영 전송은 Node의 `dns.lookup` + `https.request` 하나다.

## 6. 왜 열린 프록시가 아닌가

```text
세션 필수      게스트는 401 — 그리고 그 판정이 가져오기보다 앞이다
회원당 상한    runtimeRemoteAsset 240회/분, fail-open(lib/rate-limit)
목적지 판정    §5
응답 검증      이미지 바이트만, 우리 헤더만
```

작품 자격에 묶지 않는다. 요청은 어느 작품에서 왔는지 말하지 않고, 말하게 하면 그 주장이 곧
인가가 된다 — 이미지는 제작자가 공개 인터넷에 이미 올려 둔 것이라 여기서 지키는 것은 비밀이
아니라 **우리 자원**(회선·커넥션·서버 안의 네트워크)이다.

실패는 두 코드뿐이고 세부가 없다(`runtime_asset_invalid` 400 · `runtime_asset_unavailable`
502). 사설망·404·형식·크기를 갈라 답하면 이 엔드포인트가 우리 서버 안에서 남의 네트워크를
더듬는 탐지기가 된다.

## 7. 두 검사는 다른 질문에 답한다

```text
런타임   classifyRuntimeAssetValue   모양 — 스킴·호스트 이름·포트·자격증명·조각·길이·글자   제작자에게 그 자리에서 답한다
서버     lib/remote-image            목적지 — 해석된 주소가 공개 인터넷인가                   연결 시점에 판정한다
```

앞의 것은 보안 경계가 아니고 그렇게 적지 않는다. `URL`을 쓰지 않는 이유는 VM에 없기 때문이고,
있어도 쓰지 않을 것이다 — 그 파서는 관대해서(`HTTPS://EXAMPLE.COM`·백슬래시·공백을 고쳐 준다)
제작자가 적은 것과 참조가 가리키는 것을 갈라 놓는다. 받는 것은 이미 정규화된 모양뿐이다.

상한은 논리 경로와 **다른 값**이다(`RUNTIME_REMOTE_ASSET_MAX_URL_LENGTH` = 8 KiB). 서명된 CDN
주소가 200자를 넘고, 그 상수가 유일한 출처라 서버와 공개 문서가 같은 값을 읽는다.

## 8. 실패의 모양

- 렌더러: 해석기가 `null`이면(논리 참조·손상된 값) 자리표시자. 해석기가 준 주소가 **실패**해도
  (프록시 거절·404) 같은 자리표시자 — 웹은 `error` 이벤트가 `src`를 거두고, 네이티브는 `onError`가
  상태를 접는다. 깨진 그림 아이콘을 그리지 않는다.
- 런타임: `runtime_invalid_asset_ref`는 **모양**의 오류이고 그 뒤의 실패는 렌더링의 것이다. 새
  오류 코드가 없다 — 있으면 제작자 코드가 그림 로딩을 네트워크 탐지기로 쓴다.
- 서버: 업스트림의 문장·주소·상태·스택이 응답에도 결과 객체에도 없다(`fetch.test.ts`가 결과의
  키 집합을 센다).

## 9. 하지 않은 것

- **논리 자산 호스트.** `asset("characters/…")`는 유효하되 여전히 자리표시자다. 업로드·자산
  라이브러리·발행 자산 묶음·CDN은 다른 슬라이스다.
- **발행 시점의 가져오기·복사.** 컴파일은 정적이고 원격 이미지의 가용성은 재생 시점의 것이다.
  제작자의 CDN이 죽었다고 발행이 막히지 않고, 그림을 우리 저장소로 복사하지도 않는다(소유권·
  보존·저작권이 딸린 다른 제품이다).
- **SVG·AVIF.** 두 렌더러가 같은 방식으로 그리는 래스터 넷만이다. SVG는 정화 파이프라인이
  없고 네이티브 지원이 다르다.
- **이미지 모더레이션.** 원격 이미지는 제작자가 고른 콘텐츠이고 기존 작품 신고 경로가 받는다.
  분류기·심사 큐를 만들지 않았다.
- **저장·동기화·수명주기의 변경.** 원격 주소는 소스의 값이라 어느 저장 레코드에도 오지 않고,
  그림 요청은 저장 흘려보내기와 세션 폐기를 막지 않는다.
- **캐시 인프라.** 응답은 `private, max-age=3600`이고 서버 쪽 캐시는 없다 — 내용이 우리 것이
  아니라 `immutable`이 아니다. CDN 캐시는 그 인프라가 생기는 날의 결정이다.

## 11. 인가 — 정적으로 선언된 주소만 나간다

**이 절이 §4~§7보다 뒤에 있지만 앞의 셋을 전제한다.** 기기가 직접 가져오지 않는다는 사실은
플레이어의 **접속 정보**를 가리고, SSRF 판정은 **우리 서버의 나가는 요청**을 안전하게 한다.
어느 것도 답하지 않는 질문이 하나 남아 있었다 — *그 주소를 누가 정하는가.*

### 11.1 남아 있던 구멍

`asset()`은 값을 만들 뿐 그 문자열이 어디서 왔는지 묻지 않는다. 그래서 다음이 성립했다.

```tsx
const [input, setInput] = useState("");
<TextInput value={input} onChangeText={setInput} />
<Image source={asset(`https://creator.example/pixel.png?q=${input}`)} />
```

제작자는 응답을 읽지 못한다. **그 사실이 이것을 안전하게 만들지 않는다** — 주소의 경로와
질의는 제작자의 서버에 도착하고, 거기에 실을 수 있는 것이 넓다:

```text
플레이어가 친 글 · 저장 상태(플레이스루·영구) · 생성된 AI 문장 · 선택의 이력 · 행동의 시각
```

RowCat이 대신 가져다주는 구조가 가리는 것은 **IP이지 값이 아니다.** 눈이 없는 한 방향
채널도 채널이다.

### 11.2 불변식

```text
런타임이 내보낸 원격 주소가 요청이 되려면
  → 그 주소가 **권위 있는 컴파일의 소스**에 완전한 정적 문자열로 있었어야 한다
```

만드는 쪽과 지키는 쪽이 갈려 있다.

```text
컴파일    projectRemoteAssets(소스 파일들)        → RuntimeArtifact.remoteAssets   결정적 · 중복 제거 · 코드 단위 정렬
검증      validateRuntimeArtifact                → 모양 · 정본 · 개수 256 · 전체 64 KiB
세션      RuntimeVmSession.remoteAssets          → 이 세션의 것이고 이 세션과 함께 죽는다
전달      started(웹 워커 · 네이티브 다리)         → 메인/Hermes가 아티팩트를 다시 읽지 않는다
집행      authorizeRuntimeAssetResolver          → 목록 밖이면 **주소를 만들지 않는다**
```

### 11.3 왜 "완전한 정적 문자열"인가

스코프 분석도 상수 전파도 하지 않는다. 그 둘을 만들기 시작하면 이 패스가 곧 평가기의 절반이
되고, 평가기는 제작자 코드를 실행하지 않고서는 완결되지 않는다 — 그리고 이 컴파일러는 제작자
코드를 실행하지 않는다.

```text
asset("https://cdn.example.com/a.png")     리터럴          든다
asset(`https://cdn.example.com/a.png`)     치환 없는 템플릿  든다
const U = "https://cdn…"; asset(U)         모듈의 리터럴     든다 — 그 글자가 소스에 있다
asset(`https://cdn…/${id}.png`)            치환 있는 템플릿  **완전한 글자가 없다**
asset("https://cdn…/" + id)                이어 붙이기      〃
asset(await load())                        런타임 값        〃
```

이어 붙인 주소의 **앞 조각**(`https://cdn.example.com/`)이 목록에 들어올 수는 있다. 그것은
대가가 아니라 정확히 이 규칙이 말하는 바다 — 제작자가 손으로 적은 고정 목적지이고 런타임
값을 한 글자도 나르지 않는다. 막아야 하는 것은 **조립된 결과**이고, 그 결과는 어느 리터럴과도
같지 않다.

**호출부의 이름으로 좁히지 않는다.** `asset(...)`이라는 이름만 보면 `import { asset as img }`와
주소를 넘겨받는 제작자의 헬퍼가 조용히 자리표시자가 되고, 그 실패는 발행한 **뒤에** 드러난다.
반대 방향의 대가(쓰이지 않는 주소가 목록에 하나 더 있는 것)는 아무것도 열지 않는다.

### 11.4 왜 형으로 풀지 않았는가

`asset<const T extends string>(value: T)` 같은 리터럴 형 장치는 저작 피드백이지 경계가 아니다.
`as any` 한 줄이면 지나가고, 무엇보다 **발행 아티팩트를 만드는 것은 서버의 컴파일**이라
권위는 형 검사가 아니라 그 패스의 결과여야 한다(§`publication.md`의 "서버가 컴파일의 권위").

### 11.5 옛 아티팩트 — 없는 것은 빈 것이다

`remoteAssets`가 없는 아티팩트는 **원격 주소를 하나도 인가하지 않는다.**

- "없으면 전부 허용"으로 접으면 그 필드를 지운 아티팩트 하나가 이 방어를 통째로 연다.
- 옛 아티팩트가 잃는 것은 없다 — 이 판 전에는 원격 주소를 성공적으로 쓴 발행본이 없고, 논리
  참조는 한 글자도 바뀌지 않았다.

그래서 **판을 올리지 않았다.** `RUNTIME_ARTIFACT_FORMAT_VERSION`을 올리면 옛 호스트가 새
아티팩트를 통째로 거절하고, `RUNTIME_COMPILER_VERSION`을 올리면 **이미 발행된 모든 런타임이
재발행 전까지 재생 불가**가 된다(소스가 서버에 없어 재컴파일 이관이 불가능하다 —
`player.md` §아티팩트 호환). 얻는 것이 없는 대가다: 선택 필드의 부재가 이미 안전한 쪽으로
읽힌다.

정본 바이트에는 목록이 **언제나 배열로** 들어간다(`remoteAssets: [...(artifact.remoteAssets ?? [])]`)
— 없는 것과 빈 것의 뜻이 같으므로 같은 바이트여야 한다. `sourceHash`는 소스에서만 나오므로
이 필드가 그 값을 움직이지 않는다(목록이 소스에서 결정적으로 파생되기 때문이다).

### 11.6 목록의 주인은 세션이다

전역 집합·모듈 변수·앱 상태에 두면 A 작품이 선언한 주소가 B 작품의 세션에서 열린다. **그
누출에는 증상이 없다** — 그림은 멀쩡히 뜨고, 달라지는 것은 제작자의 서버가 받는 값뿐이다.

```text
웹      전이가 시작될 때 비우고 started가 다시 채운다(ref)
네이티브 목록이 running 상태 **안**에 있어 세대가 바뀌면 저절로 사라진다
```

메인·Hermes가 아티팩트에서 목록을 스스로 뽑지 않는 것도 같은 축이다 — 세션을 세운 것은
워커/WebView이고 그 검증이 목록의 권위라, 밖에서 읽으면 **검증을 지나지 않은 값**이 해석기의
근거가 된다.

### 11.7 미리보기가 예외가 아니다

스튜디오 미리보기와 제품 재생이 **같은 컴파일러·같은 목록·같은 인가**를 쓴다. 여기서만
느슨하면 저작 중에는 그려지던 그림이 발행 뒤에 사라지고, 그 차이는 제작자가 발행한 **뒤에야**
만난다.

### 11.8 API의 방어는 줄지 않았다

두 층이 **다른 위협**을 막는다.

```text
인가 목록        제작자 코드가 목적지를 고르는 것 — 값이 밖으로 나가는 통로
프록시의 판정     우리 서버의 나가는 요청 — SSRF · 리바인딩 · 리다이렉트 · 형식 · 크기 · 시한
```

어느 쪽도 다른 쪽을 대신하지 않는다. **엔드포인트에 아티팩트를 주장하는 파라미터를 만들지
않았다**(`storyId`·`artifactId`·`allowedUrls`) — 클라이언트가 주장하는 인가는 인가가 아니고,
막는 자리는 그보다 앞이다. 제작자 VM에는 이 API를 부를 수단이 없다(`fetch`가 없다).

### 11.9 남아 있는 것

- ~~**대역폭.** 상한은 요청 수뿐이다~~ — **닫혔다.** 회원당 바이트 예산(10분에 512 MiB)이
  요청 수 상한 위에 선다. 들어올 때 응답 상한(10 MiB)만큼 예약하고 끝나면 **실제로 읽은
  바이트**로 확정한다 — 실패한 응답·형식이 틀린 본문까지. 프로세스 하나는 동시에 16개만
  버퍼링하고(넘치면 잠깐 기다린다), 플레이어가 떠나면 업스트림을 끊고 자리와 남은 예약을
  돌려준다. 숫자와 근거는 `apps/api/src/lib/remote-image/budget.ts`가 갖는다. 예산의 단위는
  **회원**이다 — 서버는 런타임 세션을 보지 못하고, 이 엔드포인트는 작품·아티팩트를 주장하는
  파라미터를 받지 않는다(주장이 곧 인가가 된다).
- **정적 목록도 몇 비트는 나른다.** 제작자가 주소 N개를 선언하고 그중 하나를 상태로 고르면
  요청 하나가 log₂N 비트를 말한다. 그것은 정적 선언 모델에 내재하고 목록 상한(256)이 그
  폭을 묶는다 — 막는 것은 **플레이어가 친 글이 그대로 나가는 것**이고, 그건 닫혔다.

## 10. 잠그는 자리

```text
packages/runtime/src/asset.test.ts                         문법 — 받는 것·거절하는 것·불투명성·신뢰된 판정
packages/runtime-compiler/src/compile.test.ts               형 — 네 조합 · 여는 함수가 제작자에게 없다
packages/runtime-host/src/root.test.ts                      와이어 — 원격·논리가 같은 표식으로 건너온다
packages/runtime-renderer-web/src/renderer.test.ts          제작자의 주소가 src에 없다 · 실패의 자리표시자
packages/runtime-renderer-web/src/pipeline.test.ts          VM → DOM 끝까지 프록시 주소
packages/runtime-renderer-native/src/image-source.test.ts   제작자의 주소가 uri에 없다
apps/api/src/lib/remote-image/address.test.ts               CIDR — 사설 대역 전부 · 임베디드 IPv4
apps/api/src/lib/remote-image/fetch.test.ts                 SSRF · 리바인딩 · 리다이렉트 · 형식 · 크기 · 시한 · 헤더 격리
apps/api/src/routes/runtime-assets.test.ts                  401 · 400 · 502 · 응답 헤더
apps/web/src/lib/runtime-assets/web-asset-resolver.test.ts  해석기의 답이 우리 오리진이다
apps/mobile/src/features/runtime-player/asset-resolver.test.ts  〃 + 세션 헤더 확정 전에는 null
apps/web/src/features/docs/runtime-docs-examples.test.ts    공개 문서의 HTTPS 예제가 컴파일되고 VM에서 마운트된다
```

인가(§11)를 잠그는 자리:

```text
packages/runtime-compiler/src/remote-assets.test.ts         정적 수집 — 리터럴·상수·다른 모듈 / 조립·함수·논리는 아니다 · 정렬 · 상한
packages/runtime-host/src/artifact.test.ts                  목록 검증 — 없으면 빈 것 · 정본화 · 비원격·개수·길이 거절
packages/runtime-host/src/remote-assets.test.ts             **진짜 VM** — 친 글이 실린 주소가 목록 밖이다 · 세션 사이 격리
apps/web/src/lib/runtime-assets/web-asset-resolver.test.ts  인가된 해석기 — 목록 밖이면 주소를 만드는 일 자체가 없다
apps/mobile/src/features/runtime-player/asset-resolver.test.ts  〃(네이티브)
apps/web/src/features/runtime-preview/runtime-preview-boundaries.test.ts  렌더러가 받는 해석기가 인가를 지난다
apps/web/src/features/runtime-player/runtime-player-boundaries.test.ts    〃 + 아티팩트에서 목록을 뽑지 않는다
apps/mobile/src/lib/runtime-native/runtime-native-boundaries.test.ts      〃(네이티브) + 다리가 목록을 나른다
apps/web/src/features/docs/runtime-docs-remote-assets.test.ts             문서가 정적 규칙과 **정확한 프라이버시**를 적는다
```
