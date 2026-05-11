# Shorts BGM Rules

Background music is part of the final MP4 composition, not a separate mock step.

## Source Policy

- Do not download or use random copyrighted YouTube Music tracks at runtime.
- Use only the project-approved default BGM asset:
    - `apps/backend/assets/bgm/default-comic-mi-steak-loop.mp3`
- Preserve track id, title, source, and license in the video output metadata.

## Selection Contract

- The selector must not choose by topic, mood, horror/news/education category, or random fallback.
- When background music is enabled, select the default BGM only.
- ffmpeg loops the BGM to match the final MP4 duration.

## Mixing

- Narration is primary.
- BGM must sit below narration.
- Default BGM volume should stay around 0.04-0.06 when narration is present.
