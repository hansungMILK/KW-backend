import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, join, resolve } from 'path';

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

function buildLongformHyperframesHtml(
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
      .caption {
        margin-top: 34px;
        font-size: 38px;
        line-height: 1.42;
        color: rgba(255, 255, 255, 0.86);
        font-weight: 750;
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
      <div class="progress-bar"><span id="progress-fill"></span></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${scenes
          .map(
              scene => `
      tl.fromTo("#${scene.id}", { autoAlpha: 0, y: 70, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" }, ${scene.startSec});
      tl.to("#${scene.id} .visual", { scale: 1.035, duration: ${Math.max(0.6, scene.durationSec - 0.4)}, ease: "none" }, ${scene.startSec});
      tl.to("#${scene.id}", { autoAlpha: 0, y: -48, duration: 0.35, ease: "power2.in" }, ${Math.max(scene.startSec, scene.endSec - 0.35)});`
          )
          .join('\n')}
      tl.fromTo("#progress-fill", { scaleX: 0 }, { scaleX: 1, duration: ${durationSec}, ease: "none" }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

function renderScene(scene: ReturnType<typeof buildSceneTimeline>[number]): string {
    return `<section id="${scene.id}" class="scene" data-start="${scene.startSec}" data-duration="${scene.durationSec}" data-track-index="${scene.trackIndex}">
        <div>
          <div class="eyebrow">${escapeHtml(scene.kicker)}</div>
          <div class="headline">${escapeHtml(scene.title)}</div>
          <div class="caption">${escapeHtml(scene.caption)}</div>
        </div>
        <div class="visual">
          <div class="visual-label">${escapeHtml(scene.visualText)}</div>
        </div>
      </section>`;
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
        cursor = endSec;
        return {
            id: htmlId(scene.sceneId ?? `scene-${index + 1}`),
            trackIndex: index + 1,
            startSec: roundMillis(startSec),
            endSec: roundMillis(endSec),
            durationSec: roundMillis(sceneDurationSec),
            kicker: `Chapter ${index + 1}`,
            title: normalizeText(scene.headline ?? scene.title) || `장면 ${index + 1}`,
            caption:
                normalizeText(cue?.text ?? scene.narration ?? scene.caption) || '핵심 내용을 시각적으로 정리합니다.',
            visualText:
                normalizeText(scene.visualText ?? scene.layout ?? scene.objects?.[0]?.text) ||
                '자료, 비교, 타임라인을 한 화면에서 이해하게 구성합니다.',
        };
    });
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

        const child = spawn(command.bin, [...command.prefixArgs, ...baseArgs], { stdio: ['ignore', 'ignore', 'pipe'] });
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

function resolveHyperframesCommand(): { bin: string; prefixArgs: string[] } {
    const configured = process.env.HYPERFRAMES_CLI_BIN?.trim();
    if (configured) return { bin: configured, prefixArgs: [] };

    const candidates = [
        resolve(process.cwd(), 'node_modules/.bin/hyperframes'),
        resolve(process.cwd(), 'node_modules/hyperframes/dist/cli.js'),
        resolve(process.cwd(), '../../node_modules/.bin/hyperframes'),
        resolve(process.cwd(), '../../node_modules/hyperframes/dist/cli.js'),
        resolve(__dirname, '../../node_modules/.bin/hyperframes'),
        resolve(__dirname, '../../node_modules/hyperframes/dist/cli.js'),
    ];
    const found = candidates.find(candidate => existsSync(candidate));
    if (found) {
        return found.endsWith('/cli.js')
            ? { bin: process.execPath, prefixArgs: [found] }
            : { bin: found, prefixArgs: [] };
    }

    return { bin: 'hyperframes', prefixArgs: [] };
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
