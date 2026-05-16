import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, delimiter, dirname, extname, join, resolve } from 'path';

import { getLocalAssetPath } from '../aws/s3';

import type { VideoCompositionResult } from './ffmpeg-adapter';

type HyperframesAudioTrack = {
    url?: string;
    path?: string;
    volume?: number;
    title?: string;
    artist?: string;
};

export type HyperframesScene = {
    sceneId?: string;
    sceneNumber?: number;
    title?: string;
    headline?: string;
    layout?: string;
    caption?: string;
    narration?: string;
    visualText?: string;
    visualType?: string;
    visualData?: Record<string, unknown>;
    subtitleDraft?: string;
    onScreenTextPlan?: unknown;
    durationSec?: number;
    objects?: Array<{ id?: string; type?: string; text?: string }>;
};

export type HyperframesSubtitleCue = {
    sceneNumber?: number;
    text?: string;
    startSec?: number;
    endSec?: number;
};

export type HyperframesMotionCue = {
    sceneNumber?: number;
    type?: string;
    startSec?: number;
    endSec?: number;
};

export type HyperframesRenderRequest = {
    scenes: HyperframesScene[];
    subtitleCues: HyperframesSubtitleCue[];
    motionCues: HyperframesMotionCue[];
    audioUrl: string;
    audioDurationSec?: number;
    backgroundMusic?: false | HyperframesAudioTrack;
    outputWidth: number;
    outputHeight: number;
    fps?: number;
    quality?: 'draft' | 'standard' | 'high';
    signal?: AbortSignal;
    onProgress?: (progress: number, message: string) => void | Promise<void>;
};

const LOCAL_ASSET_BASE_URL = process.env.LOCAL_ASSET_BASE_URL || 'http://localhost:8800/_local-assets';

export const hyperframesAdapter = {
    async renderLongform(request: HyperframesRenderRequest): Promise<VideoCompositionResult> {
        if (!request.audioUrl) throw new Error('Hyperframes longform render requires narration audio');

        const workDir = await mkdtemp(join(tmpdir(), 'eureka-hyperframes-'));
        const assetsDir = join(workDir, 'assets');
        const outputPath = join(workDir, 'output.mp4');

        try {
            await mkdir(assetsDir, { recursive: true });
            const narrationPath = join(assetsDir, 'narration.mp3');
            await writeFile(narrationPath, await loadBinaryInput(request.audioUrl, request.signal));
            const gsapPath = await prepareGsapRuntime(assetsDir);

            const bgmPath = await prepareBackgroundMusic(request.backgroundMusic, assetsDir, request.signal);
            const html = buildLongformHyperframesHtml(request, {
                narrationSrc: './assets/narration.mp3',
                backgroundMusicSrc: bgmPath ? `./assets/${basename(bgmPath)}` : undefined,
                gsapSrc: `./assets/${basename(gsapPath)}`,
            });

            await writeFile(join(workDir, 'index.html'), html, 'utf8');
            await writeFile(
                join(workDir, 'hyperframes.json'),
                JSON.stringify({ compositions: [{ id: 'main', file: 'index.html' }] }, null, 2),
                'utf8'
            );

            await request.onProgress?.(70, 'Hyperframes 2K 렌더 시작');
            await runHyperframesRender(workDir, outputPath, request);
            await request.onProgress?.(88, 'Hyperframes 2K 렌더 완료');

            const videoBuffer = await readFile(outputPath);
            return {
                videoBuffer,
                durationSec: getCompositionDurationSec(request),
                sizeBytes: videoBuffer.byteLength,
            };
        } finally {
            await rm(workDir, { recursive: true, force: true });
        }
    },
};

