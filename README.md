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

## Salvar dados na sua planilha Google

Para salvar automaticamente na planilha, use Google Apps Script (arquivo pronto: `google-apps-script.gs`).

### 1) Vincular Apps Script à planilha
1. Abra sua planilha Google.
2. Vá em **Extensões > Apps Script**.
3. Apague o conteúdo padrão e cole o código de `google-apps-script.gs`.
4. Clique em **Implantar > Nova implantação > App da Web**.
5. Execute como: **Você**.
6. Quem tem acesso: **Qualquer pessoa com o link**.
7. Copie a URL do app da web.

### 2) Conectar no app
1. Abra `app.js`.
2. Edite esta linha:
	 - `const SHEETS_WEB_APP_URL = '';`
3. Cole a URL do Apps Script entre aspas.

### 3) Estrutura criada na planilha
O script cria/atualiza 3 abas:
- `Canais`
	- `id, nome, url, nicho, descricao, updatedAt`
- `Videos`
	- `id, titulo, canalId, dataPublicacao, status, roteiro, gravacao, edicao, thumbnail, publicado, url, notas, updatedAt`
- `LogSync`
	- `timestamp, source, canais, videos`

### Observações
- O app continua salvando localmente no navegador (`localStorage`).
- Ao salvar/editar/excluir, ele sincroniza automaticamente com a planilha.
- Você também pode usar o botão **Sincronizar Planilha**.
- Ao abrir o app, ele tenta carregar os dados da planilha automaticamente.

### Importante após alterar o script
Sempre que editar o Apps Script, faça uma nova implantação da versão web:
1. **Implantar > Gerenciar implantações**
2. Edite a implantação ativa e selecione **Nova versão**
3. Salve para publicar as mudanças
