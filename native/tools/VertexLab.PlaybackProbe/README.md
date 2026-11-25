# Windows playback probe

Standalone Windows-only benchmark. Reads finalized JSON metadata, its sibling JSONL and referenced video. No UDP receiver, OBS control or library writes. Requires .NET 10 SDK, Windows Media Foundation, Direct3D 11 and a compatible GPU decoder.

```powershell
dotnet run --project native/tools/VertexLab.PlaybackProbe -c Release -- --session "C:/sessions/example.json" --measure --seconds 60 --report "C:/reports/playback.json"
```

Default: comparison by distance, using the second and third recorded laps (or available laps when fewer). Main video: Media Engine HWND with audio. Silent comparison: SourceReader with a bounded GPU queue and nearest timestamp selection. Both images use contain sizing. No browser or LibVLC.

Without `--measure`, controls permit playback/pause, dragging and ±1/60 s steps. The step buttons assume 60 FPS; the GPU queue reads the source frame rate. `--clock-only` uses two Media Engine clocks at 1×, starting 60 seconds apart. `--scheduled-follower` explicitly selects the GPU follower in either mode.

`--native-follower` explicitly enables the rejected experimental approach: continuous follower rate changes and corrective seeks. Do not use it as the product backend. `--no-corrective-seeks` disables those experimental corrections. Reports are written only at the supplied `--report` path. Initialization timeout and decoder errors are reported, not replaced by generated data.

## Observed results

[Actual 60-second report](results/scheduled-60s.json), Windows x64, real OBS H.264/AAC 1920×1080 60 FPS recording, recorded Lamborghini session, laps 2/3:

- Timestamp selection error: median 4.03 ms, p95 7.84 ms, max 8.64 ms.
- Main video: 3,606 Media Engine rendered frames, zero reported drops.
- One initial seek per video. No follower playback-rate changes.
- Process CPU time: 8.14 s over 60.01 s wall time; working set 331,542,528 bytes at reporting. CPU time is aggregate, not a normalized CPU percentage.

[Desktop interaction profile](results/desktop-interactions.json): 6,736 playback updates; comparison PTS error p95 7.81 ms, max 8.33 ms; UI playback-update p95 0.323 ms. These UI timings exclude decoding and physical display latency. Includes deliberate seeking, pause, arbitrary-point dragging, reference change and window resizing. Five comparison seeks correspond to setup/user interactions; none are periodic drift corrections. No comparison observations over 40 ms were counted in this run.

`driftMilliseconds` measures requested source time versus selected frame PTS while playback is active and seeks have completed. It does not measure DWM, display scanout or the image-to-physics offset introduced during recording. `frameErrorMilliseconds` also includes startup/preroll observations. Follower `Presented` counts GPU submissions, not physical displayed frames; `Late` counts observations with PTS error over 40 ms, not decoder drops. Raw Media Engine counters may reset after rate/seek changes, so the experimental variable-rate mode is not a reliable FPS test.

These are results on one machine without simultaneous Forza/OBS load. No web-relative speed multiplier, all-codec support or frame-perfect capture synchronization is claimed. The input recording retains an independently observed approximately 100 ms capture-origin offset; no metadata was recalibrated.

## Regression checks

Core tests cover seek generations, preroll across distant keyframes, queue capacity on new seeks, sequential playback without repeated seeks, and rational frame rates. Manual desktop QA covers pause, arbitrary-point scrubbing, comparison/reference selectors, seeking after the end and contain layout. The capture engine and stored session data are unchanged by the playback backend.
