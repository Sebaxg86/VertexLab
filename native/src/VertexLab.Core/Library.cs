using Microsoft.Data.Sqlite;
namespace VertexLab.Core;
public sealed class Library
{
    readonly AppPaths paths;
    public Library(AppPaths paths)
    {
        this.paths=paths;
        using var db=Open();using var cmd=db.CreateCommand();
        cmd.CommandText="""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created REAL NOT NULL,ended REAL,duration REAL NOT NULL,telemetry_path TEXT NOT NULL,state TEXT NOT NULL,owner_id TEXT,sync_state TEXT NOT NULL DEFAULT 'LocalOnly',meta_json TEXT NOT NULL);
        PRAGMA user_version=1;
        """;cmd.ExecuteNonQuery();
    }
    SqliteConnection Open() { var db=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=paths.Database,DefaultTimeout=5}.ToString());db.Open();return db; }
    public void Save(SessionMeta meta,string state)
    {
        AppPaths.AtomicWrite(paths.MetaPath(meta.Id),Wire.Encode(meta));
        using var db=Open();using var cmd=db.CreateCommand();cmd.CommandText="""
        INSERT INTO sessions(id,name,created,ended,duration,telemetry_path,state,meta_json) VALUES($id,$name,$created,$ended,$duration,$path,$state,$meta)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,ended=excluded.ended,duration=excluded.duration,state=excluded.state,meta_json=excluded.meta_json;
        """;
        cmd.Parameters.AddWithValue("$id",meta.Id);cmd.Parameters.AddWithValue("$name",meta.Name);cmd.Parameters.AddWithValue("$created",meta.Created);
        cmd.Parameters.AddWithValue("$ended",(object?)meta.Ended??DBNull.Value);cmd.Parameters.AddWithValue("$duration",meta.Duration);
        cmd.Parameters.AddWithValue("$path",paths.RowsPath(meta.Id));cmd.Parameters.AddWithValue("$state",state);cmd.Parameters.AddWithValue("$meta",Wire.Encode(meta));cmd.ExecuteNonQuery();
    }
    public List<SessionEntry> List()
    {
        using var db=Open();using var cmd=db.CreateCommand();cmd.CommandText="SELECT meta_json,telemetry_path,state FROM sessions ORDER BY created DESC";using var r=cmd.ExecuteReader();var rows=new List<SessionEntry>();
        while(r.Read())rows.Add(new(Wire.Decode<SessionMeta>(r.GetString(0)),r.GetString(1),r.GetString(2)));return rows;
    }
    public void RecoverInterrupted()
    {
        foreach(var entry in List().Where(s=>s.Meta.Ended is null)){
            var meta=entry.Meta;meta.Ended=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()/1000d;
            // A partial trailing JSON line from a process crash is excluded from analysis.
            double end=0;foreach(var row in Analysis.ReadRows(entry.TelemetryPath))end=Math.Max(end,row.T);
            meta.Duration=end;meta.SyncState=meta.SyncSegments.Count>0?"recovered":"none";Save(meta,"Interrupted");
        }
    }
    public async Task<SessionEntry> ImportLegacyAsync(string metadata,CancellationToken cancellation=default)
    {
        var meta=Wire.Decode<SessionMeta>(await File.ReadAllTextAsync(metadata,cancellation));
        var rows=Path.ChangeExtension(metadata,".jsonl");if(!File.Exists(rows))throw new InvalidDataException("Falta la telemetría .jsonl de esta sesión");
        if(meta.Ended is null)throw new InvalidDataException("Finaliza la sesión en el MVP antes de importarla");
        if(meta.VideoPath is not null&&!Path.IsPathFullyQualified(meta.VideoPath))meta.VideoPath=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(metadata)!,meta.VideoPath));
        meta.Id=Guid.NewGuid().ToString("N");
        try{await using(var src=File.OpenRead(rows))await using(var dest=File.Create(paths.RowsPath(meta.Id)))await src.CopyToAsync(dest,cancellation);Save(meta,"Imported");return new(meta,paths.RowsPath(meta.Id),"Imported");}
        catch{File.Delete(paths.RowsPath(meta.Id));throw;}
    }
}
