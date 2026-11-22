/* SetupDT V3.6 LAB — identificador local de HTML, sem rede e sem alterações.
 Uso: node lab/setupdt-v36/identificar-html.mjs caminho/para/app.html
 A impressão digital SHA-256 permite vincular o diagnóstico à versão exata do HTML.
*/
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

export function inspectHtml(html, filename='desconhecido.html') {
  assert.equal(typeof html,'string');
  const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'').replace(/\s+/g,' ').trim();
  const markers=['technicalTradable','preFlowTradable','applyFlowGate','applyLiveEntryFilter','WAITING_FLOW','Triple Screen','SetupDT EGI V3.5'].filter(s=>html.includes(s));
  return {filename:path.basename(filename),title,sha256:crypto.createHash('sha256').update(html).digest('hex'),bytes:Buffer.byteLength(html),markers,compatibleForComparison:markers.includes('applyLiveEntryFilter')&&markers.includes('WAITING_FLOW'),warning:'Correspondência de marcadores não comprova que este HTML produziu o JSON.'};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 if(!process.argv[2]){console.error('Uso: node identificar-html.mjs arquivo.html');process.exitCode=1;}
 else console.log(JSON.stringify(inspectHtml(fs.readFileSync(process.argv[2],'utf8'),process.argv[2]),null,2));
}
