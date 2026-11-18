# Auditoria comparativa V9.1.1 × V9.3 LAB — 18/11/2026
## Evidências
Main public/index6.html blob de0e92badcbe54f17d052472dbf34837726a9e51.
LAB public/index6-v93-lab.html blob 3e73f7f53f23e9a5f0503d9e3cf599ce97f8a15d.
Prefixo original idêntico antes da inserção do módulo. Nenhuma alteração main.
## Testes executados
Funções reais extraídas dos dois arquivos e executadas em JavaScript isolado, não em navegador.
4/4: filtro fechado, EMA constante, lateralidade, stop prioritário.
Cenários sintéticos, 150 candles, últimos 80 no original conforme sua coleta; mesmo fechamento. Preço-base 100, últimos 3 candles deslocados 0,8 por barra; volume-base 100; tolerância 0,2%, stretch 2%; spread e liquidez simulados.
| Cenário | Original | LAB |
|---|---|---|
| Lateral | LATERAL | COMPRESSÃO |
| Alta volume 3x | PREPARAR | RETOMADA LONG |
| Baixa volume 3x | PREPARAR | RETOMADA SHORT |
| Alta volume 1x | PREPARAR | TRANSIÇÃO |
| Baixa volume 1x | PREPARAR | TRANSIÇÃO |
## Divergências e limitações
LAB usa MME80, compressão <=0,6 ATR, expansão e volume >=1,3x; stop experimental 1 ATR. Original usa pullback, rejeição, inclinação, pivô confirmado e RelOk. Retomada não equivale a entrada aprovada. Guardas de fechamento diferem (original 1400ms; LAB sem guarda). LAB solicita 300 candles, original 80; teste sintético com 150 disponíveis. Não demonstrada antecipação temporal nem rentabilidade. Coleta real falhou por DNS nos dois hosts Binance. Interface, persistência e regressão completa no navegador pendentes. Código original embutido ainda usa chaves legadas de armazenamento; testar em perfil separado para não afetar histórico local. Recomenda-se alinhar guarda temporal, comparar por timestamp e implementar exportação de relatório por símbolo antes de promover.
