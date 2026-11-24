using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;
using System.Text;

namespace VertexLab.Core;

public static class Wire
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    public static string Encode<T>(T value) => JsonSerializer.Serialize(value, Json);
    public static T Decode<T>(string text)
    {
        var value=JsonSerializer.Deserialize<T>(text,Json)??throw new InvalidDataException("Documento vacío");
        if(value is SessionMeta meta){using var document=JsonDocument.Parse(text);if(!document.RootElement.TryGetProperty("version",out _))meta.Version=1;}
        return value;
    }
}
public sealed record TelemetryPacket
{
    public bool Active { get; init; }
    public uint Timestamp { get; init; }
    public double X { get; init; } public double Y { get; init; } public double Z { get; init; }
    public double Speed { get; init; } public double Distance { get; init; }
    public double LapTime { get; init; } public double RaceTime { get; init; }
    public int Lap { get; init; } public int RacePosition { get; init; }
    public int CarOrdinal { get; init; } public int CarClass { get; init; } public int CarPI { get; init; }
    public double Rpm { get; init; } public double EngineMaxRpm { get; init; } public int? Gear { get; init; }
    public int? Steer { get; init; } public double? AccelX { get; init; } public double? AccelY { get; init; } public double? AccelZ { get; init; }
    public double[] TireTempsC { get; init; } = []; public double[] TireSlipCombined { get; init; } = [];
    public double[] TireSlipRatio { get; init; } = []; public double[] Suspension { get; init; } = [];
    public double Throttle { get; init; } public double Brake { get; init; }
    public double T { get; init; } public double Wall { get; init; } public bool BreakBefore { get; init; }
    public double? VideoTime { get; init; }
}
public sealed record SyncSegment
{
    public double TStart { get; set; } public double TEnd { get; set; } public double VideoStart { get; set; }
    public double Uncertainty { get; set; }
}
public sealed record SessionMeta
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "Sesión";
    public double Created { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
    public double? Ended { get; set; } public double Duration { get; set; }
    public int Version { get; set; } = 2; public double Offset { get; set; }
    public int CarOrdinal { get; set; } public int? CarClass { get; set; } public int? CarPI { get; set; }
    public bool Automatic { get; set; } public bool Featured { get; set; }
    public string? VideoPath { get; set; }
    public string SyncState { get; set; } = "none";
    public List<SyncSegment> SyncSegments { get; set; } = [];
}
public sealed record SessionEntry(SessionMeta Meta, string TelemetryPath, string State);
public sealed record EngineSettings { public int UdpPort { get; set; } = 5301; public bool Automatic { get; set; } = false; }
public sealed record EngineStatus(string Mode, SessionMeta? Session, TelemetryPacket? Packet, double PacketAge,
    long Packets, long Rejected, long Dropped, int UdpPort, bool Automatic, bool ObsConnected, bool ObsOwned, string? Error);
public sealed record Command(string Action, string? Name = null, int? Port = null, bool? Enabled = null, string? Password = null);
public sealed record Reply(bool Ok, string? Error = null, EngineStatus? Status = null);
public sealed class AppPaths
{
    public string Root { get; }
    public string Sessions => Path.Combine(Root, "sessions");
    public string Database => Path.Combine(Root, "library.db");
    public string Settings => Path.Combine(Root, "settings.json");
    public string PipeName => "VertexLab-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Root.ToUpperInvariant())))[..20];
    public AppPaths(string? root = null) { Root = Path.GetFullPath(root ?? Environment.GetEnvironmentVariable("VERTEXLAB_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VertexLab")); Directory.CreateDirectory(Sessions); }
    public string MetaPath(string id) => Path.Combine(Sessions, id + ".json");
    public string RowsPath(string id) => Path.Combine(Sessions, id + ".jsonl");
    public static void AtomicWrite(string path, string value) { var temp = path + ".tmp"; File.WriteAllText(temp, value, new UTF8Encoding(false)); File.Move(temp, path, true); }
}
