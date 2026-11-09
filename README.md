# Gerenciador de Canais YouTube (Lite)

Projeto simplificado em HTML + CSS + JavaScript, pronto para GitHub Pages.

## Funcionalidades
- Cadastro de canais
- Planejamento de vídeos
- Checklist de produção
- Dashboard com total de vídeos publicados por canal
- Salvamento automático no navegador (`localStorage`)

## Rodar localmente (sem instalar nada)
Abra o arquivo `index.html` no navegador.

## Publicar no GitHub Pages
1. Suba os arquivos para um repositório no GitHub.
2. No repositório, vá em **Settings > Pages**.
3. Em **Build and deployment**, selecione:
	- **Source**: `Deploy from a branch`
	- **Branch**: `main` (ou `master`), pasta `/ (root)`
4. Salve e aguarde a URL do Pages ser gerada.

Arquivos principais usados no deploy:
- `index.html`
- `styles.css`
- `app.js`

## Banco de dados (SQLite na nuvem — Cloudflare D1)

Os dados ficam num banco SQLite no **Cloudflare D1**, acessado por um pequeno **Worker** (`worker/`).
O navegador nunca fala direto com o banco: toda chamada passa pelo Worker, que exige uma **chave de acesso**.
A chave fica guardada só no navegador de quem usa (pedida na primeira vez) e **não** vai para o código.

### Estrutura
- `worker/src/index.js` — API (`GET /api/data`, `PUT/DELETE /api/canais/:id`, `PUT/DELETE /api/videos/:id`, `POST /api/import`)
- `worker/migrations/0001_inicial.sql` — tabelas `canais` e `videos`
- `scripts/migrar-planilha.mjs` — copia os dados da planilha Google antiga para o banco

### Rodar localmente
```bash
cd worker
npm install
printf 'API_KEY=teste-local-gerenciador\n' > .dev.vars   # chave só para testes locais
npx wrangler d1 migrations apply gerenciador-canais --local
npx wrangler dev --port 8789
```
Em outro terminal, sirva o site (ex.: `npx http-server . -p 8751`) e abra `http://localhost:8751`.
Em `localhost` o app usa a API em `http://localhost:8789` automaticamente.

### Publicar na Cloudflare (uma vez)
```bash
cd worker
npx wrangler login
npx wrangler d1 create gerenciador-canais          # copie o database_id para o wrangler.toml
npx wrangler d1 migrations apply gerenciador-canais --remote
npx wrangler secret put API_KEY                     # digite uma chave forte
npx wrangler deploy                                 # mostra a URL *.workers.dev
```
Depois cole a URL do Worker em `API_URL_PRODUCAO` no `app.js` e publique o site.

### Migrar os dados da planilha
```bash
API_URL=https://gerenciador-canais-api.SEU-USUARIO.workers.dev API_KEY=SUA_CHAVE node scripts/migrar-planilha.mjs
```
A planilha só é lida; nada é apagado nela.

### Observações
- Cada alteração (criar, editar, marcar checklist, excluir) é gravada na hora, registro por registro.
- O navegador guarda uma cópia dos dados (`localStorage`) para abrir rápido e para consulta se a API cair.
- O botão **Recarregar dados** busca de novo o que está no banco.
- `google-apps-script.gs` ficou só como referência da integração antiga com a planilha.
