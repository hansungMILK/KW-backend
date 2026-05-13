import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { getLocalAssetPath } from '../aws/s3';

export interface VideoCompositionRequest {
    images: Array<{ url: string; durationSec: number; title?: string; caption?: string; sourceLabel?: string }>;
    audioUrl?: string;
    backgroundMusic?:
        | boolean
        | {
              url?: string;
              path?: string;
              volume?: number;
              title?: string;
              artist?: string;
              license?: string;
              attribution?: string;
          };
    outputWidth: number;
    outputHeight: number;
    outputFormat: 'mp4';
    signal?: AbortSignal;
    onProgress?: (progress: number, message: string) => void | Promise<void>;
}

export interface VideoCompositionResult {
    videoBuffer: Buffer;
    durationSec: number;
    sizeBytes: number;
}

export interface VideoProbeResult {
    hasVideo: boolean;
    hasAudio: boolean;
    width?: number;
    height?: number;
    durationSec?: number;
}

const FFMPEG_PATH = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';
const FFPROBE_PATH =
    process.env.FFPROBE_PATH ||
    (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.endsWith('ffmpeg')
        ? process.env.FFMPEG_PATH.replace(/ffmpeg$/, 'ffprobe')
        : 'ffprobe');
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 840000);
const FFMPEG_OVERLAY_MODE = process.env.SHORTS_FFMPEG_OVERLAY || 'all';
const LOCAL_ASSET_BASE_URL = process.env.LOCAL_ASSET_BASE_URL || 'http://localhost:8800/_local-assets';
const REFERENCE_YELLOW = '#fff200';

let cachedDrawtextSupport: boolean | undefined;
let cachedSipsSupport: boolean | undefined;

type OverlayStrategy = 'none' | 'drawtext' | 'image';

