import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface VideoCompositionRequest {
    images: Array<{ url: string; durationSec: number; title?: string; caption?: string; sourceLabel?: string }>;
    audioUrl?: string;
    backgroundMusic?: boolean;
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
const FFMPEG_OVERLAY_MODE = process.env.SHORTS_FFMPEG_OVERLAY || 'source';

let cachedDrawtextSupport: boolean | undefined;

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

            let audioPath: string | null = null;
            if (request.audioUrl) {
                audioPath = join(workDir, 'audio.mp3');
                await writeFile(audioPath, await loadAudioBinary(request.audioUrl));
            }

            await runFfmpeg(buildArgs(imageFiles, audioPath, request, outputPath));

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
    imageFiles: Array<{ path: string; durationSec: number; title?: string; caption?: string; sourceLabel?: string }>,
    audioPath: string | null,
    request: VideoCompositionRequest,
    outputPath: string
): string[] {
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    const durationSec = imageFiles.reduce((sum, image) => sum + image.durationSec, 0);

    for (const image of imageFiles) {
        args.push('-framerate', '30', '-loop', '1', '-t', String(image.durationSec), '-i', image.path);
    }

    let nextInputIndex = imageFiles.length;
    let narrationInputIndex: number | null = null;
    if (audioPath) {
        narrationInputIndex = nextInputIndex;
        nextInputIndex += 1;
        args.push('-i', audioPath);
    }

    let bgmInputIndex: number | null = null;
    if (request.backgroundMusic !== false) {
        bgmInputIndex = nextInputIndex;
        args.push(
            '-f',
            'lavfi',
            '-t',
            String(durationSec),
            '-i',
            'aevalsrc=exprs=0.020*(sin(2*PI*196*t)+sin(2*PI*246.94*t)+sin(2*PI*293.66*t)):sample_rate=44100'
        );
    }

    const width = String(request.outputWidth);
    const height = String(request.outputHeight);
    const fontFile = resolveOverlayFontFile();
    const canApplyTextOverlay = FFMPEG_OVERLAY_MODE !== 'off' && Boolean(fontFile) && ffmpegSupportsDrawtext();
    if (FFMPEG_OVERLAY_MODE !== 'off' && !canApplyTextOverlay) {
        console.warn(
            `[ffmpeg-adapter] text overlay disabled: ${fontFile ? 'ffmpeg drawtext filter is unavailable' : 'Korean font file not found'}`
        );
    }
    const filterParts = imageFiles.map((image, i) => {
        const overlay = canApplyTextOverlay ? buildOverlayFilter(image, fontFile) : '';
        return `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1${overlay}[v${i}]`;
    });
    const concatInputs = imageFiles.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${imageFiles.length}:v=1:a=0,format=yuv420p[v]`);

    let audioMap: string | null = null;
    if (narrationInputIndex !== null && bgmInputIndex !== null) {
        filterParts.push(`[${narrationInputIndex}:a]volume=1.0[a0]`);
        filterParts.push(`[${bgmInputIndex}:a]volume=0.08[a1]`);
        filterParts.push('[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[a]');
        audioMap = '[a]';
    } else if (bgmInputIndex !== null) {
        filterParts.push(`[${bgmInputIndex}:a]volume=0.08[a]`);
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

function buildOverlayFilter(
    image: { title?: string; caption?: string; sourceLabel?: string },
    fontFile: string | undefined
): string {
    if (FFMPEG_OVERLAY_MODE === 'off' || !fontFile) return '';

    const filters: string[] = [];
    const sourceLabel = compactOverlayText(image.sourceLabel, 36);
    const caption = compactOverlayText(image.caption, 24);
    const title = compactOverlayText(image.title, 20);
    const font = escapeDrawtext(fontFile);

    if (FFMPEG_OVERLAY_MODE === 'all' && title) {
        filters.push('drawbox=x=0:y=0:w=w:h=230:color=black@0.88:t=fill');
        filters.push(
            `drawtext=fontfile='${font}':text='${escapeDrawtext(title)}':x=(w-text_w)/2:y=52:fontsize=86:fontcolor=yellow:borderw=4:bordercolor=black`
        );
    }

    if (FFMPEG_OVERLAY_MODE === 'all' && caption) {
        filters.push(
            `drawtext=fontfile='${font}':text='${escapeDrawtext(caption)}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=66:fontcolor=white:borderw=5:bordercolor=black`
        );
    }

    if ((FFMPEG_OVERLAY_MODE === 'source' || FFMPEG_OVERLAY_MODE === 'all') && sourceLabel) {
        filters.push('drawbox=x=0:y=h-92:w=w:h=92:color=black@0.34:t=fill');
        filters.push(
            `drawtext=fontfile='${font}':text='${escapeDrawtext(sourceLabel)}':x=(w-text_w)/2:y=h-62:fontsize=30:fontcolor=white@0.86:borderw=2:bordercolor=black@0.7`
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

function escapeDrawtext(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

async function loadImageBinary(url: string): Promise<Buffer> {
    if (url.startsWith('fake://') || url.startsWith('placeholder://')) {
        throw new Error(`FFmpeg image input must be a real public URL, got ${url}`);
    }

    if (url.startsWith('s3://')) {
        throw new Error(`FFmpeg input must be a public URL, got ${url}`);
    }

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
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch audio input ${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
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
