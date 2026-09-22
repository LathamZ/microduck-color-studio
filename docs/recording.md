# README preview

`docs/media/studio-demo.gif`: 30 seconds, 300 frames, 1120 × 788, about 4.7 MB. Captures only the webpage viewport: no browser tabs, address bar, ChatGPT interface or debugger overlays.

To reproduce: serve the app and open `?demo=1` at a 1280 × 900 viewport. Demo mode never reads or writes local palettes/inventory. Advance with Right arrow 190 times (`DEMO_FRAMES` in src/demo.ts), capturing the viewport after each step. Frames 0–24 orbit the assembly; 25–31 apply a palette from the tray; 32–79 drag the part colour picker through a ramp while the model follows live; 80–119 drag the light direction and strength and switch presets; 124–154 step through materials from matte PLA to carbon nylon; 158–179 link a part to a filament and edit that spool in the library; 180–204 save the look, change it and switch back; 205–229 open the recommendations, shuffle them and apply one; 230–256 explode the parts and isolate the selected one; 258–272 play a head shake from the actions menu; 274–299 import a print model and preview the plates. Example stock is for demonstration only.

Encode the captured JPEG frames with (the settings used for the current file):

```sh
ffmpeg -framerate 10 -i frame-%03d.jpg -filter_complex 'fps=10,scale=1120:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle' -loop 0 studio-demo.gif
```

The rendered model remains covered by CC BY-NC-SA 4.0; see NOTICE.md.
