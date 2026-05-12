import type { ShortsRulepack } from './base-shorts-rulepack';

export const GENERAL_SHORTS_RULEPACK: ShortsRulepack = {
    id: 'general-shorts',
    label: '범용 쇼츠',
    triggerKeywords: [],
    sourcePolicy: `Prefer primary sources, official pages, direct announcements, reputable reporting, and clearly dated references. Do not turn weak or unsourced claims into facts.`,
    searchPrompt: `General source policy:
- Prefer primary or official sources first, then reputable reporting.
- Include title, url, source, publishedAt when available, sourceType, confidence, and summary.
- If a topic is current or factual, preserve source references for every important claim.
- If sources disagree, reflect uncertainty instead of choosing silently.`,
    contentPrompt: `General Shorts content rules:
- Audience depends on the user request.
- Use a fast hook, short captions, clear narration, and one idea per scene.
- Avoid misleading certainty, fabricated statistics, or invented source references.
- Each scene should include sourceRefs when it contains factual claims.
- Keep imagePrompt style-neutral. Do not force comic, animation, photo-real, newspaper, or any other art style here.`,
    imagePrompt: `General visual rules:
- The FFmpeg video compositor is responsible for final title/caption/source overlays.
- Short Korean/English in-scene text is allowed when it helps explain the scene, but do not add unrelated text, fake logos, URLs, or watermark-like marks.
- Prefer one clear visual metaphor per scene.`,
    analysisPrompt: `General quality rules:
- Flag unsourced factual claims, overconfident wording, and captions too long for mobile.
- Flag image text that tries to include too many details.
- Preserve uncertainty when the source evidence is weak.`,
};
