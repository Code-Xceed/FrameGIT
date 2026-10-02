; FrameGit Windows Installer Script (NSIS)
; Packages standalone framegit.exe, Premiere Pro CCX panel, and DaVinci Resolve script

!include "MUI2.nsh"
!include "FileFunc.nsh"

; General Settings
Name "FrameGit"
OutFile "..\..\dist\FrameGit-Setup-1.0.0.exe"
InstallDir "$PROGRAMFILES64\FrameGit"
InstallDirRegKey HKLM "Software\FrameGit" "Install_Dir"
RequestExecutionLevel admin

; UI Configuration
!define MUI_ABORTWARNING
!define MUI_ICON "..\..\plugin\premiere\icons\icon-48.png"
!define MUI_UNICON "..\..\plugin\premiere\icons\icon-48.png"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"

; Installer Sections
Section "FrameGit Core (Required)" SecCore
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Standalone Executable
  File "..\..\dist\framegit.exe"

  ; Premiere Pro UXP Plugin Package
  File "..\..\dist\FrameGit-Premiere.ccx"

  ; DaVinci Resolve Integration
  CreateDirectory "$INSTDIR\resolve"
  SetOutPath "$INSTDIR\resolve"
  File "..\..\plugin\resolve\framegit_resolve.py"

  SetOutPath "$INSTDIR"

  ; Store installation folder in Registry
  WriteRegStr HKLM "Software\FrameGit" "Install_Dir" "$INSTDIR"

  ; Register in Windows Uninstall Registry
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit" "DisplayName" "FrameGit Version Control"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit" "DisplayVersion" "1.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit" "Publisher" "FrameGit Open Source Project"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit" "DisplayIcon" "$INSTDIR\framegit.exe"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit" "NoRepair" 1

  ; Write Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Append to System PATH
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0;$INSTDIR"

  ; Broadcast environment change to Windows explorer
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
SectionEnd

Section "Start Menu Shortcuts" SecShortcuts
  CreateDirectory "$SMPROGRAMS\FrameGit"
  CreateShortcut "$SMPROGRAMS\FrameGit\FrameGit CLI.lnk" "powershell.exe" "-NoExit -Command Write-Host 'FrameGit CLI Ready. Type framegit --help for commands.' -ForegroundColor Cyan"
  CreateShortcut "$SMPROGRAMS\FrameGit\Install Premiere Plugin.lnk" "$INSTDIR\FrameGit-Premiere.ccx"
  CreateShortcut "$SMPROGRAMS\FrameGit\Uninstall FrameGit.lnk" "$INSTDIR\uninstall.exe"
SectionEnd

; Uninstaller Section
Section "Uninstall"
  ; Remove Registry Keys
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameGit"
  DeleteRegKey HKLM "Software\FrameGit"

  ; Remove Files and Uninstaller
  Delete "$INSTDIR\framegit.exe"
  Delete "$INSTDIR\FrameGit-Premiere.ccx"
  Delete "$INSTDIR\resolve\framegit_resolve.py"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR\resolve"
  RMDir "$INSTDIR"

  ; Remove Shortcuts
  Delete "$SMPROGRAMS\FrameGit\*.*"
  RMDir "$SMPROGRAMS\FrameGit"

  ; Broadcast environment change
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
SectionEnd
