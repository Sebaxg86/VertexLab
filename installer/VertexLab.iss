#ifndef AppVersion
  #define AppVersion "0.2.5"
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
UninstallDisplayIcon={app}\VertexConnect.exe
SetupIconFile=..\public\vertexlab.ico
CloseApplications=yes
[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
[Files]
Source: "..\dist\VertexConnect\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\VertexLab"; Filename: "{app}\VertexConnect.exe"
Name: "{autodesktop}\VertexLab"; Filename: "{app}\VertexConnect.exe"
[Run]
Filename: "{app}\VertexConnect.exe"; Description: "Abrir VertexLab y configurar VertexConnect"; Flags: nowait postinstall skipifsilent
