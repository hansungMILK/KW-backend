import type { BlockExecutor, BlockExecutorResult } from '../types';

export const countryballAnalysisBlock: BlockExecutor = {
    blockType: 'countryball-analysis',

    async execute(input: unknown): Promise<BlockExecutorResult> {
        const start = Date.now();
        const root = isRecord(input) ? input : {};
        const scenes = Array.isArray(root['normalizedScenes'])
            ? root['normalizedScenes'].filter(isRecord)
            : Array.isArray(root['scenes'])
              ? root['scenes'].filter(isRecord)
              : [];
        if (scenes.length === 0) {
            throw new Error('Analysis rejected content: 컨트리볼 장면 계약이 없습니다.');
        }

        const issues = validateScenes(scenes);
        const blocking = issues.filter(issue => issue.severity === 'high' || issue.severity === 'critical');
        if (blocking.length > 0) {
            throw new Error(`Analysis rejected content: ${blocking.map(issue => issue.message).join(' / ')}`);
        }

        return {
            output: {
                safetyScore: issues.some(issue => issue.severity === 'medium') ? 82 : 95,
                qualityScore: issues.length > 0 ? 84 : 94,
                issues,
                approved: true,
                normalizedScenes: scenes,
                cast: Array.isArray(root['cast']) ? root['cast'] : [],
                metadata: {
                    ...(isRecord(root['metadata']) ? root['metadata'] : {}),
                    presetId: 'countryball-shorts',
                    contentProfileId: 'shorts.countryball.v1',
                    narrativeMode: 'countryball-dialogue-skit',
                    imageStyleId: 'countryball-comic',
                },
            },
            durationMs: Date.now() - start,
        };
    },
};

