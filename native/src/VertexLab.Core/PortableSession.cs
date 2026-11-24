using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace VertexLab.Core;
public static partial class PortableSession
{
    const long Maximum=256L*1024*1024*1024;
    [GeneratedRegex("^video\\.(mp4|mkv|mov|webm|flv|ts|m4v)$")]private static partial Regex VideoName();
    public static async Task<SessionEntry> ImportAsync(string package,AppPaths paths,Library library,IProgress<string>? progress=null,CancellationToken token=default)
    {
        var created=new List<string>();
        try{
            using var zip=ZipFile.OpenRead(package);if(zip.Entries.Count is <4 or >5||zip.Entries.Select(e=>e.FullName).Distinct().Count()!=zip.Entries.Count)throw new InvalidDataException("Estructura .vrtx inválida");
            var manifestEntry=zip.GetEntry("manifest.json")??throw new InvalidDataException("Falta el manifiesto");if(manifestEntry.Length>65536)throw new InvalidDataException("Manifiesto demasiado grande");
            using var manifest=await JsonDocument.ParseAsync(manifestEntry.Open(),cancellationToken:token);var m=manifest.RootElement;
            if(m.GetProperty("format").GetString()!="VertexLab session"||m.GetProperty("version").GetInt32()!=1)throw new InvalidDataException("Versión .vrtx no compatible");
            string? video=m.GetProperty("video").ValueKind==JsonValueKind.Null?null:m.GetProperty("video").GetString();if(video is not null&&!VideoName().IsMatch(video))throw new InvalidDataException("Nombre de video inválido");
            var names=new List<string>{"session.json","view.json","telemetry.jsonl"};if(video is not null)names.Add(video);
            var expected=m.GetProperty("files");if(expected.EnumerateObject().Count()!=names.Count||zip.Entries.Count!=names.Count+1||zip.Entries.Any(e=>e.FullName!="manifest.json"&&!names.Contains(e.FullName)))throw new InvalidDataException("Archivos no permitidos en el paquete");
            string id=Guid.NewGuid().ToString("N");SessionMeta? meta=null;string? videoPath=null;
            foreach(var name in names){token.ThrowIfCancellationRequested();var entry=zip.GetEntry(name)??throw new InvalidDataException("Falta "+name);var spec=expected.GetProperty(name);long size=spec.GetProperty("size").GetInt64();
                long limit=name=="view.json"?65536:name=="session.json"?4*1024*1024:name=="telemetry.jsonl"?4L*1024*1024*1024:Maximum;
                if(size!=entry.Length||size<0||size>limit)throw new InvalidDataException("Tamaño inválido: "+name);
                string destination=name=="telemetry.jsonl"?paths.RowsPath(id):name==video?Path.Combine(paths.Sessions,id+Path.GetExtension(video)):Path.Combine(paths.Sessions,id+"-"+name);
                created.Add(destination);progress?.Report("Importando "+name);await using var input=entry.Open();await using(var output=new FileStream(destination,FileMode.CreateNew,FileAccess.Write,FileShare.None,1024*1024,true)){
                    using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);var buffer=new byte[1024*1024];long written=0;int n;
                    while((n=await input.ReadAsync(buffer,token))>0){written+=n;if(written>size)throw new InvalidDataException("Archivo expandido incorrectamente");hash.AppendData(buffer,0,n);await output.WriteAsync(buffer.AsMemory(0,n),token);}
                    if(written!=size||!Convert.ToHexString(hash.GetHashAndReset()).Equals(spec.GetProperty("sha256").GetString(),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("El paquete está incompleto o dañado: "+name);
                }
                if(name=="session.json")meta=Wire.Decode<SessionMeta>(await File.ReadAllTextAsync(destination,token));if(name==video)videoPath=destination;
            }
            if(meta is null||meta.Ended is null)throw new InvalidDataException("La sesión no está finalizada");
            if(meta.Version is not (1 or 2)||string.IsNullOrWhiteSpace(meta.Name)||meta.Name.Length>256||!double.IsFinite(meta.Created)||meta.Created<0||meta.Created>253402300799||!double.IsFinite(meta.Ended.Value)||meta.Ended<0||meta.Ended>253402300799||!double.IsFinite(meta.Offset)||!double.IsFinite(meta.Duration)||meta.Duration<0)throw new InvalidDataException("Metadatos de sesión inválidos");
            if(meta.SyncSegments.Any(s=>!double.IsFinite(s.TStart)||!double.IsFinite(s.TEnd)||!double.IsFinite(s.VideoStart)||s.TEnd<s.TStart))throw new InvalidDataException("Sincronización inválida");
            meta.Id=id;meta.VideoPath=videoPath;library.Save(meta,"Imported");
            foreach(var file in created.Where(f=>f.EndsWith("-session.json")||f.EndsWith("-view.json")))File.Delete(file);
            return new(meta,paths.RowsPath(id),"Imported");
        }catch{foreach(var file in created)File.Delete(file);throw;}
    }
    public static async Task ExportAsync(SessionEntry entry,string target,IProgress<string>? progress=null,CancellationToken token=default)
    {
        if(entry.Meta.Ended is null)throw new InvalidOperationException("Finaliza la sesión antes de exportar");
        if(entry.Meta.VideoPath is not null&&!File.Exists(entry.Meta.VideoPath))throw new FileNotFoundException("Falta el video asociado");
        var temporary=target+"."+Guid.NewGuid().ToString("N")+".tmp";
        try{
            var specs=new Dictionary<string,object>();string? video=entry.Meta.VideoPath is {} v?"video"+Path.GetExtension(v).ToLowerInvariant():null;
            if(video is not null&&!VideoName().IsMatch(video))throw new InvalidDataException("Extensión de video no compatible con .vrtx");
            using(var zip=ZipFile.Open(temporary,ZipArchiveMode.Create)){
                async Task Add(string name,Stream input,bool stored=false){progress?.Report("Exportando "+name);var member=zip.CreateEntry(name,stored?CompressionLevel.NoCompression:CompressionLevel.Fastest);await using var output=member.Open();using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);var buffer=new byte[1024*1024];long count=0;int n;
                    while((n=await input.ReadAsync(buffer,token))>0){hash.AppendData(buffer,0,n);count+=n;await output.WriteAsync(buffer.AsMemory(0,n),token);}specs[name]=new{size=count,sha256=Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()};}
                using(var meta=new MemoryStream(System.Text.Encoding.UTF8.GetBytes(Wire.Encode(entry.Meta with{VideoPath=null}))))await Add("session.json",meta);
                using(var view=new MemoryStream("{}"u8.ToArray()))await Add("view.json",view);
                await using(var rows=File.OpenRead(entry.TelemetryPath))await Add("telemetry.jsonl",rows);
                if(video is not null){await using var media=File.OpenRead(entry.Meta.VideoPath!);await Add(video,media,true);}
                var manifest=zip.CreateEntry("manifest.json");await using var stream=manifest.Open();await JsonSerializer.SerializeAsync(stream,new Dictionary<string,object?>{{"format","VertexLab session"},{"version",1},{"video",video},{"files",specs}},new JsonSerializerOptions(),token);
            }
            File.Move(temporary,target,true);
        }catch{File.Delete(temporary);throw;}
    }
}