export const ffmpegAdapter = {
    async compose(request: VideoCompositionRequest): Promise<VideoCompositionResult> {
        const workDir = await mkdtemp(join(tmpdir(), 'eureka-video-'));
        const outputPath = join(workDir, 'output.mp4');

        try {
            if (request.images.length === 0) {
                throw new Error('FFmpeg composition requires at least one real image input');
            }
            throwIfAborted(request.signal);

            const imageFiles: Array<{
                path: string;
                durationSec: number;
                title?: string;
                caption?: string;
                sourceLabel?: string;
                overlayPath?: string;
            }> = [];

            for (let i = 0; i < request.images.length; i++) {
                const image = request.images[i];
                const path = join(workDir, `image-${String(i).padStart(2, '0')}.png`);
                throwIfAborted(request.signal);
                const imageBuffer = await loadImageBinary(image.url, request.signal);
                await writeFile(path, imageBuffer);
                imageFiles.push({
                    path,
                    durationSec: normalizeDurationSec(image.durationSec),
                    title: image.title,
                    caption: image.caption,
                    sourceLabel: image.sourceLabel,
                });
                await request.onProgress?.(
                    40 + Math.round(((i + 1) / request.images.length) * 12),
                    `이미지 입력 준비 중 (${i + 1}/${request.images.length})`
                );
            }

            const overlayStrategy = resolveOverlayStrategy();
            if (overlayStrategy === 'image') {
                for (let i = 0; i < imageFiles.length; i += 1) {
                    throwIfAborted(request.signal);
                    imageFiles[i].overlayPath = await createOverlayPng(imageFiles[i], i, workDir);
                    await request.onProgress?.(
                        52 + Math.round(((i + 1) / imageFiles.length) * 8),
                        `자막 오버레이 준비 중 (${i + 1}/${imageFiles.length})`
                    );
                }
            }

            let audioPath: string | null = null;
            if (request.audioUrl) {
                audioPath = join(workDir, 'audio.mp3');
                throwIfAborted(request.signal);
                await writeFile(audioPath, await loadAudioBinary(request.audioUrl, request.signal));
                await request.onProgress?.(62, '나레이션 입력 준비 완료');
            }

            const backgroundMusicPath = await resolveBackgroundMusicPath(
                request.backgroundMusic,
                workDir,
                request.signal
            );
            if (backgroundMusicPath) await request.onProgress?.(65, '배경음악 입력 준비 완료');

            throwIfAborted(request.signal);
            await request.onProgress?.(70, 'FFmpeg 합성 시작');
            await runFfmpeg(buildArgs(imageFiles, audioPath, backgroundMusicPath, request, outputPath), request.signal);
            await request.onProgress?.(88, 'FFmpeg 합성 완료');

            const videoBuffer = await readFile(outputPath);
            const { size } = await stat(outputPath);
            const durationSec = imageFiles.reduce((sum, image) => sum + image.durationSec, 0);

            return {
                videoBuffer,
                durationSec,
                sizeBytes: size,
            };
        } finally {
            await rm(workDir, { recursive: true, force: true });
        }
    },

    async probeVideo(videoBuffer: Buffer): Promise<VideoProbeResult> {
        const workDir = await mkdtemp(join(tmpdir(), 'eureka-video-probe-'));
        const videoPath = join(workDir, 'output.mp4');

        try {
            await writeFile(videoPath, videoBuffer);
            const result = spawnSync(
                FFPROBE_PATH,
                [
                    '-v',
                    'error',
                    '-show_entries',
                    'stream=codec_type,width,height:format=duration',
                    '-of',
                    'json',
                    videoPath,
                ],
                { encoding: 'utf8', timeout: 10000 }
            );
            if (result.error || result.status !== 0) {
                return { hasVideo: false, hasAudio: false };
            }

            const parsed = JSON.parse(result.stdout || '{}') as {
                streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
                format?: { duration?: string };
            };
            const videoStream = parsed.streams?.find(stream => stream.codec_type === 'video');
            const audioStream = parsed.streams?.find(stream => stream.codec_type === 'audio');
            const durationSec = Number.parseFloat(parsed.format?.duration ?? '');

            return {
                hasVideo: Boolean(videoStream),
                hasAudio: Boolean(audioStream),
                ...(typeof videoStream?.width === 'number' ? { width: videoStream.width } : {}),
                ...(typeof videoStream?.height === 'number' ? { height: videoStream.height } : {}),
                ...(Number.isFinite(durationSec) && durationSec > 0 ? { durationSec: roundToMillis(durationSec) } : {}),
            };
        } catch {
            return { hasVideo: false, hasAudio: false };
        } finally {
            await rm(workDir, { recursive: true, force: true });
        }
    },
};

