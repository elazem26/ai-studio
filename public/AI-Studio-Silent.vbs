' AI Studio Silent Launcher (VBS)
' Runs the bat file without showing a command window
' Place this file on your Desktop

Set WshShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd /c """ & strPath & "\AI-Studio-Launcher.bat""", 0, False
