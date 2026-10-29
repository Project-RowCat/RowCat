import type { Messages } from "../../types.ts";

export const story: Messages["story"] = {
	starting: "준비하는 중…",
	related: "관련 작품",
	backToDiscover: "발견으로",
	startFailure: {
		play_unavailable: "이 작품은 아직 대화를 시작할 수 없습니다.",
		storage: "대화를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		unknown: "대화를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
	},
	navigateFailure:
		"대화는 만들어졌지만 화면을 열지 못했습니다. 대화 목록에서 이어갈 수 있습니다.",
	share: {
		label: "작품 공유",
		copied: "링크를 복사했습니다",
		failed: "공유하지 못했습니다",
	},
	error: {
		notFound: "작품을 찾을 수 없습니다",
		loadFailed: "작품을 불러오지 못했습니다",
		notFoundBody: "존재하지 않거나 현재 볼 수 없는 작품입니다.",
		retryLater: "잠시 후 다시 시도해 주세요.",
		requestId: "요청 ID: {{id}}",
	},
	persona: {
		newTitle: "새 페르소나",
		chooseTitle: "이 대화에서 나는",
		newBody: "만들면 이 대화에 곧바로 적용됩니다.",
		chooseBody:
			"고른 역할의 이름이 내 발화의 화자가 되고, 설명은 모델이 읽는 설정에 들어갑니다.",
		createAndChoose: "만들고 고르기",
		legend: "이 대화의 페르소나",
		create: "새 페르소나",
		starting: "시작하는 중…",
	},
	info: "작품 정보",
	coverAlt: "{{title}} 표지",
	mine: "내 작품",
	reportTarget: "작품",
	reportMenu: "작품 신고 메뉴",
	descriptionLabel: "작품 설명",
	noDescription: "설명이 없습니다.",
	tagsLabel: "태그",
	findByTag: "태그 {{tag}}로 작품 찾기",
	close: "닫기",
	details: "상세보기",
	start: "시작하기",
	loading: "작품을 불러오는 중입니다",
	properties: {
		created: "등록",
		updated: "수정",
		author: "작가 표기",
		size: "크기",
		body: "본문",
		protected: "프롬프트 보호본",
	},
};
