using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using VertexLab.Core;
using Vortice.MediaFoundation;
using Windows.Media.Ocr;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using static Vortice.MediaFoundation.MediaFactory;
using Bitmap = System.Drawing.Bitmap;
namespace VertexLab.Sync;

public static partial class RecordedClockVerifier
{
    [GeneratedRegex(@"(?<!\d)(?<m>\d{1,3})\s*:\s*(?<s>[0-5]\d)\s*[.,]\s*(?<ms>\d{3})(?!\d)")]
    private static partial Regex ClockText();
    public static async Task<SessionMeta> VerifyAsync(SessionEntry entry, CancellationToken token = default)
    {
        var meta = Wire.Decode<SessionMeta>(Wire.Encode(entry.Meta));
        if (meta.VideoPath is null || meta.SyncSegments.Count == 0) return meta with { SyncMessage = "No hay video o referencias de grabación para verificar." };
        bool started = false;
        try
        {
            var ocr = OcrEngine.TryCreateFromUserProfileLanguages();
            if (ocr is null) return meta with { SyncMessage = "Windows no tiene un idioma OCR disponible; sincronización estimada." };
            var rows = Analysis.ReadRows(entry.TelemetryPath).ToArray();
            MFStartup().CheckError(); started = true;
            using var attributes = MFCreateAttributes(1); attributes.Set(SourceReaderAttributeKeys.EnableAdvancedVideoProcessing, true);
            using var reader = MFCreateSourceReaderFromURL(meta.VideoPath, attributes);
            reader.SetStreamSelection(SourceReaderIndex.AllStreams, false); reader.SetStreamSelection(SourceReaderIndex.FirstVideoStream, true);
            using var format = MFCreateMediaType(); format.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video); format.Set(MediaTypeAttributeKeys.Subtype, VideoFormatGuids.Argb32);
            reader.SetCurrentMediaType(SourceReaderIndex.FirstVideoStream, format);
            using var actual = reader.GetCurrentMediaType(SourceReaderIndex.FirstVideoStream);
            ulong size = actual.GetUInt64(MediaTypeAttributeKeys.FrameSize); int width = (int)(size >> 32), height = (int)(size & uint.MaxValue);
            if (width < 320 || height < 180 || width > 7680 || height > 4320) throw new InvalidDataException("Resolución no compatible con la verificación visual.");
            double interval = FrameTimePolicy.FrameInterval(actual.GetUInt64(MediaTypeAttributeKeys.FrameRate));
            int verified = 0;
            foreach (var segment in meta.SyncSegments)
            {
                token.ThrowIfCancellationRequested(); var observations = new List<VideoClockObservation>();
                double duration = segment.TEnd - segment.TStart;
                // Each pause/resume has its own independent visual calibration.
                if (duration >= 4 && rows.Any(r => r.T >= segment.TStart && r.T <= segment.TEnd && r.RaceTime > 0 && r.RacePosition > 0))
                {
                    for (int i = 0; i < 9; i++)
                    {
                        token.ThrowIfCancellationRequested(); double target = segment.VideoStart + meta.Offset + .5 + (duration - 1) * (i + .5) / 9;
                        var frame = ReadFrame(reader, target, width, height, interval, token);
                        if (frame is null) continue;
                        using var image = frame.Value.Image;
                        using var bitmap = ToOcrBitmap(image, width, height);
                        var recognized = await ocr.RecognizeAsync(bitmap).AsTask(token);
                        var words = recognized.Lines.SelectMany(l => l.Words).ToArray();
                        var label = words.FirstOrDefault(w => w.Text.Contains("iempo", StringComparison.OrdinalIgnoreCase) || string.Equals(w.Text, "Time", StringComparison.OrdinalIgnoreCase));
                        if (label is null) continue;
                        double center = label.BoundingRect.Y + label.BoundingRect.Height / 2;
                        var clocks = words.Where(w => w.BoundingRect.X > label.BoundingRect.Right && Math.Abs(w.BoundingRect.Y + w.BoundingRect.Height / 2 - center) <= Math.Max(label.BoundingRect.Height, w.BoundingRect.Height)).Select(w => ClockText().Match(w.Text)).Where(m => m.Success).ToArray();
                        if (clocks.Length != 1) continue;
                        var clock = clocks[0]; double race = int.Parse(clock.Groups["m"].Value) * 60 + int.Parse(clock.Groups["s"].Value) + int.Parse(clock.Groups["ms"].Value) / 1000d;
                        observations.Add(new(frame.Value.Time, race));
                    }
                }
                var check = VideoSyncVerifier.Evaluate(meta, segment, rows, observations, interval); segment.Verification = check;
                if (check.State == "verified") { segment.VideoStart += check.CorrectionSeconds; segment.Uncertainty = Math.Max(interval, check.ResidualSeconds + interval / 2 + .001); verified++; }
            }
            meta.SyncState = verified == meta.SyncSegments.Count ? "video-verified" : "estimated";
            meta.SyncMessage = $"Cronómetro del video: {verified}/{meta.SyncSegments.Count} tramos verificados. " + (verified == meta.SyncSegments.Count ? "Corrección aplicada a las referencias; muestras originales conservadas." : "Los tramos sin cronómetro legible conservan sincronización estimada.");
            return meta;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { return meta with { SyncMessage = "No se pudo verificar la imagen: " + ex.Message }; }
        finally { if (started) MFShutdown(); }
    }
    static (Bitmap Image, double Time)? ReadFrame(IMFSourceReader reader, double target, int width, int height, double interval, CancellationToken token)
    {
        reader.SetCurrentPosition((long)(Math.Max(0, target) * 10_000_000));
        // Bound keyframe preroll and never decode the entire recording by mistake.
        for (int i = 0; i < 1800; i++)
        {
            token.ThrowIfCancellationRequested(); using var sample = reader.ReadSample(SourceReaderIndex.FirstVideoStream, SourceReaderControlFlag.None, out _, out var flags, out long stamp);
            if ((flags & SourceReaderFlag.Error) != 0) throw new InvalidDataException("Error al leer un fotograma de la grabación.");
            if ((flags & SourceReaderFlag.EndOfStream) != 0) return null;
            if (sample is null || stamp / 10_000_000d < target - interval / 2) continue;
            using var buffer = sample.ConvertToContiguousBuffer(); buffer.Lock(out var bytes, out _, out int count);
            try
            {
                if (count < width * height * 4) throw new InvalidDataException("Fotograma incompleto.");
                var image = new Bitmap(width, height, PixelFormat.Format32bppRgb);
                var locked = image.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
                try { byte[] row = new byte[width * 4]; for (int y = 0; y < height; y++) { Marshal.Copy(bytes + y * width * 4, row, 0, row.Length); Marshal.Copy(row, 0, locked.Scan0 + y * locked.Stride, row.Length); } }
                finally { image.UnlockBits(locked); }
                return (image, stamp / 10_000_000d);
            }
            finally { buffer.Unlock(); }
        }
        return null;
    }
    static SoftwareBitmap ToOcrBitmap(Bitmap image, int width, int height)
    {
        // HUD clock is in the upper-left. No game/map asset is stored or uploaded.
        int w = (int)(width * .36), h = (int)(height * .30); double scale = Math.Min(3, 2500d / Math.Max(w, h));
        using var crop = new Bitmap((int)(w * scale), (int)(h * scale), PixelFormat.Format32bppRgb);
        using (var graphics = Graphics.FromImage(crop)) graphics.DrawImage(image, new Rectangle(0, 0, crop.Width, crop.Height), new Rectangle(0, 0, w, h), GraphicsUnit.Pixel);
        var locked = crop.LockBits(new Rectangle(0, 0, crop.Width, crop.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppRgb);
        try
        {
            var bytes = new byte[crop.Width * crop.Height * 4]; for (int y = 0; y < crop.Height; y++) Marshal.Copy(locked.Scan0 + y * locked.Stride, bytes, y * crop.Width * 4, crop.Width * 4);
            using var writer = new DataWriter(); writer.WriteBytes(bytes);
            var bitmap = new SoftwareBitmap(BitmapPixelFormat.Bgra8, crop.Width, crop.Height, BitmapAlphaMode.Ignore); bitmap.CopyFromBuffer(writer.DetachBuffer()); return bitmap;
        }
        finally { crop.UnlockBits(locked); }
    }
}
