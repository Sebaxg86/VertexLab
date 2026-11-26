#ifndef AppVersion
  #define AppVersion "0.2.8"
#endif
[Setup]
AppId={{72CD7404-CBB3-4DCD-85CC-EE0249E045AA}
AppName=VertexLab
AppVersion={#AppVersion}
AppPublisher=VertexLab
DefaultDirName={localappdata}\Programs\VertexLab
DefaultGroupName=VertexLab
PrivilegesRequired=lowest
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
Source: "..\dist\VertexConnect\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\VertexLab"; Filename: "{app}\VertexConnect.exe"

[Messages]
ClickNext=
ClickFinish=
SelectDirBrowseLabel=Pulsa Instalar para continuar, o Examinar para elegir otra carpeta.
WelcomeLabel1=Bienvenido al instalador de VertexLab + VertexConnect
WelcomeLabel2=Instala tu espacio de telemetría para capturar, reproducir y analizar tus sesiones de Forza.%n%nVertexConnect conecta el juego y OBS. VertexLab te permite explorar cada vuelta, su video y sus gráficas.%n%nPulsa Siguiente para elegir dónde instalarlo.
FinishedHeadingLabel=Todo listo para empezar.
FinishedLabel=VertexLab y VertexConnect ya están instalados.%n%nElige cómo quieres continuar. Al iniciar VertexConnect podrás configurar Forza y OBS.

[UninstallDelete]
Type: files; Name: "{autodesktop}\VertexLab.lnk"

[Code]
var
  DesktopShortcut, StartConnect: TNewCheckBox;

procedure AddArtPanel(Page: TNewNotebookPage);
var
  Panel: TPanel;
  Brand: TNewStaticText;
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
  Backdrop.Bitmap.Width := 1;
  Backdrop.Bitmap.Height := 1;
  Backdrop.Bitmap.Canvas.Pixels[0, 0] := $100C0C;
  Backdrop.Stretch := True;
  Brand := TNewStaticText.Create(WizardForm);
  Brand.Parent := Panel;
  Brand.AutoSize := False;
  Brand.SetBounds(ScaleX(20), (Panel.Height div 2) - ScaleY(20), Panel.Width - ScaleX(40), ScaleY(40));
  Brand.Caption := 'VERTEXLAB';
  Brand.Color := $100C0C;
  Brand.Font.Name := 'Segoe UI';
  Brand.Font.Size := 23;
  Brand.Font.Style := [fsBold, fsItalic];
  Brand.Font.Color := $4F39FF;
  Brand.Alignment := taCenter;
  Log(Format('Artwork panel: %d x %d pixels', [Panel.Width, Panel.Height]));
end;

procedure InitializeWizard;
var
  TextLeft, TextWidth: Integer;
begin
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage2.Visible := False;
  AddArtPanel(WizardForm.WelcomePage);
  AddArtPanel(WizardForm.FinishedPage);
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
begin
  if (CurStep = ssDone) and DesktopShortcut.Checked then
    CreateShellLink(ExpandConstant('{autodesktop}\VertexLab.lnk'),
      'VertexLab + VertexConnect', ExpandConstant('{app}\VertexConnect.exe'),
      '', ExpandConstant('{app}'), ExpandConstant('{app}\VertexConnect.exe'), 0, SW_SHOWNORMAL);
  if (CurStep = ssDone) and not WizardSilent and StartConnect.Checked then
    if not Exec(ExpandConstant('{app}\VertexConnect.exe'), '', ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, ResultCode) then
      MsgBox('La instalación terminó. Abre VertexConnect desde el menú Inicio.', mbInformation, MB_OK);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpSelectDir then
    WizardForm.NextButton.Caption := SetupMessage(msgButtonInstall);
end;
