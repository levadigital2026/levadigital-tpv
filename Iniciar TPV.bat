@echo off
REM Arranca el servidor del TPV LevaDigital y abre el TPV en su propia ventana.
cd /d "%~dp0"
REM Banco de imagenes: carpeta "imagenes" junto al programa o, si no existe, "..\imagenestpv".
if not defined IMAGENES if not exist "%~dp0imagenes" if exist "%~dp0..\imagenestpv" set "IMAGENES=%~dp0..\imagenestpv"
where node >nul 2>nul || (echo Falta Node.js. Descargalo de https://nodejs.org e instalalo. & pause & exit /b 1)
REM Con Microsoft Edge se abre como aplicacion (sin barra de direcciones); si no, el navegador normal.
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" >nul 2>nul && (start "" msedge --app=http://localhost:8080) || start "" http://localhost:8080
npm start
pause
