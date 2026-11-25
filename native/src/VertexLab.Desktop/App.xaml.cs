using System.Configuration;
using System.Data;
using System.Windows;

namespace VertexLab.Desktop;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e) { Vortice.MediaFoundation.MediaFactory.MFStartup().CheckError(); base.OnStartup(e); }
    protected override void OnExit(ExitEventArgs e) { Vortice.MediaFoundation.MediaFactory.MFShutdown(); base.OnExit(e); }
}

