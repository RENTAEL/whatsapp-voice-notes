' Starts the OmniRoute gateway hidden at login so the omniroute MCP in Claude always has a backend.
CreateObject("WScript.Shell").Run "cmd /c omniroute serve --daemon --no-open --no-tray", 0, False
