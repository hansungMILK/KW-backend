import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';
import { isImageGenerationRequestText, normalizeIntentText } from '../request-intent';

import type { Message } from '@flows/contracts';

type ChatIntent = {
    action: 'chat' | 'proposal';
    reason?: string;
};

const WORKFLOW_ACTION_TERMS = [
    '만들',
    '제작',
    '생성',
    '설계',
    '짜줘',
    '구성',
    '실행',
    '자동화',
    '설명',
    '요약',
    '정리',
    '분석',
    '알려',
    '해설',
    '읽어',
    '브리핑',
    'build',
    'create',
    'generate',
    'make',
    'run',
    'execute',
    'automate',
    'explain',
    'summarize',
    'analyze',
    'brief',
    'review',
] as const;

const WORKFLOW_TARGET_TERMS = [
    '워크플로',
    '플로우',
    '자동화',
    '파이프라인',
    '노드',
    '블록',
    '쇼츠',
    '이미지',
    '그림',
    '사진',
    '일러스트',
    '영상',
    '비디오',
    '콘텐츠',
    '롱폼',
    '긴영상',
    '유튜브',
    '대본',
    '스크립트',
    '링크',
    '주소',
    'url',
    '본문',
    '원문',
    '기사',
    '글',
    '페이지',
    'workflow',
    'flow',
    'automation',
    'pipeline',
    'node',
    'block',
    'shorts',
    'image',
    'picture',
    'photo',
    'illustration',
    'video',
    'longform',
    'youtube',
    'script',
    'link',
    'source',
    'article',
    'page',
] as const;

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;

const URL_SOURCE_TERMS = [
    '링크',
    '주소',
    'url',
    '본문',
    '원문',
    '기사',
    '글',
    '페이지',
    '사이트',
    '출처',
    'link',
    'source',
    'article',
    'page',
] as const;

const LONGFORM_TARGET_TERMS = ['롱폼', '긴영상', '유튜브', 'longform', 'youtube'] as const;

const hasAnyTerm = (normalizedText: string, terms: readonly string[]): boolean =>
    terms.some(term => normalizedText.includes(term.toLowerCase()));

const getDeterministicProposalReason = (text: string): string | undefined => {
    const normalized = normalizeIntentText(text);
    const hasAction = hasAnyTerm(normalized, WORKFLOW_ACTION_TERMS);
    const hasTarget = hasAnyTerm(normalized, WORKFLOW_TARGET_TERMS);
    const hasUrl = URL_PATTERN.test(text);
    const hasUrlSource = hasAnyTerm(normalized, URL_SOURCE_TERMS);
    const hasLongformTarget = hasAnyTerm(normalized, LONGFORM_TARGET_TERMS);

    if (hasUrl && (hasAction || hasTarget || hasUrlSource)) {
        return 'URL 원문 수집 기반 워크플로우 요청';
    }

    if (hasLongformTarget && hasAction) {
        return '롱폼 제작 워크플로우 요청';
    }

    if (isImageGenerationRequestText(text)) {
        return '이미지 생성 워크플로우 요청';
    }

    return undefined;
};

const hasWorkflowProposalSignal = (text: string): boolean => {
    const normalized = normalizeIntentText(text);
    const hasAction = hasAnyTerm(normalized, WORKFLOW_ACTION_TERMS);
    const hasTarget = hasAnyTerm(normalized, WORKFLOW_TARGET_TERMS);
    return Boolean(getDeterministicProposalReason(text)) || (hasAction && hasTarget);
};

const isObviousChatMessage = (text: string): boolean => {
    const normalized = normalizeIntentText(text).replace(/[?!?.。！？]+$/g, '');
    return (
        /^(ㅎㅇ|하이|안녕|안녕하세요|hi|hello|hey)$/.test(normalized) ||
        /^(뭐할수있어|무엇을할수있어|기능이뭐야|사용법|도움말|help)$/.test(normalized)
    );
};

const AVAILABLE_BLOCKS = [
    'search',
    'countryball-brief',
    'countryball-angle-lab',
    'countryball-writer-brain',
    'countryball-script',
    'countryball-data',
    'countryball-analysis',
    'countryball-image',
    'countryball-tts',
    'countryball-video',
    'content',
    'data',
    'analysis',
    'media-image',
    'media-tts',
    'media-video',
    'integration',
    'longform-source',
    'longform-brief',
    'longform-script',
    'longform-storyboard',
    'longform-scene-json',
    'longform-review',
    'longform-tts',
    'longform-srt-align',
    'longform-motion-compose',
    'longform-render',
    'longform-qa',
    'longform-package',
] as const;

const INTENT_ROUTER_SYSTEM_PROMPT = `You route messages for Flow Agent, a Korean workflow-building chatbot.
Return JSON only.

Choose "proposal" when the user is asking the product to create, design, run, modify, or approve a workflow/automation/Shorts/video/image pipeline now.
Only choose "proposal" when the workflow/video/image/automation creation intent is explicit.
If the message is a greeting, reaction, short phrase, vague topic, or casual chat without an explicit make/create/run/design request, choose "chat".
If a workflow creation request is explicit but missing details, choose "proposal"; the orchestrator will use sensible defaults and surface assumptions.
If the message contains a URL and asks to explain, summarize, make a video, make Shorts, make longform, or write a script from that URL, choose "proposal"; URL source collection is handled by workflow blocks.
If the user asks to draw, paint, sketch, illustrate, make a logo, make an image-like visual, or create a scene visually, choose "proposal" even if the word "image" is not present.
Do not choose "chat" just to ask audience/tone/detail questions when the user clearly says "make/create/build/generate".
Choose "chat" for greetings, small talk, questions about capabilities, vague messages, troubleshooting, or when you need to explain/clarify before creating a workflow.

Schema:
{ "action": "chat" | "proposal", "reason": "short Korean reason" }`;

