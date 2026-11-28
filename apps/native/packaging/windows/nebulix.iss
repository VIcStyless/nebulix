; Nebulix for Windows installer (Inno Setup 6). Built by .github/workflows/release.yml.
#define AppVersion GetEnv("NBX_VERSION")
[Setup]
AppId={{6E0B4C2E-5B1D-4C7A-9C55-2F6D1C3A9B11}
AppName=Nebulix
AppVersion={#AppVersion}
AppPublisher=VicStyles
DefaultDirName={autopf}\Nebulix
DefaultGroupName=Nebulix
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=out
OutputBaseFilename=Nebulix-Setup-{#AppVersion}
SetupIconFile=..\..\app\icons\nebulix.ico
UninstallDisplayIcon={app}\nebulix.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\..\target\release\nebulix.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Nebulix"; Filename: "{app}\nebulix.exe"
Name: "{autodesktop}\Nebulix"; Filename: "{app}\nebulix.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\nebulix.exe"; Description: "{cm:LaunchProgram,Nebulix}"; Flags: nowait postinstall skipifsilent
