@echo off
rem Sobe o protótipo do Brechó Digital em http://localhost:5173
cd /d "%~dp0"
echo.
echo   Brecho Digital - http://localhost:5173
echo   Modo administrador - http://localhost:5173/?admin=1
echo   (feche esta janela para desligar o servidor)
echo.
start "" http://localhost:5173
python tools\servidor.py 5173