function validateScenes(
    scenes: Record<string, unknown>[]
): Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; message: string; sceneNumber?: number }> {
    const issues: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; message: string; sceneNumber?: number }> =
        [];
    let dialogueSceneCount = 0;
    let actionSceneCount = 0;
    const dialogueCountries = new Set<string>();
    const dialogueVoiceRoles = new Set<string>();

    scenes.forEach((scene, index) => {
        const sceneNumber = typeof scene['sceneNumber'] === 'number' ? scene['sceneNumber'] : index + 1;
        const dialogueLines = Array.isArray(scene['dialogueLines']) ? scene['dialogueLines'].filter(isRecord) : [];
        const screenAction = text(scene['screenAction']);
        const captionOverlay = Array.isArray(scene['captionOverlay']) ? scene['captionOverlay'].filter(isRecord) : [];

        if (!text(scene['scenePurpose'])) {
            issues.push({ severity: 'high', message: '컨트리볼 장면에는 scenePurpose가 필요합니다.', sceneNumber });
        }
        if (!text(scene['visualTone'])) {
            issues.push({ severity: 'medium', message: '컨트리볼 장면에는 visualTone이 필요합니다.', sceneNumber });
        }
        if (!screenAction || /설명|해설|보여줍니다|정리합니다/.test(screenAction)) {
            issues.push({
                severity: 'high',
                message: '컨트리볼 장면은 설명이 아니라 화면 행동으로 구성되어야 합니다.',
                sceneNumber,
            });
        } else {
            actionSceneCount += 1;
        }
        if (dialogueLines.length > 0) dialogueSceneCount += 1;
        if (index < scenes.length - 1 && dialogueLines.length < 1) {
            issues.push({ severity: 'high', message: '일반 컨트리볼 장면에는 국가볼 대사가 필요합니다.', sceneNumber });
        }
        if (captionOverlay.length === 0) {
            issues.push({
                severity: 'high',
                message: '컨트리볼 장면에는 자막 배치용 captionOverlay가 필요합니다.',
                sceneNumber,
            });
        }
        for (const line of dialogueLines) {
            const country = text(line['country']);
            const lineText = text(line['line'] ?? line['text']);
            const voiceRole = text(line['voiceRole']);
            if (!country || !lineText) {
                issues.push({ severity: 'high', message: '컨트리볼 대사는 country와 line이 필요합니다.', sceneNumber });
            }
            if (!voiceRole) {
                issues.push({
                    severity: 'high',
                    message: '컨트리볼 대사는 role-based voiceRole이 필요합니다.',
                    sceneNumber,
                });
            }
            if (country && lineText && hasMechanicalJapaneseSuffix(country, lineText)) {
                issues.push({
                    severity: 'high',
                    message: '일본볼 말투는 기계적 접미사 붙이기가 아니라 짧고 자연스러운 캐릭터 말투여야 합니다.',
                    sceneNumber,
                });
            }
            if (isLectureLikeDialogue(lineText)) {
                issues.push({
                    severity: 'critical',
                    message: '컨트리볼 대사는 강의형 대사가 아니라 상황 속 짧은 반응이어야 합니다.',
                    sceneNumber,
                });
            }
            if (isWeakAcceptanceLine(lineText)) {
                issues.push({
                    severity: 'high',
                    message: '컨트리볼 엔딩/반응은 납득 설명으로 끝나면 안 됩니다.',
                    sceneNumber,
                });
            }
            if (country) dialogueCountries.add(country);
            if (voiceRole) dialogueVoiceRoles.add(voiceRole);
        }
        for (const overlay of captionOverlay) {
            if (overlay['type'] === 'dialogue' && !text(overlay['speakerCountry'])) {
                issues.push({
                    severity: 'high',
                    message: 'dialogue captionOverlay에는 speakerCountry가 필요합니다.',
                    sceneNumber,
                });
            }
        }
        const narratorText = narratorLineText(scene['narratorLine']);
        if (narratorText.length > 32 || /공식 지표|보도에 따르면|출처|자료에 따르면/.test(narratorText)) {
            issues.push({
                severity: 'high',
                message: '컨트리볼 narratorLine은 짧은 제목/시간점프/엔딩 외 설명문이면 안 됩니다.',
                sceneNumber,
            });
        }
    });

    const minDialogueScenes = Math.max(3, Math.ceil(scenes.length * 0.65));
    const minActionScenes = Math.max(3, Math.ceil(scenes.length * 0.8));
    if (dialogueSceneCount < minDialogueScenes) {
        issues.push({ severity: 'high', message: '컨트리볼 쇼츠는 해설보다 국가볼 대화가 중심이어야 합니다.' });
    }
    if (actionSceneCount < minActionScenes) {
        issues.push({
            severity: 'high',
            message: '컨트리볼 상황극은 설명보다 구체적인 행동 장면이 중심이어야 합니다.',
        });
    }
    if (dialogueCountries.size >= 2 && dialogueVoiceRoles.size < 2) {
        issues.push({ severity: 'high', message: '여러 국가볼이 말하면 최소 2개 이상의 voiceRole이 필요합니다.' });
    }
    return issues;
}

function narratorLineText(input: unknown): string {
    if (typeof input === 'string') return input.trim();
    if (isRecord(input) && typeof input['text'] === 'string') return input['text'].trim();
    return '';
}

function text(input: unknown): string {
    return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
}

function hasMechanicalJapaneseSuffix(country: string, line: string): boolean {
    if (!/일본|japan/i.test(country)) return false;
    return /(요|네요|합니다|입니다|하죠|하지요)[.。!！?？]*\s*(데스|です)[!！.。?？]*$/i.test(line);
}

function isLectureLikeDialogue(line: string): boolean {
    const lectureTerms = ['인프라', '자동화', '투자', '전국망', '시스템', '구조', '정책', '고도화'];
    const causalTerms = ['그러니까', '때문', '가능', '굴러', '묶어', '처리', '운영'];
    const lectureTermCount = lectureTerms.filter(term => line.includes(term)).length;
    if (lectureTermCount >= 2) return true;
    return lectureTermCount >= 1 && causalTerms.some(term => line.includes(term)) && line.length > 28;
}

function isWeakAcceptanceLine(line: string): boolean {
    return /납득|이해했어|이해했어요|완전 이해|오케이.*이제/.test(line);
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return input != null && typeof input === 'object' && !Array.isArray(input);
}
