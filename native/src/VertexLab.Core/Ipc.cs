using System.IO.Pipes;
namespace VertexLab.Core;
public static class CaptureClient
{
    public static async Task<Reply> SendAsync(AppPaths paths,Command command,CancellationToken token=default)
    {
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(token);timeout.CancelAfter(TimeSpan.FromSeconds(12));
        await using var pipe=new NamedPipeClientStream(".",paths.PipeName,PipeDirection.InOut,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
        await pipe.ConnectAsync(timeout.Token);using var writer=new StreamWriter(pipe,leaveOpen:true){AutoFlush=true};using var reader=new StreamReader(pipe,leaveOpen:true);
        await writer.WriteLineAsync(Wire.Encode(command).AsMemory(),timeout.Token);
        var text=await reader.ReadLineAsync(timeout.Token);return Wire.Decode<Reply>(text??throw new IOException("El motor cerró la conexión"));
    }
}
