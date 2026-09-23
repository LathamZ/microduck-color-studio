# README preview

`docs/media/studio-demo.gif`: about 41.5 seconds, 415 recorded frames, 1280 × 720. Captures only the webpage viewport: no browser tabs, address bar or debugger overlays.

To reproduce: serve the app and open `?demo=1` at a 1920 × 1080 viewport. Demo mode never reads or writes local palettes or inventory. Advance with Right arrow `DEMO_FRAMES` times (see `src/demo.ts`), capturing the viewport after each step, then encode as below. Example stock is for demonstration only.

## Storyboard

| Frames  |       | Beat                                                           |
| ------- | ----- | -------------------------------------------------------------- |
| 0–10    | 1.0 s | The duck, in the studio's own standard view                    |
| 11–60   | 5.0 s | Turn it while colours are applied from the tray, one at a time |
| 61–74   | 1.4 s | Push in on the torso and pick a reference colour               |
| 75–112  | 3.8 s | Four materials in turn, drifting so highlights move            |
| 113–126 | 1.4 s | Pull back out to the standard view                             |
| 127–152 | 2.6 s | Studio → daylight → warm → cinema                              |
| 153–174 | 2.2 s | Butterfly → Rembrandt → split → rim inside cinema              |
| 175–202 | 2.8 s | Aim the lamp: direction, then angle, then strength             |
| 203–214 | 1.2 s | Fullscreen                                                     |
| 215–252 | 3.8 s | The duck walks, turning all the way round                      |
| 253–264 | 1.2 s | Fit the roller skates                                          |
| 265–294 | 3.0 s | Cruise, then accelerate                                        |
| 295–314 | 2.0 s | Brake                                                          |
| 315–326 | 1.2 s | A head shake on the skates                                     |
| 327–336 | 1.0 s | Leave fullscreen                                               |
| 337–358 | 2.2 s | Save a look, change it, apply the saved one back               |
| 359–404 | 4.6 s | Import a 3MF, export, pick a printer, preview the plates       |
| 405–414 | 1.0 s | Hold on the plate preview                                      |

Camera moves are eased and the turn and walk ease in and out, so no beat starts or ends with a jolt. Every control is scrolled into view before it is used, and the recorded cursor shows where the click lands.

The encode fades the first and last frames through the page's own background, so the file loops without a hard cut: the last frame matches the first.

## Fullscreen in the recording

A recording runs headless, and a synthetic click is never granted the Fullscreen API. Demo mode therefore puts the equivalent `.is-fullscreen` styles on the stage instead of calling `requestFullscreen()`: the same rules the real fullscreen element gets. Everything else in the recording is the app's own behaviour.

## Encoding

```sh
ffmpeg -framerate 10 -i frame-%03d.jpg -filter_complex 'fps=10,scale=1280:720:flags=lanczos,fade=t=in:st=0:d=0.4:color=0xeef0eb,fade=t=out:st=41.0:d=0.5:color=0xeef0eb,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle' -loop 0 studio-demo.gif
gifsicle -O3 --lossy=170 studio-demo.gif -o studio-demo.opt.gif && mv studio-demo.opt.gif studio-demo.gif
```

No dithering, because these are gradients and UI text rather than photographic tones; gifsicle then merges the identical frames the demo holds on and trims the palette per frame.

The rendered model remains covered by CC BY-NC-SA 4.0; see NOTICE.md.
