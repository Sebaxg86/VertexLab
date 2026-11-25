# Recorded clock verification

Windows 10 2004+ / .NET 10 / installed Windows OCR language. All analysis stays local. No OBS configuration, capture control, network upload or writes to the input session.

```powershell
dotnet run --project native/tools/VertexLab.SyncProbe -c Release -- --session "C:/sessions/example.json" --report "C:/reports/verification.json" --validate
```

Reads the sibling JSONL and referenced video. `--report` writes a sanitized metadata report with the video path removed. `--validate` repeats verification on new frame timestamps after applying the first measured correction; the independent report is appended with `.validation.json`. Original input metadata and telemetry are untouched.

The upper-left HUD must contain a readable race clock labelled Tiempo/Time. A clock observation is accepted only when its numeric value shares the label's row. Each segment is sampled independently at nine positions. Matching requires a unique interpolation of actual telemetry `RaceTime` near the predicted instant, without crossing gaps, pauses or timestamp resets. Five readings spanning two seconds are the minimum; at least 80% must agree, and retained residuals must be within one source-video frame. An error, unreadable clock, ambiguous matches or unstable correction preserves the estimated mapping. No speed-based guesses or configured 100 ms offsets are used.

The background capture integration queues work after manual/automatic save. It does not block UDP reception or the capture actor while decoding/OCR runs. Results merge into the latest saved entry, preserving title/star changes; deleted entries are not recreated. Native and web `.vrtx` readers retain the corrected `syncSegments` mapping.

## Actual measured evidence

[Original fit](results/recorded-clock.json): nine images of the real OBS H.264/AAC 1920×1080 60 FPS recording. Correction +95.460 ms, maximum retained residual 13.925 ms.

[Different frames after correction](results/independent-frames.json): nine other image timestamps. Remaining correction +1.230 ms, maximum residual 12.236 ms. Residual correction is a fit parameter, not a claim of physical 1 ms capture precision. These measurements do not guarantee all recordings, HUD layouts or capture modes. Free roam without a clock is explicitly unverifiable by this method.

OBS status duration is a quantized output-frame counter, not the presentation timestamp of a captured game image. Primary references: [OBS WebSocket record implementation](https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestHandler_Record.cpp), [output duration calculation](https://github.com/obsproject/obs-websocket/blob/master/src/utils/Obs_NumberHelper.cpp). Recognition uses the Windows OCR API already installed on the machine; no model or language package is downloaded by VertexLab.
