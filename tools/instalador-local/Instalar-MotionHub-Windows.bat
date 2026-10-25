@echo off
chcp 65001 >nul
title Megalume Motion Hub - Instalacao local
echo.
echo  ==============================================
echo   MEGALUME MOTION HUB - instalacao local
echo   Biblioteca em C:\MotionHub (sem rede)
echo  ==============================================
echo.
set "ORIGEM=%~dp0biblioteca"
set "DESTINO=C:\MotionHub"

if not exist "%ORIGEM%" (
  echo [ERRO] Pasta "biblioteca" nao encontrada ao lado deste arquivo.
  pause
  exit /b 1
)

echo [1/2] Copiando efeitos para %DESTINO% ...
rem /E inclui subpastas; /XO nao sobrescreve arquivos mais novos; mantem efeitos ja existentes.
robocopy "%ORIGEM%" "%DESTINO%" /E /XO /NFL /NDL /NJH /NP
if %ERRORLEVEL% GEQ 8 (
  echo [ERRO] Falha ao copiar. Verifique o espaco em disco e as permissoes.
  pause
  exit /b 1
)
echo       Efeitos copiados.
echo.

echo [2/2] Plugin do Premiere ...
set "CCX="
for %%F in ("%~dp0*.ccx") do set "CCX=%%~fF"
if defined CCX (
  echo       Abrindo o instalador do plugin. Confirme no Creative Cloud clicando em "Instalar".
  start "" "%CCX%"
) else (
  echo       Nenhum arquivo .ccx encontrado ao lado deste instalador.
  echo       Se o plugin ja estiver instalado, tudo certo. Caso contrario, veja LEIA-ME.txt.
)
echo.
echo  Pronto! No Premiere: Janela ^> Plugins UXP ^> Motion Hub
echo  Na primeira vez, clique em "Escolher pasta da biblioteca" e selecione C:\MotionHub
echo.
pause
