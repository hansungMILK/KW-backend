import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { isLocalStage } from '../../config/env';
import { getLocalAssetPath } from '../aws/s3';

export interface VideoCompositionRequest {
    images: Array<{
        url: string;
        durationSec: number;
        title?: string;
        caption?: string;
        sourceLabel?: string;
        captionPosition?: CaptionPosition;
        captionStyle?: CaptionStyle;
    }>;
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
    motionMode?: 'ken-burns';
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

const FFMPEG_PATH = resolveFfmpegPath();
const FFPROBE_PATH = resolveFfprobePath(process.env, FFMPEG_PATH);
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 840000);
const FFMPEG_OVERLAY_MODE = process.env.SHORTS_FFMPEG_OVERLAY || 'all';
const LOCAL_ASSET_BASE_URL = process.env.LOCAL_ASSET_BASE_URL || 'http://localhost:8800/_local-assets';
const REFERENCE_YELLOW = '#fff200';

let cachedDrawtextSupport: boolean | undefined;
let cachedSubtitlesSupport: boolean | undefined;
let cachedSipsSupport: boolean | undefined;

type OverlayStrategy = 'none' | 'drawtext' | 'ass' | 'image';
export type CaptionPosition =
    | 'upper-left'
    | 'upper-center'
    | 'upper-right'
    | 'middle-left'
    | 'center'
    | 'middle-right'
    | 'lower-left'
    | 'lower-center'
    | 'lower-right';
