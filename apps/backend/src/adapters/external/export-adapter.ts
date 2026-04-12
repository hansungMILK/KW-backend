/**
 * Export adapter — handles publishing to external platforms.
 *
 * Currently returns mock responses.
 * To enable real exports:
 * 1. YouTube: use googleapis (youtube.videos.insert) with OAuth2
 * 2. TikTok: use TikTok Content Posting API
 *
 * Both require env vars for API keys/tokens:
 * - YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 * - TIKTOK_ACCESS_TOKEN
 */

export interface ExportResult {
    success: boolean;
    externalId?: string;
    externalUrl?: string;
    message: string;
}

export const exportAdapter = {
    async publishToYouTube(videoUrl: string, _metadata: Record<string, unknown>): Promise<ExportResult> {
        const hasYouTubeCredentials = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN);

        if (!hasYouTubeCredentials) {
            return {
                success: false,
                message: 'YouTube credentials not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_REFRESH_TOKEN.',
            };
        }

        // Real implementation would:
        // 1. Download video from videoUrl (or use S3 presigned URL)
        // 2. Call youtube.videos.insert with OAuth2
        // 3. Return the published video ID and URL
        return {
            success: false,
            message: 'YouTube API integration pending. Credentials detected but upload not yet implemented.',
        };
    },

    async publishToTikTok(videoUrl: string, _metadata: Record<string, unknown>): Promise<ExportResult> {
        const hasTikTokCredentials = !!process.env.TIKTOK_ACCESS_TOKEN;

        if (!hasTikTokCredentials) {
            return {
                success: false,
                message: 'TikTok credentials not configured. Set TIKTOK_ACCESS_TOKEN.',
            };
        }

        return {
            success: false,
            message: 'TikTok API integration pending. Credentials detected but upload not yet implemented.',
        };
    },
};
