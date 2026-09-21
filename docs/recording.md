# README preview

`docs/media/studio-demo.gif`: 19 seconds, 190 frames, 1120 × 788, about 3.3 MB. Captures only the webpage viewport: no browser tabs, address bar, ChatGPT interface or debugger overlays.

To reproduce: serve the app and open `?demo=1` at a 1280 × 900 viewport. Demo mode never reads or writes local palettes/inventory. Advance with Right arrow 190 times (`DEMO_FRAMES` in src/demo.ts), capturing the viewport after each step. Frames 0–24 orbit the assembly; 25–39 apply a palette from the tray; 40–54 set a matte finish and then a silk PLA one; 55–79 link a part to a filament and edit that spool in the library; 80–104 save the look, change it and switch back; 105–140 move to the cinema stage with a lamp setup and aim the lights; 141–164 make it walk; 165–189 import a print model and preview the plates. Example stock is for demonstration only.

Encode the captured JPEG frames with (the settings used for the current file):

```sh
ffmpeg -framerate 10 -i frame-%03d.jpg -filter_complex 'fps=10,scale=1120:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle' -loop 0 studio-demo.gif
```

The rendered model remains covered by CC BY-NC-SA 4.0; see NOTICE.md.
