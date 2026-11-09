#!/bin/zsh
# Cria a chave de acesso da API, grava como secret no Worker, espera o HTTPS
# ficar pronto e migra os dados da planilha. A chave NÃO aparece na tela:
# ela vai só para o Worker e para a sua área de transferência.
set -euo pipefail

API_URL="https://gerenciador-canais-api.gerenciador-canais-api.workers.dev"
RAIZ="${0:A:h:h}"
WRANGLER="$RAIZ/worker/node_modules/.bin/wrangler"

cd "$RAIZ/worker"

if "$WRANGLER" secret list 2>/dev/null | grep -q '"API_KEY"'; then
  echo "O Worker já tem uma API_KEY. Para migrar com ela, rode:"
  echo "  cd \"$RAIZ\" && API_URL=$API_URL API_KEY=\$(pbpaste) node scripts/migrar-planilha.mjs"
  exit 1
fi

KEY="$(openssl rand -hex 24)"
echo "1/3 Gravando a chave no Worker..."
printf '%s' "$KEY" | "$WRANGLER" secret put API_KEY >/dev/null
printf '%s' "$KEY" | pbcopy
echo "    ok (chave copiada para a área de transferência)"

echo "2/3 Esperando o certificado HTTPS do Worker (pode levar alguns minutos)..."
for i in {1..120}; do
  if curl -s -m 10 -o /dev/null "$API_URL/api/data"; then
    echo "    ok"
    break
  fi
  if [[ $i -eq 120 ]]; then
    echo "    o HTTPS ainda não respondeu após 30 min. A chave está na área de transferência;"
    echo "    depois rode: cd \"$RAIZ\" && API_URL=$API_URL API_KEY=\$(pbpaste) node scripts/migrar-planilha.mjs"
    exit 1
  fi
  sleep 15
done

echo "3/3 Migrando os dados da planilha..."
cd "$RAIZ"
API_URL="$API_URL" API_KEY="$KEY" node scripts/migrar-planilha.mjs

echo
echo "Pronto. A chave está na sua área de transferência: salve agora no seu gerenciador de senhas."
echo "O app vai pedir essa chave na primeira vez que abrir em cada navegador."
