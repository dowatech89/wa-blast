@echo off
rem Builds dist\WABlast.exe with GOWA bundled inside. Run from the agent folder.
setlocal
cd /d "%~dp0"
uv run pyinstaller --noconfirm --clean --onefile --noconsole --name WABlast ^
  --add-binary "..\tools\gowa\gowa.exe;." ^
  launcher.py || exit /b 1
if exist wablast.env (copy /y wablast.env dist\wablast.env >nul) else (copy /y wablast.env.example dist\wablast.env >nul)
echo Built dist\WABlast.exe and dist\wablast.env
