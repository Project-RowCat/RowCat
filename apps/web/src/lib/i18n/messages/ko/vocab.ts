import type { Messages } from "../../types.ts";

export const vocab: Messages["vocab"] = {
	orientation: { female: "여성향", male: "남성향", all: "전연령" },
	rating: { any: "전체", sfw: "전체이용가", adult: "성인" },
	sort: { recent: "최신순", popular: "인기순", relevance: "관련순" },
	period: {
		all: "전체 기간",
		day: "오늘",
		week: "최근 7일",
		month: "최근 30일",
	},
	filterAxis: {
		orientation: "성향",
		rating: "이용 등급",
		tag: "태그",
		following: "팔로잉",
	},
	visibility: {
		public: "공개",
		unlisted: "링크 공개",
		private: "비공개",
		archived: "보관",
	},
	start: { chat: "대화 시작", runtime: "플레이" },
	deletedCreator: "탈퇴한 제작자",
	unnamedProfile: "이름 없는 제작자",
	adultBadge: "성인",
	untitled: "제목 없음",
	pinnedNotice: {
		hidden: "운영 정책에 따라 숨겨져 프로필에 보이지 않습니다.",
		private: "비공개 상태라 프로필에 보이지 않습니다.",
		unlisted: "링크 공개 상태라 프로필에 보이지 않습니다.",
		archived: "보관 상태라 프로필에 보이지 않습니다.",
		public: "",
	},
	filterToken: "{{axis}}: {{value}}",
	filterTag: "{{axis}}: #{{value}}",
	filterRemove: "{{axis}} {{value}} 필터 제거",
	filterRemoveAxis: "{{axis}} 필터 제거",
	sortTrigger: "{{sort}} · {{period}}",
};