const INTENT_ROUTER_EXAMPLES = `Examples:
- "ㅎㅇ" -> {"action":"chat","reason":"인사"}
- "뭐 할 수 있어?" -> {"action":"chat","reason":"기능 질문"}
- "바나나가 춤추는 이미지 생성해줘" -> {"action":"proposal","reason":"이미지 생성 워크플로우 요청"}
- "캐릭터들이 서로 대치하는 상황을 그려줘" -> {"action":"proposal","reason":"이미지 생성 워크플로우 요청"}
- "신규 서비스 로고 하나 뽑아줘" -> {"action":"proposal","reason":"이미지 생성 워크플로우 요청"}
- "최신 이슈를 쇼츠로 만들어줘" -> {"action":"proposal","reason":"쇼츠 제작 요청"}
- "뉴스 요약 영상 생성해줘" -> {"action":"proposal","reason":"영상 워크플로우 생성 요청"}
- "이 링크 내용 설명해줘 https://example.com/post" -> {"action":"proposal","reason":"URL 원문 기반 설명 요청"}
- "롱폼만들어줘. 주제는 이 링크 설명해주기 https://example.com/post" -> {"action":"proposal","reason":"URL 원문 기반 롱폼 제작 요청"}
- "이 플로우 실행해줘" -> {"action":"proposal","reason":"실행 요청"}`;

const CHAT_SYSTEM_PROMPT = `You are Flow Agent inside a serverless n8n-like workflow builder.
Answer in Korean, naturally and briefly.

Product reality:
- You can help users design workflows from natural language.
- Current executable block catalog: ${AVAILABLE_BLOCKS.join(', ')}.
- The first polished template is Shorts creation: search -> content -> data -> analysis -> media-image + media-tts -> media-video -> integration.
- Standalone image generation uses the minimal content -> media-image workflow.
- A one-minute Shorts video defaults to 12 vertical images, with user-selectable 8/12/16 scene counts, captions, TTS narration, BGM, and FFmpeg MP4 composition.
- URL links are valid workflow sources. Do not say you cannot open/read URLs when the user is asking to make, explain, summarize, script, Shorts, video, or longform content from a URL.
- Do not claim that a workflow, image, audio, or video was created unless the system actually creates it.
- If the user only greets you, greet back and suggest one concrete next request.
- If the user asks a vague production request, ask the smallest necessary clarifying question or offer a sensible default.
- If a user asks for missing/dynamic block creation, say it is not implemented yet and suggest using the current block catalog.`;

const serializeHistory = (messages: Message[]): string =>
    messages
        .slice(-8)
        .map(message => `${message.role}: ${message.content}`)
        .join('\n');

export async function classifyMessageIntent(
    userMessage: string,
    history: Message[],
    currentContext?: Record<string, unknown>
): Promise<ChatIntent> {
    const deterministicProposalReason = getDeterministicProposalReason(userMessage);
    if (deterministicProposalReason) {
        return { action: 'proposal', reason: deterministicProposalReason };
    }

    if (isObviousChatMessage(userMessage)) {
        return { action: 'chat', reason: '워크플로우 생성/실행 의도가 명시되지 않음' };
    }

    if (env.orchestratorMode === 'mock') {
        return hasWorkflowProposalSignal(userMessage)
            ? { action: 'proposal', reason: 'mock orchestrator mode' }
            : { action: 'chat', reason: 'mock orchestrator mode: 워크플로우 의도 불명확' };
    }

    const response = await openaiAdapter.chatJson({
        model: env.openaiOrchestratorModel,
        systemPrompt: `${INTENT_ROUTER_SYSTEM_PROMPT}\n\n${INTENT_ROUTER_EXAMPLES}`,
        userMessage: JSON.stringify(
            {
                userMessage,
                recentHistory: serializeHistory(history),
                currentContext: currentContext ?? null,
            },
            null,
            2
        ),
        maxTokens: 256,
    });

    const parsed = JSON.parse(response.content) as Partial<ChatIntent>;
    return parsed.action === 'proposal'
        ? { action: 'proposal', reason: parsed.reason }
        : { action: 'chat', reason: parsed.reason };
}

export async function generateChatReply(
    userMessage: string,
    history: Message[],
    currentContext?: Record<string, unknown>
): Promise<string> {
    const response = await openaiAdapter.chatText({
        model: env.openaiModel,
        systemPrompt: CHAT_SYSTEM_PROMPT,
        userMessage: JSON.stringify(
            {
                userMessage,
                recentHistory: serializeHistory(history),
                currentContext: currentContext ?? null,
            },
            null,
            2
        ),
        maxTokens: 512,
    });

    return response.content;
}
