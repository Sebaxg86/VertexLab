using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VertexLab.Core;
namespace VertexLab.Tests;
public sealed class ObsProtocolTests
{
    [Fact] public async Task AuthenticationAndDelayedRecordStatesAreConfirmed()
    {
        await using var server=new ObsFixture(false);using var client=new ObsClient();await client.ConnectAsync(server.Port,"test-password");
        var start=await client.StartAsync();Assert.True(client.Owned);Assert.Equal(1.234,start!.Video,6);await client.PauseAsync();await client.ResumeAsync();Assert.Equal("C:\\Tests\\Synthetic.mp4",await client.StopAsync());Assert.False(client.Owned);Assert.True(server.Authenticated);Assert.Contains("PauseRecord",server.Requests);Assert.True(server.Requests.Count(r=>r=="GetRecordStatus")>=10);
    }
    [Fact] public async Task AnExistingObsRecordingIsNeverClaimedOrStopped()
    {
        await using var server=new ObsFixture(true);using var client=new ObsClient();await client.ConnectAsync(server.Port,"test-password");await Assert.ThrowsAsync<InvalidOperationException>(()=>client.StartAsync());Assert.False(client.Owned);Assert.Null(await client.StopAsync());Assert.DoesNotContain("StartRecord",server.Requests);Assert.DoesNotContain("StopRecord",server.Requests);
    }
    sealed class ObsFixture : IAsyncDisposable
    {
        readonly TcpListener listener=new(IPAddress.Loopback,0);readonly CancellationTokenSource cancellation=new();readonly Task server;bool active,paused;string? pending;int polls;
        public int Port{get;}public bool Authenticated{get;private set;}public List<string> Requests=[];
        public ObsFixture(bool active){this.active=active;listener.Start();Port=((IPEndPoint)listener.LocalEndpoint).Port;server=Run();}
        async Task Run()
        {
            try{using var tcp=await listener.AcceptTcpClientAsync(cancellation.Token);await using var stream=tcp.GetStream();var header=new List<byte>();var one=new byte[1];
                while(!Encoding.ASCII.GetString(header.ToArray()).EndsWith("\r\n\r\n")){if(await stream.ReadAsync(one,cancellation.Token)==0)return;header.Add(one[0]);if(header.Count>16384)throw new InvalidDataException();}
                string request=Encoding.ASCII.GetString(header.ToArray());string key=request.Split("\r\n").First(l=>l.StartsWith("Sec-WebSocket-Key:",StringComparison.OrdinalIgnoreCase)).Split(':',2)[1].Trim();string accept=Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
                await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n"),cancellation.Token);
                using var ws=WebSocket.CreateFromStream(stream,true,null,TimeSpan.FromSeconds(30));
                async Task Send(object value)=>await ws.SendAsync(Encoding.UTF8.GetBytes(Wire.Encode(value)),WebSocketMessageType.Text,true,cancellation.Token);
                async Task<JsonElement> Read(){var buffer=new byte[16384];var r=await ws.ReceiveAsync(new ArraySegment<byte>(buffer),cancellation.Token);if(r.MessageType==WebSocketMessageType.Close)throw new OperationCanceledException();return JsonDocument.Parse(buffer.AsMemory(0,r.Count)).RootElement.Clone();}
                await Send(new{op=0,d=new{rpcVersion=1,authentication=new{salt="salt",challenge="challenge"}}});var identify=await Read();string H(string s)=>Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(s)));Authenticated=identify.GetProperty("d").GetProperty("authentication").GetString()==H(H("test-passwordsalt")+"challenge");Assert.True(Authenticated);await Send(new{op=2,d=new{negotiatedRpcVersion=1}});
                while(!cancellation.IsCancellationRequested){var message=await Read();var data=message.GetProperty("d");string name=data.GetProperty("requestType").GetString()!;Requests.Add(name);
                    object response=new{};
                    if(name=="GetRecordStatus"){
                        if(pending is not null&&++polls>=3){switch(pending){case "StartRecord":active=true;paused=false;break;case "PauseRecord":paused=true;break;case "ResumeRecord":paused=false;break;case "StopRecord":active=false;paused=false;break;}pending=null;}
                        response=new{outputActive=active,outputPaused=paused,outputDuration=1234};
                    }else{pending=name;polls=0;if(name=="StopRecord")response=new{outputPath="C:\\Tests\\Synthetic.mp4"};}
                    await Send(new{op=7,d=new{requestType=name,requestId=data.GetProperty("requestId").GetString(),requestStatus=new{result=true,code=100},responseData=response}});
                }
            }catch(Exception ex)when(ex is OperationCanceledException or IOException or WebSocketException or ObjectDisposedException){}
        }
        public async ValueTask DisposeAsync(){cancellation.Cancel();listener.Stop();await server;cancellation.Dispose();}
    }
}
