#ifndef AppVersion
  #define AppVersion "0.2.18"
#endif
[Setup]
AppId={{72CD7404-CBB3-4DCD-85CC-EE0249E045AA}
AppName=VertexLab
AppVersion={#AppVersion}
AppPublisher=VertexLab
DefaultDirName={autopf}\VertexLab
DefaultGroupName=VertexLab
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist\installer
OutputBaseFilename=VertexLab-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
DisableDirPage=no
DisableProgramGroupPage=yes
DisableReadyPage=yes
WizardImageFile=
UninstallDisplayIcon={app}\VertexConnect.exe
SetupIconFile=..\public\vertexlab.ico
CloseApplications=yes
[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
[Files]
Source: "assets\welcome.bmp"; Flags: dontcopy
Source: "assets\finished.bmp"; Flags: dontcopy
Source: "..\dist\VertexConnect\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Dirs]
Name: "{app}\Sessions"; Permissions: users-modify; Check: IsAdminInstallMode
Name: "{app}\Sessions"; Check: not IsAdminInstallMode
[Icons]
Name: "{group}\VertexLab"; Filename: "{app}\VertexConnect.exe"

[Messages]
ClickNext=
ClickFinish=
SelectDirBrowseLabel=Pulsa Instalar para continuar, o Examinar para elegir otra carpeta.
WelcomeLabel1=Bienvenido al instalador de VertexLab + VertexConnect
WelcomeLabel2=Instala tu espacio de telemetría para capturar, reproducir y analizar tus sesiones de Forza.%n%nVertexConnect conecta el juego y OBS. VertexLab te permite explorar cada vuelta, su video y sus gráficas.%n%nPulsa Siguiente para elegir dónde instalarlo.
FinishedHeadingLabel=Todo listo para empezar.
ConfirmUninstall=¿Desinstalar VertexLab y VertexConnect? Se eliminarán la aplicación, sus ajustes y la caché. Tus sesiones, videos, archivos .vrtx y copias de seguridad se conservarán.
FinishedLabel=VertexLab y VertexConnect ya están instalados.%n%nElige cómo quieres continuar. Al iniciar VertexConnect podrás configurar Forza y OBS.

[UninstallDelete]
Type: files; Name: "{autodesktop}\VertexLab.lnk"

[Code]
var
  DesktopShortcut, StartConnect: TNewCheckBox;

procedure AddArtPanel(Page: TNewNotebookPage; Artwork: String);
var
  Panel: TPanel;
  Backdrop: TBitmapImage;
begin
  Panel := TPanel.Create(WizardForm);
  Panel.Parent := Page;
  Panel.SetBounds(0, 0, Page.ClientWidth div 2, Page.ClientHeight);
  Panel.BevelOuter := bvNone;
  Panel.Color := $100C0C;
  Backdrop := TBitmapImage.Create(WizardForm);
  Backdrop.Parent := Panel;
  Backdrop.SetBounds(0, 0, Panel.Width, Panel.Height);
  Backdrop.Bitmap.LoadFromFile(ExpandConstant('{tmp}\') + Artwork);
  Backdrop.Stretch := True;
  Log(Format('Artwork panel: %d x %d pixels', [Panel.Width, Panel.Height]));
end;

procedure InitializeWizard;
var
  TextLeft, TextWidth: Integer;
begin
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage2.Visible := False;
  ExtractTemporaryFile('welcome.bmp');
  ExtractTemporaryFile('finished.bmp');
  AddArtPanel(WizardForm.WelcomePage, 'welcome.bmp');
  AddArtPanel(WizardForm.FinishedPage, 'finished.bmp');
  TextLeft := (WizardForm.WelcomePage.ClientWidth div 2) + ScaleX(22);
  TextWidth := WizardForm.WelcomePage.ClientWidth - TextLeft - ScaleX(22);
  WizardForm.WelcomeLabel1.SetBounds(TextLeft, ScaleY(28), TextWidth, ScaleY(112));
  WizardForm.WelcomeLabel1.Font.Size := 17;
  WizardForm.WelcomeLabel2.SetBounds(TextLeft, ScaleY(151), TextWidth, WizardForm.WelcomePage.ClientHeight - ScaleY(165));
  WizardForm.FinishedHeadingLabel.SetBounds(TextLeft, ScaleY(28), TextWidth, ScaleY(78));
  WizardForm.FinishedHeadingLabel.Font.Size := 18;
  WizardForm.FinishedLabel.SetBounds(TextLeft, ScaleY(116), TextWidth, ScaleY(106));
  DesktopShortcut := TNewCheckBox.Create(WizardForm);
  DesktopShortcut.Parent := WizardForm.FinishedPage;
  DesktopShortcut.SetBounds(TextLeft, ScaleY(242), TextWidth, ScaleY(36));
  DesktopShortcut.Caption := 'Crear acceso directo en el escritorio';
  DesktopShortcut.Checked := True;
  StartConnect := TNewCheckBox.Create(WizardForm);
  StartConnect.Parent := WizardForm.FinishedPage;
  StartConnect.SetBounds(TextLeft, ScaleY(282), TextWidth, ScaleY(36));
  StartConnect.Caption := 'Iniciar VertexConnect';
  StartConnect.Checked := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Launched: Boolean;
begin
  if (CurStep = ssDone) and DesktopShortcut.Checked then
    CreateShellLink(ExpandConstant('{autodesktop}\VertexLab.lnk'),
      'VertexLab + VertexConnect', ExpandConstant('{app}\VertexConnect.exe'),
      '', ExpandConstant('{app}'), ExpandConstant('{app}\VertexConnect.exe'), 0, SW_SHOWNORMAL);
  if (CurStep = ssDone) and not WizardSilent and StartConnect.Checked then begin
    if IsAdminInstallMode then
      Launched := ExecAsOriginalUser(ExpandConstant('{app}\VertexConnect.exe'), '', ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, ResultCode)
    else
      Launched := Exec(ExpandConstant('{app}\VertexConnect.exe'), '', ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, ResultCode);
    if not Launched then
      MsgBox('La instalación terminó. Abre VertexConnect desde el menú Inicio.', mbInformation, MB_OK);
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpSelectDir then
    WizardForm.NextButton.Caption := SetupMessage(msgButtonInstall);
end;


function IsVertexConnectRunning: Boolean;
var
  Locator, Services, Processes: Variant;
begin
  Result := False;
  Locator := CreateOleObject('WbemScripting.SWbemLocator');
  Services := Locator.ConnectServer('', 'root\CIMV2');
  Processes := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''VertexConnect.exe''');
  Result := Processes.Count > 0;
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if WizardSilent then
    Exit;
  try
    if IsVertexConnectRunning then begin
      MsgBox('Cierra VertexConnect desde el icono junto al reloj (Salir de VertexConnect) antes de instalar o actualizar, para guardar cualquier grabación activa.', mbInformation, MB_OK);
      Result := False;
    end;
  except
    Result := True;
  end;
end;

function InitializeUninstall: Boolean;
begin
  Result := False;
  try
    if IsVertexConnectRunning then begin
      MsgBox('Cierra VertexConnect desde el icono junto al reloj: Salir de VertexConnect. La X solo oculta la ventana. No se interrumpirá ninguna grabación.', mbInformation, MB_OK);
      Exit;
    end;
    Result := True;
  except
    MsgBox('No se pudo comprobar si VertexConnect sigue activo. Cierra la aplicación y vuelve a intentarlo.', mbError, MB_OK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    if not Exec(ExpandConstant('{app}\VertexConnect.exe'), '--uninstall-cleanup', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      Log('No se pudo limpiar la configuración; las sesiones se conservan.')
    else if ResultCode <> 0 then
      Log('Limpieza de configuración incompleta; se conservaron los archivos que no pudieron validarse.');
  end;
end;
