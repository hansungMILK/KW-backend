# Base Shorts Engine

This is the shared production rulepack for all Shorts presets.

- Format: vertical 9:16.
- Default length: about 60 seconds.
- Default scene count: 12 scenes, with 10-15 allowed.
- Pipeline: search -> content -> data -> analysis -> media-image + media-tts -> media-video -> integration.
- Each scene should carry one idea, one short caption, narration, image prompt, duration, and source references when factual.
- GPT-image-2 can render short Korean text in-frame.
- In-frame Korean text should be short: persistent top title, one central caption, and optionally a tiny source/date label.
- Do not put long facts, dense tables, URLs, many numbers, or detailed dates inside generated images.
- Preserve source references through the final output.
- Do not invent source names, URLs, statistics, dates, or official claims.
