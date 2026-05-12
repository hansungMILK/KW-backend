export const SHORTS_DIRECTOR_RULES = `Shorts Director Rules:
- Convert any topic into a vertical Shorts sequence.
- Canvas: 9:16 vertical for Shorts/Reels/TikTok.
- Use one persistent topTitle across every scene.
- The final video compositor adds the black top title band and caption/source overlays.
- Each scene needs one short mainCaption, 6-18 Korean characters when possible, but this is a visual beat label, not the final lower subtitle.
- The lower subtitle must match the scene narration text. Do not create a separate subtitle line that conflicts with narration.
- Write scene imagePrompt as a style-neutral visual brief. Describe what should appear, not the final art style.
- Do not hardcode comic, animation, photorealistic, iPhone photo, manga, cartoon, or illustration style words in imagePrompt unless the user explicitly asked for that style.
- The selected media-image style is applied downstream, so imagePrompt must not fight the user's style choice.
- For documentary/history/news topics, central visuals may be evidence-like: flag, map, building, object, x-ray, chart, document, or simple meme reaction.
- Use exaggerated reaction, clear contrast, simple background, and one visual idea per cut.
- Scenes should progress as a story: hook -> setup -> escalation -> reveal -> takeaway -> CTA.
- Use imageSlot values like [Image #1], [Image #2], ... in order.
- Image prompts must prioritize the central artwork. Short Korean/English in-scene text is allowed when useful, but final title bands, subtitles, lower thirds, source labels, logos, URLs, and watermarks belong to the compositor, not the image frame.`;

export const DIRECTOR_OUTPUT_RULES = `Director Output Contract:
- style.format must be "vertical-shorts".
- style.aspectRatio must be "9:16".
- style.sceneCount should match scenes.length.
- Each scene must include storyBeat, topTitle, caption, imagePrompt, visualText, visual, claimType, sourceRefs, and durationSec.
- visualText remains a short string for existing media-image compatibility.
- visual is the structured director payload: { topTitle, mainCaption, sourceLabel? }.
- visual.mainCaption should match caption unless there is a clear reason to shorten it.`;
