import type { Messages } from "../../types.ts";

export const discover: Messages["discover"] = {
	offline: "네트워크에 연결되어 있지 않습니다. 연결되면 자동으로 이어집니다.",
	loadFailed: "작품을 불러오지 못했습니다.",
	followingEmptyTitle: "팔로우한 제작자가 없습니다",
	followingEmptyDescription:
		"마음에 드는 작품의 제작자를 팔로우하면 새 작품이 여기에 모입니다.",
	browse: "작품 둘러보기",
	filteredEmptyTitle: "조건에 맞는 작품이 없습니다",
	resetFilters: "필터 초기화",
	emptyTitle: "아직 작품이 없습니다",
	emptyDescription: "첫 작품이 올라오면 여기에 나타납니다.",
	end: "마지막 작품입니다",
	filter: "필터",
	all: "전체",
	sort: "정렬",
	period: "기간",
	sortTrigger: "정렬: {{label}}",
	totalOne: "작품 1개",
	total: "작품 {{total}}개",
	searchLabel: "작품 검색",
	searchPlaceholder: "제목·작가·설명·제작자로 검색",
	cardHint: "작품 상세를 엽니다",
};
