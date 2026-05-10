# Reference Shorts Style Guide

This guide captures the reusable style grammar extracted from the three user-provided Korean Shorts references. Do not copy the videos, wording, images, music, or channel identity. Use this only as a production grammar for Eureka Flow generated Shorts.

## Reference Analysis Artifacts

Local analysis artifacts are stored outside the repo:

- `/Users/a0000/Downloads/eureka-shorts-reference-analysis/frames/7rscHG5BNIM_sheet.jpg`
- `/Users/a0000/Downloads/eureka-shorts-reference-analysis/frames/7tZCNnhwjzg_sheet.jpg`
- `/Users/a0000/Downloads/eureka-shorts-reference-analysis/frames/uE8ks8jKwdU_sheet.jpg`

## Visual Grammar

- Canvas: 9:16 vertical MP4.
- Background: mostly black, with the central visual framed inside the vertical canvas.
- Top title: persistent across scenes, two-line Korean title, heavy bold font.
- Title color: yellow for the key phrase, white for the rest.
- Central visual: one image, evidence crop, object, map, flag, chart, document, or meme reaction per scene.
- Lower subtitle: black band with white bold Korean subtitle.
- Source label: optional small bottom label only for factual or source-sensitive content.

## Script Grammar

- Duration: 40-60 seconds for default Shorts.
- First 0-3 seconds: title-like hook that promises one clear payoff.
- Every 2-4 seconds: one new fact, contrast, reveal, or reaction.
- Narration should be subtitle-readable. The bottom subtitle is derived from narration, not a separate teaser caption.
- Use compressed spoken Korean. Avoid blog prose and long disclaimers.
- For factual topics, separate confirmed facts from interpretation and keep source references in metadata.

## BGM Grammar

Use instrumental beds only. The voice must remain dominant.

Production Suno template filenames expected by the backend:

- `warm-education-suno.mp3`
- `cinematic-tension-suno.mp3`
- `fast-explainer-suno.mp3`
- `quirky-office-suno.mp3`
- `futuristic-tech-suno.mp3`

Place them in `apps/backend/assets/bgm/`. If a Suno file is missing, the backend falls back to the existing copyright-safe procedural loop for that mood.

Recommended Suno prompts:

- Warm education: `warm Korean educational documentary background bed, soft pulse, light piano, gentle percussion, loopable, no vocals, no lead melody, narration-friendly`
- Cinematic tension: `dark documentary tension bed, low drums, subtle suspense strings, slow pulse, loopable, no vocals, no lead melody, narration-friendly`
- Fast explainer: `fast Korean explainer background music, clean beat, light percussion, energetic but soft, loopable, no vocals, narration-friendly`
- Quirky office: `quirky office psychology explainer background bed, subtle marimba pluck, light bass, loopable, no vocals, narration-friendly`
- Futuristic tech: `futuristic tech explainer background bed, soft synth pulse, cyber but clean, loopable, no vocals, narration-friendly`

## Implementation Contract

- GPT-image should generate central visuals only. It should not draw title bands, subtitles, source labels, logos, URLs, or readable text.
- `media-video` passes scene narration to FFmpeg as the lower subtitle text.
- `media-tts` emits scene-level `subtitleCues` so future alignment work can use the same text as TTS.
- FFmpeg owns title/subtitle/source overlay rendering and uses the configured Korean font.
