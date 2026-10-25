#!/bin/bash
# Megalume Motion Hub - instalação local (sem rede). Biblioteca em /Users/Shared/MotionHub
cd "$(dirname "$0")" || exit 1
ORIGEM="$(pwd)/biblioteca"
DESTINO="/Users/Shared/MotionHub"

echo ""
echo " =============================================="
echo "  MEGALUME MOTION HUB - instalação local"
echo "  Biblioteca em $DESTINO (sem rede)"
echo " =============================================="
echo ""

if [ ! -d "$ORIGEM" ]; then
  echo "[ERRO] Pasta 'biblioteca' não encontrada ao lado deste arquivo."
  read -r -p "Pressione Enter para fechar..." _
  exit 1
fi

echo "[1/2] Copiando efeitos para $DESTINO ..."
mkdir -p "$DESTINO"
# -u: não sobrescreve arquivos mais novos; mantém efeitos já existentes.
if command -v rsync >/dev/null 2>&1; then
  copiar() { rsync -a -u "$ORIGEM/" "$DESTINO/"; }
else
  copiar() { cp -R -p "$ORIGEM/." "$DESTINO/"; }
fi
if ! copiar; then
  echo "[ERRO] Falha ao copiar. Verifique o espaço em disco."
  read -r -p "Pressione Enter para fechar..." _
  exit 1
fi
chmod -R a+rwX "$DESTINO" 2>/dev/null
echo "      Efeitos copiados."
echo ""

echo "[2/2] Plugin do Premiere ..."
CCX="$(ls ./*.ccx 2>/dev/null | head -n 1)"
if [ -n "$CCX" ]; then
  echo "      Abrindo o instalador do plugin. Confirme no Creative Cloud clicando em \"Instalar\"."
  open "$CCX"
else
  echo "      Nenhum arquivo .ccx encontrado ao lado deste instalador."
  echo "      Se o plugin já estiver instalado, tudo certo. Caso contrário, veja LEIA-ME.txt."
fi
echo ""
echo " Pronto! No Premiere: Janela > Plugins UXP > Motion Hub"
echo " Na primeira vez, clique em \"Escolher pasta da biblioteca\" e selecione $DESTINO"
echo ""
read -r -p "Pressione Enter para fechar..." _
