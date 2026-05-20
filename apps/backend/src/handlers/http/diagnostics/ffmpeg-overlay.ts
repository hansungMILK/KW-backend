import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
    decodeDataUrlBinary,
    ffmpegAdapter,
    prepareFfmpegFontconfigEnv,
    resolveOverlayFontFile,
} from '../../../adapters/external/ffmpeg-adapter';
import { getBody, withMiddleware } from '../../../utils/middleware';
import { forbidden, ok } from '../../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ONE_PIXEL_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const DIAGNOSTIC_TIMEOUT_MS = Number(process.env.FFMPEG_DIAGNOSTIC_TIMEOUT_MS || 90000);
const MATRIX_STEP_TIMEOUT_MS = Number(process.env.FFMPEG_DIAGNOSTIC_MATRIX_STEP_TIMEOUT_MS || 12000);

function logStep(step: string, fields: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ event: 'ffmpeg-overlay.diagnostic', step, ...fields }));
}

type DiagnosticRequestBody = { mode?: 'compose' | 'matrix'; source?: string };

const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!isDiagnosticsEndpointAllowed()) {
        return forbidden('Diagnostics endpoints are disabled for this stage.');
    }

    const body = getBody<DiagnosticRequestBody>(event);
    if (body?.mode === 'matrix') {
        return ok(await runFfmpegDiagnosticMatrix());
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const previousDiagnosticLog = process.env.FFMPEG_DIAGNOSTIC_LOG;
    process.env.FFMPEG_DIAGNOSTIC_LOG = 'true';
    const timeout = setTimeout(() => {
        controller.abort(new Error(`FFmpeg diagnostic timed out after ${Math.round(DIAGNOSTIC_TIMEOUT_MS / 1000)}s`));
    }, DIAGNOSTIC_TIMEOUT_MS);

    logStep('compose.start', {
        timeoutMs: DIAGNOSTIC_TIMEOUT_MS,
        ffmpegPath: process.env.FFMPEG_PATH,
        ffprobePath: process.env.FFPROBE_PATH,
        overlayMode: process.env.SHORTS_FFMPEG_OVERLAY,
    });

    try {
        const result = await ffmpegAdapter.compose({
            images: [
                {
                    url: ONE_PIXEL_PNG,
                    durationSec: 0.5,
                    title: 'FFmpeg',
                    caption: 'overlay smoke',
                    sourceLabel: 'runtime diagnostics',
                },
            ],
            outputWidth: 320,
            outputHeight: 568,
            outputFormat: 'mp4',
            signal: controller.signal,
            onProgress: (_progress, message) => {
                logStep('compose.progress', { elapsedMs: Date.now() - startedAt, message });
            },
        });
        logStep('compose.done', { elapsedMs: Date.now() - startedAt, sizeBytes: result.sizeBytes });

        logStep('probe.start', { elapsedMs: Date.now() - startedAt });
        const probe = await ffmpegAdapter.probeVideo(result.videoBuffer);
        logStep('probe.done', { elapsedMs: Date.now() - startedAt, hasVideo: probe.hasVideo });

        return ok({
            ok: true,
            capability: 'ffmpeg-overlay',
            durationMs: Date.now() - startedAt,
            video: {
                durationSec: result.durationSec,
                sizeBytes: result.sizeBytes,
                hasVideo: probe.hasVideo,
                hasAudio: probe.hasAudio,
                width: probe.width,
                height: probe.height,
            },
        });
    } finally {
        if (previousDiagnosticLog === undefined) {
            delete process.env.FFMPEG_DIAGNOSTIC_LOG;
        } else {
            process.env.FFMPEG_DIAGNOSTIC_LOG = previousDiagnosticLog;
        }
        clearTimeout(timeout);
    }
};

export const main = withMiddleware(handler);

function isDiagnosticsEndpointAllowed(): boolean {
    const explicit = process.env.ALLOW_DIAGNOSTICS_ENDPOINTS?.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(explicit ?? '')) return true;
    return process.env.STAGE !== 'prod';
}

