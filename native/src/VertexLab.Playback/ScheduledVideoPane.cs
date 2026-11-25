using System.Diagnostics;
using Color = System.Drawing.Color;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;
using Vortice.MediaFoundation;
using static Vortice.Direct3D11.D3D11;
using static Vortice.MediaFoundation.MediaFactory;
using VertexLab.Core;

namespace VertexLab.Playback;

// Silent comparison video: decoding has no playback clock and never changes rate.
// A small GPU queue is consumed using source timestamps, driven by the master.
public sealed class ScheduledVideoPane : Panel
{
    sealed record Frame(double Time, int Generation, ID3D11Texture2D Texture, ID3D11ShaderResourceView View) : IDisposable
    { public void Dispose() { View.Dispose(); Texture.Dispose(); } }
    readonly object framesGate = new(), gpuGate = new(); readonly Queue<Frame> frames = [];
    readonly ManualResetEventSlim wake = new(false);
    ID3D11Device device = null!; ID3D11DeviceContext context = null!;
    IDXGISwapChain1 swap = null!; ID3D11RenderTargetView targetView = null!;
    ID3D11VertexShader vertex = null!; ID3D11PixelShader pixel = null!; ID3D11SamplerState sampler = null!;
    Frame? shown; Task? worker; volatile bool stopping, ready, seeking; bool redraw; int generation;
    double requested = double.NaN, frameInterval = 1d / 60; int width, height;
    public string? Failure { get; private set; }
    public bool Ready => ready;
    public int VideoWidth => width;
    public int VideoHeight => height;
    public bool Seeking => seeking;
    public int Seeks { get; private set; }
    public long Presented { get; private set; }
    public long Decoded { get; private set; }
    public long Late { get; private set; }
    public double? PresentedTime => shown?.Time;
    public List<double> FrameErrors { get; } = [];
    public ScheduledVideoPane() { Dock = DockStyle.Fill; BackColor = Color.Black; Resize += (_, _) => ResizeSurface(); }
    public void Open(string path)
    {
        D3D11CreateDevice(IntPtr.Zero, DriverType.Hardware, DeviceCreationFlags.BgraSupport | DeviceCreationFlags.VideoSupport, new[] { FeatureLevel.Level_11_0 }, out device, out context).CheckError();
        using (var multithread = context.QueryInterface<ID3D11Multithread>()) multithread.SetMultithreadProtected(true);
        using var dxgi = device.QueryInterface<IDXGIDevice>(); using var adapter = dxgi.GetAdapter(); using var factory = adapter.GetParent<IDXGIFactory2>();
        swap = factory.CreateSwapChainForHwnd(device, Handle, new SwapChainDescription1((uint)Math.Max(1, Width), (uint)Math.Max(1, Height), Format.B8G8R8A8_UNorm, false, Usage.RenderTargetOutput, 2, Scaling.Stretch, SwapEffect.FlipDiscard));
        const string shader = """
            Texture2D image:register(t0); SamplerState linearSampler:register(s0);
            struct V { float4 position:SV_POSITION; float2 uv:TEXCOORD0; };
            V vs(uint id:SV_VertexID) { V v; v.uv=float2((id<<1)&2,id&2); v.position=float4(v.uv*float2(2,-2)+float2(-1,1),0,1); return v; }
            float4 ps(V v):SV_TARGET { return image.Sample(linearSampler,v.uv); }
            """;
        var vs = Vortice.D3DCompiler.Compiler.Compile(shader, "vs", "probe.hlsl", "vs_4_0", Vortice.D3DCompiler.ShaderFlags.OptimizationLevel3, Vortice.D3DCompiler.EffectFlags.None);
        var ps = Vortice.D3DCompiler.Compiler.Compile(shader, "ps", "probe.hlsl", "ps_4_0", Vortice.D3DCompiler.ShaderFlags.OptimizationLevel3, Vortice.D3DCompiler.EffectFlags.None);
        vertex = device.CreateVertexShader(vs.Span); pixel = device.CreatePixelShader(ps.Span);
        sampler = device.CreateSamplerState(SamplerDescription.LinearClamp);
        ResizeSurface();
        worker = Task.Factory.StartNew(() => Decode(path), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }
    void ResizeSurface()
    {
        if (swap is null || Width < 1 || Height < 1) return;
        lock (gpuGate)
        {
            context.ClearState(); targetView?.Dispose();
            swap.ResizeBuffers(2, (uint)Width, (uint)Height, Format.B8G8R8A8_UNorm, SwapChainFlags.None).CheckError();
            using var buffer = swap.GetBuffer<ID3D11Texture2D>(0); targetView = device.CreateRenderTargetView(buffer); redraw = true;
        }
    }
    public void Request(double time, bool seek = false)
    {
        lock (framesGate) { requested = time; if (seek) { generation++; seeking = true; } }
        wake.Set();
    }
    public void PresentAt(double time)
    {
        Request(time);
        Frame? candidate = null;
        lock (framesGate)
        {
            while (frames.TryPeek(out var next) && (next.Generation != generation || next.Time <= time + frameInterval / 2))
            {
                var frame = frames.Dequeue();
                if (frame.Generation != generation) frame.Dispose(); else { candidate?.Dispose(); candidate = frame; }
            }
            if (candidate is null && shown is null && frames.TryPeek(out var first) && Math.Abs(first.Time - time) < .04) candidate = frames.Dequeue();
        }
        if (candidate is not null) { shown?.Dispose(); shown = candidate; Presented++; }
        if (shown is null || shown.Generation != generation) return;
        double error = Math.Abs(shown.Time - time) * 1000;
        lock (framesGate)
        {
            // A preroll frame is a useful preview, but is not a seek acknowledgement.
            // A queued future frame also proves coverage for variable-frame-rate gaps.
            bool covered = error <= frameInterval * 510 || (frames.TryPeek(out var next) && next.Generation == generation && next.Time > time + frameInterval / 2);
            if (covered) seeking = false;
        }
        if (FrameErrors.Count < 100000) FrameErrors.Add(error);
        if (error > 40) Late++;
        if (candidate is null && !redraw) return;
        redraw = false;
        lock (gpuGate)
        {
            context.OMSetRenderTargets(targetView);
            context.ClearRenderTargetView(targetView, new Color4(0, 0, 0, 1));
            double scale = Math.Min(Width / (double)width, Height / (double)height);
            float w = (float)(width * scale), h = (float)(height * scale);
            context.RSSetViewport(new Viewport((Width - w) / 2, (Height - h) / 2, w, h));
            context.IASetPrimitiveTopology(PrimitiveTopology.TriangleList);
            context.VSSetShader(vertex); context.PSSetShader(pixel); context.PSSetShaderResource(0, shown.View); context.PSSetSampler(0, sampler);
            context.Draw(3, 0); context.PSSetShaderResource(0, null!);
            swap.Present(0, PresentFlags.None).CheckError();
        }
        wake.Set();
    }
    void Decode(string path)
    {
        try
        {
            var manager = MFCreateDXGIDeviceManager();
            using (manager)
            {
                manager.ResetDevice(device).CheckError();
                using var attributes = MFCreateAttributes(3);
                attributes.Set(SourceReaderAttributeKeys.D3DManager, manager);
                attributes.Set(SourceReaderAttributeKeys.EnableAdvancedVideoProcessing, true);
                attributes.Set(SinkWriterAttributeKeys.ReadwriteEnableHardwareTransforms, true);
                using var reader = MFCreateSourceReaderFromURL(path, attributes);
                reader.SetStreamSelection(SourceReaderIndex.AllStreams, false); reader.SetStreamSelection(SourceReaderIndex.FirstVideoStream, true);
                using var output = MFCreateMediaType(); output.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video); output.Set(MediaTypeAttributeKeys.Subtype, VideoFormatGuids.Argb32);
                reader.SetCurrentMediaType(SourceReaderIndex.FirstVideoStream, output);
                using var actual = reader.GetCurrentMediaType(SourceReaderIndex.FirstVideoStream);
                ulong size = actual.GetUInt64(MediaTypeAttributeKeys.FrameSize); width = (int)(size >> 32); height = (int)(size & uint.MaxValue);
                try { frameInterval = FrameTimePolicy.FrameInterval(actual.GetUInt64(MediaTypeAttributeKeys.FrameRate)); } catch (SharpGen.Runtime.SharpGenException) { frameInterval = 1d / 60; }
                ready = true; int activeGeneration = -1; double lastDecoded = double.NaN; bool positioning = false, atEnd = false;
                while (!stopping)
                {
                    double desired; int version; int count;
                    lock (framesGate) { desired = requested; version = generation; count = frames.Count; }
                    if ((atEnd && version == activeGeneration) || !double.IsFinite(desired) || FrameTimePolicy.QueueFull(count, version, activeGeneration)) { wake.Wait(20); wake.Reset(); continue; }
                    if (FrameTimePolicy.NeedsSeek(version, activeGeneration, positioning, desired, lastDecoded))
                    {
                        lock (framesGate) { while (frames.TryDequeue(out var old)) old.Dispose(); }
                        seeking = true; reader.SetCurrentPosition((long)(Math.Max(0, desired) * 10_000_000)); activeGeneration = version; positioning = true; atEnd = false; Seeks++;
                    }
                    using var sample = reader.ReadSample(SourceReaderIndex.FirstVideoStream, SourceReaderControlFlag.None, out _, out var flags, out long timestamp);
                    if ((flags & SourceReaderFlag.Error) != 0) throw new InvalidDataException("Windows no pudo decodificar el video de comparación.");
                    if ((flags & SourceReaderFlag.EndOfStream) != 0) { atEnd = true; continue; }
                    if (sample is null) continue;
                    double pts = timestamp / 10_000_000d; lastDecoded = pts; Decoded++;
                    if (pts < desired - frameInterval * 2) continue;
                    positioning = false;
                    using var buffer = sample.GetBufferByIndex(0);
                    using var gpu = buffer.QueryInterface<IMFDXGIBuffer>();
                    using var decodedTexture = new ID3D11Texture2D(gpu.GetResource(typeof(ID3D11Texture2D).GUID));
                    var desc = decodedTexture.Description;
                    if (desc.Format != Format.B8G8R8A8_UNorm || desc.Width < width || desc.Height < height) throw new InvalidDataException("Formato de superficie de video no compatible con la comparación GPU.");
                    desc.Width = (uint)width; desc.Height = (uint)height; desc.ArraySize = 1; desc.MipLevels = 1; desc.BindFlags = BindFlags.ShaderResource; desc.CPUAccessFlags = CpuAccessFlags.None; desc.MiscFlags = ResourceOptionFlags.None; desc.Usage = ResourceUsage.Default;
                    var texture = device.CreateTexture2D(desc);
                    lock (gpuGate) context.CopySubresourceRegion(texture, 0, 0, 0, 0, decodedTexture, gpu.SubresourceIndex, new Box(0, 0, 0, width, height, 1));
                    var frame = new Frame(pts, version, texture, device.CreateShaderResourceView(texture));
                    lock (framesGate) { if (version == generation) frames.Enqueue(frame); else frame.Dispose(); }
                }
            }
        }
        catch (Exception ex) { Failure = ex.ToString(); }
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            stopping = true; wake.Set();
            if (worker is null || worker.Wait(3000))
            {
                lock (framesGate) { while (frames.TryDequeue(out var frame)) frame.Dispose(); }
                shown?.Dispose(); targetView?.Dispose(); sampler?.Dispose(); pixel?.Dispose(); vertex?.Dispose(); swap?.Dispose(); context?.Dispose(); device?.Dispose(); wake.Dispose();
            }
        }
        base.Dispose(disposing);
    }
}
