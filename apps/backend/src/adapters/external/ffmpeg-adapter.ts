import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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
              license?: string;
              attribution?: string;
          };
    outputWidth: number;
    outputHeight: number;
    outputFormat: 'mp4';
}

export interface VideoCompositionResult {
    videoBuffer: Buffer;
    durationSec: number;
    sizeBytes: number;
}

const FFMPEG_PATH = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 840000);
const FFMPEG_OVERLAY_MODE = process.env.SHORTS_FFMPEG_OVERLAY || 'all';
const LOCAL_ASSET_BASE_URL = process.env.LOCAL_ASSET_BASE_URL || 'http://localhost:8800/_local-assets';

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
                const imageBuffer = await loadImageBinary(image.url);
                await writeFile(path, imageBuffer);
                imageFiles.push({
                    path,
                    durationSec: Math.max(1, Math.ceil(image.durationSec || 5)),
                    title: image.title,
                    caption: image.caption,
                    sourceLabel: image.sourceLabel,
                });
            }

            const overlayStrategy = resolveOverlayStrategy();
            if (overlayStrategy === 'image') {
                for (let i = 0; i < imageFiles.length; i += 1) {
                    imageFiles[i].overlayPath = await createOverlayPng(imageFiles[i], i, workDir);
                }
            }

            let audioPath: string | null = null;
            if (request.audioUrl) {
                audioPath = join(workDir, 'audio.mp3');
                await writeFile(audioPath, await loadAudioBinary(request.audioUrl));
            }

            const backgroundMusicPath = await resolveBackgroundMusicPath(request.backgroundMusic, workDir);

            await runFfmpeg(buildArgs(imageFiles, audioPath, backgroundMusicPath, request, outputPath));

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

    const width = String(request.outputWidth);
    const height = String(request.outputHeight);
    const overlayStrategy = resolveOverlayStrategy();
    const fontFile = overlayStrategy === 'drawtext' ? resolveOverlayFontFile() : undefined;
    const filterParts: string[] = [];
    imageFiles.forEach((image, i) => {
        const overlayInputIndex = overlayInputIndices.get(i);
        if (overlayInputIndex !== undefined) {
            filterParts.push(
                `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[base${i}]`
            );
            filterParts.push(`[base${i}][${overlayInputIndex}:v]overlay=0:0:format=auto[v${i}]`);
            return;
        }

        const overlay = overlayStrategy === 'drawtext' ? buildDrawtextOverlayFilter(image, fontFile) : '';
        filterParts.push(
            `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1${overlay}[v${i}]`
        );
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

function resolveOverlayFontFile(): string | undefined {
    const candidates = [
        process.env.FFMPEG_FONT_FILE,
        '/opt/fonts/Pretendard-Black.otf',
        '/opt/fonts/BlackHanSans-Regular.ttf',
        '/opt/fonts/NotoSansKR-Black.otf',
        '/opt/fonts/NotoSansCJKkr-Black.otf',
        '/System/Library/Fonts/AppleSDGothicNeo.ttc',
        '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
        '/opt/fonts/NotoSansCJKkr-Regular.otf',
        '/opt/fonts/NotoSansKR-Regular.otf',
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates.find(candidate => existsSync(candidate));
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
        FFMPEG_OVERLAY_MODE === 'all' ? splitOverlayLines(compactOverlayText(image.title, 24), 12, 2) : [];
    const captionLines =
        FFMPEG_OVERLAY_MODE === 'all' ? splitOverlayLines(compactOverlayText(image.caption, 78), 18, 3) : [];
    const sourceLabel = compactOverlayText(image.sourceLabel, 36);
    const titleText = titleLines
        .map((line, index) => {
            const y = titleLines.length === 1 ? 198 : 148 + index * 112;
            const color = index === 0 ? '#fff200' : '#ffffff';
            return svgText(line, 540, y, 96, color, 8);
        })
        .join('\n');
    const captionText = captionLines
        .map((line, index) => svgText(line, 540, 1652 + index * 82, 62, '#ffffff', 7))
        .join('\n');
    const sourceText = sourceLabel ? svgText(sourceLabel, 540, 1888, 30, 'rgba(255,255,255,0.78)', 2) : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${FFMPEG_OVERLAY_MODE === 'all' ? '<rect x="0" y="0" width="1080" height="360" fill="black"/>' : ''}
  ${
      FFMPEG_OVERLAY_MODE === 'all'
          ? '<rect x="0" y="1588" width="1080" height="332" fill="black"/>'
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
    const captionLines = splitOverlayLines(compactOverlayText(image.caption, 78), 18, 3);
    const titleLines = splitOverlayLines(compactOverlayText(image.title, 24), 12, 2);
    const font = escapeDrawtext(fontFile);

    if (FFMPEG_OVERLAY_MODE === 'all' && titleLines.length > 0) {
        filters.push('drawbox=x=0:y=0:w=w:h=360:color=black:t=fill');
        titleLines.forEach((line, index) => {
            const y = titleLines.length === 1 ? 144 : 92 + index * 112;
            const color = index === 0 ? 'yellow' : 'white';
            filters.push(
                `drawtext=fontfile='${font}':text='${escapeDrawtext(line)}':x=(w-text_w)/2:y=${y}:fontsize=96:fontcolor=${color}:borderw=5:bordercolor=black`
            );
        });
    }

    if (FFMPEG_OVERLAY_MODE === 'all' && captionLines.length > 0) {
        filters.push('drawbox=x=0:y=h-332:w=w:h=332:color=black:t=fill');
        captionLines.forEach((line, index) => {
            filters.push(
                `drawtext=fontfile='${font}':text='${escapeDrawtext(line)}':x=(w-text_w)/2:y=h-${270 - index * 82}:fontsize=62:fontcolor=white:borderw=5:bordercolor=black`
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

function splitOverlayLines(value: string, maxCharsPerLine: number, maxLines: number): string[] {
    if (!value) return [];
    if (value.length <= maxCharsPerLine) return [value];

    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words.length > 1 ? words : value.split('')) {
        const next = current ? `${current}${words.length > 1 ? ' ' : ''}${word}` : word;
        if (next.length <= maxCharsPerLine) {
            current = next;
            continue;
        }
        if (current) lines.push(current);
        current = word;
        if (lines.length >= maxLines - 1) break;
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
    workDir: string
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
        await writeFile(bgmPath, await loadAudioBinary(backgroundMusic.url));
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

async function loadImageBinary(url: string): Promise<Buffer> {
    if (url.startsWith('fake://') || url.startsWith('placeholder://')) {
        throw new Error(`FFmpeg image input must be a real public URL, got ${url}`);
    }

    if (url.startsWith('s3://')) {
        throw new Error(`FFmpeg input must be a public URL, got ${url}`);
    }

    const localAssetKey = localAssetKeyFromUrl(url);
    if (localAssetKey) return readFile(getLocalAssetPath(localAssetKey));

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch image input ${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

async function loadAudioBinary(url: string): Promise<Buffer> {
    if (url.startsWith('fake://') || url.startsWith('placeholder://')) {
        throw new Error(`FFmpeg audio input must be a real public URL, got ${url}`);
    }

    if (url.startsWith('s3://')) {
        throw new Error(`FFmpeg input must be a public URL, got ${url}`);
    }
    const localAssetKey = localAssetKeyFromUrl(url);
    if (localAssetKey) return readFile(getLocalAssetPath(localAssetKey));

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch audio input ${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function localAssetKeyFromUrl(url: string): string | undefined {
    const base = LOCAL_ASSET_BASE_URL.replace(/\/+$/, '');
    if (!url.startsWith(`${base}/`)) return undefined;
    return decodeURIComponent(url.slice(base.length + 1));
}

function runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(FFMPEG_PATH, args);
        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`FFmpeg timed out after ${Math.round(FFMPEG_TIMEOUT_MS / 1000)} seconds`));
        }, FFMPEG_TIMEOUT_MS);

        child.stderr.on('data', chunk => {
            if (stderr.length < 4000) stderr += chunk.toString().slice(0, 4000 - stderr.length);
        });
        child.on('error', err => {
            clearTimeout(timeout);
            reject(
                new Error(
                    `FFmpeg not available at ${FFMPEG_PATH}. Set FFMPEG_PATH to a working binary or attach a Lambda layer with /opt/bin/ffmpeg. ${err.message}`
                )
            );
        });
        child.on('close', code => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`FFmpeg failed with exit code ${code}: ${stderr.slice(0, 2000)}`));
        });
    });
}
