using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;
public sealed class SettingsWindow : Window
{
    public SettingsWindow(AppPaths paths,EngineStatus? status)
    {
        Style=(Style)FindResource(typeof(Window));Title="VertexLab · Configuración";Width=510;Height=620;ResizeMode=ResizeMode.NoResize;WindowStartupLocation=WindowStartupLocation.CenterOwner;
        var panel=new StackPanel{Margin=new Thickness(24)};Content=panel;
        void Text(string text,int size=14){panel.Children.Add(new TextBlock{Text=text,FontSize=size,Margin=new Thickness(4,8,4,4),TextWrapping=TextWrapping.Wrap,Foreground=Brushes.LightGray});}
        Text("CAPTURA INDEPENDIENTE",23);Text("El motor permanece en la bandeja del sistema al cerrar la ventana.");
        var auto=new CheckBox{Content="Detectar carreras automáticamente",IsChecked=status?.Automatic??false};panel.Children.Add(auto);
        var result=new TextBlock{TextWrapping=TextWrapping.Wrap,Foreground=Brushes.LightPink,Margin=new Thickness(4,10,4,4)};
        async Task<bool> Send(Command command){try{var reply=await CaptureClient.SendAsync(paths,command);result.Text=reply.Ok?"Configuración aplicada.":reply.Error;return reply.Ok;}catch(Exception ex){result.Text=ex.Message;return false;}}
        auto.Click+=async(_,_)=>{if(!await Send(new("auto",Enabled:auto.IsChecked==true)))auto.IsChecked=status?.Automatic??false;};
        Text("Puerto UDP de Forza (IP 127.0.0.1)");var udp=new TextBox{Text=(status?.UdpPort??5301).ToString()};panel.Children.Add(udp);
        var apply=new Button{Content="Aplicar puerto UDP"};apply.Click+=async(_,_)=>{if(int.TryParse(udp.Text,out int port))await Send(new("udp",Port:port));else result.Text="Introduce un puerto válido.";};panel.Children.Add(apply);
        Text("OBS WEBSOCKET",18);var portBox=new TextBox{Text="4455"};panel.Children.Add(portBox);var password=new PasswordBox{ToolTip="Contraseña WebSocket de OBS"};panel.Children.Add(password);
        var connect=new Button{Content="Conectar OBS"};connect.Click+=async(_,_)=>{if(!int.TryParse(portBox.Text,out int port)){result.Text="Puerto OBS inválido";return;}connect.IsEnabled=false;await Send(new("obs-connect",Port:port,Password:password.Password));password.Clear();connect.IsEnabled=true;};panel.Children.Add(connect);
        Text("La contraseña solo se usa en memoria. OBS debe estar abierto y configurado para permitir pausas.",12);
        var folder=new Button{Content="Abrir carpeta de la biblioteca"};folder.Click+=(_,_)=>Process.Start(new ProcessStartInfo(paths.Root){UseShellExecute=true});panel.Children.Add(folder);
        var exit=new Button{Content="Cerrar motor (requiere finalizar la sesión)"};exit.Click+=async(_,_)=>{if(await Send(new("quit")))Close();};panel.Children.Add(exit);panel.Children.Add(result);
    }
}
