# README preview

`docs/media/studio-demo.gif`: 15 seconds, 150 frames, 1120 × 788, about 2.4 MB. Captures only the webpage viewport: no browser tabs, address bar, ChatGPT interface or debugger overlays.

To reproduce: serve the app and open `?demo=1` at a 1280 × 900 viewport. Demo mode never reads or writes local palettes/inventory. Advance with Right arrow 150 times, capturing the viewport after each step. Frames 0–29 rotate; 30–49 change a palette; 50–69 select a matte finish; 70–89 show PETG; 90–109 sweep warm lighting; 110–129 show add-one inventory recommendations; 130–149 show acrylic recommendations. Example stock is for demonstration only.

Encode the captured JPEG frames with:

```sh
ffmpeg -framerate 10 -i frame-%03d.jpg -filter_complex 'fps=10,scale=1120:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle' -loop 0 studio-demo.gif
```

The rendered model remains covered by CC BY-NC-SA 4.0; see NOTICE.md.