export type CaptionStyle = 'whiteBlack' | 'yellowBlack' | 'redBlack' | 'smallWhite' | 'titleBand';

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
                captionPosition?: CaptionPosition;
                captionStyle?: CaptionStyle;
                overlayPath?: string;
                subtitlePath?: string;
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
                    captionPosition: image.captionPosition,
                    captionStyle: image.captionStyle,
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
            } else if (overlayStrategy === 'ass') {
                for (let i = 0; i < imageFiles.length; i += 1) {
                    throwIfAborted(request.signal);
                    imageFiles[i].subtitlePath = await createOverlayAss(imageFiles[i], i, workDir);
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
            await runFfmpeg(
                buildArgs(imageFiles, audioPath, backgroundMusicPath, request, outputPath),
                request.signal,
                prepareFfmpegFontconfigEnv(process.env, workDir)
            );
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
                { encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: '/tmp' } }
            );
            if (result.error || result.status !== 0) {
                console.warn(
                    `[ffmpeg-adapter] ffprobe failed via ${FFPROBE_PATH}: ${
                        result.error?.message || result.stderr || `status ${result.status}`
                    }`
                );
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

export function resolveFfmpegPath(baseEnv: NodeJS.ProcessEnv = process.env): string {
    const configured = resolveConfiguredBinary(baseEnv.FFMPEG_PATH);
    if (configured) return configured;

    return (
        ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(candidate =>
            existsSync(candidate)
        ) ?? 'ffmpeg'
    );
}

export function resolveFfprobePath(
    baseEnv: NodeJS.ProcessEnv = process.env,
    ffmpegPath = resolveFfmpegPath(baseEnv)
): string {
    const configured = resolveConfiguredBinary(baseEnv.FFPROBE_PATH);
    if (configured) return configured;

    const sibling =
        ffmpegPath.endsWith('ffmpeg') && !['ffmpeg', '/opt/bin/ffmpeg'].includes(ffmpegPath)
            ? ffmpegPath.replace(/ffmpeg$/, 'ffprobe')
            : undefined;
    if (sibling && existsSync(sibling)) return sibling;

    return (
        [sibling, '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'].find(
            (candidate): candidate is string => Boolean(candidate && existsSync(candidate))
        ) ?? 'ffprobe'
    );
}

function resolveConfiguredBinary(value: string | undefined): string | undefined {
    const configured = value?.trim();
    if (!configured) return undefined;
    if (!configured.includes('/')) return configured;
    return existsSync(configured) ? configured : undefined;
}

function buildArgs(
    imageFiles: Array<{
        path: string;
        durationSec: number;
        title?: string;
        caption?: string;
        sourceLabel?: string;
        captionPosition?: CaptionPosition;
        captionStyle?: CaptionStyle;
        overlayPath?: string;
        subtitlePath?: string;
    }>,
    audioPath: string | null,
    backgroundMusicPath: string | null,
    request: VideoCompositionRequest,
    outputPath: string
): string[] {
    const args = ['-y', '-nostdin', '-hide_banner', '-loglevel', 'error'];
    const durationSec = imageFiles.reduce((sum, image) => sum + image.durationSec, 0);
    const outputFrameCount = Math.max(1, Math.round(durationSec * 30));

    for (const image of imageFiles) {
        args.push('-i', image.path);
    }

    let nextInputIndex = imageFiles.length;
    const overlayInputIndices = new Map<number, number>();
    imageFiles.forEach((image, index) => {
        if (!image.overlayPath) return;
        overlayInputIndices.set(index, nextInputIndex);
        nextInputIndex += 1;
        args.push('-i', image.overlayPath);
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
    const fontsDir = overlayStrategy === 'ass' ? resolveOverlayFontsDir() : undefined;
    const filterParts: string[] = [];
    imageFiles.forEach((image, i) => {
        const baseFilter = buildShortsVisualBaseFilter(
            i,
            request.outputWidth,
            request.outputHeight,
            image.durationSec,
            request.motionMode
        );
        const overlayInputIndex = overlayInputIndices.get(i);
        if (overlayInputIndex !== undefined) {
            filterParts.push(`${baseFilter}[base${i}]`);
            filterParts.push(
                `[base${i}][${overlayInputIndex}:v]overlay=0:0:format=auto,${buildFiniteSceneFilter(image.durationSec)}[v${i}]`
            );
            return;
        }

        const subtitle = image.subtitlePath ? buildAssSubtitleFilter(image.subtitlePath, fontsDir) : '';
        const overlay = overlayStrategy === 'drawtext' ? buildDrawtextOverlayFilter(image, fontFile) : subtitle;
        filterParts.push(`${baseFilter}${overlay},${buildFiniteSceneFilter(image.durationSec)}[v${i}]`);
    });
    if (imageFiles.length === 1) {
        filterParts.push('[v0]format=yuv420p[v]');
    } else {
        const concatInputs = imageFiles.map((_, i) => `[v${i}]`).join('');
        filterParts.push(`${concatInputs}concat=n=${imageFiles.length}:v=1:a=0,format=yuv420p[v]`);
    }

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
    args.push('-t', String(durationSec), '-frames:v', String(outputFrameCount));
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-r', '30', '-movflags', '+faststart', outputPath);

    return args;
}

function buildFiniteSceneFilter(durationSec: number): string {
    return `trim=duration=${durationSec},setpts=PTS-STARTPTS`;
}

function buildFiniteImageInputFilter(inputIndex: number, durationSec: number): string {
    const frameCount = Math.max(1, Math.round(durationSec * 30));
    return `[${inputIndex}:v]loop=loop=${Math.max(0, frameCount - 1)}:size=1:start=0,setpts=N/(30*TB)`;
}

function buildShortsVisualBaseFilter(
    inputIndex: number,
    outputWidth: number,
    outputHeight: number,
    durationSec: number,
    motionMode?: VideoCompositionRequest['motionMode']
): string {
    const input = buildFiniteImageInputFilter(inputIndex, durationSec);
    if (motionMode === 'ken-burns') {
        const frameCount = Math.max(1, Math.round(durationSec * 30));
        const scaledWidth = Math.ceil(outputWidth * 1.12);
        const scaledHeight = Math.ceil(outputHeight * 1.12);
        return `${input},scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=${scaledWidth}:${scaledHeight},zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${outputWidth}x${outputHeight}:fps=30,setsar=1`;
    }

    const visualHeight = Math.round(outputHeight * 0.55);
    const visualY = Math.round(outputHeight * 0.205);
    return `${input},scale=${outputWidth}:${visualHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${visualHeight},setsar=1,pad=${outputWidth}:${outputHeight}:0:${visualY}:black`;
}

export function resolveOverlayFontFile(): string | undefined {
    const candidates = [
        process.env.FFMPEG_FONT_FILE,
        resolve('assets/fonts/Pretendard-Black.otf'),
        resolve('assets/fonts/Pretendard-Bold.otf'),
        resolve('apps/backend/assets/fonts/Pretendard-Black.otf'),
        resolve('apps/backend/assets/fonts/Pretendard-Bold.otf'),
        '/opt/fonts/Pretendard-Black.otf',
        '/opt/fonts/Pretendard-Bold.otf',
        '/opt/fonts/BlackHanSans-Regular.ttf',
        '/opt/fonts/NotoSansKR-Black.otf',
        '/opt/fonts/NotoSansCJKkr-Black.otf',
        resolve('assets/fonts/Jalnan2.otf'),
        resolve('apps/backend/assets/fonts/Jalnan2.otf'),
        '/System/Library/Fonts/AppleSDGothicNeo.ttc',
        '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
        '/opt/fonts/NotoSansCJKkr-Regular.otf',
        '/opt/fonts/NotoSansKR-Regular.otf',
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates.map(resolveFontCandidatePath).find(isSupportedFontFile);
}

function resolveFontCandidatePath(candidate: string): string {
    const trimmed = candidate.trim();
    if (trimmed.startsWith('/')) return trimmed;
    const cwdPath = resolve(trimmed);
    if (existsSync(cwdPath)) return cwdPath;
    if (trimmed.startsWith('assets/')) {
        const backendAssetPath = resolve('apps/backend', trimmed);
        if (existsSync(backendAssetPath)) return backendAssetPath;
    }
    return cwdPath;
}

function resolveOverlayFontsDir(): string | undefined {
    const fontFile = resolveOverlayFontFile();
    if (!fontFile) return undefined;
    const index = Math.max(fontFile.lastIndexOf('/'), fontFile.lastIndexOf('\\'));
    return index > 0 ? fontFile.slice(0, index) : undefined;
}

export function isSupportedFontFile(candidate: string | undefined): candidate is string {
    const resolved = candidate ? resolveFontCandidatePath(candidate) : undefined;
    if (!resolved || !existsSync(resolved)) return false;

    try {
        const header = readFileSync(resolved, { encoding: null, flag: 'r' }).subarray(0, 4);
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

function ffmpegSupportsSubtitles(): boolean {
    if (cachedSubtitlesSupport !== undefined) return cachedSubtitlesSupport;

    const result = spawnSync(FFMPEG_PATH, ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 5000 });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    cachedSubtitlesSupport = !result.error && result.status === 0 && /\bsubtitles\b/.test(output);
    return cachedSubtitlesSupport;
}

function canRenderSvgOverlayWithSips(): boolean {
    if (cachedSipsSupport !== undefined) return cachedSipsSupport;
    cachedSipsSupport = existsSync('/usr/bin/sips');
    return cachedSipsSupport;
}

export function resolveOverlayStrategy(): OverlayStrategy {
    if (FFMPEG_OVERLAY_MODE === 'off') {
        if (isLocalStage || process.env.ALLOW_SHORTS_OVERLAY_OFF === 'true') return 'none';
        throw new Error(
            `VIDEO_OVERLAY_DISABLED_IN_STAGE: SHORTS_FFMPEG_OVERLAY=off is blocked outside local/offline stage. Text overlay is required for Shorts composition in deployed stages. Set ALLOW_SHORTS_OVERLAY_OFF=true only for an intentional debug run.`
        );
    }

    const fontFile = resolveOverlayFontFile();
    if (fontFile && ffmpegSupportsDrawtext()) return 'drawtext';
    if (fontFile && ffmpegSupportsSubtitles()) return 'ass';
    if (isLocalStage && canRenderSvgOverlayWithSips()) return 'image';

    throw new Error(
        `VIDEO_OVERLAY_CAPABILITY_MISSING: Shorts text overlay requires ffmpeg drawtext or subtitles/libass support. FFMPEG_PATH=${FFMPEG_PATH}, SHORTS_FFMPEG_OVERLAY=${FFMPEG_OVERLAY_MODE}. Local macOS may use /usr/bin/sips as a fallback, but deployed Lambda must use an ffmpeg layer with overlay support.`
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
    image: {
        title?: string;
        caption?: string;
        sourceLabel?: string;
        captionPosition?: CaptionPosition;
        captionStyle?: CaptionStyle;
    },
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

async function createOverlayAss(
    image: {
        title?: string;
        caption?: string;
        sourceLabel?: string;
        durationSec?: number;
        captionPosition?: CaptionPosition;
        captionStyle?: CaptionStyle;
    },
    index: number,
    workDir: string
): Promise<string> {
    const assPath = join(workDir, `overlay-${String(index).padStart(2, '0')}.ass`);
    await writeFile(assPath, buildOverlayAss(image), 'utf8');
    return assPath;
}

function buildOverlayAss(image: {
    title?: string;
    caption?: string;
    sourceLabel?: string;
    durationSec?: number;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
}): string {
    const end = formatAssTime(normalizeDurationSec(image.durationSec));
    const titleLines =
        FFMPEG_OVERLAY_MODE === 'all' ? splitOverlayLines(compactOverlayText(image.title, 28), 11, 2) : [];
    const captionLines =
        FFMPEG_OVERLAY_MODE === 'all' ? splitOverlayLines(compactOverlayText(image.caption, 62), 14, 3) : [];
    const sourceLabel = compactOverlayText(image.sourceLabel, 36);
    const dialogues: string[] = [];

    if (FFMPEG_OVERLAY_MODE === 'all' && titleLines.length > 0) {
        dialogues.push(
            `Dialogue: 0,0:00:00.00,${end},Title,,0,0,0,,{\\pos(540,${titleLines.length === 1 ? 150 : 95})}${escapeAss(titleLines.join('\\N'))}`
        );
    }
    if (FFMPEG_OVERLAY_MODE === 'all' && captionLines.length > 0) {
        const captionPoint = assCaptionPoint(image.captionPosition);
        dialogues.push(
            `Dialogue: 0,0:00:00.00,${end},Caption,,0,0,0,,{\\pos(${captionPoint.x},${captionPoint.y})}${escapeAss(captionLines.join('\\N'))}`
        );
    }
    if ((FFMPEG_OVERLAY_MODE === 'source' || FFMPEG_OVERLAY_MODE === 'all') && sourceLabel) {
        dialogues.push(`Dialogue: 0,0:00:00.00,${end},Source,,0,0,0,,{\\pos(540,1888)}${escapeAss(sourceLabel)}`);
    }

    return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Jalnan 2,118,&H0000F2FF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,7,0,8,0,0,0,1
Style: Caption,Jalnan 2,76,&H0000F2FF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,7,0,2,0,0,0,1
Style: Source,Jalnan 2,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogues.join('\n')}
`;
}

function buildOverlaySvg(image: {
    title?: string;
    caption?: string;
    sourceLabel?: string;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
}): string {
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
    const captionPoint = svgCaptionPoint(image.captionPosition);
    const captionFill = captionFillColor(image.captionStyle);
    const captionText = captionLines
        .map((line, index) =>
            svgText(line, captionPoint.x, captionPoint.y + index * 92, 76, captionFill, 8, captionPoint.anchor)
        )
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

function svgText(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fill: string,
    strokeWidth: number,
    anchor: 'start' | 'middle' | 'end' = 'middle'
): string {
    if (!text) return '';
    const escaped = escapeXml(text);
    const family = 'Apple SD Gothic Neo, AppleGothic, Arial Unicode MS, sans-serif';
    const shadow = `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${family}" font-size="${fontSize}" font-weight="900" fill="${fill}" stroke="black" stroke-width="${strokeWidth}" paint-order="stroke" dominant-baseline="middle">${escaped}</text>`;
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
                `<text x="${x + dx}" y="${y + dy}" text-anchor="${anchor}" font-family="${family}" font-size="${fontSize}" font-weight="900" fill="${fill}" dominant-baseline="middle">${escaped}</text>`
        )
        .join('\n');
    return `${shadow}\n${fills}`;
}

function buildDrawtextOverlayFilter(
    image: {
        title?: string;
        caption?: string;
        sourceLabel?: string;
        captionPosition?: CaptionPosition;
        captionStyle?: CaptionStyle;
    },
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
        const captionPoint = drawtextCaptionPoint(image.captionPosition);
        const captionColor = drawtextCaptionColor(image.captionStyle);
        captionLines.forEach((line, index) => {
            filters.push(
                `drawtext=fontfile='${font}':text='${escapeDrawtext(line)}':x=${captionPoint.x}:y=${captionPoint.y + index * 92}:fontsize=76:fontcolor=${captionColor}:borderw=7:bordercolor=black`
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

function buildAssSubtitleFilter(subtitlePath: string, fontsDir: string | undefined): string {
    const options = [`filename='${escapeFilterValue(subtitlePath)}'`];
    if (fontsDir) options.push(`fontsdir='${escapeFilterValue(fontsDir)}'`);
    return `,subtitles=${options.join(':')}`;
}

function drawtextCaptionPoint(position: CaptionPosition | undefined): { x: string; y: number } {
    return {
        x: drawtextCaptionX(position),
        y: captionY(position),
    };
}

function assCaptionPoint(position: CaptionPosition | undefined): { x: number; y: number } {
    return {
        x: captionX(position),
        y: captionY(position),
    };
}

function svgCaptionPoint(position: CaptionPosition | undefined): {
    x: number;
    y: number;
    anchor: 'start' | 'middle' | 'end';
} {
    const x = captionX(position);
    return {
        x,
        y: captionY(position),
        anchor: x < 540 ? 'start' : x > 540 ? 'end' : 'middle',
    };
}

function drawtextCaptionX(position: CaptionPosition | undefined): string {
    if (position?.endsWith('-left')) return '64';
    if (position?.endsWith('-right')) return 'w-text_w-64';
    return '(w-text_w)/2';
}

function captionX(position: CaptionPosition | undefined): number {
    if (position?.endsWith('-left')) return 64;
    if (position?.endsWith('-right')) return 1016;
    return 540;
}

function captionY(position: CaptionPosition | undefined): number {
    if (position?.startsWith('upper-')) return 620;
    if (position?.startsWith('middle-') || position === 'center') return 960;
    return 1430;
}

function drawtextCaptionColor(style: CaptionStyle | undefined): string {
    if (style === 'whiteBlack' || style === 'smallWhite') return 'white';
    if (style === 'redBlack') return '#ff3b30';
    return 'yellow';
}

function captionFillColor(style: CaptionStyle | undefined): string {
    if (style === 'whiteBlack' || style === 'smallWhite') return '#ffffff';
    if (style === 'redBlack') return '#ff3b30';
    return REFERENCE_YELLOW;
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

function escapeFilterValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

function escapeAss(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
}

function formatAssTime(durationSec: number): string {
    const totalCentiseconds = Math.max(1, Math.round(durationSec * 100));
    const centiseconds = totalCentiseconds % 100;
    const totalSeconds = Math.floor(totalCentiseconds / 100);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
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

    const dataBuffer = decodeDataUrlBinary(url);
    if (dataBuffer) return dataBuffer;

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
    const dataBuffer = decodeDataUrlBinary(url);
    if (dataBuffer) return dataBuffer;

    const localAssetKey = localAssetKeyFromUrl(url);
    if (localAssetKey) return readFile(getLocalAssetPath(localAssetKey));

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Failed to fetch audio input ${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function localAssetKeyFromUrl(url: string): string | undefined {
    const base = LOCAL_ASSET_BASE_URL.replace(/\/+$/, '');
    if (!url.startsWith(`${base}/`)) return undefined;
    if (!isLocalStage) {
        throw new Error('FFmpeg local asset URLs are disabled outside local/offline stage.');
    }
    return decodeURIComponent(url.slice(base.length + 1));
}

export function decodeDataUrlBinary(url: string): Buffer | undefined {
    const match = /^data:([^,]*),(.*)$/s.exec(url);
    if (!match) return undefined;

    const metadata = match[1] ?? '';
    const payload = match[2] ?? '';
    if (/;base64(?:;|$)/i.test(metadata)) return Buffer.from(payload, 'base64');
    return Buffer.from(decodeURIComponent(payload), 'utf8');
}

export function prepareFfmpegFontconfigEnv(
    baseEnv: NodeJS.ProcessEnv,
    workDir: string
): NodeJS.ProcessEnv & { FONTCONFIG_PATH: string; FONTCONFIG_FILE: string; XDG_CACHE_HOME: string; HOME: string } {
    const fontconfigDir = join(workDir, 'fontconfig');
    const fontconfigCacheDir = join(workDir, 'fontconfig-cache');
    const fontsConfPath = join(fontconfigDir, 'fonts.conf');
    mkdirSync(fontconfigDir, { recursive: true });
    mkdirSync(fontconfigCacheDir, { recursive: true });
    writeFileSync(
        fontsConfPath,
        `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/var/task/assets/fonts</dir>
  <dir>/opt/fonts</dir>
  <dir>/usr/share/fonts</dir>
  <cachedir>${escapeFontconfigXml(fontconfigCacheDir)}</cachedir>
</fontconfig>
`,
        'utf8'
    );

    return {
        ...baseEnv,
        HOME: '/tmp',
        XDG_CACHE_HOME: fontconfigCacheDir,
        FONTCONFIG_PATH: fontconfigDir,
        FONTCONFIG_FILE: fontsConfPath,
    };
}

export function runFfmpeg(args: string[], signal?: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError(signal));
            return;
        }

        const diagnosticLog = env.FFMPEG_DIAGNOSTIC_LOG === 'true';
        if (diagnosticLog) {
            console.log(
                JSON.stringify({
                    event: 'ffmpeg.process.start',
                    ffmpegPath: FFMPEG_PATH,
                    args,
                })
            );
        }

        const child = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'], env });
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
            const error = abortError(signal);
            error.message = `${error.message}. FFmpeg stderr: ${stderr.slice(0, 2000) || '(empty)'}`;
            rejectOnce(error);
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        child.stderr?.on('data', chunk => {
            if (stderr.length < 4000) stderr += chunk.toString().slice(0, 4000 - stderr.length);
            if (diagnosticLog) {
                console.log(
                    JSON.stringify({
                        event: 'ffmpeg.process.stderr',
                        chunk: chunk.toString().slice(0, 1000),
                    })
                );
            }
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

function escapeFontconfigXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
    const reason = signal?.reason;
    return reason instanceof Error ? reason : new Error('FFmpeg composition cancelled');
}
