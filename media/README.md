# Interface screenshots and animated demonstrations

[Home](../README.md) · [Mechanism gallery](../figure/README.md)

These assets show HAKCC's actual interface with **fictional participants and course data**. The local mock service supplies the data and scripts AI responses; no live classroom account or provider request is used. They illustrate operations, not classroom observations or measured learning outcomes.

## Screenshots

![Shared workspace](../public/manual/ui-canvas.jpg)

A shared canvas connects Notes and inquiry strands.

![Note writing and contextual assistance](../public/manual/ui-note-page.jpg)

The Note editor combines student writing, scaffolds, and contextual AI assistance.

![Teacher AI configuration](../public/manual/ui-teacher-ai.jpg)

Teacher-side course configuration. No provider secret is displayed.

### Public update panel

![Public v0.3.0 update notes](../public/manual/ui-changelog.jpg)

The update panel was recaptured with the local mock service on 6 October 2026. It shows the sanitized public release history. The workspace and assistant screenshots also reflect updated interface assets; the three looping GIFs retain their earlier baseline demonstrations.

## Animated demonstrations

### Build-on

![Build-on contribution](build-on.gif)

A student links a clarification to an existing idea. [Original clip](../public/manual/c04-buildon.mp4).

### AI partnership

![Contextual AI dialogue](ai-partner.gif)

A scripted response supplies material for student examination. Its example cites Roediger and Karpicke (2006) and explicitly distinguishes that study from an AI-specific claim. [Original clip](../public/manual/c05-note-ai.mp4).

### Rise-above

![Rise-above discussion and synthesis](rise-above.gif)

Source Notes remain visible while participants discuss and write their synthesis. [Original clip](../public/manual/c09-riseabove.mp4).

## Provenance and reproduction

The fictional data and capture procedures are included under `scripts/manual-capture/`: `world.mjs`, `mockApi.mjs`, `mockTeacher.mjs`, `scenes.mjs`, and `capture.mjs`. The bundled Chinese-interface clips are converted to 800-pixel-wide, 8 fps looping GIFs at 1.5× speed. English captions explain the actions.

For each original clip, reproduce the conversion using FFmpeg:

```bash
ffmpeg -i INPUT.mp4 -vf 'setpts=PTS/1.5,fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' -loop 0 OUTPUT.gif
```

The source clips include editing, cursor movement, and camera zooms for readability. They are documentation recordings of the local demonstration environment, rather than continuous authenticated production sessions.
