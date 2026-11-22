# Execução local de validação — SetupDT V3.6 LAB (22/11/2026)

Fonte: arquivo original `SetupDT_V3_5_LAB_diagnostico.json` fornecido pelo usuário (não armazenado neste repositório).

- Executada localmente, com Node.js v22, a lógica de `auditoria.mjs` e suas 6 asserções internas: **PASS**.
- Processados 304 registros e 304 chaves distintas; 33 checklists 6/6; 4 WAITING_FLOW; 4 technicalTradable; 0 tradable; 300 janelas não avaliadas.
- WAITING_FLOW: BOME, MET, NIL, PENDLE. Nenhuma autorização inconsistente identificada pelas regras atuais do verificador.
- Entre os 33: Triple Screen 0/100: 4; 30/100: 13; 40/100: 3; 60/100: 3; 70/100: 5; trecho Triple Screen ausente: 5.
- Esta execução **não** comprova os testes de navegador, nem a validade do motor V3.5; não houve alteração de filtros.

## Localização do HTML
`public/index.html` está identificado pelo título como **SetupDT Light Multi-Exchange V1.9.52**, não V3.5. `public/SetupDT_MME1_Teste.html` é V1.9.51. A pesquisa de código encontrou `applyFlowGate`, `preFlowTradable` e `applyLiveEntryFilter` em arquivos históricos/teste, mas **não foi possível provar qual HTML produziu o JSON V3.5**. Necessário confirmar origem e hash do aplicativo em execução antes de editar.

## Segurança
Produção `main` não alterada; histórico original preservado; nenhuma ordem enviada. Correções no motor dependem de falha reproduzível.
