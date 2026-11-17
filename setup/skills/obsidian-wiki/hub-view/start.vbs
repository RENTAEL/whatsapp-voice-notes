' Opens the Agent Hub live view (http://127.0.0.1:4317), starting it in a hidden console first. No window.
' If the view is already running the second copy just exits. Log: %LOCALAPPDATA%\agent-hub\view.log
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c md ""%LOCALAPPDATA%\agent-hub"" 2>nul & node """ & dir & "\server.mjs"" >> ""%LOCALAPPDATA%\agent-hub\view.log"" 2>&1", 0, False
WScript.Sleep 2000
sh.Run "http://127.0.0.1:4317"
