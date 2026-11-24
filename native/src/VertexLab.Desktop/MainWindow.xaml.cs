using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using System.Windows.Input;
using Microsoft.Win32;
using VertexLab.Core;
namespace VertexLab.Desktop;
public partial class MainWindow : Window
{
    readonly AppPaths paths=new();readonly Library library;readonly DispatcherTimer statusTimer=new(){Interval=TimeSpan.FromMilliseconds(100)};readonly DispatcherTimer frameTimer=new(){Interval=TimeSpan.FromMilliseconds(33)};
    readonly CancellationTokenSource lifetime=new();bool polling,playing,internalTime,loading,videoFailed;SessionEntry? selected;SessionAnalysis? analysis;EngineStatus? engine;double time;int generation;DateTime lastRefresh=DateTime.MinValue;string librarySignature="";
    public record LibraryItem(SessionEntry Entry){public override string ToString()=>Entry.Meta.Name;public SessionMeta Meta=>Entry.Meta;public string Caption=>DateTimeOffset.FromUnixTimeMilliseconds((long)(Meta.Created*1000)).LocalDateTime.ToString("dd MMM yyyy · HH:mm")+" · "+(Entry.State=="Interrupted"?"Recuperada":ClockText(Meta.Duration));}
    record LapItem(int? Id,string Label){public override string ToString()=>Label;}
    public MainWindow()
    {
        InitializeComponent();library=new(paths);
        foreach(var plot in Plots){plot.Seek+=Seek;plot.RangeChanged+=(a,b)=>{foreach(var other in Plots)if(other!=plot)other.SetRange(a,b);};}Route.Seek+=Seek;
        foreach (var control in Plots.Cast<UIElement>().Append(Timeline))
            control.AddHandler(Mouse.PreviewMouseDownEvent, new MouseButtonEventHandler(ScrubDown), true);
        AddHandler(Mouse.PreviewMouseUpEvent, new MouseButtonEventHandler(ScrubUp), true);
        AddHandler(Mouse.LostMouseCaptureEvent, new MouseEventHandler(ScrubCaptureLost), true);
        Deactivated += (_, _) => FinishDrag();
        statusTimer.Tick+=async(_,_)=>await Poll();frameTimer.Tick+=(_,_)=>Frame();
    }
    readonly ScrubController scrub = new();
    static double SeekClock => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
    SeriesView[] Plots=>[SpeedPlot,RpmPlot,ThrottlePlot,BrakePlot];
    async void WindowLoaded(object sender,RoutedEventArgs e)
    {
        RefreshLibrary();frameTimer.Start();statusTimer.Start();
        try{using var probe=new CancellationTokenSource(600);await CaptureClient.SendAsync(paths,new("status"),probe.Token);}
        catch{var exe=System.IO.Path.Combine(AppContext.BaseDirectory,"VertexLab.Capture.exe");if(!System.IO.File.Exists(exe)){Message.Text="Falta VertexLab.Capture.exe. Compila o publica la solución completa.";return;}
            var info=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};info.Environment["VERTEXLAB_DATA"]=paths.Root;Process.Start(info);}
        await Poll();
        var file=Environment.GetCommandLineArgs().Skip(1).FirstOrDefault();if(file is not null&&System.IO.File.Exists(file))await ImportPath(file);
    }
    void WindowClosed(object? sender,EventArgs e){scrub.Cancel();lifetime.Cancel();statusTimer.Stop();frameTimer.Stop();Video.Close();}
    async Task Poll()
    {
        if(polling)return;polling=true;
        try{var reply=await CaptureClient.SendAsync(paths,new("status"),lifetime.Token);if(!reply.Ok||reply.Status is null)return;engine=reply.Status;
            bool connected=engine.PacketAge<1.5&&engine.Packet?.Active==true;EngineBadge.Text=connected?"● LIVE":"○ SIN SEÑAL";
            CaptureInfo.Text=$"Motor: {engine.Mode}  ·  UDP {engine.UdpPort}  ·  {engine.Packets:N0} paquetes  ·  OBS {(engine.ObsConnected?"conectado":"sin video automático")}"+(engine.Session is {} session?$"  ·  {session.Name}":"");
            if(engine.Error is not null)Message.Text=engine.Error;
            if(selected is null)RenderInstruments(connected?engine.Packet:null);
            if(DateTime.UtcNow-lastRefresh>TimeSpan.FromSeconds(3)){RefreshLibrary();lastRefresh=DateTime.UtcNow;}
        }catch(OperationCanceledException){if(!lifetime.IsCancellationRequested)EngineBadge.Text="MOTOR SIN RESPUESTA";}
        catch(Exception ex){EngineBadge.Text="MOTOR DESCONECTADO";Message.Text=ex.Message;}finally{polling=false;}
    }
    void RefreshLibrary(){var id=(SessionList.SelectedItem as LibraryItem)?.Meta.Id;var entries=library.List();var signature=string.Join(";",entries.Select(s=>$"{s.Meta.Id}:{s.Meta.Duration:R}:{s.Meta.Ended}:{s.Meta.Name}:{s.State}"));if(signature==librarySignature)return;librarySignature=signature;SessionList.ItemsSource=entries.Select(e=>new LibraryItem(e)).ToList();LibraryInfo.Text=$"{entries.Count} sesiones · solo en este equipo";if(id is not null){var item=SessionList.Items.Cast<LibraryItem>().FirstOrDefault(x=>x.Meta.Id==id);SessionList.SelectedItem=item;}}
    async Task<bool> Command(Command command){try{var reply=await CaptureClient.SendAsync(paths,command,lifetime.Token);if(!reply.Ok)Message.Text=reply.Error;else Message.Text="Orden confirmada por el motor. La captura continúa al cerrar esta ventana.";await Poll();return reply.Ok;}catch(Exception ex){Message.Text=ex.Message;return false;}}
    async void RecordClicked(object sender,RoutedEventArgs e)=>await Command(new("start",Name:SessionName.Text));
    async void StopClicked(object sender,RoutedEventArgs e){await Command(new("stop"));RefreshLibrary();}
    void LiveClicked(object sender,RoutedEventArgs e){scrub.Cancel();generation++;selected=null;analysis=null;playing=false;PlayButton.Content="▶";Video.Close();Video.Source=null;VideoHint.Visibility=Visibility.Visible;VideoHint.Text="LIVE · Esperando telemetría del juego";SessionTitle.Text="LIVE";SessionList.SelectedItem=null;foreach(var plot in Plots)plot.SetData(null);Route.SetData(null);}
    async void SessionSelected(object sender,SelectionChangedEventArgs e)
    {
        if(SessionList.SelectedItem is not LibraryItem item||item.Meta.Id==selected?.Meta.Id)return;
        if(item.Meta.Ended is null){Message.Text="Finaliza y guarda esta sesión para analizarla. LIVE sigue disponible durante la captura.";return;}
        scrub.Cancel();int request=++generation;videoFailed=false;loading=true;playing=false;PlayButton.Content="▶";Video.Close();Video.Source=null;VideoHint.Visibility=Visibility.Visible;VideoHint.Text="Cargando telemetría…";
        try{var loaded=await Task.Run(()=>Analysis.Load(item.Entry.TelemetryPath),lifetime.Token);if(request!=generation)return;selected=item.Entry;analysis=loaded;time=0;
            SessionTitle.Text=item.Meta.Name;Timeline.Maximum=Math.Max(.001,analysis.Duration);DurationLabel.Text=ClockText(analysis.Duration);
            var laps=new List<LapItem>{new(null,"Todo el recorrido")};laps.AddRange(analysis.Laps.Select(l=>new LapItem(l.Id,$"Vuelta {l.Number+1} · {ClockText(l.Time)}{(l.Partial?" · parcial":"")}")));LapPicker.ItemsSource=laps;LapPicker.SelectedIndex=0;
            foreach(var plot in Plots)plot.SetData(analysis);Route.SetData(analysis);
            if(item.Meta.VideoPath is {} path&&System.IO.File.Exists(path)){Video.Source=new Uri(System.IO.Path.GetFullPath(path));Video.Volume=.7;Video.Play();Video.Pause();VideoHint.Text="Preparando video…";}
            else VideoHint.Text="Sesión sin video disponible. Puedes explorar toda su telemetría.";
            Message.Text=item.Entry.State=="Interrupted"?"Sesión recuperada tras una interrupción; comprueba el archivo de OBS.":"Rueda: zoom · Gráfica o trazada: ir al instante · La captura funciona de forma independiente.";UpdateCursor();
        }catch(Exception ex){Message.Text="No se pudo abrir la sesión: "+ex.Message;VideoHint.Text=Message.Text;}finally{if(request==generation)loading=false;}
    }
    void VideoOpened(object sender,RoutedEventArgs e){VideoHint.Visibility=Visibility.Collapsed;Seek(time);}
    void VideoFailed(object sender,ExceptionRoutedEventArgs e){videoFailed=true;VideoHint.Visibility=Visibility.Visible;VideoHint.Text="Windows no pudo abrir el video. Comprueba el archivo y su codec. La telemetría sigue disponible.";Message.Text=e.ErrorException.Message;}
    void VideoEnded(object sender,RoutedEventArgs e){playing=false;PlayButton.Content="▶";}
    void PlayClicked(object sender,RoutedEventArgs e){if(analysis is null)return;bool next=!playing;if(scrub.Active){scrub.End(SeekClock);ApplyScrub();scrub.Cancel();}playing=next;PlayButton.Content=playing?"Ⅱ":"▶";if(Video.Source is not null){if(playing)Video.Play();else Video.Pause();}}
    void BackClicked(object sender,RoutedEventArgs e)=>Seek(time-5);
    void ForwardClicked(object sender,RoutedEventArgs e)=>Seek(time+5);
    void TimeChanged(object sender,RoutedPropertyChangedEventArgs<double> e){if(!internalTime&&!loading&&analysis is not null)Seek(e.NewValue);}
    void ScrubDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left || analysis is null || loading) return;
        scrub.Begin(playing, SeekClock);
        playing = false; Video.Pause(); PlayButton.Content = "▶";
    }
    void ScrubUp(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) Dispatcher.BeginInvoke(FinishDrag, DispatcherPriority.Input);
    }
    void ScrubCaptureLost(object sender, MouseEventArgs e)
    {
        if (Mouse.LeftButton == MouseButtonState.Released) FinishDrag();
    }
    void FinishDrag()
    {
        if (!scrub.Active) return;
        scrub.End(SeekClock);
        ApplyScrub();
    }
    void Seek(double value)
    {
        if (analysis is null || selected is null) return;
        time = Math.Clamp(value, 0, analysis.Duration);
        bool entering = !scrub.Active;
        scrub.Request(time, playing, SeekClock);
        playing = false; if (entering) Video.Pause(); PlayButton.Content = "▶";
        UpdateCursor();
    }
    void ApplyScrub()
    {
        var targetTime = scrub.TakeSeek(SeekClock);
        if (targetTime is not null && selected is not null && !videoFailed && Video.Source is not null &&
            Analysis.ToVideo(selected.Meta, targetTime.Value) is {} target)
            Video.Position = TimeSpan.FromSeconds(Math.Max(0, target));
        if (scrub.TryFinish(SeekClock, out bool resume))
        {
            playing = resume; PlayButton.Content = playing ? "Ⅱ" : "▶";
            if (playing && !videoFailed && Video.Source is not null) Video.Play();
        }
    }
    void Frame()
    {
        ApplyScrub();
        if(selected is null||analysis is null||loading||!playing)return;
        if(playing){if(!videoFailed&&Video.Source is not null&&Video.NaturalDuration.HasTimeSpan&&Analysis.ToVideo(selected.Meta,time) is not null){var mapped=Analysis.FromVideo(selected.Meta,Video.Position.TotalSeconds);if(mapped is not null){time=mapped.Value;var target=Analysis.ToVideo(selected.Meta,time);if(target is not null&&Math.Abs(target.Value-Video.Position.TotalSeconds)>.15)Video.Position=TimeSpan.FromSeconds(target.Value);}}else time+=frameTimer.Interval.TotalSeconds;
            var end=LapPicker.SelectedItem is LapItem {Id:{} id}?analysis.Laps.First(l=>l.Id==id).End:analysis.Duration;
            if(time>=end){time=end;playing=false;Video.Pause();PlayButton.Content="▶";}}
        UpdateCursor();
    }
    void UpdateCursor(){internalTime=true;Timeline.Value=time;internalTime=false;Clock.Text=ClockText(time);foreach(var plot in Plots)plot.SetTime(time);Route.SetTime(time);RenderInstruments(analysis?.At(time)?.Packet);}
    static string ClockText(double seconds)=>$"{(int)(seconds/60)}:{seconds%60:00.000}";
    void RenderInstruments(TelemetryPacket? p){if(p is null){SteeringValue.Text=GValue.Text=MotorValue.Text=TyreValue.Text="—";return;}SteeringValue.Text=(p.Steer is {} steer?$"{steer/127d*100:+0;-0;0}%":"Sin datos")+$"  ·  A {p.Throttle:0}%  F {p.Brake:0}%";GValue.Text=p.AccelX is {} ax&&p.AccelZ is {} az?$"{ax/9.80665:+0.00;-0.00;0} / {az/9.80665:+0.00;-0.00;0} G":"Sin datos";MotorValue.Text=$"{(p.Gear==0?"R":(p.Gear?.ToString()??"—"))}  |  {p.Rpm:N0} RPM  |  {p.Speed:0} km/h";TyreValue.Text=p.TireTempsC.Length==4?string.Join(" / ",p.TireTempsC.Select(t=>$"{t:0}°")):"Sin datos";}
    void LapSelected(object sender,SelectionChangedEventArgs e){if(analysis is null)return;int? id=(LapPicker.SelectedItem as LapItem)?.Id;foreach(var plot in Plots)plot.SetData(analysis,id);Route.SetData(analysis,id);Seek(id is {} lap?analysis.Laps.First(l=>l.Id==lap).Start:0);}
    void ResetPlots(object sender,RoutedEventArgs e){foreach(var plot in Plots)plot.Fit();}
    void FitRoute(object sender,RoutedEventArgs e)=>Route.Fit();
    async void ImportClicked(object sender,RoutedEventArgs e)
    {
        var dialog=new OpenFileDialog{Title="Importar una sesión finalizada",Filter="Sesión VertexLab|*.vrtx;*.json"};if(dialog.ShowDialog()!=true)return;
        await ImportPath(dialog.FileName);
    }
    async Task ImportPath(string file)
    {
        try{Message.Text="Importando sesión…";var progress=new Progress<string>(text=>Message.Text=text);var entry=System.IO.Path.GetExtension(file).Equals(".vrtx",StringComparison.OrdinalIgnoreCase)?await Task.Run(()=>PortableSession.ImportAsync(file,paths,library,progress,lifetime.Token)):await library.ImportLegacyAsync(file,lifetime.Token);RefreshLibrary();SessionList.SelectedItem=SessionList.Items.Cast<LibraryItem>().First(i=>i.Meta.Id==entry.Meta.Id);}
        catch(Exception ex){Message.Text="Importación cancelada: "+ex.Message;}
    }

    async void ExportClicked(object sender,RoutedEventArgs e)
    {
        if(selected is null){Message.Text="Selecciona una sesión finalizada.";return;}var dialog=new SaveFileDialog{Filter="Sesión portable|*.vrtx",FileName="VertexLab-session.vrtx"};if(dialog.ShowDialog()!=true)return;
        try{await Task.Run(()=>PortableSession.ExportAsync(selected,dialog.FileName,new Progress<string>(text=>Dispatcher.Invoke(()=>Message.Text=text)),lifetime.Token));Message.Text="Archivo .vrtx exportado.";}catch(Exception ex){Message.Text=ex.Message;}
    }
    void SettingsClicked(object sender,RoutedEventArgs e)=>new SettingsWindow(paths,engine){Owner=this}.ShowDialog();
}
