# SetupDT EGI V3.6 LAB — auditoria explicável

Escopo estritamente de diagnóstico: **não altera o motor, não envia ordens, não publica na produção**.

## Evidência do diagnóstico V3.5 (22/11/2026 UTC)
304 registros, 304 chaves únicas, 74 ativos, 33 checklists 6/6, 151 checklists 5/6, 4 technicalTradable, 0 tradable, 300 janelas não avaliadas e 4 WAITING_FLOW (BOME, MET, NIL, PENDLE). Os números vêm do JSON fornecido pelo usuário, não de execução GitHub Actions.

O mesmo ativo pode ter registros com chaves diferentes. Não agregar por ativo antes de auditar cada chave.

## Execução local
```bash
node lab/setupdt-v36/auditoria.test.mjs
node lab/setupdt-v36/auditoria.mjs SetupDT_V3_5_LAB_diagnostico.json > relatorio-v36.json
```

A análise separa checklist, Triple Screen, liquidez, fluxo, janela e autorização. **NOT_EVALUATED não é prova de defeito**: pode representar short-circuit por filtro anterior. Os rótulos do Professor são explicativos, não sinais de entrada.

## Pendências antes de qualquer correção no motor
1. Identificar a versão exata do HTML V3.5 em execução (o repositório possui versões antigas e arquivos de teste).
2. Verificar a ordem real dos filtros e distinguir `preFlowTradable`, `technicalTradable` e `tradable`.
3. Comparar cada uma das 33 chaves 6/6 com o candle fechado, liquidez, Triple Screen e confirmação de fluxo.
4. Executar autotestes em ambiente real; não reduzir filtros para aumentar artificialmente os sinais.
5. Somente após falha reproduzível, corrigir em LAB, mantendo histórico e produção intocados.
