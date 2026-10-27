@echo off
rem Builds dist\WABlast.exe with GOWA bundled inside. Run from the agent folder.
rem wablast.env (Supabase URL + publishable key, both public) is baked in too, so each outlet gets one file.
setlocal
cd /d "%~dp0"
if not exist wablast.env (echo Copy wablast.env.example to wablast.env and fill in Supabase first. & exit /b 1)
uv run pyinstaller --noconfirm --clean --onefile --noconsole --name WABlast ^
  --add-binary "..\tools\gowa\gowa.exe;." ^
  --add-data "wablast.env;." ^
  launcher.py || exit /b 1
if exist dist\wablast.env del dist\wablast.env
rmdir /s /q build
del WABlast.spec
echo Built dist\WABlast.exe
