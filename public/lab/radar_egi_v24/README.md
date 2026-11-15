# Radar EGI V2.4 LAB — auditoria experimental

Branch exclusiva: `lab/radar-egi-v24`. Arquivos em `public/lab/radar_egi_v24/`.
V2.3 em `lab/radar-egi-v23` e produção `main` não são alterados.

## Escopo
- Varredura BTC, XRP, LINK, ETH, SOL, ONDO em candles fechados 15m/1h/2h/4h.
- Alertas de **observação**, não de entrada; nenhum envio de ordens.
- Cada evento V2.4 pode virar uma operação **simulada**, se o fechamento do próximo candle 15m superar o preço do sinal. Se não confirmar, registra INVALIDADO.
- Entrada simulada no fechamento de confirmação; stop = entrada menos ATR14 em 15m; metas fixas 1R, 2R e 3R.
- Mede toques nas metas separadamente e resultado realizado: stop -1R, 3R +3R, ou expiração após 48 candles pelo fechamento. Se stop e alvo forem tocados na mesma vela, o stop prevalece. Não há custos, spread, slippage nem ordens reais.
- Nenhum candle futuro é usado para definir entrada/stop/target; avaliação de resultados só após o fechamento da vela de entrada.
- Observações herdadas da V2.3 **não entram** na avaliação para evitar retrospectiva contaminada.
- Relatório `audit` por ativo: amostra de operações encerradas, acerto, payoff, total R, toques 1R/2R/3R, abertos e invalidados. Sem operações encerradas => taxa de acerto nula, jamais 100%.
- Professor pós-sinal explica pendente, invalidado, aberto, stop, 3R e expiração.
- `state.json` guarda eventos, trades simulados, auditoria e 90 snapshots no campo `history`. Faça backup JSON antes de resetar ou trocar branch.
- `ntfyTest` registra dry-run no tópico `RadarIA_11` por padrão.

## Testes
```bash
cd public/lab/radar_egi_v24
python -m unittest -v tests.py
```

## Notificações
Sempre desligadas por padrão. O fluxo de teste do ntfy é **dry-run**.
Para mandar mensagem TESTE (não um sinal), precisa configurar simultaneamente
`ENABLE_NTFY=true` e `NTFY_TEST=true` no ambiente de execução.
**Não habilite essas flags por acidente.** O workflow padrão mantém ambas falsas.

## Segurança
Código experimental; não executar ordens e não usar taxas de acerto sem tamanho da amostra.
A versão V2.4 não modifica nem importa `state.json` da V2.3.
