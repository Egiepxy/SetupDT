# SetupDT Robot EGI — LAB

Monitoramento automático de sinais técnicos do SetupDT, em modo somente leitura.

## Escopo desta versão

- Binance Spot pública, sem chave de API.
- Watchlist de 21 ativos EGI, configurada em `scripts/scan.mjs`.
- Candles fechados de 15m, 1h, 4h e 1d; preço atual usado apenas para invalidar ou marcar entrada perdida/aguardando pullback.
- Espelha o cálculo-base do SetupDT V1.9.52 para tendência, escore, RSI, ATR, checklist 6/6, fluxo EGI e níveis técnicos.
- Grava a última leitura e o histórico em `state.json`.
- Não envia ordens nem configura notificações externas.

## Situação do sinal

O campo `status` pode indicar observação, preparação, espera de fluxo, candidato técnico, entrada perdida, invalidação ou falta de dados. Um candidato técnico **não é liberação de entrada**: os filtros completos de risco, Triple Screen, disciplina local e janela operacional do app principal ainda precisam ser conferidos nele. O monitor grava `fullSetupDTApproval: false` e `execution: "NONE"` em todas as leituras.

## Agenda

O workflow propõe execução a cada 15 minutos, nos minutos 7, 22, 37 e 52 UTC. O arquivo de workflow está nesta branch LAB. O agendamento recorrente do GitHub só começa depois que o workflow estiver presente na branch padrão `main`; antes disso, a execução manual pelo GitHub Actions é a única opção.

Para cada execução, o workflow consulta o código desta branch e salva o estado de volta em `lab/setupdt-robot/state.json`. Nenhum arquivo da aplicação SetupDT de produção é alterado.

## Limitações conhecidas

- A fonte é Binance Spot; SHORT é leitura direcional, não posição vendida disponível no Spot.
- O serviço salva o estado no GitHub, mas não envia push ao telefone. A escolha e configuração de um canal de alerta fica para uma etapa posterior.
- A agenda do GitHub pode atrasar execuções. Não é um feed de ticks nem garantia de execução no segundo exato.
- Falhas de API por ativo são registradas como `SEM DADOS`; não são convertidas em sinais.
