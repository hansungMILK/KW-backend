export const SHORTS_DIRECTOR_RULES = `Shorts Director Rules:
- Convert any topic into a vertical comic Shorts sequence.
- Canvas: 9:16 vertical for Shorts/Reels/TikTok.
- Use one persistent topTitle across every scene.
- The final video compositor adds the black top title band and caption/source overlays.
- Each scene needs one short mainCaption, 6-18 Korean characters when possible.
- The main image should feel like a comic, meme, or staged situation, not a report slide.
- Use exaggerated reaction, clear contrast, simple background, and one visual idea per cut.
- Scenes should progress as a story: hook -> setup -> escalation -> reveal -> takeaway -> CTA.
- Use imageSlot values like [Image #1], [Image #2], ... in order.
- Image prompts must describe only the central artwork. Do not ask GPT-image to draw text, black title bands, subtitles, lower thirds, source labels, logos, URLs, or readable UI text.`;

export const DIRECTOR_OUTPUT_RULES = `Director Output Contract:
- style.format must be "vertical-comic-shorts".
- style.aspectRatio must be "9:16".
- style.sceneCount should match scenes.length.
- Each scene must include storyBeat, topTitle, caption, imagePrompt, visualText, visual, claimType, sourceRefs, and durationSec.
- visualText remains a short string for existing media-image compatibility.
- visual is the structured director payload: { topTitle, mainCaption, sourceLabel? }.
- visual.mainCaption should match caption unless there is a clear reason to shorten it.`;
