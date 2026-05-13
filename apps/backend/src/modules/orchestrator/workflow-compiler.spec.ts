import { describe, expect, it } from 'vitest';

import { compileWorkflowPlan, seedRootBlockInputs } from './workflow-compiler';
import {
    buildImageGenerationPreferences,
    enrichImageNodeConfig,
    estimateGptImage2CostUsd,
} from '../image-generation/image-style';

describe('compileWorkflowPlan', () => {
    it('accepts a full longform production factory without shorts media blocks', () => {
        const result = compileWorkflowPlan({
            plan: {
                goal: '롱폼 제작 기획안을 만들고 사용자가 검수한다',
                outputType: 'data',
                planType: 'interactive',
                requiredCapabilities: [
                    'source.collect',
                    'longform.brief',
                    'longform.script',
                    'longform.storyboard',
                    'longform.scene-json',
                    'longform.review',
                    'longform.tts',
                    'longform.srt-align',
                    'longform.motion-compose',
                    'longform.render',
                    'longform.qa',
                    'longform.package',
                ],
                selectedBlocks: [
                    { blockType: 'longform-source', reason: '원문과 보조 자료를 수집한다' },
                    { blockType: 'longform-brief', reason: '영상 관점과 구조를 잡는다' },
                    { blockType: 'longform-script', reason: '롱폼 내레이션 초안을 작성한다' },
                    { blockType: 'longform-storyboard', reason: '대본을 visual chapter로 바꾼다' },
                    { blockType: 'longform-scene-json', reason: 'renderer 입력 계약을 만든다' },
                    { blockType: 'longform-review', reason: '유료 제작 전 사용자 검수를 받는다' },
                    { blockType: 'longform-tts', reason: '승인된 대본으로 TTS를 만든다' },
                    { blockType: 'longform-srt-align', reason: 'TTS timing 기준으로 SRT를 정렬한다' },
                    { blockType: 'longform-motion-compose', reason: 'HyperFrames 모션 composition을 만든다' },
                    { blockType: 'longform-render', reason: '2K MP4를 렌더한다' },
                    { blockType: 'longform-qa', reason: 'MP4 품질을 검수한다' },
                    { blockType: 'longform-package', reason: '최종 미리보기와 다운로드 패키지를 만든다' },
                ],
                rejectedBlocks: [
                    { blockType: 'media-image', reason: '롱폼은 승인 전 이미지 생성 중심 플로우가 아니다' },
                    { blockType: 'media-tts', reason: '승인 전 TTS 비용을 발생시키지 않는다' },
                    { blockType: 'media-video', reason: '승인 전 MP4 렌더를 실행하지 않는다' },
                ],
                assumptions: ['장면 수와 화풍은 사용자가 고르지 않는다'],
            },
            blocks: [
                { type: 'longform-source', label: '롱폼 자료 수집', config: { mode: 'longform-gate-a' } },
                { type: 'longform-brief', label: '롱폼 관점 설계', config: { mode: 'longform-gate-a' } },
                { type: 'longform-script', label: '롱폼 대본 작성', config: { mode: 'longform-gate-a' } },
                {
                    type: 'longform-storyboard',
                    label: '롱폼 스토리보드',
                    config: { mode: 'longform-gate-a' },
                },
                {
                    type: 'longform-scene-json',
                    label: '롱폼 장면 계약',
                    config: { mode: 'longform-gate-a', renderer: 'hyperframes' },
                },
                { type: 'longform-review', label: '롱폼 사용자 검수', config: { mode: 'longform-gate-a' } },
                { type: 'longform-tts', label: '롱폼 음성 생성', config: { mode: 'longform-gate-b' } },
                { type: 'longform-srt-align', label: '롱폼 자막 정렬', config: { mode: 'longform-gate-b' } },
                { type: 'longform-motion-compose', label: '롱폼 모션 설계', config: { mode: 'longform-gate-b' } },
                { type: 'longform-render', label: '롱폼 2K 렌더', config: { mode: 'longform-gate-b' } },
                { type: 'longform-qa', label: '롱폼 QA', config: { mode: 'longform-gate-b' } },
                { type: 'longform-package', label: '롱폼 패키지', config: { mode: 'longform-gate-b' } },
            ],
            edges: [
                { from: 0, to: 1 },
                { from: 1, to: 2 },
                { from: 2, to: 3 },
                { from: 3, to: 4 },
                { from: 4, to: 5 },
                { from: 5, to: 6 },
                { from: 6, to: 7 },
                { from: 7, to: 8 },
                { from: 8, to: 9 },
                { from: 9, to: 10 },
                { from: 10, to: 11 },
            ],
            estimatedCostUsd: 0.82,
            summary: '검수 후 제작까지 이어지는 롱폼 공장을 만듭니다.',
        });

        expect(result.ok).toBe(true);
    });

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
        expect(prefs.sceneCountOptions.map(option => option.count)).toEqual([8, 12, 16]);
    });

    it('lets the user requested visual style override planner defaults', () => {
        const prefs = buildImageGenerationPreferences({
            userMessage: '쇼츠 만들어줘. 실사 그림풍으로, 아이폰으로 찍은 것처럼.',
            sceneCount: 12,
            imageQuality: 'medium',
            imageStyleId: 'explainer-comic',
        });

        expect(prefs.imageStyleId).toBe('photo-real');
        expect(prefs.imageStyleLabel).toBe('실사풍');
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
