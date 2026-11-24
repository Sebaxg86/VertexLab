using System.Text.Json;
namespace VertexLab.Desktop;

internal static class PresentationMetrics
{
    static readonly string? path = Environment.GetEnvironmentVariable("VERTEXLAB_PROFILE_PATH");
    static readonly Dictionary<string, List<double>> samples = []; static readonly Dictionary<string, string> info = [];
    public static void Info(string key, string value) { if (path is not null) info[key] = value; }
    public static void Record(string name, double milliseconds) { if (path is null) return; if (!samples.TryGetValue(name, out var list)) samples[name] = list = []; if (list.Count < 20000) list.Add(milliseconds); }
    public static void Save() { if (path is null) return; var result = samples.ToDictionary(p => p.Key, p => { var a = p.Value.Order().ToArray(); return new { count = a.Length, medianMs = a.Length == 0 ? 0 : a[a.Length / 2], p95Ms = a.Length == 0 ? 0 : a[(int)Math.Min(a.Length - 1, a.Length * .95)], maxMs = a.LastOrDefault() }; }); System.IO.File.WriteAllText(path, JsonSerializer.Serialize(new { operations = result, details = info }, new JsonSerializerOptions { WriteIndented = true })); }
}
