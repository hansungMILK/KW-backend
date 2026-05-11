import { describe, expect, it } from 'vitest';

import { compileWorkflowPlan, seedRootBlockInputs } from './workflow-compiler';
import {
    buildImageGenerationPreferences,
    enrichImageNodeConfig,
    estimateGptImage2CostUsd,
} from '../image-generation/image-style';

describe('compileWorkflowPlan', () => {
    it('rejects video blocks when the workflow plan is text-only', () => {
        const result = compileWorkflowPlan({
            plan: {
                goal: '링크 내용을 요약한다',
                outputType: 'text',
                planType: 'one-shot',
                requiredCapabilities: ['source.collect', 'text.generate'],
                selectedBlocks: [
                    { blockType: 'search', reason: '링크 내용을 수집한다' },
                    { blockType: 'content', reason: '요약문을 작성한다' },
                    { blockType: 'media-video', reason: '불필요한 영상 합성' },
                ],
                rejectedBlocks: [],
                assumptions: [],
            },
            blocks: [
                { type: 'search', label: '링크 내용 수집', config: {} },
                { type: 'content', label: '요약 작성', config: {} },
                { type: 'media-video', label: '영상 합성', config: {} },
            ],
            edges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
            ],
            estimatedCostUsd: 0.2,
            summary: '링크를 요약합니다.',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('media-video');
    });

    it('accepts a generic shorts video pipeline when video capability is required', () => {
        const result = compileWorkflowPlan({
            plan: {
                goal: '링크 내용을 쇼츠 영상으로 만든다',
                outputType: 'video',
                planType: 'pipeline',
                requiredCapabilities: [
                    'source.collect',
                    'text.generate',
                    'data.structure',
                    'quality.review',
                    'image.generate',
                    'audio.tts',
                    'video.compose',
                    'metadata.generate',
                ],
                selectedBlocks: [
                    { blockType: 'search', reason: '근거를 수집한다' },
                    { blockType: 'content', reason: '대본을 작성한다' },
                    { blockType: 'data', reason: '장면 데이터를 구조화한다' },
                    { blockType: 'analysis', reason: '품질을 검수한다' },
                    { blockType: 'media-image', reason: '장면 이미지를 만든다' },
                    { blockType: 'media-tts', reason: '나레이션을 만든다' },
                    { blockType: 'media-video', reason: '영상으로 합성한다' },
                    { blockType: 'integration', reason: '메타데이터를 만든다' },
                ],
                rejectedBlocks: [],
                assumptions: [],
            },
            blocks: [
                { type: 'search', label: '자료 수집', config: {} },
                { type: 'content', label: '대본 생성', config: { scenes: 12 } },
                { type: 'data', label: '데이터 정규화', config: {} },
                { type: 'analysis', label: '품질 검수', config: {} },
                { type: 'media-image', label: '이미지 생성', config: { count: 12 } },
                { type: 'media-tts', label: '음성 생성', config: {} },
                { type: 'media-video', label: '영상 합성', config: {} },
                { type: 'integration', label: '메타데이터 생성', config: {} },
            ],
            edges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
                { from: 2, to: 3 },
                { from: 3, to: 4 },
                { from: 3, to: 5 },
                { from: 4, to: 6 },
                { from: 5, to: 6 },
                { from: 6, to: 7 },
            ],
            estimatedCostUsd: 0.9,
            summary: '쇼츠 영상을 만듭니다.',
        });

        expect(result.ok).toBe(true);
    });

    it('rejects video composition without both image and tts upstream edges', () => {
        const result = compileWorkflowPlan({
            plan: {
                goal: '쇼츠 영상 생성',
                outputType: 'video',
                planType: 'pipeline',
                requiredCapabilities: ['image.generate', 'audio.tts', 'video.compose'],
                selectedBlocks: [
                    { blockType: 'media-image', reason: '이미지 생성' },
                    { blockType: 'media-tts', reason: '음성 생성' },
                    { blockType: 'media-video', reason: '영상 합성' },
                ],
                rejectedBlocks: [],
                assumptions: [],
            },
            blocks: [
                { type: 'media-image', label: '이미지 생성', config: {} },
                { type: 'media-tts', label: '음성 생성', config: {} },
                { type: 'media-video', label: '영상 합성', config: {} },
            ],
            edges: [{ from: 0, to: 2 }],
            estimatedCostUsd: 0.4,
            summary: '쇼츠 영상을 만듭니다.',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('media-tts');
    });

    it('seeds root search blocks with the original user request when the AI omitted input config', () => {
        const seeded = seedRootBlockInputs(
            {
                plan: {
                    goal: '링크 내용을 쇼츠 영상으로 만든다',
                    outputType: 'video',
                    planType: 'pipeline',
                    requiredCapabilities: ['source.collect', 'text.generate'],
                    selectedBlocks: [
                        { blockType: 'search', reason: '링크를 확인한다' },
                        { blockType: 'content', reason: '대본을 만든다' },
                    ],
                    rejectedBlocks: [],
                    assumptions: [],
                },
                blocks: [
                    { type: 'search', label: '링크 내용 수집', config: {} },
                    { type: 'content', label: '쇼츠 대본 생성', config: {} },
                ],
                edges: [{ from: 0, to: 1 }],
                estimatedCostUsd: 0.1,
                summary: '링크 기반 쇼츠를 만듭니다.',
            },
            '쇼츠 만들어줘 https://tikongs.tistory.com/1463'
        );

        expect(seeded.blocks[0].config.query).toBe('쇼츠 만들어줘 https://tikongs.tistory.com/1463');
        expect(seeded.blocks[1].config.topic).toBeUndefined();
    });

    it('does not overwrite explicit root block input config', () => {
        const seeded = seedRootBlockInputs(
            {
                plan: {
                    goal: 'KTX 설명문',
                    outputType: 'text',
                    planType: 'pipeline',
                    requiredCapabilities: ['source.collect', 'text.generate'],
                    selectedBlocks: [
                        { blockType: 'search', reason: '자료 수집' },
                        { blockType: 'content', reason: '설명 작성' },
                    ],
                    rejectedBlocks: [],
                    assumptions: [],
                },
                blocks: [
                    { type: 'search', label: '자료 수집', config: { query: 'KTX 예매 어려운 이유' } },
                    { type: 'content', label: '설명 작성', config: {} },
                ],
                edges: [{ from: 0, to: 1 }],
                estimatedCostUsd: 0.1,
                summary: 'KTX 설명문을 만듭니다.',
            },
            '다른 사용자 요청'
        );

        expect(seeded.blocks[0].config.query).toBe('KTX 예매 어려운 이유');
    });

    it('estimates gpt-image-2 vertical shorts image cost by scene count and quality', () => {
        expect(estimateGptImage2CostUsd(12, 'low')).toBe(0.06);
        expect(estimateGptImage2CostUsd(12, 'medium')).toBe(0.492);
        expect(estimateGptImage2CostUsd(12, 'high')).toBe(1.98);
    });

    it('builds image generation preferences with animation style when requested', () => {
        const prefs = buildImageGenerationPreferences({
            userMessage: '기술 이슈 쇼츠 만들어줘. 이번에는 애니메이션 풍으로 그려줘라.',
            sceneCount: 12,
            imageQuality: 'medium',
            textAndOtherEstimatedCostUsd: 0.18,
        });

        expect(prefs.model).toBe('gpt-image-2');
        expect(prefs.imageStyleId).toBe('animation');
        expect(prefs.imageStyleLabel).toBe('애니메이션');
        expect(prefs.imageEstimatedCostUsd).toBe(0.492);
        expect(prefs.estimatedTotalCostUsd).toBe(0.672);
        expect(prefs.styleOptions.some(option => option.id === 'animation')).toBe(true);
    });

    it('does not leak invalid scene counts into media-image node config', () => {
        const prefs = buildImageGenerationPreferences({
            userMessage: '쇼츠 만들어줘',
            sceneCount: 12,
            imageQuality: 'medium',
        });

        expect(enrichImageNodeConfig({ count: 'not-a-number' }, prefs)).toEqual(
            expect.objectContaining({
                count: 12,
                imageModel: 'gpt-image-2',
            })
        );
    });
});