export function buildLongformHyperframesHtml(
    request: HyperframesRenderRequest,
    media: { narrationSrc: string; backgroundMusicSrc?: string; gsapSrc: string }
): string {
    const durationSec = getCompositionDurationSec(request);
    const scenes = buildSceneTimeline(request, durationSec);
    const bgmVolume = clampVolume(request.backgroundMusic ? request.backgroundMusic.volume : 0.08);

    return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${request.outputWidth}, height=${request.outputHeight}" />
    <script src="${media.gsapSrc}"></script>
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${request.outputWidth}px;
        height: ${request.outputHeight}px;
        overflow: hidden;
        background: #07080d;
        font-family: Pretendard, Inter, Arial, sans-serif;
      }
      #root {
        position: relative;
        width: ${request.outputWidth}px;
        height: ${request.outputHeight}px;
        background:
          radial-gradient(circle at 16% 18%, rgba(108, 92, 231, 0.34), transparent 28%),
          radial-gradient(circle at 82% 14%, rgba(255, 196, 87, 0.20), transparent 24%),
          linear-gradient(135deg, #07080d 0%, #121826 52%, #080a12 100%);
        color: white;
      }
      .scene {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 64px;
        padding: 108px 132px;
        align-items: center;
      }
      .eyebrow {
        display: inline-flex;
        width: fit-content;
        padding: 12px 22px;
        border-radius: 999px;
        background: rgba(255, 242, 0, 0.12);
        border: 1px solid rgba(255, 242, 0, 0.42);
        color: #fff200;
        font-size: 30px;
        font-weight: 900;
      }
      .headline {
        margin-top: 32px;
        font-size: 82px;
        line-height: 1.05;
        font-weight: 950;
        letter-spacing: 0;
      }
      .visual {
        min-height: 660px;
        border-radius: 42px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 44px 120px rgba(0, 0, 0, 0.42);
        overflow: hidden;
        position: relative;
      }
      .visual::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(135deg, rgba(255,255,255,0.16), transparent 38%),
          repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 72px);
      }
      .visual-label {
        position: absolute;
        left: 46px;
        right: 46px;
        bottom: 46px;
        padding: 30px 34px;
        border-radius: 28px;
        background: rgba(0, 0, 0, 0.54);
        font-size: 40px;
        line-height: 1.28;
        font-weight: 900;
      }
      .visual-content {
        position: absolute;
        inset: 46px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 24px;
      }
      .visual-title {
        font-size: 44px;
        line-height: 1.18;
        font-weight: 950;
        color: #fff200;
      }
      .visual-body,
      .visual-item,
      .visual-metric,
      .visual-quote {
        padding: 22px 26px;
        border-radius: 24px;
        background: rgba(0, 0, 0, 0.44);
        font-size: 34px;
        line-height: 1.34;
        font-weight: 820;
      }
      .visual-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 22px;
      }
      .visual-column {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .visual-column-title {
        font-size: 28px;
        font-weight: 900;
        color: rgba(255, 255, 255, 0.7);
      }
      .subtitle-layer {
        position: absolute;
        left: 280px;
        right: 280px;
        bottom: 104px;
        height: 120px;
        pointer-events: none;
      }
      .subtitle-cue {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        opacity: 0;
        transform: translateY(18px);
        margin: 0 auto;
        width: fit-content;
        max-width: 100%;
        padding: 22px 34px;
        border-radius: 22px;
        background: rgba(0, 0, 0, 0.74);
        color: #fff;
        font-size: 42px;
        line-height: 1.25;
        font-weight: 900;
        text-align: center;
        box-shadow: 0 18px 52px rgba(0, 0, 0, 0.34);
      }
      .progress-bar {
        position: absolute;
        left: 132px;
        right: 132px;
        bottom: 64px;
        height: 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        overflow: hidden;
      }
      .progress-bar span {
        display: block;
        height: 100%;
        background: #fff200;
        transform-origin: left center;
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${durationSec}" data-width="${request.outputWidth}" data-height="${request.outputHeight}">
      <audio id="narration" data-start="0" data-duration="${durationSec}" data-track-index="100" data-volume="1" src="${media.narrationSrc}"></audio>
      ${
          media.backgroundMusicSrc
              ? `<audio id="background-music" data-start="0" data-duration="${durationSec}" data-track-index="101" data-volume="${bgmVolume}" src="${media.backgroundMusicSrc}"></audio>`
              : ''
      }
      ${scenes.map(renderScene).join('\n')}
      ${renderSubtitleLayer(request.subtitleCues)}
      <div class="progress-bar"><span id="progress-fill"></span></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${scenes.map(renderSceneTimeline).join('\n')}
      ${renderSubtitleTimeline(request.subtitleCues, durationSec)}
      tl.fromTo("#progress-fill", { scaleX: 0 }, { scaleX: 1, duration: ${durationSec}, ease: "none" }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

function renderScene(scene: ReturnType<typeof buildSceneTimeline>[number]): string {
    return `<section id="${scene.id}" class="scene" data-start="${scene.startSec}" data-duration="${scene.durationSec}" data-track-index="${scene.trackIndex}" data-motion="${escapeHtml(scene.motionTypes.join(' '))}">
        <div>
          <div class="eyebrow">${escapeHtml(scene.kicker)}</div>
          <div class="headline">${escapeHtml(scene.title)}</div>
        </div>
        ${renderVisualPanel(scene)}
      </section>`;
}

function renderSceneTimeline(scene: ReturnType<typeof buildSceneTimeline>[number]): string {
    const enterY = scene.primaryMotion === 'comparison-slide' ? 0 : 70;
    const enterX = scene.primaryMotion === 'comparison-slide' ? -90 : 0;
    const visualScale =
        scene.primaryMotion === 'camera-push' || scene.primaryMotion === 'source-card-zoom' ? 1.07 : 1.035;
    const visualRotate = scene.primaryMotion === 'comparison-slide' ? 0.45 : 0;
    const headlineScale = scene.primaryMotion === 'metric-count-up' ? 1.055 : 1;
    const labelY = scene.primaryMotion === 'connector-draw' || scene.primaryMotion === 'underline' ? -12 : 0;

    return `
      tl.fromTo("#${scene.id}", { autoAlpha: 0, x: ${enterX}, y: ${enterY}, scale: 0.985 }, { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.55, ease: "${scene.easing}" }, ${scene.startSec});
      tl.to("#${scene.id} .headline", { scale: ${headlineScale}, duration: ${Math.min(1.2, Math.max(0.4, scene.durationSec * 0.24))}, ease: "${scene.easing}", transformOrigin: "left center" }, ${scene.startSec + 0.2});
      tl.to("#${scene.id} .visual", { scale: ${visualScale}, rotate: ${visualRotate}, duration: ${Math.max(0.6, scene.durationSec - 0.4)}, ease: "none" }, ${scene.startSec});
      tl.to("#${scene.id} .visual-content", { y: ${labelY}, color: "${scene.primaryMotion === 'underline' ? '#fff200' : '#ffffff'}", duration: 0.45, ease: "${scene.easing}" }, ${scene.startSec + 0.35});
      tl.to("#${scene.id}", { autoAlpha: 0, y: -48, duration: 0.35, ease: "power2.in" }, ${Math.max(scene.startSec, scene.endSec - 0.35)});`;
}

function renderVisualPanel(scene: ReturnType<typeof buildSceneTimeline>[number]): string {
    return `<div class="visual visual-${escapeHtml(scene.visualType)}">
          <div class="visual-content ${escapeHtml(`visual-${scene.visualType}`)}">
            ${renderVisualContent(scene.visualType, scene.visualData, scene.title, scene.visualText)}
          </div>
        </div>`;
}

function renderVisualContent(
    visualType: string,
    visualData: Record<string, unknown>,
    title: string,
    fallbackText: string
): string {
    const visualTitle = normalizeText(visualData.title) || title;
    const items = stringItems(visualData.items).length ? stringItems(visualData.items) : stringItems(visualData.claims);
    const body = normalizeText(visualData.body) || fallbackText;

    if (visualType === 'event-timeline') {
        return [
            `<div class="visual-title">${escapeHtml(visualTitle)}</div>`,
            ...items
                .slice(0, 5)
                .map((item, index) => `<div class="visual-item">${index + 1}. ${escapeHtml(item)}</div>`),
        ].join('\n');
    }
    if (visualType === 'comparison') {
        return `<div class="visual-title">${escapeHtml(visualTitle)}</div>
          <div class="visual-grid">
            ${renderComparisonColumn(normalizeText(visualData.leftLabel) || '겉보기', stringItems(visualData.leftItems))}
            ${renderComparisonColumn(normalizeText(visualData.rightLabel) || '핵심', stringItems(visualData.rightItems))}
          </div>`;
    }
    if (visualType === 'quote-card') {
        return `<div class="visual-title">${escapeHtml(visualTitle)}</div>
          <div class="visual-quote">“${escapeHtml(normalizeText(visualData.quote) || body)}”</div>
          <div class="visual-body">${escapeHtml(normalizeText(visualData.source) || '자료 기반')}</div>`;
    }
    if (visualType === 'process-flow') {
        return [
            `<div class="visual-title">${escapeHtml(visualTitle)}</div>`,
            ...stringItems(visualData.steps)
                .slice(0, 5)
                .map((item, index) => `<div class="visual-item">${index + 1}. ${escapeHtml(item)}</div>`),
        ].join('\n');
    }
    if (visualType === 'metric-reveal') {
        const metrics = arrayItems(visualData.metrics);
        return [
            `<div class="visual-title">${escapeHtml(visualTitle)}</div>`,
            ...metrics
                .slice(0, 4)
                .map(
                    metric =>
                        `<div class="visual-metric">${escapeHtml(normalizeText(metric.label) || '핵심')} · ${escapeHtml(
                            normalizeText(metric.value) || body
                        )}</div>`
                ),
        ].join('\n');
    }
    if (visualType === 'source-proof') {
        return [
            `<div class="visual-title">${escapeHtml(visualTitle)}</div>`,
            ...items.slice(0, 4).map(item => `<div class="visual-item">${escapeHtml(item)}</div>`),
        ].join('\n');
    }
    return `<div class="visual-title">${escapeHtml(visualTitle)}</div><div class="visual-body">${escapeHtml(body)}</div>`;
}

function renderComparisonColumn(label: string, items: string[]): string {
    const lines = items.length ? items : ['핵심 내용을 비교합니다.'];
    return `<div class="visual-column">
        <div class="visual-column-title">${escapeHtml(label)}</div>
        ${lines
            .slice(0, 3)
            .map(item => `<div class="visual-item">${escapeHtml(item)}</div>`)
            .join('\n')}
      </div>`;
}

function renderSubtitleLayer(subtitleCues: HyperframesSubtitleCue[]): string {
    const cues = subtitleCues.filter(cue => normalizeText(cue.text));
    if (cues.length === 0) return '<div class="subtitle-layer"></div>';
    return `<div class="subtitle-layer">
        ${cues
            .map(
                (cue, index) =>
                    `<div id="subtitle-cue-${index}" class="subtitle-cue">${escapeHtml(normalizeText(cue.text))}</div>`
            )
            .join('\n')}
      </div>`;
}

function renderSubtitleTimeline(subtitleCues: HyperframesSubtitleCue[], durationSec: number): string {
    return subtitleCues
        .map((cue, index) => {
            const text = normalizeText(cue.text);
            if (!text) return '';
            const startSec = positiveNumber(cue.startSec) ?? 0;
            const endSec = Math.min(durationSec, positiveNumber(cue.endSec) ?? durationSec);
            if (endSec <= startSec) return '';
            return `
      tl.fromTo("#subtitle-cue-${index}", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.16, ease: "power2.out" }, ${roundMillis(startSec)});
      tl.to("#subtitle-cue-${index}", { autoAlpha: 0, y: -10, duration: 0.16, ease: "power2.in" }, ${roundMillis(Math.max(startSec, endSec - 0.16))});`;
        })
        .join('\n');
}

function buildSceneTimeline(request: HyperframesRenderRequest, durationSec: number) {
    const scenes = request.scenes.length > 0 ? request.scenes : [{ sceneNumber: 1, title: '롱폼 장면' }];
    const fallbackDuration = Math.max(1, durationSec / scenes.length);
    let cursor = 0;
    return scenes.map((scene, index) => {
        const cue = request.subtitleCues.find(item => normalizeSceneNumber(item.sceneNumber, index + 1) === index + 1);
        const startSec = positiveNumber(cue?.startSec) ?? cursor;
        const endSec =
            positiveNumber(cue?.endSec) ??
            Math.min(durationSec, startSec + (positiveNumber(scene.durationSec) ?? fallbackDuration));
        const sceneDurationSec = Math.max(0.5, endSec - startSec);
        const motionTypes = motionTypesForScene(request.motionCues, scene, index);
        cursor = endSec;
        return {
            id: htmlId(scene.sceneId ?? `scene-${index + 1}`),
            trackIndex: index + 1,
            startSec: roundMillis(startSec),
            endSec: roundMillis(endSec),
            durationSec: roundMillis(sceneDurationSec),
            kicker: `Chapter ${index + 1}`,
            title: normalizeText(scene.headline ?? scene.title) || `장면 ${index + 1}`,
            caption: normalizeText(cue?.text ?? scene.narration ?? scene.caption),
            visualType: normalizeVisualType(scene.visualType ?? scene.layout),
            visualData: normalizeVisualData(scene),
            visualText:
                normalizeText(scene.visualText ?? scene.objects?.[0]?.text) ||
                '자료, 비교, 타임라인을 한 화면에서 이해하게 구성합니다.',
            motionTypes,
            primaryMotion: primaryMotionType(motionTypes),
            easing: easingForMotion(motionTypes),
        };
    });
}

function normalizeVisualType(value: unknown): string {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'timeline') return 'event-timeline';
    if (normalized === 'diagram' || normalized === 'diagram-board') return 'process-flow';
    if (normalized === 'chapter-board') return 'fact-card';
    if (
        [
            'source-proof',
            'event-timeline',
            'comparison',
            'metric-reveal',
            'fact-card',
            'quote-card',
            'process-flow',
        ].includes(normalized)
    ) {
        return normalized;
    }
    return 'fact-card';
}

function normalizeVisualData(scene: HyperframesScene): Record<string, unknown> {
    const explicit = isRecord(scene.visualData) ? scene.visualData : {};
    const visualType = normalizeVisualType(scene.visualType ?? scene.layout);
    const title = normalizeText(explicit.title) || normalizeText(scene.headline ?? scene.title) || '핵심 장면';
    const objectTexts = (scene.objects ?? []).map(object => normalizeText(object.text)).filter(Boolean);
    const fallbackItems = objectTexts.length ? objectTexts : [normalizeText(scene.visualText) || title];

    if (Object.keys(explicit).length > 0) return { ...explicit, title };
    if (visualType === 'event-timeline') return { title, items: fallbackItems.slice(0, 5) };
    if (visualType === 'comparison') {
        return {
            title,
            leftLabel: '겉보기',
            leftItems: fallbackItems.slice(0, 2),
            rightLabel: '핵심',
            rightItems: fallbackItems.slice(2, 4).length ? fallbackItems.slice(2, 4) : fallbackItems.slice(0, 2),
        };
    }
    if (visualType === 'quote-card') return { title, quote: fallbackItems[0], source: '자료 기반' };
    if (visualType === 'process-flow') return { title, steps: fallbackItems.slice(0, 5) };
    if (visualType === 'metric-reveal') {
        return {
            title,
            metrics: fallbackItems.slice(0, 3).map((value, index) => ({ label: `핵심 ${index + 1}`, value })),
        };
    }
    if (visualType === 'source-proof') return { title, claims: fallbackItems.slice(0, 4) };
    return { title, body: fallbackItems.join(' ') };
}

function stringItems(value: unknown): string[] {
    return Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [];
}

function arrayItems(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function motionTypesForScene(motionCues: HyperframesMotionCue[], scene: HyperframesScene, index: number): string[] {
    const sceneNumber = normalizeSceneNumber(scene.sceneNumber, index + 1);
    const sceneId = scene.sceneId ?? `scene-${index + 1}`;
    const types = motionCues
        .filter(
            cue => normalizeSceneNumber(cue.sceneNumber, sceneNumber) === sceneNumber || cue.sceneNumber === undefined
        )
        .filter((cue, cueIndex) => cue.sceneNumber !== undefined || cueIndex === index)
        .map(cue => normalizeText(cue.type))
        .filter(Boolean);
    const bySceneId = motionCues
        .filter(cue => normalizeText((cue as { sceneId?: string }).sceneId) === sceneId)
        .map(cue => normalizeText(cue.type))
        .filter(Boolean);
    return [...new Set([...bySceneId, ...types])].slice(0, 4);
}

function primaryMotionType(types: string[]): string {
    const joined = types.join(' ').toLowerCase();
    if (/comparison|slide/.test(joined)) return 'comparison-slide';
    if (/metric|count/.test(joined)) return 'metric-count-up';
    if (/source|zoom/.test(joined)) return 'source-card-zoom';
    if (/connector|draw/.test(joined)) return 'connector-draw';
    if (/underline/.test(joined)) return 'underline';
    if (/push|camera/.test(joined)) return 'camera-push';
    return 'reveal';
}

function easingForMotion(types: string[]): string {
    const joined = types.join(' ').toLowerCase();
    if (/dramatic|zoom|push/.test(joined)) return 'expo.out';
    if (/fast|reveal|slide/.test(joined)) return 'power3.out';
    return 'power2.out';
}

async function prepareBackgroundMusic(
    backgroundMusic: HyperframesRenderRequest['backgroundMusic'],
    assetsDir: string,
    signal?: AbortSignal
): Promise<string | undefined> {
    if (!backgroundMusic) return undefined;
    const ext = extname(backgroundMusic.path ?? backgroundMusic.url ?? '') || '.mp3';
    const targetPath = join(assetsDir, `background-music${ext}`);
    if (backgroundMusic.path) {
        await copyFile(resolveExistingPath(backgroundMusic.path), targetPath);
        return targetPath;
    }
    if (backgroundMusic.url) {
        await writeFile(targetPath, await loadBinaryInput(backgroundMusic.url, signal));
        return targetPath;
    }
    return undefined;
}

async function prepareGsapRuntime(assetsDir: string): Promise<string> {
    const sourcePath = resolveExistingPath('node_modules/gsap/dist/gsap.min.js');
    const targetPath = join(assetsDir, 'gsap.min.js');
    await copyFile(sourcePath, targetPath);
    return targetPath;
}

async function loadBinaryInput(url: string, signal?: AbortSignal): Promise<Buffer> {
    throwIfAborted(signal);
    const localAssetKey = localAssetKeyFromUrl(url);
    if (localAssetKey) return readFile(getLocalAssetPath(localAssetKey));
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Failed to fetch Hyperframes media input ${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function resolveExistingPath(path: string): string {
    const candidates = [
        path,
        resolve(process.cwd(), path),
        resolve(process.cwd(), '../../', path),
        resolve(process.cwd(), 'apps/backend', path),
    ];
    const found = candidates.find(candidate => existsSync(candidate));
    if (!found) throw new Error(`Configured Hyperframes media file does not exist: ${path}`);
    return found;
}

function runHyperframesRender(
    projectDir: string,
    outputPath: string,
    request: HyperframesRenderRequest
): Promise<void> {
    const command = resolveHyperframesCommand();
    const baseArgs = [
        'render',
        projectDir,
        '--output',
        outputPath,
        '--fps',
        String(request.fps ?? 30),
        '--quality',
        request.quality ?? 'high',
        '--workers',
        process.env.HYPERFRAMES_RENDER_WORKERS || '4',
        '--quiet',
    ];

    return new Promise((resolvePromise, reject) => {
        if (request.signal?.aborted) {
            reject(abortError(request.signal));
            return;
        }

        const child = spawn(command.bin, [...command.prefixArgs, ...baseArgs], {
            env: buildHyperframesChildEnv(),
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        const onAbort = () => {
            child.kill('SIGTERM');
            reject(abortError(request.signal));
        };
        request.signal?.addEventListener('abort', onAbort, { once: true });

        child.stderr.on('data', chunk => {
            stderr += String(chunk);
        });
        child.on('error', error => {
            request.signal?.removeEventListener('abort', onAbort);
            reject(error);
        });
        child.on('close', code => {
            request.signal?.removeEventListener('abort', onAbort);
            if (code === 0) {
                resolvePromise();
                return;
            }
            reject(new Error(`Hyperframes render failed with exit code ${code}: ${stderr.trim()}`));
        });
    });
}

export function resolveHyperframesCommand(): { bin: string; prefixArgs: string[] } {
    const configured = process.env.HYPERFRAMES_CLI_BIN?.trim();
    if (configured) return { bin: configured, prefixArgs: [] };

    const candidates = [
        resolve(process.cwd(), 'node_modules/hyperframes/dist/cli.js'),
        resolve(process.cwd(), '../../node_modules/hyperframes/dist/cli.js'),
        resolve(__dirname, '../../node_modules/hyperframes/dist/cli.js'),
        resolve(process.cwd(), 'node_modules/.bin/hyperframes'),
        resolve(process.cwd(), '../../node_modules/.bin/hyperframes'),
        resolve(__dirname, '../../node_modules/.bin/hyperframes'),
    ];
    const found = candidates.find(candidate => existsSync(candidate));
    if (found) {
        return found.endsWith('/cli.js')
            ? { bin: process.execPath, prefixArgs: [found] }
            : { bin: found, prefixArgs: [] };
    }

    return { bin: 'hyperframes', prefixArgs: [] };
}

export function buildHyperframesChildEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const ffmpegPath = resolveFfmpegPath(baseEnv);
    const pathDirs = [
        dirname(process.execPath),
        ffmpegPath ? dirname(ffmpegPath) : undefined,
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
    ].filter((value): value is string => Boolean(value));

    return {
        ...baseEnv,
        ...(ffmpegPath ? { FFMPEG_PATH: ffmpegPath } : {}),
        PATH: buildToolPath(baseEnv.PATH, pathDirs),
    };
}

function resolveFfmpegPath(baseEnv: NodeJS.ProcessEnv): string | undefined {
    const configured = baseEnv.FFMPEG_PATH?.trim();
    if (configured) return configured;

    return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(candidate =>
        existsSync(candidate)
    );
}

function buildToolPath(existingPath: string | undefined, preferredDirs: string[]): string {
    const parts: string[] = [];
    for (const item of [...preferredDirs, ...(existingPath?.split(delimiter) ?? [])]) {
        const normalized = item.trim();
        if (normalized && !parts.includes(normalized)) parts.push(normalized);
    }
    return parts.join(delimiter);
}

function getCompositionDurationSec(request: HyperframesRenderRequest): number {
    const fromAudio = positiveNumber(request.audioDurationSec);
    if (fromAudio) return roundMillis(fromAudio);
    const cueEnd = Math.max(0, ...request.subtitleCues.map(cue => positiveNumber(cue.endSec) ?? 0));
    if (cueEnd > 0) return roundMillis(cueEnd);
    const sceneDuration = request.scenes.reduce((sum, scene) => sum + (positiveNumber(scene.durationSec) ?? 6), 0);
    return roundMillis(Math.max(1, sceneDuration));
}

function localAssetKeyFromUrl(url: string): string | undefined {
    const base = LOCAL_ASSET_BASE_URL.replace(/\/+$/, '');
    if (!url.startsWith(`${base}/`)) return undefined;
    return decodeURIComponent(url.slice(base.length + 1));
}

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function htmlId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function normalizeSceneNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function positiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function roundMillis(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function clampVolume(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0.08;
    return Math.min(0.3, Math.max(0, parsed));
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
    const reason = signal?.reason;
    return reason instanceof Error ? reason : new Error('Hyperframes render aborted');
}
