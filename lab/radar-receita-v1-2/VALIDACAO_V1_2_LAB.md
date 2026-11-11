# Radar Receita EGI V1.2 LAB — Relatório de validação (11/11/2026)

## Arquivos
- `index21_V1_1_BACKUP.html`: cópia integral da produção no início do trabalho.
- `index21_V1_2_LAB.html`: candidato de testes, sem alteração do `public/index21.html`.

## Implementado
1. Visualização da receita 7d / 30d / 90d para o líder do filtro. **90d aparece como n/d quando não fornecido pela fonte**; não extrapola.
2. TOP 6 por score preexistente, identificado como heurístico e sujeito à qualidade dos dados.
3. Auditoria manual: emissões/desbloqueios e queimas (mesma janela 7/30/90 dias), data e URL de evidência obrigatórias para números de oferta; saldo líquido calculado em tokens.
4. Rótulo 'DECLARADO_NAO_VALIDADO': URL informada não significa que o aplicativo verificou a prova.
5. Histórico JSON V1.2 separado da persistência de favoritos/auditorias V1.1; até 60 snapshots compactos, exportação e importação; não registra demonstração fictícia.
6. Preservados estudo GEOD, leitura de áudio, CSV, favoritos, auditoria original, filtro, atualização DefiLlama e consulta opcional CoinGecko.

## Testes concluídos
- 15/15 verificações estáticas passaram.
- Ambos os scripts embutidos compilaram sem erro sintático em parser JavaScript.
- Todos os IDs usados por `$('...')` possuem elementos no HTML.
- SHA da produção observado: `08d2f001043d8c9aae744b038caad86f8d8477fc` (sem atualização).
- Validação estática **não equivale** a teste de interface ou integração com APIs reais.

## Testes manuais obrigatórios antes de publicar
- Abrir arquivo em Chrome/Windows e Android; checar tela mobile, áudio GEOD e botões existentes.
- Atualizar com internet; confirmar resposta da DefiLlama, conferir 7d, 30d e 90d com a resposta bruta e verificar campos 'n/d'.
- Testar modo Demonstração: não deve gerar snapshot de dados reais.
- Registrar auditoria com e sem URL/data; campos incompletos devem ser recusados.
- Exportar/importar JSON V1.2; confirmar persistência após reabrir arquivo.
- Exportar/importar favoritos no formato antigo V1; verificar nenhuma perda.
- Testar limite de armazenamento e ausência de internet.
- Validar as fontes de emissões/queimas manualmente, incluindo igualdade das unidades e das janelas de medição.

## Limitações assumidas
- API pública pode não fornecer a receita de 90d; mostra 'n/d' em vez de valores inventados.
- Não consulta automaticamente eventos de desbloqueio, emissões ou queimas em blockchain.
- A auditoria de URL é formal (sintaxe), não valida semanticamente o conteúdo.
- O TOP 6 é de **investigação fundamentalista** e não confirma entrada técnica.
- Não envia ordens, não altera `public/index21.html`.
