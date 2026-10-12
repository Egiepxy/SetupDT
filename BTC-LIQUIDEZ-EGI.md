# BTC LIQUIDEZ EGI — SetupDT V1.9.45

## O que foi acrescentado
- Painel dentro de `public/index.html`, acima da seção Telegram.
- `public/btc-liquidez.js`: consulta o servidor para exibir preço, maior faixa de ordens compradoras abaixo, maior faixa vendedora acima, distâncias, força relativa e desequilíbrio.
- `btc-liquidez-server.js`: lê exclusivamente o livro de ofertas público Binance Spot (`BTCUSDT`, até 1.000 níveis por lado), agrega faixas de US$100 e publica `GET /api/btc-liquidity`.
- Identifica valores estimados do livro visível em USDT. **Não é mapa de liquidações em futuros** e não contém ordens escondidas nem estimativa de preço-alvo.
- Link para mapa de liquidações externo, como fonte separada.

## Telegram (servidor Render)
Aproveita o bot já existente no `server.js`, usando `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` ou `TELEGRAM_CHAT_IDS`. Nunca inclua estes valores no HTML nem no GitHub.

O monitor começa com o servidor. Por padrão, quando existe Telegram configurado:
- Scan Binance Spot a cada **90 segundos**.
- Avisa quando uma parede **persistir em duas leituras**, apresentar força relativa **>= 2 vezes** a mediana das faixas visíveis e o BTC estiver a **até 0,40%** da faixa.
- Um aviso por lado; cooldown de **90 minutos**, rearmando somente quando o BTC se afasta e se aproxima novamente.
- O primeiro scan **não** dispara alertas; falhas são exibidas e dados vencidos não são tratados como atuais.
- Sem trade automático. Este indicador **não** altera semáforo, checklist ou outros sinais existentes.

Configuração opcional no ambiente Render:

| Variável | Valor padrão | Uso |
|---|---|---|
| `BTC_LIQUIDITY_ALERTS_ENABLED` | `true` | `false` pausa envios, mantendo o quadro |
| `BTC_LIQUIDITY_ALERT_PCT` | `0.4` | Distância percentual, limitada a 0,1–2 |
| `BTC_LIQUIDITY_COOLDOWN_MIN` | `90` | Intervalo mínimo 30–1440 minutos por lado |
| `BTC_LIQUIDITY_INTERVAL_MS` | `90000` | Frequência 60–600 segundos |

## Validação no Render
1. Faça redeploy da branch `main` do repositório `Egiepxy/SetupDT`.
2. Abra `https://SEU-RENDER/api/health` e confira `telegramConfigured: true`.
3. Abra `https://SEU-RENDER/api/btc-liquidity` e confira `ok: true`, `kind: visible_orderbook_not_liquidations`, `stale: false`.
4. Abra o SetupDT pelo Render, confira o novo painel e toque em **Atualizar**. Os dados exibem a data de leitura de São Paulo.
5. O envio real ao Telegram depende de dados válidos e aproximação material; não é correto forçar um alerta que não aconteceu.

**Atenção**: Render gratuito pode hibernar instâncias ociosas e interromper as consultas e alertas. Armazenamento efêmero pode zerar cooldown/histórico após redeploy. Para monitoramento contínuo e persistência, use serviço sempre ativo e disco persistente (`SETUPDT_DATA_DIR`).