function buildArgs(
    imageFiles: Array<{
        path: string;
        durationSec: number;
        title?: string;
        caption?: string;
        sourceLabel?: string;
        overlayPath?: string;
    }>,
    audioPath: string | null,
    backgroundMusicPath: string | null,
    request: VideoCompositionRequest,
    outputPath: string
): string[] {
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    const durationSec = imageFiles.reduce((sum, image) => sum + image.durationSec, 0);

    for (const image of imageFiles) {
        args.push('-framerate', '30', '-loop', '1', '-t', String(image.durationSec), '-i', image.path);
    }

    let nextInputIndex = imageFiles.length;
    const overlayInputIndices = new Map<number, number>();
    imageFiles.forEach((image, index) => {
        if (!image.overlayPath) return;
        overlayInputIndices.set(index, nextInputIndex);
        nextInputIndex += 1;
        args.push('-framerate', '30', '-loop', '1', '-t', String(image.durationSec), '-i', image.overlayPath);
    });

    let narrationInputIndex: number | null = null;
    if (audioPath) {
        narrationInputIndex = nextInputIndex;
        nextInputIndex += 1;
        args.push('-i', audioPath);
    }

    let bgmInputIndex: number | null = null;
    if (backgroundMusicPath) {
        bgmInputIndex = nextInputIndex;
        nextInputIndex += 1;
        args.push('-stream_loop', '-1', '-t', String(durationSec), '-i', backgroundMusicPath);
    }

    const overlayStrategy = resolveOverlayStrategy();
    const fontFile = overlayStrategy === 'drawtext' ? resolveOverlayFontFile() : undefined;
    const filterParts: string[] = [];
    imageFiles.forEach((image, i) => {
        const baseFilter = buildShortsVisualBaseFilter(i, request.outputWidth, request.outputHeight);
        const overlayInputIndex = overlayInputIndices.get(i);
        if (overlayInputIndex !== undefined) {
            filterParts.push(`${baseFilter}[base${i}]`);
            filterParts.push(`[base${i}][${overlayInputIndex}:v]overlay=0:0:format=auto[v${i}]`);
            return;
        }

        const overlay = overlayStrategy === 'drawtext' ? buildDrawtextOverlayFilter(image, fontFile) : '';
        filterParts.push(`${baseFilter}${overlay}[v${i}]`);
    });
    const concatInputs = imageFiles.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${imageFiles.length}:v=1:a=0,format=yuv420p[v]`);

    let audioMap: string | null = null;
    const backgroundMusicVolume = resolveBackgroundMusicVolume(request.backgroundMusic);
    if (narrationInputIndex !== null && bgmInputIndex !== null) {
        filterParts.push(`[${narrationInputIndex}:a]volume=1.0[a0]`);
        filterParts.push(`[${bgmInputIndex}:a]volume=${backgroundMusicVolume}[a1]`);
        filterParts.push('[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[a]');
        audioMap = '[a]';
    } else if (bgmInputIndex !== null) {
        filterParts.push(`[${bgmInputIndex}:a]volume=${backgroundMusicVolume}[a]`);
        audioMap = '[a]';
    }

    args.push('-filter_complex', filterParts.join(';'), '-map', '[v]');
    if (audioMap) {
        args.push('-map', audioMap, '-shortest', '-c:a', 'aac', '-b:a', '128k');
    } else if (narrationInputIndex !== null) {
        args.push('-map', `${narrationInputIndex}:a:0`, '-shortest', '-c:a', 'aac', '-b:a', '128k');
    }
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-r', '30', '-movflags', '+faststart', outputPath);

    return args;
}

function buildShortsVisualBaseFilter(inputIndex: number, outputWidth: number, outputHeight: number): string {
    const visualHeight = Math.round(outputHeight * 0.55);
    const visualY = Math.round(outputHeight * 0.205);
    return `[${inputIndex}:v]scale=${outputWidth}:${visualHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${visualHeight},setsar=1,pad=${outputWidth}:${outputHeight}:0:${visualY}:black`;
}

function resolveOverlayFontFile(): string | undefined {
    const candidates = [
        process.env.FFMPEG_FONT_FILE,
        resolve('assets/fonts/Pretendard-Black.otf'),
        resolve('assets/fonts/Pretendard-Bold.otf'),
        '/opt/fonts/Pretendard-Black.otf',
        '/opt/fonts/Pretendard-Bold.otf',
        '/opt/fonts/BlackHanSans-Regular.ttf',
        '/opt/fonts/NotoSansKR-Black.otf',
        '/opt/fonts/NotoSansCJKkr-Black.otf',
        resolve('assets/fonts/Jalnan2.otf'),
        '/System/Library/Fonts/AppleSDGothicNeo.ttc',
        '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
        '/opt/fonts/NotoSansCJKkr-Regular.otf',
        '/opt/fonts/NotoSansKR-Regular.otf',
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates.find(isSupportedFontFile);
}

export function isSupportedFontFile(candidate: string | undefined): candidate is string {
    if (!candidate || !existsSync(candidate)) return false;

    try {
        const header = readFileSync(candidate, { encoding: null, flag: 'r' }).subarray(0, 4);
        const signature = header.toString('latin1');
        const sfntVersion = header.readUInt32BE(0);
        return signature === 'OTTO' || signature === 'ttcf' || sfntVersion === 0x00010000 || signature === 'true';
    } catch {
        return false;
    }
}

function ffmpegSupportsDrawtext(): boolean {
    if (cachedDrawtextSupport !== undefined) return cachedDrawtextSupport;

    const result = spawnSync(FFMPEG_PATH, ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 5000 });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    cachedDrawtextSupport = !result.error && result.status === 0 && /\bdrawtext\b/.test(output);
    return cachedDrawtextSupport;
}

function canRenderSvgOverlayWithSips(): boolean {
    if (cachedSipsSupport !== undefined) return cachedSipsSupport;
    cachedSipsSupport = existsSync('/usr/bin/sips');
    return cachedSipsSupport;
}

function resolveOverlayStrategy(): OverlayStrategy {
    if (FFMPEG_OVERLAY_MODE === 'off') return 'none';

    const fontFile = resolveOverlayFontFile();
    if (fontFile && ffmpegSupportsDrawtext()) return 'drawtext';
    if (canRenderSvgOverlayWithSips()) return 'image';

    throw new Error(
        'Shorts text overlay requires an ffmpeg build with drawtext support or macOS /usr/bin/sips for local overlay PNG rendering. Set SHORTS_FFMPEG_OVERLAY=off only if text overlay is intentionally disabled.'
    );
}

function normalizeDurationSec(value: number | undefined): number {
    const durationSec = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 5;
    return Math.max(0.25, Math.round(durationSec * 1000) / 1000);
}

function roundToMillis(value: number): number {
    return Math.round(value * 1000) / 1000;
}

async function createOverlayPng(
    image: { title?: string; caption?: string; sourceLabel?: string },
    index: number,
    workDir: string
): Promise<string> {
    const svgPath = join(workDir, `overlay-${String(index).padStart(2, '0')}.svg`);
    const pngPath = join(workDir, `overlay-${String(index).padStart(2, '0')}.png`);
    await writeFile(svgPath, buildOverlaySvg(image), 'utf8');

    const result = spawnSync('/usr/bin/sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], {
        encoding: 'utf8',
        timeout: 10000,
    });
    if (result.error || result.status !== 0) {
        throw new Error(
            `Failed to render overlay PNG with sips: ${result.error?.message ?? result.stderr ?? result.stdout}`
        );
    }
    return pngPath;
}

function buildOverlaySvg(image: { title?: string; caption?: string; sourceLabel?: string }): string {
    const titleLines =
        FFMPEG_OVERLAY_MODE === 'all' ? splitOverlayLines(compactOverlayText(image.title, 28), 11, 2) : [];
    const captionLines =
        FFMPEG_OVERLAY_MODE === 'all' ? splitOverlayLines(compactOverlayText(image.caption, 62), 14, 3) : [];
    const sourceLabel = compactOverlayText(image.sourceLabel, 36);
    const titleText = titleLines
        .map((line, index) => {
            const y = titleLines.length === 1 ? 170 : 108 + index * 128;
            const color = index === 0 ? REFERENCE_YELLOW : '#ffffff';
            return svgText(line, 540, y, 118, color, 9);
        })
        .join('\n');
    const captionText = captionLines
        .map((line, index) => svgText(line, 540, 1500 + index * 92, 76, REFERENCE_YELLOW, 8))
        .join('\n');
    const sourceText = sourceLabel ? svgText(sourceLabel, 540, 1888, 30, 'rgba(255,255,255,0.78)', 2) : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${
      FFMPEG_OVERLAY_MODE === 'all'
          ? '<rect x="0" y="0" width="1080" height="1920" fill="none"/>'
          : sourceLabel
            ? '<rect x="0" y="1828" width="1080" height="92" fill="rgba(0,0,0,0.34)"/>'
            : ''
  }
  ${titleText}
  ${captionText}
  ${sourceText}
</svg>`;
}

function svgText(text: string, x: number, y: number, fontSize: number, fill: string, strokeWidth: number): string {
    if (!text) return '';
    const escaped = escapeXml(text);
    const family = 'Apple SD Gothic Neo, AppleGothic, Arial Unicode MS, sans-serif';
    const shadow = `<text x="${x}" y="${y}" text-anchor="middle" font-family="${family}" font-size="${fontSize}" font-weight="900" fill="${fill}" stroke="black" stroke-width="${strokeWidth}" paint-order="stroke" dominant-baseline="middle">${escaped}</text>`;
    const fills = [
        [0, 0],
        [-1.8, 0],
        [1.8, 0],
        [0, -1.8],
        [0, 1.8],
        [-1.2, -1.2],
        [1.2, 1.2],
    ]
        .map(
            ([dx, dy]) =>
                `<text x="${x + dx}" y="${y + dy}" text-anchor="middle" font-family="${family}" font-size="${fontSize}" font-weight="900" fill="${fill}" dominant-baseline="middle">${escaped}</text>`
        )
        .join('\n');
    return `${shadow}\n${fills}`;
}

function buildDrawtextOverlayFilter(
    image: { title?: string; caption?: string; sourceLabel?: string },
    fontFile: string | undefined
): string {
    if (FFMPEG_OVERLAY_MODE === 'off' || !fontFile) return '';

    const filters: string[] = [];
    const sourceLabel = compactOverlayText(image.sourceLabel, 36);
    const captionLines = splitOverlayLines(compactOverlayText(image.caption, 62), 14, 3);
    const titleLines = splitOverlayLines(compactOverlayText(image.title, 28), 11, 2);
    const font = escapeDrawtext(fontFile);

    if (FFMPEG_OVERLAY_MODE === 'all' && titleLines.length > 0) {
        titleLines.forEach((line, index) => {
            const y = titleLines.length === 1 ? 111 : 49 + index * 128;
            const color = index === 0 ? 'yellow' : 'white';
            filters.push(
                `drawtext=fontfile='${font}':text='${escapeDrawtext(line)}':x=(w-text_w)/2:y=${y}:fontsize=118:fontcolor=${color}:borderw=7:bordercolor=black`
            );
        });
    }

    if (FFMPEG_OVERLAY_MODE === 'all' && captionLines.length > 0) {
        captionLines.forEach((line, index) => {
            filters.push(
                `drawtext=fontfile='${font}':text='${escapeDrawtext(line)}':x=(w-text_w)/2:y=${1430 + index * 92}:fontsize=76:fontcolor=yellow:borderw=7:bordercolor=black`
            );
        });
    }

    if ((FFMPEG_OVERLAY_MODE === 'source' || FFMPEG_OVERLAY_MODE === 'all') && sourceLabel) {
        if (FFMPEG_OVERLAY_MODE === 'source') {
            filters.push('drawbox=x=0:y=h-92:w=w:h=92:color=black@0.34:t=fill');
        }
        filters.push(
            `drawtext=fontfile='${font}':text='${escapeDrawtext(sourceLabel)}':x=(w-text_w)/2:y=h-54:fontsize=30:fontcolor=white@0.86:borderw=2:bordercolor=black@0.7`
        );
    }

    return filters.length > 0 ? `,${filters.join(',')}` : '';
}

function compactOverlayText(value: string | undefined, maxLength: number): string {
    if (!value) return '';
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 1)}...`;
}

export function splitOverlayLines(value: string, maxCharsPerLine: number, maxLines: number): string[] {
    if (!value) return [];
    if (value.length <= maxCharsPerLine) return [value];

    const words = value.split(/\s+/).filter(Boolean);
    const useWords = words.length > 1;
    const tokens = useWords ? words : value.split('');
    const joiner = useWords ? ' ' : '';
    const lines: string[] = [];
    let current = '';
    for (const word of tokens) {
        const next = current ? `${current}${joiner}${word}` : word;
        if (next.length <= maxCharsPerLine) {
            current = next;
            continue;
        }
        if (current && lines.length < maxLines - 1) {
            lines.push(current);
            current = word;
            continue;
        }
        if (current) break;
        current = word;
    }
    if (current && lines.length < maxLines) lines.push(current);
    return lines.slice(0, maxLines);
}

function escapeDrawtext(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function resolveBackgroundMusicPath(
    backgroundMusic: VideoCompositionRequest['backgroundMusic'],
    workDir: string,
    signal?: AbortSignal
): Promise<string | null> {
    if (!backgroundMusic || backgroundMusic === true) return null;
    if (typeof backgroundMusic !== 'object') return null;

    if (backgroundMusic.path) {
        if (!existsSync(backgroundMusic.path)) {
            throw new Error(`Configured BGM file does not exist: ${backgroundMusic.path}`);
        }
        return backgroundMusic.path;
    }

    if (backgroundMusic.url) {
        const bgmPath = join(workDir, 'background-music.mp3');
        await writeFile(bgmPath, await loadAudioBinary(backgroundMusic.url, signal));
        return bgmPath;
    }

    return null;
}

function resolveBackgroundMusicVolume(backgroundMusic: VideoCompositionRequest['backgroundMusic']): number {
    if (!backgroundMusic || typeof backgroundMusic !== 'object') return 0.05;
    const volume = backgroundMusic.volume;
    if (typeof volume !== 'number' || !Number.isFinite(volume)) return 0.05;
    return Math.min(0.3, Math.max(0, volume));
}

async function loadImageBinary(url: string, signal?: AbortSignal): Promise<Buffer> {
    throwIfAborted(signal);
    if (url.startsWith('fake://') || url.startsWith('placeholder://')) {
        throw new Error(`FFmpeg image input must be a real public URL, got ${url}`);
    }

    if (url.startsWith('s3://')) {
        throw new Error(`FFmpeg input must be a public URL, got ${url}`);
    }

    const localAssetKey = localAssetKeyFromUrl(url);
    if (localAssetKey) return readFile(getLocalAssetPath(localAssetKey));

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Failed to fetch image input ${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

async function loadAudioBinary(url: string, signal?: AbortSignal): Promise<Buffer> {
    throwIfAborted(signal);
    if (url.startsWith('fake://') || url.startsWith('placeholder://')) {
        throw new Error(`FFmpeg audio input must be a real public URL, got ${url}`);
    }

    if (url.startsWith('s3://')) {
        throw new Error(`FFmpeg input must be a public URL, got ${url}`);
    }
    const localAssetKey = localAssetKeyFromUrl(url);
    if (localAssetKey) return readFile(getLocalAssetPath(localAssetKey));

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Failed to fetch audio input ${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function localAssetKeyFromUrl(url: string): string | undefined {
    const base = LOCAL_ASSET_BASE_URL.replace(/\/+$/, '');
    if (!url.startsWith(`${base}/`)) return undefined;
    return decodeURIComponent(url.slice(base.length + 1));
}

export function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError(signal));
            return;
        }

        const child = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        let settled = false;
        let exitFallbackTimeout: ReturnType<typeof setTimeout> | undefined;
        const processTimeout = setTimeout(() => {
            child.kill('SIGKILL');
            rejectOnce(new Error(`FFmpeg timed out after ${Math.round(FFMPEG_TIMEOUT_MS / 1000)} seconds`));
        }, FFMPEG_TIMEOUT_MS);
        const cleanup = () => {
            clearTimeout(processTimeout);
            if (exitFallbackTimeout) clearTimeout(exitFallbackTimeout);
            signal?.removeEventListener('abort', onAbort);
        };
        const rejectOnce = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const resolveOnce = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const finish = (code: number | null, killedBySignal: NodeJS.Signals | null) => {
            if (code === 0) {
                resolveOnce();
                return;
            }
            if (killedBySignal) {
                rejectOnce(new Error(`FFmpeg exited with signal ${killedBySignal}: ${stderr.slice(0, 2000)}`));
                return;
            }
            rejectOnce(new Error(`FFmpeg failed with exit code ${code}: ${stderr.slice(0, 2000)}`));
        };
        const onAbort = () => {
            child.kill('SIGKILL');
            rejectOnce(abortError(signal));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        child.stderr?.on('data', chunk => {
            if (stderr.length < 4000) stderr += chunk.toString().slice(0, 4000 - stderr.length);
        });
        child.on('error', err => {
            rejectOnce(
                new Error(
                    `FFmpeg not available at ${FFMPEG_PATH}. Set FFMPEG_PATH to a working binary or attach a Lambda layer with /opt/bin/ffmpeg. ${err.message}`
                )
            );
        });
        child.on('exit', (code, killedBySignal) => {
            exitFallbackTimeout = setTimeout(() => finish(code, killedBySignal), 250);
        });
        child.on('close', (code, killedBySignal) => {
            finish(code, killedBySignal);
        });
    });
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
    const reason = signal?.reason;
    return reason instanceof Error ? reason : new Error('FFmpeg composition cancelled');
}
