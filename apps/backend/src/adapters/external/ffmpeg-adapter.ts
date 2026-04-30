import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface VideoCompositionRequest {
    images: Array<{ url: string; durationSec: number }>;
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

export const ffmpegAdapter = {
    async compose(request: VideoCompositionRequest): Promise<VideoCompositionResult> {
        const workDir = await mkdtemp(join(tmpdir(), 'eureka-video-'));
        const outputPath = join(workDir, 'output.mp4');

        try {
            if (request.images.length === 0) {
                throw new Error('FFmpeg composition requires at least one real image input');
            }

            const imageFiles: Array<{ path: string; durationSec: number }> = [];

            for (let i = 0; i < request.images.length; i++) {
                const image = request.images[i];
                const path = join(workDir, `image-${String(i).padStart(2, '0')}.png`);
                const imageBuffer = await loadImageBinary(image.url);
                await writeFile(path, imageBuffer);
                imageFiles.push({
                    path,
                    durationSec: Math.max(1, Math.ceil(image.durationSec || 5)),
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
    imageFiles: Array<{ path: string; durationSec: number }>,
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
    const filterParts = imageFiles.map((_, i) => {
        return `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[v${i}]`;
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
