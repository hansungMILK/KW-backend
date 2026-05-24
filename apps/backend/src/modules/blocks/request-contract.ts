import { isImageGenerationRequestText } from '../request-intent';

export type OutputKind = 'text' | 'image' | 'audio' | 'video' | 'data' | 'unknown';

export type ContentIntent =
    | 'single-image'
    | 'blog-post'
    | 'shorts'
    | 'longform'
    | 'explanation'
    | 'research'
    | 'unknown';

export type ContentMode = 'creative-simulation';

export interface RequestUnderstanding {
    /** User-visible phrases preserved before canonicalization. AI routing/review must see these. */
    surfaceTerms: string[];
    focusEntities: string[];
    actions: string[];
    constraints: string[];
    styleHints: string[];
}

export interface RequestSpec {
    userRequest: string;
    contentIntent: ContentIntent;
    outputKind: OutputKind;
    contentMode?: ContentMode;
    understanding: RequestUnderstanding;
    /** Backward-compatible alias for understanding.focusEntities. */
    focusTerms: string[];
    exactSubjectRequired: boolean;
}

export interface SourceCoverage {
    status: 'direct' | 'supporting' | 'unrelated';
    matchedTerms: string[];
    missingTerms: string[];
    reason: string;
}

export interface OutputContract {
    requestTopic: string;
    outputKind: OutputKind;
    contentMode?: ContentMode;
    requiredCoverageTerms: string[];
    exactSubjectRequired: boolean;
}

const COMMAND_STOPWORDS = new Set([
    '쇼츠',
    '쇼츠생성',
    '쇼츠생성해줘',
    '생성',
    '만들어줘',
    '만들',
    '만들어',
    '주제',
    '설명',
    '상황극',
    '재연',
    '컨트리볼',
    '국가볼',
    '폴란드볼',
    '편',
    '영상',
    '가상',
    '상황',
    '시뮬레이션',
    '대결',
    '승부',
    '싸우면',
    '맞붙는다면',
    '누가',
    '이길까',
    '어떻게',
    '되는지',
    '해줘',
    '그려',
    '그려줘',
    '그려라',
    '그려주세요',
    '그걸',
    '이걸',
    '저걸',
    '보여줘',
    '관한',
    '관련',
    '대하여',
    '내용',
    '블로그',
    '글',
    '써줘',
    '작성',
    '사진',
    '이미지',
    '하나',
    '롱폼',
    '링크',
    'short',
    'shorts',
    'countryball',
    'countryballs',
    'polandball',
    'video',
    'draw',
    'paint',
    'illustrate',
    'sketch',
    'about',
    'or',
    'vs',
    'versus',
]);

const PARTICIPANT_MODIFIER_WORDS = new Set([
    '만약',
    '처음부터',
    '초반',
    '중반',
    '후반',
    '풀전력',
    '모드',
    '상태',
    '버전',
    '폼',
    '각성',
    '최종',
    '최강',
    '전성기',
]);

const DIRECT_SUBJECT_MARKERS = /편|논란|사건|특집|제품|모델|기사|링크|url|ipo|yes|no|[a-z0-9]/i;
const SIMULATION_CONTEXT_PATTERN =
    /가상|시뮬레이션|상상|만약|설정상|세계관|풀전력|hypothetical|simulation|scenario|what\s*if/i;
const CONFRONTATION_PATTERN =
    /누가\s*이길|이기(?:나|는지|면|ㄹ|겠)|승부|대결|맞붙|붙는다면|붙으면|싸우면|싸운다면|상대한다면|전투|결투|상성|매치업|\bvs\b|versus|who\s*wins|fight|battle|duel|matchup/i;
const CONDITIONAL_CONFRONTATION_PATTERN =
    /싸우면|싸운다면|대결하면|맞붙으면|맞붙는다면|붙으면|붙는다면|상대하면|상대한다면|겨루면|겨룬다면/i;

