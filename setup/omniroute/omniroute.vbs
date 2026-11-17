' Starts the OmniRoute gateway hidden at sign-in, so the omniroute MCP and the free-models skill always have a backend.
' Runs in a hidden console (not --daemon, which re-spawns itself outside it and can open windows). Log: %LOCALAPPDATA%\agent-hub\omniroute.log
CreateObject("WScript.Shell").Run "cmd /c md ""%LOCALAPPDATA%\agent-hub"" 2>nul & omniroute serve --no-open --no-tray >> ""%LOCALAPPDATA%\agent-hub\omniroute.log"" 2>&1", 0, False
