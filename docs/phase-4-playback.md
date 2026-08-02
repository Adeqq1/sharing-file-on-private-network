# Phase 4: Playback Correctness

- Direct browser streaming now requires a compatible container and codec pair: MP4/H.264/AAC or WebM/VP8-9-AV1 with Opus/Vorbis.
- Other inputs use FFmpeg; remuxing only copies codecs portable in fMP4 output.
- Seek, subtitle offset, burn-in, and embedded subtitle stream parameters reject invalid, non-finite, or mismatched values before spawning FFmpeg.
- The two-process FFmpeg limit now includes remux playback.
