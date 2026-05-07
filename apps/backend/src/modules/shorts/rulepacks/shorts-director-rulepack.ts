export const SHORTS_DIRECTOR_RULES = `Shorts Director Rules:
- Convert any topic into a vertical comic Shorts sequence.
- Canvas: 9:16 vertical for Shorts/Reels/TikTok.
- Use one persistent topTitle across every scene.
- Prefer a black top title band with large yellow/white Korean title text.
- Each scene needs one short mainCaption, 6-18 Korean characters when possible.
- The main image should feel like a comic, meme, or staged situation, not a report slide.
- Use exaggerated reaction, clear contrast, simple background, and one visual idea per cut.
- Scenes should progress as a story: hook -> setup -> escalation -> reveal -> takeaway -> CTA.
- Use imageSlot values like [Image #1], [Image #2], ... in order.
- GPT-image-2 can render short Korean text, but avoid long paragraphs, tables, URLs, many numbers, and tiny text.`;

export const DIRECTOR_OUTPUT_RULES = `Director Output Contract:
- style.format must be "vertical-comic-shorts".
- style.aspectRatio must be "9:16".
- style.sceneCount should match scenes.length.
- Each scene must include storyBeat, topTitle, caption, imagePrompt, visualText, visual, claimType, sourceRefs, and durationSec.
- visualText remains a short string for existing media-image compatibility.
- visual is the structured director payload: { topTitle, mainCaption, sourceLabel? }.
- visual.mainCaption should match caption unless there is a clear reason to shorten it.`;
