using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
namespace VertexLab.Core;
public sealed record ObsAnchor(double Wall,double Video,double Uncertainty);
public interface IObsRecorder
{
    bool Connected { get; } bool Owned { get; }
    Task<ObsAnchor?> StartAsync();Task<ObsAnchor?> ResumeAsync();Task PauseAsync();Task<string?> StopAsync();
}
public sealed class ObsClient : IObsRecorder, IDisposable
{
    ClientWebSocket? socket;
    public bool Connected=>socket?.State==WebSocketState.Open;
    public bool Owned {get;private set;}
    public static double Clock=>Stopwatch.GetTimestamp()/(double)Stopwatch.Frequency;
    public async Task ConnectAsync(int port,string password)
    {
        bool pending=Owned;
        socket?.Dispose();socket=new();using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(4));
        try{
            await socket.ConnectAsync(new Uri($"ws://127.0.0.1:{port}"),timeout.Token);
            var hello=await Receive(timeout.Token);if(hello.GetProperty("op").GetInt32()!=0)throw new InvalidDataException("OBS no usa WebSocket v5");
            var identify=new Dictionary<string,object>{{"rpcVersion",1},{"eventSubscriptions",0}};
            if(hello.GetProperty("d").TryGetProperty("authentication",out var auth)){
                string H(string s)=>Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
                identify["authentication"]=H(H(password+auth.GetProperty("salt").GetString())+auth.GetProperty("challenge").GetString());
            }
            await Send(new{op=1,d=identify},timeout.Token);
            if((await Receive(timeout.Token)).GetProperty("op").GetInt32()!=2)throw new InvalidDataException("OBS rechazó la autenticación");
            var status=await Request("GetRecordStatus");if(pending&&status.GetProperty("outputActive").GetBoolean())throw new InvalidOperationException("Detén manualmente la grabación pendiente en OBS antes de reconectar");if(pending)Owned=false;
        }catch(InvalidOperationException){socket.Dispose();socket=null;throw;}catch{socket.Dispose();socket=null;throw new InvalidOperationException("No se pudo conectar con OBS. Revisa WebSocket, puerto y contraseña.");}
    }
    async Task Send(object value,CancellationToken token)=>await socket!.SendAsync(Encoding.UTF8.GetBytes(Wire.Encode(value)),WebSocketMessageType.Text,true,token);
    async Task<JsonElement> Receive(CancellationToken token)
    {
        using var result=new MemoryStream();var buffer=new byte[16384];WebSocketReceiveResult part;
        do{part=await socket!.ReceiveAsync(new ArraySegment<byte>(buffer),token);if(part.MessageType==WebSocketMessageType.Close)throw new IOException("OBS se desconectó");result.Write(buffer,0,part.Count);if(result.Length>1024*1024)throw new IOException("Respuesta de OBS demasiado grande");}while(!part.EndOfMessage);
        return JsonDocument.Parse(result.ToArray()).RootElement.Clone();
    }
    async Task<JsonElement> Request(string name)
    {
        if(!Connected)throw new InvalidOperationException("OBS desconectado");
        string id=Guid.NewGuid().ToString("N");using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(4));
        await Send(new{op=6,d=new{requestType=name,requestId=id}},timeout.Token);
        while(true){var message=await Receive(timeout.Token);if(message.GetProperty("op").GetInt32()!=7)continue;var data=message.GetProperty("d");if(data.GetProperty("requestId").GetString()!=id)continue;
            if(!data.GetProperty("requestStatus").GetProperty("result").GetBoolean())throw new InvalidOperationException("OBS rechazó "+name);
            return data.TryGetProperty("responseData",out var response)?response.Clone():JsonSerializer.SerializeToElement(new{});
        }
    }
    async Task<ObsAnchor> Wait(bool active,bool? paused=null)
    {
        double deadline=Clock+5;
        while(true){double before=Clock;var status=await Request("GetRecordStatus");double after=Clock;
            if(status.GetProperty("outputActive").GetBoolean()==active&&(paused is null||status.GetProperty("outputPaused").GetBoolean()==paused))return new((before+after)/2,status.GetProperty("outputDuration").GetDouble()/1000,(after-before)/2);
            if(Clock>deadline)throw new TimeoutException("OBS no confirmó el cambio de grabación");await Task.Delay(80);
        }
    }
    public async Task<ObsAnchor?> StartAsync()
    {
        if(Owned)throw new InvalidOperationException("OBS conserva una grabación pendiente");if(!Connected)return null;
        if((await Request("GetRecordStatus")).GetProperty("outputActive").GetBoolean())throw new InvalidOperationException("OBS ya graba por tu cuenta; se guardará solo telemetría");
        await Request("StartRecord");Owned=true;return await Wait(true,false);
    }
    public async Task PauseAsync(){if(Owned){await Request("PauseRecord");await Wait(true,true);}}
    public async Task<ObsAnchor?> ResumeAsync(){if(!Owned)return null;await Request("ResumeRecord");return await Wait(true,false);}
    public async Task<string?> StopAsync(){if(!Owned)return null;var result=await Request("StopRecord");await Wait(false);Owned=false;return result.TryGetProperty("outputPath",out var path)?path.GetString():null;}
    public void Dispose(){socket?.Dispose();}
}
