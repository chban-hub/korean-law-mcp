# Changelog

## [1.9.0] - 2026-03-15

### Fixed
- HWP 구형 파서: `controls` 내 테이블(표) 추출 지원
  - `hwp.js`의 `paragraph.controls[].content` 경로에서 테이블 구조(rows/cells) 탐색
  - 기존에는 `paragraph.content`만 탐색하여 표 형식 HWP 파싱 실패

## [1.8.1] - 2026-03-15

### Changed
- MCP 도구 스키마 최적화: description 압축 + apiKey 은닉

## [1.8.0] - 2026-03-10

### Added
- 체인 도구 7개: chain_law_system, chain_action_basis, chain_dispute_prep, chain_amendment_track, chain_ordinance_compare, chain_full_research, chain_procedure_detail
- get_batch_articles: `laws` 배열 파라미터로 복수 법령 일괄 조회 지원
- search_ai_law: `lawTypes` 필터로 법령종류별 결과 필터링
- truncateSections(): 체인 도구 섹션별 응답 크기 최적화
- truncateResponse summary 모드: 긴 응답 자동 요약
- unwrapZodEffects: .refine() 스키마의 MCP 호환성 개선
- 구조화된 에러 포맷: [에러코드] + 도구명 + 제안

### Changed
- formatToolError: ZodError 자동 감지, 구조화된 출력
- toMcpInputSchema: ZodEffects unwrap 후 JSON Schema 변환
- 총 도구 수: 57 → 64
