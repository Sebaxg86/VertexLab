# Third-party notices

Vehicle ordinal catalog only: TheBanHammer/fh6-tel, tag v1.2.2, commit fc43e6700733a28ca3731f73624b49cfaa054c55.
Source: https://github.com/TheBanHammer/fh6-tel/tree/v1.2.2/src/lib
FH6 entries override legacy entries. Legacy identifiers may not match FH6. No dashboard or session detection code was copied.

MIT License

Copyright (c) 2025 BanHammer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Typography: Barlow Condensed Bold Italic and Rajdhani SemiBold, from Google Fonts.
Sources: https://github.com/google/fonts/tree/main/ofl/barlowcondensed and
https://github.com/google/fonts/tree/main/ofl/rajdhani
Bundled locally for offline use. SIL Open Font License 1.1 notices are included in
public/OFL-Barlow.txt and public/OFL-Rajdhani.txt.
RaceLab's tire and playback SVG drawings are implemented locally.

Steering wheel: Tabler Icons, filled steering-wheel.svg (adapted into the animated dial).
Source: https://github.com/tabler/tabler-icons/blob/main/icons/filled/steering-wheel.svg
MIT license, Copyright (c) 2020-2026 Paweł Kuna. Full notice: public/LICENSE-Tabler.txt.

Manufacturer logos: car-logos-dataset by filippofilip95 (local thumbnail assets).
Source: https://github.com/filippofilip95/car-logos-dataset
Logo images remain the property of their respective manufacturers. Used only to
identify recorded vehicles; no affiliation or endorsement is implied.

Compact manufacturer emblems / wordmarks: Cardog Icons (43 local SVG variants).
Source: https://github.com/cardog-ai/icons/tree/master/core/optimized
Icon variants are preferred over combined logos; text-only marques use wordmarks.
Copyright / MIT notice: public/LICENSE-Cardog.txt. Trademarks remain their owners'.

## Browser portable viewer

- zip.js 2.25.0 — Gildas Lormeau — BSD-3-Clause. Source: https://github.com/gildas-lormeau/zip.js . Bundled as `public/vendor-zip-2.25.0.js`; license beside it.
- hash-wasm 4.13.0 — Dániel Németh — MIT. Source: https://github.com/Daninet/hash-wasm . SHA-256 bundle `public/vendor-sha256-4.13.0.js`; license beside it.

Packages were pinned and their npm tarball SRI verified before vendoring. No third-party scripts are fetched when a user opens a session.

## Native desktop video

- LibVLCSharp / LibVLCSharp.WPF 3.10.2 — VideoLAN contributors — LGPL-2.1-or-later.
  Corresponding source: https://code.videolan.org/videolan/LibVLCSharp/-/tree/3082c09ca955131c705fc4767fde03e9c4a14999
- VideoLAN.LibVLC.Windows 3.0.24 — VideoLAN / VLC authors — LGPL-2.1-or-later (NuGet distribution).
  Corresponding source: https://download.videolan.org/pub/videolan/vlc/3.0.24/vlc-3.0.24.tar.xz
  Windows packaging/build recipes: https://code.videolan.org/videolan/libvlc-nuget

These unmodified libraries are dynamically linked and remain replaceable in the installation directory (LibVLCSharp*.dll and libvlc/win-x64/). The license text is included in native/licenses/LGPL-2.1.txt and installed beside the program. VertexLab does not restrict reverse engineering for debugging modifications to these LGPL components. No separate VLC installation is required.
