# API 업데이트 가이드 (Blocks & Flows 표준화)

이 문서는 `GET /blocks` API의 표준화 및 신규 확장 API(`categories`, `flows`, `block detail`) 작업 내용을 요약합니다. 브랜치 커밋 및 PR 작성 시 참고하시기 바랍니다.

## 1. 주요 변경 사항

### API 표준화 및 하위 호환성 (Compatibility)

- **`GET /blocks`**: 기존의 `list` 필드 외에, 프론트엔드에서 사용하기 편한 평면적 구조의 `blocks` 필드를 추가했습니다.
- **데이터 구조**: `$definition` 내부의 복잡한 계층을 제거하고 `id`, `name`, `description`, `input`, `output` 등의 평면적인 키-값 구조로 변환했습니다.
- **필터링**: `?category={CategoryName}` 쿼리 파라미터를 통해 특정 카테고리 블록만 효율적으로 조회할 수 있습니다.

### 신규 API 추가

1. **`GET /blocks/categories`**: 시스템에 정의된 모든 고유 카테고리 명칭 목록을 반환합니다. (예: `["Utility", "Search", "Media"]`)
2. **`GET /blocks/{id}`**: 특정 블록의 상세 메타데이터를 표준 규격으로 조회합니다.
3. **`GET /flows`**: 저장된 모든 워크플로우의 요약 정보 목록을 조회합니다.

---

## 2. 응답 데이터 예시 (Response Examples)

### `GET /blocks` (표준/기존 병행 응답)

```json
{
  "blocks": [
    {
      "id": "blk-search",
      "name": "Search Agent",
      "description": "웹 검색 및 트렌드 데이터 수집",
      "input": {},
      "output": { "out": "json" },
      "category": "Search"
    }
  ],
  "list": [
    {
      "$definition": { "id": "blk-search", "label": "Search Agent", ... },
      "isFrontend": 0,
      ...
    }
  ]
}
```

### `GET /blocks/categories`

```json
{
    "categories": ["Utility", "Search", "Content", "Media"]
}
```

---

## 3. 엔드포인트 요약 (Endpoint Summary)

| Method | Path                 | Description                   | Query Params      |
| :----- | :------------------- | :---------------------------- | :---------------- |
| `GET`  | `/blocks`            | 전체 블록 목록 (Dual Support) | `category` (필터) |
| `GET`  | `/blocks/categories` | 사용 가능한 카테고리 목록     | -                 |
| `GET`  | `/blocks/{id}`       | 특정 블록 상세 정보           | -                 |
| `GET`  | `/flows`             | 저장된 워크플로우 요약 리스트 | -                 |

---

## 4. 로컬 테스트 및 검증 결과

본 변경 사항은 **Serverless Offline (v3)** 환경에서 **Postman**을 통해 검증 완료되었습니다.

1. **서버 실행**: `yarn workspace @flows/backend start`
2. **검증 내용**:
    - 모든 API 응답 Status Code: `200 OK` 확인
    - `blocks`와 `list` 필드의 데이터 정합성 확인
    - `category` 필터링 시 해당 카테고리 외 데이터가 포함되지 않음을 확인
    - `/blocks/categories` 응답의 고유성 및 데이터 형식 확인

---

## 5. 관련 파일 내역

- `libs/contracts/src/http/blocks.schema.ts`: 블록 관련 Zod 스키마 확장
- `libs/contracts/src/http/flows.schema.ts`: 워크플로우 관련 Zod 스키마 확장
- `apps/backend/src/handlers/http/blocks/list-blocks.ts`: 메타데이터 매핑 및 필터링 로직 (수정)
- `apps/backend/src/handlers/http/blocks/get-categories.ts`: 카테고리 조회 핸들러 (**신규**)
- `apps/backend/src/handlers/http/blocks/get-block.ts`: 개별 블록 조회 핸들러 (**신규**)
- `apps/backend/src/handlers/http/flows/list-flows.ts`: 워크플로우 목록 조회 핸들러 (**신규**)
- `apps/backend/serverless.yml`: 라우팅 설정 변경

---

## 6. 커밋 메시지 추천 (Conventional Commits)

```text
feat(api): standardize blocks response and add categories/flows listing

- Implement standardized block format (id, name, input, output)
- Add GET /blocks/categories for UI dynamic tabs
- Add GET /flows for workflow dashboard listing
- Add GET /blocks/{id} for detailed block metadata
- Maintain backward compatibility with legacy 'list' format
- Verified via Postman local testing (Status 200)
```
