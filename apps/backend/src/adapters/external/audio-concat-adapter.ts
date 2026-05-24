import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { runFfmpeg } from './ffmpeg-adapter';

export interface AudioConcatSegment {
    audioBuffer: Buffer;
}

export const audioConcatAdapter = {
    async concatMp3(segments: AudioConcatSegment[], signal?: AbortSignal): Promise<Buffer> {
        if (segments.length === 0) throw new Error('audio concat requires at least one segment');
        if (segments.length === 1) return segments[0].audioBuffer;

        const workDir = await mkdtemp(join(tmpdir(), 'eureka-audio-concat-'));
        const outputPath = join(workDir, 'output.mp3');

        try {
            const inputPaths: string[] = [];
            for (let index = 0; index < segments.length; index += 1) {
                throwIfAborted(signal);
                const inputPath = join(workDir, `segment-${String(index).padStart(3, '0')}.mp3`);
                await writeFile(inputPath, segments[index].audioBuffer);
                inputPaths.push(inputPath);
            }

            const concatListPath = join(workDir, 'concat.txt');
            await writeFile(
                concatListPath,
                inputPaths.map(inputPath => `file '${escapeConcatPath(inputPath)}'`).join('\n'),
                'utf8'
            );

            await runFfmpeg(
                [
                    '-y',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-f',
                    'concat',
                    '-safe',
                    '0',
                    '-i',
                    concatListPath,
                    '-c',
                    'copy',
                    outputPath,
                ],
                signal
            );
            return await readFile(outputPath);
        } finally {
            await rm(workDir, { recursive: true, force: true });
        }
    },
};

function escapeConcatPath(value: string): string {
    return value.replace(/'/g, "'\\''");
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error('Audio concat cancelled');
}
