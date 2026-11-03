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
	adultBadge: "성인",
	deletedComment: "삭제된 댓글입니다.",
	viewReply: "답글 1개 보기",
	viewReplies: "답글 {{total}}개 보기",
	filterToken: "{{axis}}: {{value}}",
	filterTag: "{{axis}}: #{{value}}",
	filterRemove: "{{axis}} {{value}} 필터 제거",
	filterRemoveAxis: "{{axis}} 필터 제거",
	sortTrigger: "{{sort}} · {{period}}",
};
