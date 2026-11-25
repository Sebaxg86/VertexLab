using System.Diagnostics;
using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Threading.Channels;
using VertexLab.Core;
using VertexLab.Sync;

namespace VertexLab.Capture;
internal static class Program
{
    [STAThread] static void Main()
    {
        ApplicationConfiguration.Initialize();var paths=new AppPaths();using var singleton=new Mutex(true,paths.PipeName+"-capture",out bool owned);if(!owned)return;
        try{using var host=new CaptureHost(paths);host.Start();using var tray=new NotifyIcon{Icon=System.Drawing.SystemIcons.Application,Text="VertexLab · Motor de captura",Visible=true};
            var menu=new ContextMenuStrip();menu.Items.Add("Abrir VertexLab",null,(_,_)=>OpenWindow());
            menu.Items.Add("Cerrar motor (sin sesión activa)",null,async(_,_)=>{var reply=await host.CommandAsync(new("quit"));if(!reply.Ok)MessageBox.Show(reply.Error,"VertexLab");else Application.Exit();});
            tray.ContextMenuStrip=menu;tray.DoubleClick+=(_,_)=>OpenWindow();Application.Run();tray.Visible=false;
        }catch(Exception ex){File.AppendAllText(Path.Combine(paths.Root,"capture-error.log"),DateTimeOffset.Now+" "+ex.Message+Environment.NewLine);MessageBox.Show(ex.Message,"VertexLab Capture");}
    }
    static void OpenWindow(){var file=Path.Combine(AppContext.BaseDirectory,"VertexLab.Desktop.exe");if(File.Exists(file))Process.Start(new ProcessStartInfo(file){UseShellExecute=true});}
}
internal sealed class CaptureHost : IDisposable
{
    readonly AppPaths paths;readonly Library library;readonly ObsClient obs=new();readonly CaptureEngine engine;
    readonly Channel<Work> queue=Channel.CreateBounded<Work>(new BoundedChannelOptions(2048){FullMode=BoundedChannelFullMode.Wait,SingleReader=true});
    readonly Channel<SessionEntry> verificationQueue=Channel.CreateBounded<SessionEntry>(32);
    readonly CancellationTokenSource cancellation=new();UdpClient? udp;EngineSettings settings;TelemetryPacket? latest;double lastPacket=-1;
    long packets,rejected,dropped;string? udpError;readonly List<Task> tasks=[];
    record Work(TelemetryPacket? Packet=null,double Wall=0,Command? Command=null,TaskCompletionSource<Reply>? Completion=null,SessionMeta? Verified=null);
    public CaptureHost(AppPaths paths)
    {
        this.paths=paths;library=new(paths);library.RecoverInterrupted();settings=File.Exists(paths.Settings)?Wire.Decode<EngineSettings>(File.ReadAllText(paths.Settings)):new();
        Dictionary<string,string> cars=[];var catalog=Path.Combine(AppContext.BaseDirectory,"cars.json");if(File.Exists(catalog))cars=Wire.Decode<Dictionary<string,string>>(File.ReadAllText(catalog));
        engine=new(paths,library,obs,id=>cars.GetValueOrDefault(id.ToString(),$"Vehículo #{id}")){Automatic=settings.Automatic};
        engine.SessionSaved += QueueVerification;
    }
    public void Start(){BindUdp();tasks.Add(Task.Run(Actor));tasks.Add(Task.Run(ListenPipe));tasks.Add(Task.Run(Ticks));tasks.Add(Task.Run(VerifyRecordings));}
    void BindUdp()
    {
        udp?.Dispose();udp=null;try{var receiver=new UdpClient(AddressFamily.InterNetwork);receiver.Client.ExclusiveAddressUse=true;receiver.Client.ReceiveBufferSize=1024*1024;receiver.Client.Bind(new IPEndPoint(IPAddress.Loopback,settings.UdpPort));udp=receiver;udpError=null;tasks.Add(Task.Run(()=>Receive(receiver)));}
        catch(SocketException){udpError=$"No se pudo abrir UDP {settings.UdpPort}. Cierra el MVP u otra captura, o elige otro puerto.";}
    }
    async Task Receive(UdpClient receiver)
    {
        try{while(!cancellation.IsCancellationRequested){var datagram=await receiver.ReceiveAsync(cancellation.Token);double wall=ObsClient.Clock;
            try{var packet=TelemetryDecoder.Decode(datagram.Buffer);Interlocked.Increment(ref packets);if(!queue.Writer.TryWrite(new(Packet:packet,Wall:wall)))Interlocked.Increment(ref dropped);}
            catch(InvalidDataException){Interlocked.Increment(ref rejected);}
        }}catch(Exception ex)when(ex is OperationCanceledException or ObjectDisposedException or SocketException){}
    }
    async Task Ticks(){try{using var timer=new PeriodicTimer(TimeSpan.FromMilliseconds(100));while(await timer.WaitForNextTickAsync(cancellation.Token))queue.Writer.TryWrite(new(Wall:ObsClient.Clock));}catch(OperationCanceledException){}}
    async Task Actor()
    {
        try{await foreach(var item in queue.Reader.ReadAllAsync(cancellation.Token)){
            try{if(item.Verified is {} verified){
                    // Merge with the latest library entry so naming/star changes survive.
                    var existing=library.List().FirstOrDefault(e=>e.Meta.Id==verified.Id);
                    if(existing is not null && existing.Meta.Ended is not null && existing.Meta.VideoPath==verified.VideoPath){
                        var merged=existing.Meta with{SyncSegments=verified.SyncSegments,SyncState=verified.SyncState,SyncMessage=verified.SyncMessage};library.Save(merged,existing.State);
                    }
                }
                else if(item.Command is {} command){var reply=await Execute(command);item.Completion!.TrySetResult(reply);}
                else if(item.Packet is {} packet){latest=packet;lastPacket=item.Wall;await engine.FeedAsync(packet,item.Wall);}
                else await engine.TickAsync(item.Wall);
            }catch(Exception ex){engine.Error=ex.Message;item.Completion?.TrySetResult(new(false,ex.Message));}
        }}catch(OperationCanceledException){}
    }
    void QueueVerification(SessionEntry entry)
    {
        entry.Meta.SyncMessage="Verificando el cronómetro de la grabación…";
        library.Save(entry.Meta,entry.State);
        if(!verificationQueue.Writer.TryWrite(entry)){entry.Meta.SyncMessage="Verificación pendiente: vuelve a solicitarla desde análisis.";library.Save(entry.Meta,entry.State);}
    }
    async Task VerifyRecordings()
    {
        try{await foreach(var entry in verificationQueue.Reader.ReadAllAsync(cancellation.Token)){
            var verified=await RecordedClockVerifier.VerifyAsync(entry,cancellation.Token);
            await queue.Writer.WriteAsync(new(Verified:verified),cancellation.Token);
        }}catch(OperationCanceledException){}
    }
    EngineStatus Snapshot()=>new(engine.Current is null?(engine.Automatic?"armed":"idle"):engine.Mode,
        engine.Current is null?null:Wire.Decode<SessionMeta>(Wire.Encode(engine.Current)),latest,lastPacket<0?1e9:Math.Max(0,ObsClient.Clock-lastPacket),
        Interlocked.Read(ref packets),Interlocked.Read(ref rejected),Interlocked.Read(ref dropped),settings.UdpPort,engine.Automatic,obs.Connected,obs.Owned,udpError??engine.Error){EngineVersion=typeof(CaptureHost).Assembly.GetName().Version?.ToString()};
    async Task<Reply> Execute(Command command)
    {
        switch(command.Action){
            case "status":break;
            case "verify-video":var entry=library.List().FirstOrDefault(e=>e.Meta.Id==command.Name&&e.Meta.Ended is not null)??throw new InvalidDataException("Sesión finalizada no encontrada");QueueVerification(entry);break;
            case "start":await engine.StartAsync(command.Name,latest,ObsClient.Clock);break;
            case "stop":await engine.FinishAsync();break;
            case "auto":engine.Automatic=command.Enabled??false;settings.Automatic=engine.Automatic;AppPaths.AtomicWrite(paths.Settings,Wire.Encode(settings));break;
            case "udp":if(engine.Current is not null)throw new InvalidOperationException("Finaliza la sesión antes de cambiar UDP");if(command.Port is not >0 or >65535)throw new InvalidDataException("Puerto UDP inválido");settings.UdpPort=command.Port.Value;AppPaths.AtomicWrite(paths.Settings,Wire.Encode(settings));BindUdp();break;
            case "obs-connect":if(engine.Current is not null)throw new InvalidOperationException("Finaliza la sesión antes de reconectar OBS");if(command.Port is not >0 or >65535)throw new InvalidDataException("Puerto OBS inválido");await obs.ConnectAsync(command.Port.Value,command.Password??"");break;
            case "quit":if(engine.Current is not null||obs.Owned)throw new InvalidOperationException("Finaliza y guarda la sesión antes de cerrar el motor");break;
            default:throw new InvalidDataException("Orden desconocida");
        }
        return new(true,Status:Snapshot());
    }
    public async Task<Reply> CommandAsync(Command command)
    {
        var completion=new TaskCompletionSource<Reply>(TaskCreationOptions.RunContinuationsAsynchronously);await queue.Writer.WriteAsync(new(Command:command,Completion:completion),cancellation.Token);return await completion.Task.WaitAsync(TimeSpan.FromSeconds(15));
    }
    async Task ListenPipe()
    {
        while(!cancellation.IsCancellationRequested){NamedPipeServerStream? pipe=null;
            try{pipe=new(paths.PipeName,PipeDirection.InOut,4,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);await pipe.WaitForConnectionAsync(cancellation.Token);var connected=pipe;pipe=null;_ = Task.Run(()=>Serve(connected));}
            catch(OperationCanceledException){pipe?.Dispose();break;}catch(IOException){pipe?.Dispose();await Task.Delay(100,cancellation.Token);}
        }
    }
    async Task Serve(NamedPipeServerStream pipe)
    {
        await using(pipe){try{using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);timeout.CancelAfter(TimeSpan.FromSeconds(20));using var reader=new StreamReader(pipe,leaveOpen:true);using var writer=new StreamWriter(pipe,leaveOpen:true){AutoFlush=true};
            var line=await reader.ReadLineAsync(timeout.Token);if(line is null||line.Length>16384)return;var command=Wire.Decode<Command>(line);var reply=await CommandAsync(command);await writer.WriteLineAsync(Wire.Encode(reply).AsMemory(),timeout.Token);
            if(command.Action=="quit"&&reply.Ok)Application.Exit();
        }catch(Exception ex)when(ex is IOException or OperationCanceledException or System.Text.Json.JsonException){} }
    }
    public void Dispose(){cancellation.Cancel();udp?.Dispose();try{Task.WaitAll(tasks.ToArray(),TimeSpan.FromSeconds(3));}catch(AggregateException){}engine.Dispose();obs.Dispose();cancellation.Dispose();}
}
