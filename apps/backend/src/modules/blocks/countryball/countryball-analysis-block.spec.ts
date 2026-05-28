import { describe, expect, it } from 'vitest';

import { countryballAnalysisBlock } from './countryball-analysis-block';

describe('countryballAnalysisBlock', () => {
    it('approves action-first dialogue scenes with caption overlays', async () => {
        const scenes = makeScenes();

        const result = await countryballAnalysisBlock.execute({
            normalizedScenes: scenes,
            cast: [
                { country: 'A', role: 'main', voiceRole: 'main_confident' },
                { country: 'B', role: 'reactor', voiceRole: 'panic_high' },
            ],
            metadata: { requestTopic: '사용자 요청 상황극' },
        });

        expect(result.output).toMatchObject({
            approved: true,
            normalizedScenes: scenes,
            metadata: expect.objectContaining({
                presetId: 'countryball-shorts',
                narrativeMode: 'countryball-dialogue-skit',
            }),
        });
    });

    it('rejects explainer-like scenes before media generation', async () => {
        const scenes = makeScenes().map(scene => ({
            ...scene,
            screenAction: '이 장면은 주제를 설명합니다',
            dialogueLines: [],
            captionOverlay: [],
        }));

        await expect(countryballAnalysisBlock.execute({ normalizedScenes: scenes })).rejects.toThrow(
            /화면 행동|국가볼 대사|captionOverlay/
        );
    });

    it('requires dialogue caption overlays to identify their speaker', async () => {
        const scenes = makeScenes();
        scenes[0] = {
            ...scenes[0],
            captionOverlay: [
                {
                    type: 'dialogue',
                    text: '잠깐!',
                    anchorTarget: 'speaker',
                    preferredPosition: 'middle-right',
                    style: 'yellowBlack',
                },
            ],
        };

        await expect(countryballAnalysisBlock.execute({ normalizedScenes: scenes })).rejects.toThrow(/speakerCountry/);
    });

    it('rejects multi-country dialogue that collapses to one voiceRole', async () => {
        const scenes = makeScenes().map(scene => ({
            ...scene,
            dialogueLines: scene.dialogueLines.map(line => ({ ...line, voiceRole: 'main_confident' })),
        }));

        await expect(countryballAnalysisBlock.execute({ normalizedScenes: scenes })).rejects.toThrow(
            /여러 국가볼이 말하면 최소 2개 이상의 voiceRole/
        );
    });

    it('rejects mechanical Japanese countryball suffixes before TTS', async () => {
        const scenes = makeScenes();
        scenes[0] = {
            ...scenes[0],
            dialogueLines: [
                {
                    country: '일본',
                    line: '이건 진짜 빠르네요. 데스!',
                    tone: 'panicked',
                    voiceRole: 'panic_high',
                },
                {
                    country: '한국',
                    line: '아침에 와.',
                    tone: 'confident',
                    voiceRole: 'main_confident',
                },
            ],
        };

        await expect(countryballAnalysisBlock.execute({ normalizedScenes: scenes })).rejects.toThrow(
            /일본볼 말투|기계적/
        );
    });

    it('rejects lecture-style infrastructure dialogue and weak acceptance endings', async () => {
        const scenes = makeScenes();
        scenes[2] = {
            ...scenes[2],
            dialogueLines: [
                {
                    country: '한국',
                    line: '투자 크게 하고, 자동화 깔고, 전국망으로 묶어. 그러니까 빨라지는 거지.',
                    tone: 'explainer',
                    voiceRole: 'main_confident',
                },
                {
                    country: '미국',
                    line: '오케이, 이제 완전 납득.',
                    tone: 'flat',
                    voiceRole: 'panic_high',
                },
            ],
        };

        await expect(countryballAnalysisBlock.execute({ normalizedScenes: scenes })).rejects.toThrow(
            /강의형 대사|납득/
        );
    });
});

function makeScenes() {
    return Array.from({ length: 5 }, (_, index) => ({
        sceneId: `scene-${index + 1}`,
        sceneNumber: index + 1,
        scenePurpose: `갈등과 반응을 보여주는 장면 ${index + 1}`,
        location: 'shorts skit stage',
        visualTone: index === 0 ? 'panic' : 'comedy',
        screenAction: `A countryball pushes a prop toward B countryball while B jumps back in surprise ${index + 1}`,
        dialogueLines: [
            {
                country: 'A',
                line: index === 0 ? '지금 바로 간다!' : '내 차례야!',
                tone: 'confident',
                voiceRole: 'main_confident',
            },
            {
                country: 'B',
                line: index === 0 ? '벌써?' : '잠깐만!',
                tone: 'panicked',
                voiceRole: 'panic_high',
            },
        ],
        expressionChanges: ['A has confident eyes', 'B has shocked eyes'],
        sfx: ['fast whoosh'],
        editBeat: 'quick zoom on the reaction',
        narratorLine: index === 0 ? { text: '오늘의 상황', voiceRole: 'narrator_short' } : null,
        captionOverlay: [
            {
                type: 'dialogue',
                text: index === 0 ? '지금 바로 간다!' : '내 차례야!',
                speakerCountry: 'A',
                anchorTarget: 'speaker',
                preferredPosition: 'middle-left',
                style: 'yellowBlack',
            },
        ],
    }));
}
