# Default BGM Asset

This directory intentionally keeps one canonical background music file:

- `default-bgm.mp3`

Metadata:

- Title: `Glass Horizon`
- Artist: `loudsquaredance310`
- Duration: approximately `198s`
- SHA-256: `37f55c71ef0aea6312efb8c735ecbf028b06219b42cc265bddc482d7b4adc2e9`

Longform production uses this file as its default BGM. The media-video block
also selects this track when background music is enabled.
The ffmpeg adapter loops it to match the final MP4 duration.

Do not add theme-based or random music files here unless the BGM selection contract
is intentionally changed again. Narration must stay louder than music.
