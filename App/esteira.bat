@echo off
rem Esteira de pecas: a pagina daqui, a API da nuvem (contas e acervo de verdade).
cd /d "%~dp0"
echo.
echo   Esteira de pecas - http://localhost:5173/esteira.html
echo   (feche esta janela para desligar)
echo.
start "" http://localhost:5173/esteira.html
python tools\servidor.py 5173 --nuvem
