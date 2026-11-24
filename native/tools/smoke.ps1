#requires -Version 7.2
param([string]$CaptureExe=(Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\app\VertexLab.Capture.exe'))
$ErrorActionPreference='Stop'
$qaRoot=Join-Path ([IO.Path]::GetTempPath()) ('VertexLab-smoke-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($qaRoot)
$probe=[Net.Sockets.UdpClient]::new(0);$port=$probe.Client.LocalEndPoint.Port;$probe.Dispose()
@{udpPort=$port;automatic=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaRoot 'settings.json')
$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($qaRoot.ToUpperInvariant())))
$pipeName='VertexLab-'+$hash.Substring(0,20)
function Send-Command($command){
 $pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$pipeName,[IO.Pipes.PipeDirection]::InOut)
 try{$pipe.Connect(3000);$writer=[IO.StreamWriter]::new($pipe);$writer.AutoFlush=$true;$reader=[IO.StreamReader]::new($pipe);$writer.WriteLine(($command|ConvertTo-Json -Compress));$reply=$reader.ReadLine()|ConvertFrom-Json;if(!$reply.ok){throw $reply.error};return $reply}finally{$pipe.Dispose()}
}
$info=[Diagnostics.ProcessStartInfo]::new((Resolve-Path -LiteralPath $CaptureExe).Path);$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WindowStyle='Hidden';$info.Environment['VERTEXLAB_DATA']=$qaRoot
$engine=[Diagnostics.Process]::Start($info)
try{
 $connected=$false;for($attempt=0;$attempt -lt 20;$attempt++){try{$status=Send-Command @{action='status'};$connected=$true;break}catch{Start-Sleep -Milliseconds 150}}
 if(!$connected){throw 'El motor no respondió por IPC'}
 [void](Send-Command @{action='start';name='TEST ONLY - synthetic UDP smoke'})
 $udp=[Net.Sockets.UdpClient]::new();$raw=[byte[]]::new(324);[BitConverter]::GetBytes([int]1).CopyTo($raw,0);[BitConverter]::GetBytes([single]1).CopyTo($raw,304);$raw[314]=1
 for($batch=0;$batch -lt 2;$batch++){
  for($sample=0;$sample -lt 20;$sample++){[BitConverter]::GetBytes([uint32](($batch*20+$sample)*10)).CopyTo($raw,4);[void]$udp.Send($raw,$raw.Length,'127.0.0.1',$port);Start-Sleep -Milliseconds 10}
  if($batch -eq 0){Start-Sleep -Milliseconds 900;$paused=Send-Command @{action='status'};if($paused.status.mode -ne 'paused'){throw 'No confirmó pausa por silencio'}}
 }
 $udp.Dispose();$result=Send-Command @{action='stop'}
 $metadata=Get-ChildItem (Join-Path $qaRoot 'sessions') -Filter *.json | Select-Object -First 1
 $meta=Get-Content -LiteralPath $metadata.FullName -Raw|ConvertFrom-Json
 $rows=@(Get-Content -LiteralPath ([IO.Path]::ChangeExtension($metadata.FullName,'.jsonl'))|ForEach-Object{$_|ConvertFrom-Json})
 if($rows.Count -ne 40 -or $result.status.dropped -ne 0){throw 'Se perdieron muestras de prueba'}
 if(!$rows[20].breakBefore){throw 'Falta la marca de reanudación'}
 if($rows[-1].t -gt 1){throw 'La pausa se agregó al reloj de conducción'}
 if(!$meta.ended){throw 'No se finalizó la sesión'}
 [pscustomobject]@{Passed=$true;Rows=$rows.Count;Dropped=$result.status.dropped;PauseExcluded=$true;Data=$qaRoot}|ConvertTo-Json -Compress
}finally{
 try{[void](Send-Command @{action='stop'});[void](Send-Command @{action='quit'})}catch{}
 if(!$engine.WaitForExit(5000)){$engine.Kill()}
}
