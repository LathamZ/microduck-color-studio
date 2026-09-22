# README preview

`docs/media/studio-demo.gif`: 36.6 seconds, 366 recorded frames (217 stored; identical frames are merged on encode), 1280 × 720, about 6.3 MB. Captures only the webpage viewport: no browser tabs, address bar or debugger overlays.

To reproduce: serve the app and open `?demo=1` at a 1920 × 1080 viewport. Demo mode never reads or writes local palettes or inventory. Advance with Right arrow `DEMO_FRAMES` times (see `src/demo.ts`), capturing the viewport after each step, then encode as below. Example stock is for demonstration only.

## Storyboard

| Frames  |       | Beat                                                                      |
| ------- | ----- | ------------------------------------------------------------------------- |
| 0–8     | 0.9 s | The duck, in the studio's own standard view                               |
| 9–42    | 3.4 s | Turn it while two palettes from the tray apply, easing to a stop          |
| 43–48   | 0.6 s | The turn settles                                                          |
| 49–60   | 1.2 s | Camera pushes in on the torso and swings to the front                     |
| 61–82   | 2.2 s | Drag the part colour picker; the model follows live                       |
| 83–102  | 2.0 s | Step through four materials on the same part, drifting so highlights move |
| 103–112 | 1.0 s | Pull back out to the standard view                                        |
| 113–138 | 2.6 s | Studio → daylight → warm → cinema                                         |
| 139–162 | 2.4 s | Butterfly → Rembrandt → split → rim inside cinema                         |
| 163–198 | 3.6 s | Aim the lamp: direction, then angle, then strength                        |
| 199–210 | 1.2 s | Fullscreen                                                                |
| 211–268 | 5.8 s | Walk, orbiting a full circle and stopping at the front                    |
| 269–288 | 2.0 s | Stop, tilt the head, hold                                                 |
| 289–295 | 0.7 s | Leave fullscreen                                                          |
| 296–317 | 2.2 s | Save a look, change it, apply the saved one back                          |
| 318–357 | 4.0 s | Import a 3MF, export, pick a printer, preview the plates                  |
| 358–365 | 0.8 s | Hold on the plate preview                                                 |

Camera moves are eased and the turn and walk ease in and out, so no beat starts or ends with a jolt. Every control is scrolled into view before it is used, and the recorded cursor shows where the click lands.

The encode fades the first and last frames through the page's own background, so the file loops without a hard cut: the last frame matches the first.

## Fullscreen in the recording

A recording runs headless, and a synthetic click is never granted the Fullscreen API. Demo mode therefore puts the equivalent `.is-fullscreen` styles on the stage instead of calling `requestFullscreen()`: the same rules the real fullscreen element gets. Everything else in the recording is the app's own behaviour.

## Encoding

```sh
ffmpeg -framerate 10 -i frame-%03d.jpg -filter_complex 'fps=10,scale=1280:720:flags=lanczos,fade=t=in:st=0:d=0.4:color=0xeef0eb,fade=t=out:st=36.0:d=0.5:color=0xeef0eb,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle' -loop 0 studio-demo.gif
gifsicle -O3 --lossy=170 studio-demo.gif -o studio-demo.opt.gif && mv studio-demo.opt.gif studio-demo.gif
```

No dithering, because these are gradients and UI text rather than photographic tones; gifsicle then merges the identical frames the demo holds on and trims the palette per frame.

The rendered model remains covered by CC BY-NC-SA 4.0; see NOTICE.md.
