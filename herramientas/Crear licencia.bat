@echo off
REM Crea un codigo de licencia de modulos para una instalacion del TPV LevaDigital.
REM Solo para LevaDigital: necesita la clave privada en ..\..\licencias\clave-privada-licencias.pem
REM (fuera del programa: no se entrega a los clientes ni se sube a GitHub).
cd /d "%~dp0.."
set "CLAVE=%~dp0..\..\licencias\clave-privada-licencias.pem"
if not exist "%CLAVE%" (echo No encuentro la clave privada en "%CLAVE%" & pause & exit /b 1)
where node >nul 2>nul || (echo Falta Node.js. & pause & exit /b 1)
echo.
echo Modulos: clientes, stocks, informes, efectivo, scanner, impresoras, pulseras, balanza  (o "todos")
echo.
set /p INST=Identificador de la instalacion (Configuracion ^> Modulos activos): 
set /p MODS=Modulos separados por comas, o todos: 
set /p CAD=Caduca (AAAA-MM-DD, vacio = sin caducidad): 
set /p TIT=Titular (nombre del cliente): 
node herramientas\crear-licencia.ts "%CLAVE%" "%INST%" "%MODS%" "%CAD%" "%TIT%" > "%TEMP%\licencia-leva.txt"
type "%TEMP%\licencia-leva.txt"
findstr /b "LEVA1." "%TEMP%\licencia-leva.txt" | clip
echo El codigo se ha copiado al portapapeles: pegalo en Configuracion ^> Modulos activos.
del "%TEMP%\licencia-leva.txt"
pause
