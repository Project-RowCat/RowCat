import type { Messages } from "../../types.ts";

export const conversation: Messages["conversation"] = {
	failure: {
		opaque: "응답을 받지 못했습니다.",
		managedUnavailable: "지금은 이 모델로 대화를 생성할 수 없습니다.",
		rateLimited: "생성 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
		managedNotAllowed:
			"이 서버의 기본 AI는 허용된 계정만 쓸 수 있어요. AI 설정에서 개인 API 키를 연결해 주세요.",
		persistenceFailed: "응답을 이 기기에 저장하지 못했습니다.",
		emptyAnswer: "응답에 본문이 없어 저장되지 않았습니다.",
	},
	actions: {
		continue: "이어서 생성",
		retry: "다시 생성",
		providerSettings: "AI 설정 열기",
	},
	copy: {
		idle: "{{noun}} 복사",
		copied: "복사됨",
		failed: "복사하지 못했습니다",
		announceCopied: "{{noun}}를 복사했습니다",
		announceFailed: "{{noun}}를 복사하지 못했습니다",
		nouns: {
			message: "메시지",
			block: "블록",
			request: "요청",
			lore: "로어",
			scanText: "스캔 텍스트",
			value: "값",
			previousValue: "이전 값",
		},
	},
};
