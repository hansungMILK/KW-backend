# Shorts BGM Assets

Put only licensed or royalty-free BGM files in this directory.

The current checked-in MP3 files are project-generated procedural instrumental loops.
They are intentionally simple and copyright-safe fallbacks.

Default Shorts BGM:

- `default-comic-mi-steak-loop.mp3` — default comic/explainer Shorts bed.
  This is selected for ordinary non-horror/non-specialized topics.

For production Shorts, add project-owned Suno-generated instrumental templates here.
Only add Suno files that were generated under a plan/license that grants the project
commercial use rights. Do not add random YouTube Music downloads.

YouTube Studio Audio Library tracks are preferred when installed. Download them
from YouTube Studio Audio Library, verify the visible license screen, then save
the MP3 files with these exact filenames:

- `ytal-warm-education-lovely-afternoon-breeze.mp3` — Lovely Afternoon Breeze / The 126ers
- `ytal-cinematic-tension-candidate.mp3` — add a non-horror cinematic/news track later
- `ytal-fast-explainer-happy-boy-theme.mp3` — Happy Boy Theme / Kevin MacLeod
- `ytal-quirky-office-funhouse.mp3` — Funhouse / Bad Snacks
- `ytal-futuristic-tech-after-all.mp3` — After All / Geographer
- `ytal-horror-dark-dark-toys.mp3` — Dark Toys / SYBS; only for horror/scary topics

Candidate metadata is tracked in `youtube-audio-library-candidates.json`.

If YouTube Audio Library files are not installed, the backend then looks for
these Suno filenames:

- `warm-education-suno.mp3` (fallback: `warm-storytelling-loop.mp3`)
- `cinematic-tension-suno.mp3` (fallback: `cinematic-tension-loop.mp3`)
- `fast-explainer-suno.mp3` (fallback: `fast-explainer-loop.mp3`)
- `quirky-office-suno.mp3` (fallback: `quirky-office-loop.mp3`)
- `futuristic-tech-suno.mp3` (fallback: `futuristic-tech-loop.mp3`)
- `neutral-documentary-loop.mp3`

Recommended Suno prompt directions:

- `warm-education-suno.mp3`: warm Korean educational documentary bed, soft pulse, light piano, no vocals.
- `cinematic-tension-suno.mp3`: dark documentary tension bed, low drums, suspense strings, no vocals.
- `fast-explainer-suno.mp3`: fast Korean explainer loop, clean beat, light percussion, no vocals.
- `quirky-office-suno.mp3`: quirky office psychology explainer bed, subtle marimba/pluck, no vocals.
- `futuristic-tech-suno.mp3`: futuristic tech explainer bed, soft synth pulse, no vocals.

Keep BGM instrumental. Narration must stay louder than music.
