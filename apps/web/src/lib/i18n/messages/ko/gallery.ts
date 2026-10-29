import type { Messages } from "../../types.ts";

export const gallery: Messages["gallery"] = {
	title: "발견",
	openPreview: "미리보기 열기",
	gate: {
		adultVerificationTitle: "성인인증이 필요합니다",
		adultVerificationBody:
			"성인향 작품은 성인인증을 마친 회원만 볼 수 있습니다. 다른 등급으로 둘러보거나 인증을 마친 뒤 다시 시도해 주세요.",
		adultOffTitle: "성인 콘텐츠 표시가 꺼져 있습니다",
		adultOffBody:
			"설정에서 성인 콘텐츠 표시를 켜면 볼 수 있습니다. 지금은 다른 등급으로 둘러볼 수 있습니다.",
		recheckTitle: "본인확인을 다시 해 주세요",
		recheckBody:
			"마지막 본인확인 후 1년이 지났습니다. 계정 화면에서 본인확인을 다시 하면 성인향 작품을 볼 수 있습니다.",
		loginTitle: "로그인이 필요합니다",
		loginBody: "이 목록은 로그인한 회원만 볼 수 있습니다.",
	},
	loadFailed: "작품을 불러오지 못했습니다",
	retryLater: "잠시 후 다시 시도해 주세요.",
	resetFilters: "필터 초기화",
	requestId: "요청 ID: {{id}}",
	appliedFilters: "적용된 필터",
	unit_one: "편",
	unit_other: "편",
	searchLabel: "작품 검색",
	searchPlaceholder: "제목, 작가, 설명, 태그, 제작자로 검색",
	clearSearch: "검색어 지우기",
	end: "마지막 작품까지 모두 보았습니다.",
	loadMoreFailed: "작품을 더 불러오지 못했습니다.",
	loading: "불러오는 중…",
	showMore: "더 보기",
	loadingMore: "작품을 더 불러오는 중입니다",
	loadingList: "작품 목록을 불러오는 중입니다",
	followingEmptyTitle: "아직 팔로우한 제작자가 없습니다",
	followingEmptyBody:
		"마음에 드는 작품의 제작자를 팔로우하면 이곳에 새 작품이 모입니다.",
	browse: "작품 둘러보기",
	filteredEmpty: "조건에 맞는 작품이 없습니다",
	empty: "아직 작품이 없습니다",
	emptyBody: "첫 작품이 올라오면 여기에 표시됩니다.",
	sortTrigger: "정렬: {{label}}",
	sort: "정렬",
	period: "기간",
	filter: "필터",
	all: "전체",
	followingOnly: "팔로우한 제작자만",
};