export function buildRequestSpec(input: unknown): RequestSpec {
    const userRequest = extractUserRequest(input);
    const normalized = normalizeRequestText(userRequest);
    const understanding = buildRequestUnderstanding(userRequest);
    const focusTerms = understanding.focusEntities;
    const { contentIntent, outputKind } = classifyIntent(normalized);
    const contentMode = classifyContentMode(normalized, contentIntent);

    return {
        userRequest,
        contentIntent,
        outputKind,
        ...(contentMode ? { contentMode } : {}),
        understanding,
        focusTerms,
        exactSubjectRequired:
            focusTerms.length >= 2 || /https?:\/\//i.test(userRequest) || DIRECT_SUBJECT_MARKERS.test(normalized),
    };
}

export function buildRequestUnderstanding(request: string): RequestUnderstanding {
    const normalized = normalizeRequestText(request);
    const surfaceTerms = extractSurfaceTerms(request);
    const styleHints = extractStyleHints(normalized);
    const confrontation = extractConfrontationUnderstanding(normalized);

    if (confrontation.focusEntities.length >= 2) {
        return {
            surfaceTerms,
            ...confrontation,
            styleHints,
        };
    }

    const sceneActions = extractSceneActionSlots(normalized);
    const textForFocus = removePhrases(
        normalized,
        sceneActions.map(action => action.phrase)
    );
    const focusEntities = uniqueTerms([
        ...extractGenericFocusTerms(textForFocus),
        ...sceneActions.flatMap(action => action.entities),
    ]).slice(0, 12);

    return {
        surfaceTerms,
        focusEntities,
        actions: uniqueTerms(sceneActions.map(action => action.phrase)),
        constraints: [],
        styleHints,
    };
}

