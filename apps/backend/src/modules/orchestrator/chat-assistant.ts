import { openaiAdapter } from '../../adapters/ai/openai-adapter';
import { env } from '../../config/env';

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
    'build',
    'create',
    'generate',
    'make',
    'run',
    'execute',
    'automate',
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
] as const;

const normalizeIntentText = (text: string): string => text.toLowerCase().replace(/\s+/g, '');

const hasWorkflowProposalSignal = (text: string): boolean => {
    const normalized = normalizeIntentText(text);
    const hasAction = WORKFLOW_ACTION_TERMS.some(term => normalized.includes(term));
    const hasTarget = WORKFLOW_TARGET_TERMS.some(term => normalized.includes(term));
    return hasAction && hasTarget;
};

const AVAILABLE_BLOCKS = [
    'search',
    'content',
    'data',
    'analysis',
    'media-image',
    'media-tts',
    'media-video',
    'integration',
] as const;

const INTENT_ROUTER_SYSTEM_PROMPT = `You route messages for Flow Agent, a Korean workflow-building chatbot.
Return JSON only.

Choose "proposal" when the user is asking the product to create, design, run, modify, or approve a workflow/automation/Shorts/video/image pipeline now.
Only choose "proposal" when the workflow/video/image/automation creation intent is explicit.
If the message is a greeting, reaction, short phrase, vague topic, or casual chat without an explicit make/create/run/design request, choose "chat".
If a workflow creation request is explicit but missing details, choose "proposal"; the orchestrator will use sensible defaults and surface assumptions.
Do not choose "chat" just to ask audience/tone/detail questions when the user clearly says "make/create/build/generate".
Choose "chat" for greetings, small talk, questions about capabilities, vague messages, troubleshooting, or when you need to explain/clarify before creating a workflow.

Schema:
{ "action": "chat" | "proposal", "reason": "short Korean reason" }`;

const INTENT_ROUTER_EXAMPLES = `Examples:
- "ㅎㅇ" -> {"action":"chat","reason":"인사"}
- "뭐 할 수 있어?" -> {"action":"chat","reason":"기능 질문"}
- "바나나가 춤추는 이미지 생성해줘" -> {"action":"proposal","reason":"이미지 생성 워크플로우 요청"}
- "입시정보 쇼츠 만들어줘" -> {"action":"proposal","reason":"쇼츠 제작 요청"}
- "뉴스 요약 영상 생성해줘" -> {"action":"proposal","reason":"영상 워크플로우 생성 요청"}
- "이 플로우 실행해줘" -> {"action":"proposal","reason":"실행 요청"}`;

const CHAT_SYSTEM_PROMPT = `You are Flow Agent inside a serverless n8n-like workflow builder.
Answer in Korean, naturally and briefly.

Product reality:
- You can help users design workflows from natural language.
- Current executable block catalog: ${AVAILABLE_BLOCKS.join(', ')}.
- The first polished template is Shorts creation: search -> content -> data -> analysis -> media-image + media-tts -> media-video -> integration.
- Standalone image generation uses the minimal content -> media-image workflow.
- A one-minute Shorts video is made from 10-15 vertical images, captions, OpenAI TTS, BGM, and FFmpeg MP4 composition.
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
    if (!hasWorkflowProposalSignal(userMessage)) {
        return { action: 'chat', reason: '워크플로우 생성/실행 의도가 명시되지 않음' };
    }

    if (env.orchestratorMode === 'mock') {
        return { action: 'proposal', reason: 'mock orchestrator mode' };
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
