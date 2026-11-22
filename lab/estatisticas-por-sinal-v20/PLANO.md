# SetupDT Light — Estatísticas por sinal V2.0 LAB

Branch: lab/estatisticas-por-sinal-v20
Origem: main
Arquivo-alvo: public/index.html (V1.9.52 no momento da inspeção)

## Escopo
- Auditar antes de editar: diário, painel Resultados, egiSignalAudit, persistência e exportação.
- Registrar snapshot imutável do sinal: id determinístico (mercado, ativo, timeframe, estratégia, candle fechado, direção, versão); horário UTC, checklist 0–6, score, força, motivo de bloqueio, preços e fonte dos candles.
- Separar sinais observados/bloqueados de entradas autorizadas; nunca somar ganhos hipotéticos a P&L.
- Auditar 1, 2, 4 e 8 candles posteriores **fechados**, com preços e fonte verificáveis, sem look-ahead.
- Por moeda, direção, checklist, estratégia e faixa de força: N, cobertura auditada, favorável/contrário/neutro, MFE/MAE; acerto, payoff e R apenas com entrada, stop e saída válidos.
- Comparar bloqueios vs autorizados com critérios idênticos; marcar amostra insuficiente e ausência de dados.
- Preservar históricos e backups, sem migração destrutiva, sem ordens reais.
- Corrigir apenas defeitos comprovados, nunca escrever em main.
## Caso de referência
BTC/USDT Spot, 2026-11-22 07:57 BRT, SHORT rastreador 70%, checklist 2/6, qualidade 42/100, RSI 15m 78.9, KDJ SHORT 5/5; observação, não entrada.
## Testes de aceite
1. Mesmo sinal em varreduras repetidas não duplica.
2. Candles anteriores ou ainda abertos não entram no resultado.
3. Sem stop ou entrada válida: R indisponível.
4. Backups antigos continuam legíveis e não são sobrescritos.
5. Denominadores são exibidos por grupo; nenhuma taxa sem N.
6. Divergências de volume Spot/Futures ficam explicitadas.
7. Interface móvel e demais botões existentes preservados.
8. Nenhuma requisição de ordem ou envio de segredo.
## Estado
Especificação registrada. Implementação e autotestes ainda pendentes.