async function runFfmpegDiagnosticMatrix(): Promise<{
    ok: boolean;
    capability: 'ffmpeg-overlay-matrix';
    ffmpegPath: string | undefined;
    fontFile: string | undefined;
    steps: Array<{ name: string; ok: boolean; durationMs: number; error?: string; stdout?: string; stderr?: string }>;
}> {
    const workDir = await mkdtemp(join(tmpdir(), 'eureka-ffmpeg-matrix-'));
    const imagePath = join(workDir, 'image.png');
    const fontFile = resolveOverlayFontFile();

    try {
        const imageBuffer = decodeDataUrlBinary(ONE_PIXEL_PNG);
        if (!imageBuffer) throw new Error('Failed to prepare diagnostic image');
        await writeFile(imagePath, imageBuffer);

        const steps = [
            { name: 'version', args: ['-version'] },
            { name: 'filters', args: ['-hide_banner', '-filters'] },
            {
                name: 'lavfi-x264',
                args: [
                    '-y',
                    '-nostdin',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-f',
                    'lavfi',
                    '-i',
                    'color=c=black:s=320x568:d=0.5:r=30',
                    '-frames:v',
                    '15',
                    '-c:v',
                    'libx264',
                    '-preset',
                    'ultrafast',
                    '-pix_fmt',
                    'yuv420p',
                    join(workDir, 'lavfi-x264.mp4'),
                ],
            },
            {
                name: 'lavfi-drawtext',
                args: [
                    '-y',
                    '-nostdin',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-f',
                    'lavfi',
                    '-i',
                    'color=c=black:s=320x568:d=0.5:r=30',
                    '-vf',
                    `drawtext=fontfile='${fontFile ?? ''}':text='FFmpeg':x=20:y=20:fontsize=40:fontcolor=white`,
                    '-frames:v',
                    '15',
                    '-c:v',
                    'libx264',
                    '-preset',
                    'ultrafast',
                    '-pix_fmt',
                    'yuv420p',
                    join(workDir, 'lavfi-drawtext.mp4'),
                ],
            },
            {
                name: 'image-scale-x264',
                args: [
                    '-y',
                    '-nostdin',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-i',
                    imagePath,
                    '-vf',
                    'loop=loop=14:size=1:start=0,setpts=N/(30*TB),scale=320:312:force_original_aspect_ratio=increase,crop=320:312,setsar=1,pad=320:568:0:116:black,trim=duration=0.5,setpts=PTS-STARTPTS,format=yuv420p',
                    '-frames:v',
                    '15',
                    '-c:v',
                    'libx264',
                    '-preset',
                    'ultrafast',
                    join(workDir, 'image-scale-x264.mp4'),
                ],
            },
            {
                name: 'image-drawtext-x264',
                args: [
                    '-y',
                    '-nostdin',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-i',
                    imagePath,
                    '-vf',
                    `loop=loop=14:size=1:start=0,setpts=N/(30*TB),scale=320:312:force_original_aspect_ratio=increase,crop=320:312,setsar=1,pad=320:568:0:116:black,drawtext=fontfile='${fontFile ?? ''}':text='FFmpeg':x=(w-text_w)/2:y=111:fontsize=40:fontcolor=yellow:borderw=3:bordercolor=black,trim=duration=0.5,setpts=PTS-STARTPTS,format=yuv420p`,
                    '-frames:v',
                    '15',
                    '-c:v',
                    'libx264',
                    '-preset',
                    'ultrafast',
                    join(workDir, 'image-drawtext-x264.mp4'),
                ],
            },
        ];

        const env = prepareFfmpegFontconfigEnv(process.env, workDir);
        const results = [];
        for (const step of steps) {
            results.push(await runFfmpegMatrixStep(step.name, step.args, env));
        }

        return {
            ok: results.every(step => step.ok),
            capability: 'ffmpeg-overlay-matrix',
            ffmpegPath: process.env.FFMPEG_PATH,
            fontFile,
            steps: results,
        };
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

function runFfmpegMatrixStep(
    name: string,
    args: string[],
    env: NodeJS.ProcessEnv
): Promise<{ name: string; ok: boolean; durationMs: number; error?: string; stdout?: string; stderr?: string }> {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            settle({ ok: false, error: `timed out after ${MATRIX_STEP_TIMEOUT_MS}ms` });
        }, MATRIX_STEP_TIMEOUT_MS);
        const settle = (result: { ok: boolean; error?: string }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                name,
                ok: result.ok,
                durationMs: Date.now() - startedAt,
                ...(result.error ? { error: result.error } : {}),
                ...(stdout ? { stdout: stdout.slice(0, 1200) } : {}),
                ...(stderr ? { stderr: stderr.slice(0, 1200) } : {}),
            });
        };

        child.stdout?.on('data', chunk => {
            if (stdout.length < 1200) stdout += chunk.toString().slice(0, 1200 - stdout.length);
        });
        child.stderr?.on('data', chunk => {
            if (stderr.length < 1200) stderr += chunk.toString().slice(0, 1200 - stderr.length);
        });
        child.on('error', error => settle({ ok: false, error: error.message }));
        child.on('close', (code, signal) => {
            if (code === 0) {
                settle({ ok: true });
                return;
            }
            settle({ ok: false, error: signal ? `exited with signal ${signal}` : `exited with code ${code}` });
        });
    });
}