function extractSurfaceTerms(request: string): string[] {
    const cleaned = request
        .replace(/https?:\/\/[^\s"'<>]+/gi, ' ')
        .replace(/^(쇼츠|롱폼|이미지|사진|그림|블로그|글|영상)?\s*(생성해줘|만들어줘|그려줘|써줘)?[.:：]?\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return [];
    return [cleaned.slice(0, 160)];
}

export function extractFocusTerms(request: string): string[] {
    return buildRequestUnderstanding(request).focusEntities;
}

type PartialRequestUnderstanding = Pick<RequestUnderstanding, 'focusEntities' | 'actions' | 'constraints'>;

function extractConfrontationUnderstanding(normalized: string): PartialRequestUnderstanding {
    if (!CONFRONTATION_PATTERN.test(normalized) && !CONDITIONAL_CONFRONTATION_PATTERN.test(normalized)) {
        return { focusEntities: [], actions: [], constraints: [] };
    }

    const segments: string[] = [];
    const patterns: RegExp[] = [
        /(.+?)\s+(?:vs|versus|대)\s+(.+?)(?=\s*(?:싸우|싸운|대결|붙|맞붙|누가|중|쇼츠|영상|그려|만들|$))/i,
        /(.+?)(?:와|과|랑|하고|이랑)\s+(.+?)(?:가|이|은|는)?\s*(?:싸우|싸운|대결|붙|맞붙|겨루)/,
        /(.+?)(?:와|과|랑|하고|이랑)\s+(.+?)\s+중\s+누가/,
        /(?:만약\s+)?(.+?)(?:가|이|은|는)\s+(.+?)(?:를|을|와|과|랑|하고|이랑)\s*(?:상대|싸우|대결|맞붙|겨루)/,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match) continue;
        for (const part of match.slice(1)) {
            if (part) segments.push(part);
        }
        break;
    }

    if (segments.length === 0) return { focusEntities: [], actions: [], constraints: [] };

    return {
        focusEntities: uniqueTerms(segments.flatMap(segment => extractParticipantTerms(segment))).slice(0, 12),
        actions: extractConfrontationActions(normalized),
        constraints: uniqueTerms(segments.flatMap(segment => extractParticipantConstraints(segment))).slice(0, 12),
    };
}

function extractParticipantTerms(segment: string): string[] {
    const tokens = tokenizeFocusText(segment);
    if (tokens.length === 0) return [];

    const hasModeDescriptor = tokens.some(token => PARTICIPANT_MODIFIER_WORDS.has(cleanFocusToken(token, 0, 1)));
    const cleaned = tokens
        .map((token, index) => cleanFocusToken(token, index, tokens.length))
        .filter(Boolean)
        .filter(term => !COMMAND_STOPWORDS.has(term))
        .filter(term => !PARTICIPANT_MODIFIER_WORDS.has(term));

    if (hasModeDescriptor && cleaned.length > 0) {
        return [cleaned[cleaned.length - 1]];
    }

    return cleaned;
}

function extractParticipantConstraints(segment: string): string[] {
    const terms = tokenizeFocusText(segment)
        .map((token, index, tokens) => cleanFocusToken(token, index, tokens.length))
        .filter(Boolean)
        .filter(term => !COMMAND_STOPWORDS.has(term));
    const constraints: string[] = [];

    for (let index = 0; index < terms.length; index += 1) {
        const term = terms[index];
        if (!term || !PARTICIPANT_MODIFIER_WORDS.has(term)) continue;
        const previous = terms[index - 1];
        constraints.push(previous && !PARTICIPANT_MODIFIER_WORDS.has(previous) ? `${previous} ${term}` : term);
    }

    return constraints;
}

function extractConfrontationActions(normalized: string): string[] {
    return uniqueTerms(
        normalized.match(
            /싸우면|싸운다면|대결하면|맞붙으면|맞붙는다면|붙으면|붙는다면|상대하면|상대한다면|겨루면|겨룬다면/gi
        ) ?? []
    ).slice(0, 6);
}

interface SceneActionSlot {
    phrase: string;
    entities: string[];
}

function extractSceneActionSlots(normalized: string): SceneActionSlot[] {
    const slots: SceneActionSlot[] = [];
    const patterns = [
        /(?:[a-z0-9가-힣\s]+?)(?:가|이|은|는)\s+([a-z0-9가-힣\s]{2,60}?(?:는|하는|한|할))\s+(?:상황|장면|모습|이미지|사진|포스터|일러스트)/gi,
        /(?:[a-z0-9가-힣\s]+?)\s+([a-z0-9가-힣\s]{2,60}?(?:는|하는|한|할))\s+(?:상황|장면|모습|이미지|사진|포스터|일러스트)/gi,
    ];

    for (const pattern of patterns) {
        for (const match of normalized.matchAll(pattern)) {
            const phrase = match[1]?.trim();
            if (!phrase || COMMAND_STOPWORDS.has(phrase)) continue;
            slots.push({
                phrase,
                entities: extractActionEntities(phrase),
            });
        }
    }

    return dedupeActionSlots(slots);
}

function extractActionEntities(actionPhrase: string): string[] {
    const tokens = tokenizeFocusText(actionPhrase);
    if (tokens.length <= 1) return [];
    return tokens
        .slice(0, -1)
        .map((token, index) => cleanFocusToken(token, index, tokens.length - 1))
        .filter(Boolean)
        .filter(term => !COMMAND_STOPWORDS.has(term))
        .filter(term => term.length > 1);
}

function dedupeActionSlots(slots: SceneActionSlot[]): SceneActionSlot[] {
    const byPhrase = new Map<string, SceneActionSlot>();
    for (const slot of slots) {
        if (!byPhrase.has(slot.phrase)) byPhrase.set(slot.phrase, slot);
    }
    return [...byPhrase.values()];
}

function extractGenericFocusTerms(text: string): string[] {
    const terms = tokenizeFocusText(text);
    return terms
        .map((term, index) => cleanFocusToken(term, index, terms.length))
        .filter(term => term.length > 0)
        .filter(term => !COMMAND_STOPWORDS.has(term))
        .filter(term => !/^(쇼츠|영상|설명|이미지|사진|블로그|롱폼)/.test(term))
        .filter(term => term.length > 1);
}

function extractStyleHints(normalized: string): string[] {
    return uniqueTerms(
        [
            /실사풍|사진풍|아이폰|iphone|애니메이션|애니풍|만화풍|블루프린트|신문|레트로|로고|아이콘|포스터|시네마틱|cinematic|컨트리볼|국가볼|폴란드볼|countryballs?|polandball|상황극|재연/gi,
        ].flatMap(pattern => normalized.match(pattern) ?? [])
    ).slice(0, 8);
}

function removePhrases(text: string, phrases: string[]): string {
    let output = text;
    for (const phrase of phrases) {
        output = output.replace(new RegExp(escapeRegExp(phrase), 'gi'), ' ');
    }
    return output.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeFocusText(text: string): string[] {
    return text.match(/[a-z0-9가-힣]+/g) ?? [];
}

function cleanFocusToken(token: string, index: number, total: number): string {
    let cleaned = token.trim().toLowerCase();
    if (cleaned.endsWith('의') && index < total - 1) return '';

    for (const suffix of [
        '에게서는',
        '한테서는',
        '으로는',
        '로는',
        '에게',
        '한테',
        '께서',
        '께',
        '에서는',
        '에서',
        '부터',
        '까지',
        '하고',
        '이랑',
        '와',
        '과',
        '랑',
        '은',
        '는',
        '이',
        '가',
        '을',
        '를',
        '의',
        '도',
        '만',
    ]) {
        if (cleaned.length > suffix.length + 1 && cleaned.endsWith(suffix)) {
            cleaned = cleaned.slice(0, -suffix.length);
            break;
        }
    }

    return cleaned;
}

function uniqueTerms(terms: string[]): string[] {
    return [...new Set(terms.filter(Boolean))];
}

export function classifySourceCoverage(article: Record<string, unknown>, requestSpec: RequestSpec): SourceCoverage {
    const text = normalizeRequestText(
        [
            article['title'],
            article['summary'],
            article['fullText'],
            Array.isArray(article['keyClaims']) ? article['keyClaims'].join(' ') : undefined,
        ]
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
    );
    const matchedTerms = requestSpec.focusTerms.filter(term => text.includes(normalizeRequestText(term)));
    const missingTerms = requestSpec.focusTerms.filter(term => !matchedTerms.includes(term));
    const hasExplicitLimitation = hasCoverageLimitation(text);

    if (requestSpec.focusTerms.length === 0) {
        return {
            status: 'supporting',
            matchedTerms,
            missingTerms,
            reason: '요청 핵심어가 명확하지 않아 배경 근거로 분류했습니다.',
        };
    }

    if (missingTerms.length === 0 && !hasExplicitLimitation) {
        return {
            status: 'direct',
            matchedTerms,
            missingTerms,
            reason: '요청 핵심어를 모두 포함하는 직접 근거입니다.',
        };
    }

    if (matchedTerms.length > 0) {
        return {
            status: 'supporting',
            matchedTerms,
            missingTerms: hasExplicitLimitation
                ? requestSpec.focusTerms.filter(term => term !== matchedTerms[0])
                : missingTerms,
            reason: hasExplicitLimitation
                ? '출처가 요청한 세부 주제를 직접 다루지 않는다고 밝혀 배경 참고 근거로만 사용할 수 있습니다.'
                : '일부 핵심어만 포함해 배경 참고 근거로만 사용할 수 있습니다.',
        };
    }

    return {
        status: 'unrelated',
        matchedTerms,
        missingTerms,
        reason: '요청 핵심어를 포함하지 않아 직접 근거로 사용할 수 없습니다.',
    };
}

function hasCoverageLimitation(text: string): boolean {
    return (
        /직접.{0,16}(다루지|설명하지|포함하지|언급하지)/.test(text) ||
        /(다루진|다루지는|다루지|설명하진|설명하지|포함하지|언급하지).{0,20}(않|못|아니)/.test(text) ||
        /(자체|세부|특정).{0,20}(다루진|다루지|설명하진|설명하지)/.test(text) ||
        /\b(?:does not|do not|not)\s+(?:cover|explain|mention|include)\b/.test(text)
    );
}

export function buildOutputContract(requestSpec: RequestSpec, outputKind?: OutputKind): OutputContract {
    return {
        requestTopic: requestSpec.userRequest,
        outputKind: outputKind ?? requestSpec.outputKind,
        ...(requestSpec.contentMode ? { contentMode: requestSpec.contentMode } : {}),
        requiredCoverageTerms: requestSpec.focusTerms,
        exactSubjectRequired: requestSpec.exactSubjectRequired,
    };
}

function classifyIntent(normalized: string): { contentIntent: ContentIntent; outputKind: OutputKind } {
    if (/롱폼|longform|긴\s*영상|유튜브\s*영상/.test(normalized)) {
        return { contentIntent: 'longform', outputKind: 'video' };
    }
    if (/쇼츠|shorts|릴스|틱톡/.test(normalized)) {
        return { contentIntent: 'shorts', outputKind: 'video' };
    }
    if (/블로그|포스트|게시글|\b글\b/.test(normalized)) {
        return { contentIntent: 'blog-post', outputKind: 'text' };
    }
    if (isImageGenerationRequestText(normalized)) {
        return { contentIntent: 'single-image', outputKind: 'image' };
    }
    if (/설명해줘|정리해줘|요약해줘|설명하기/.test(normalized)) {
        return { contentIntent: 'explanation', outputKind: 'text' };
    }
    return { contentIntent: 'unknown', outputKind: 'unknown' };
}

function classifyContentMode(normalized: string, contentIntent: ContentIntent): ContentMode | undefined {
    if (contentIntent !== 'shorts' && contentIntent !== 'longform') return undefined;
    const hasSimulationContext = SIMULATION_CONTEXT_PATTERN.test(normalized);
    const hasConfrontation = CONFRONTATION_PATTERN.test(normalized);
    const hasConditionalConfrontation = CONDITIONAL_CONFRONTATION_PATTERN.test(normalized);

    if ((hasSimulationContext && hasConfrontation) || hasConditionalConfrontation) {
        return 'creative-simulation';
    }

    return undefined;
}

function extractUserRequest(input: unknown): string {
    if (input == null) return '사용자 요청';
    if (typeof input === 'string') return input.trim().slice(0, 500) || '사용자 요청';

    if (isRecord(input)) {
        for (const key of ['requestTopic', 'userRequest', 'originalRequest', 'topic', 'query', 'content', 'text']) {
            const value = input[key];
            if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, 500);
        }

        const requestSpec = input['requestSpec'];
        if (isRecord(requestSpec) && typeof requestSpec['userRequest'] === 'string') {
            return requestSpec['userRequest'].trim().slice(0, 500);
        }

        const out = input['out'];
        if (isRecord(out) && typeof out['value'] === 'string' && out['value'].trim().length > 0) {
            return out['value'].trim().slice(0, 500);
        }
    }

    return String(JSON.stringify(input)).slice(0, 500);
}

function normalizeRequestText(input: string): string {
    return input
        .toLowerCase()
        .replace(/(^|[^a-z0-9가-힣])예스(?=$|[^a-z0-9가-힣])/g, '$1yes')
        .replace(/(^|[^a-z0-9가-힣])오어(?=$|[^a-z0-9가-힣])/g, '$1or')
        .replace(/(^|[^a-z0-9가-힣])노(?=$|[^a-z0-9가-힣])/g, '$1no')
        .replace(/\s+/g, ' ')
        .trim();
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
