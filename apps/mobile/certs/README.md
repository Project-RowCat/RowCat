# OTA 서명 인증서

채널마다 하나 — `rowcat-<preview|testflight|production>-<세대>.pem`. **공개 값이라 커밋한다.**
바이너리가 이 파일을 `Expo.plist`·`AndroidManifest`에 박고, 그 바이너리는 이 인증서로 검증되는
manifest만 실행한다.

- 만드는 길은 `pnpm mobile:update keys:generate <채널> --key-out <저장소 밖>` 하나다. 개인 키는 저장소
  밖에만 쓰이고(CI 비밀로 옮긴다), 이 폴더에는 인증서만 온다 — `src/lib/updates-boundaries.test.ts`가
  `PRIVATE KEY`의 부재와 이 폴더의 파일이 인증서라는 것을 함께 본다.
- 어느 파일을 믿는가는 `app.config.ts`의 `OTA_SIGNING_KEY_ID`가 정한다. 파일이 없으면 그 채널의 EAS
  빌드가 멈춘다.
- 덮어쓰지 않는다. 교체는 다음 세대의 새 파일이다(`docs/ota/OPERATIONS.md`의 「서명 신뢰 교체」).
