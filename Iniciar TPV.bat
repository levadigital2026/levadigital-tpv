@echo off
REM Arranca el servidor del TPV LevaDigital y abre el navegador.
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Descargalo de https://nodejs.org e instalalo. & pause & exit /b 1)
start "" http://localhost:8080
npm start
pause
