using VertexLab.Core;
using VertexLab.Sync;
string? Arg(string key) { int i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i+1] : null; }
string path = Path.GetFullPath(Arg("--session") ?? throw new ArgumentException("--session JSON required"));
var meta = Wire.Decode<SessionMeta>(File.ReadAllText(path));
if(meta.VideoPath is not null)meta.VideoPath=Path.GetFullPath(meta.VideoPath,Path.GetDirectoryName(path)!);
var result = await RecordedClockVerifier.VerifyAsync(new(meta,Path.ChangeExtension(path,".jsonl"),"Saved"));
Console.WriteLine(result.SyncMessage);
foreach(var segment in result.SyncSegments)Console.WriteLine($"{segment.TStart:F3}..{segment.TEnd:F3}: {segment.Verification?.State}, correction {segment.Verification?.CorrectionSeconds*1000:F2} ms, residual {segment.Verification?.ResidualSeconds*1000:F2} ms, {segment.Verification?.Observations.Count} readings");
if(Arg("--report") is { } report) { var output=result with{VideoPath=null,Id="verification-report",Name="Recording verification report"};File.WriteAllText(report,Wire.Encode(output)); }

if(args.Contains("--validate")) {
 var validation=await RecordedClockVerifier.VerifyAsync(new(result,Path.ChangeExtension(path,".jsonl"),"Saved"));
 Console.WriteLine("Independent frames after correction:");
 foreach(var segment in validation.SyncSegments)Console.WriteLine($"{segment.Verification?.State}: remaining correction {segment.Verification?.CorrectionSeconds*1000:F2} ms, residual {segment.Verification?.ResidualSeconds*1000:F2} ms");
 if(Arg("--report") is {} target)File.WriteAllText(target+".validation.json",Wire.Encode(validation with{VideoPath=null,Id="verification-report",Name="Independent verification report"}));
}
