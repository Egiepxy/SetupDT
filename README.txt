SetupDT Light L26 — pacote para Render

1. Envie os arquivos desta pasta (package.json, server.js e public/index.html) para a RAIZ de um repositorio GitHub.
2. Render > New > Web Service > conectar repositorio.
3. Branch: main; Root Directory: deixar vazio; Build Command: npm install; Start Command: npm start.
4. Abra o URL gerado pelo Render e teste analise, grafico e backup/restauracao.

O arquivo original SetupDT_L26.html foi copiado sem alteracoes para public/index.html.
A aplicacao consulta a API publica Binance Spot no navegador; disponibilidade depende da rede e da API.
Lista e diario ficam no armazenamento local do navegador, nao no servidor. Exporte backup JSON antes de trocar de dispositivo/dominio.
Este pacote hospeda o app, mas NAO inclui monitor Telegram em segundo plano. Render gratuito pode suspender instancias ociosas.
