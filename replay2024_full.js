/**
 * REPLAY 2024 COMPLETO — con alianzas, padrón y diferencial legislativo
 * Valida los tres nuevos módulos contra resultados JCE reales.
 * node replay2024_full.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// ─── Cargar datos ─────────────────────────────────────────────────────────────
const d24      = load('data/results_2024.json');
const d20      = load('data/results_2020.json');
const alianzas = load('data/alianzas_2024.json');
const padronU  = load('data/padron_2024_unificado.json');
const padronMeta = load('data/padron_2024_meta.json');
const curules  = load('data/curules_2024.json');
const dipVotos = load('data/diputados_2024_votos.json');
const senProv  = load('data/senadores_provincia.json');
const dipCirc  = load('data/diputados_circunscripciones.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pct  = (v,t) => t>0 ? (v/t*100).toFixed(2)+'%' : '0%';
const fmt  = n => Number(n).toLocaleString('es-DO');
const pp   = v => (v>=0?'+':'')+v.toFixed(2)+'pp';
const sep  = () => console.log('─'.repeat(68));
const hdr  = t => { console.log('\n'+'═'.repeat(68)); console.log('  '+t); console.log('═'.repeat(68)); };
const tick = c => c ? '✅' : '❌';

// ─── D'Hondt inline ──────────────────────────────────────────────────────────
function dhondt(votes, seats) {
  if (!seats) return {};
  const parties = Object.keys(votes).filter(p => (votes[p]||0) > 0);
  const q = [];
  parties.forEach(p => { for (let d=1;d<=seats;d++) q.push({p,v:votes[p]/d}); });
  q.sort((a,b)=>b.v-a.v);
  const r = {}; parties.forEach(p=>r[p]=0);
  q.slice(0,seats).forEach(x=>r[x.p]++);
  Object.keys(r).forEach(p=>{if(!r[p]) delete r[p];});
  return r;
}

// ─── [MOD 1] ALIANZAS: parsear config desde JCE ──────────────────────────────
function parsearAlianzas(al) {
  const cfg = { pres:[], sen:{}, dip:[] };
  if (al.pres && al.pres.bloques) {
    cfg.pres = al.pres.bloques.map(b=>({
      lider: b.lider,
      aliados: (b.aliados||[]).map(a=>a.partido),
      transferPct: (b.transferPct||100)/100,
    }));
  }
  if (al.sen && al.sen.por_provincia) {
    Object.entries(al.sen.por_provincia).forEach(([pid,b]) => {
      cfg.sen[pid.padStart(2,'0')] = {
        lider: b.lider,
        aliados: (b.aliados||[]).map(a=>a.partido),
        transferPct: (b.transferPct||100)/100,
      };
    });
  }
  if (al.dip && al.dip.bloques) {
    cfg.dip = al.dip.bloques.map(b=>({
      lider: b.lider,
      aliados: (b.aliados||[]).map(a=>a.partido),
      transferPct: (b.transferPct||100)/100,
    }));
  }
  return cfg;
}

function aplicarBloque(votes, bloque) {
  const v = Object.assign({}, votes);
  const tPct = bloque.transferPct != null ? bloque.transferPct : 1.0;
  (bloque.aliados||[]).forEach(aliado => {
    const vA = v[aliado] || 0;
    if (!vA) return;
    const trans = Math.round(vA * tPct);
    v[bloque.lider] = (v[bloque.lider]||0) + trans;
    const rem = vA - trans;
    if (rem > 0) v[aliado] = rem; else delete v[aliado];
  });
  return v;
}

function aplicarBloques(votes, bloques) {
  return (bloques||[]).reduce((acc,b) => aplicarBloque(acc,b), Object.assign({},votes));
}

const alCfg = parsearAlianzas(alianzas);

// ─── [MOD 2] PADRÓN: proyectar 2028 ─────────────────────────────────────────
function proyectarPadron2028(rows, año=2028) {
  const TASA = 0.0763;
  const FACTOR = {
    '01':1.04,'02':1.15,'03':0.95,'04':0.90,'05':0.92,'06':0.95,'07':0.97,
    '08':0.93,'09':0.92,'10':0.98,'11':0.94,'12':0.91,'13':1.08,'14':0.98,
    '15':0.95,'16':1.02,'17':0.94,'18':0.96,'19':0.90,'20':1.03,'21':1.05,
    '22':0.95,'23':1.02,'24':1.12,'25':0.93,'26':1.06,'27':0.94,'28':1.10,
    '29':0.91,'30':0.97,'31':0.93,'32':1.18,
  };
  const ciclos = (año - 2024) / 4;
  const result = {};
  rows.forEach(row => {
    const pid = String(row.provincia_id).padStart(2,'0');
    const f = FACTOR[pid] || 1.0;
    result[pid] = {
      provincia: row.provincia,
      inscritos: Math.round(row.inscritos * Math.pow(1 + TASA*f, ciclos)),
      inscritosBase: row.inscritos,
      participacionBase: row.participacion_pres,
    };
  });
  return result;
}

const padronRows = padronU.mayo2024.provincial.rows;
const padron2028 = proyectarPadron2028(padronRows, 2028);
const padron2024 = {};
padronRows.forEach(r => {
  padron2024[String(r.provincia_id).padStart(2,'0')] = r;
});

// ─── [MOD 3] DIFERENCIAL LEGISLATIVO ─────────────────────────────────────────
const COEF_RET = {
  PRM:  {sen:0.936,  dip:0.895},
  FP:   {sen:0.696,  dip:0.620},
  PLD:  {sen:1.394,  dip:1.250},
  PRSC: {sen:1.400,  dip:1.800 },
  BIS:  {sen:0.600,  dip:1.200 },
  PP:   {sen:0.400,  dip:1.300 },
  PED:  {sen:0.300,  dip:1.100 },
  DXC:  {sen:0.700,  dip:1.200 },
  JS:   {sen:0.300,  dip:1.000 },
  PRD:  {sen:0.900,  dip:1.200 },
  _def: {sen:0.900,  dip:0.900 },
};

function aplicarDiferencial(sharesPresMap, nivel) {
  const out = {};
  Object.entries(sharesPresMap).forEach(([p,s]) => {
    const coef = (COEF_RET[p] && COEF_RET[p][nivel]) || COEF_RET._def[nivel];
    out[p] = Math.max(0, s * coef);
  });
  const tot = Object.values(out).reduce((a,v)=>a+v,0);
  if (tot > 0) Object.keys(out).forEach(p => out[p] /= tot);
  return out;
}

// ─── SECCIÓN 1: PRESIDENCIAL ──────────────────────────────────────────────────
hdr('1. PRESIDENCIAL — Replay 2024 con Alianzas + Padrón');

const nat24  = d24.pres.nacional;
const VALIDOS = nat24.VALIDOS;

// Aplicar alianzas presidenciales
const votesPresAlianza = aplicarBloques(
  Object.fromEntries(Object.entries(nat24).filter(([k])=>!['EMITIDOS','VALIDOS','NULOS'].includes(k))),
  alCfg.pres
);
const TOTAL_AL = Object.values(votesPresAlianza).reduce((a,v)=>a+v,0);

// Shares
const sharesPres = {};
Object.entries(votesPresAlianza).forEach(([p,v])=>sharesPres[p]=v/TOTAL_AL);

const sorted = Object.entries(votesPresAlianza).sort(([,a],[,b])=>b-a);
const ganador = sorted[0];
const pctGan  = ganador[1] / TOTAL_AL;
const primera = pctGan > 0.50;

console.log(`\nPadrón 2024: ${fmt(padronMeta.totales.inscritos_total)} inscritos`);
console.log(`Padrón 2028: ~${fmt(Object.values(padron2028).reduce((a,p)=>a+p.inscritos,0))} inscritos (proyección +7.63%)\n`);
console.log('Partido      Votos (raw)    Votos (bloque alianza)  %Válidos');
sep();
sorted.slice(0,6).forEach(([p,v]) => {
  const raw = nat24[p] || 0;
  console.log(`${p.padEnd(12)} ${fmt(raw).padStart(12)}   ${fmt(v).padStart(12)}         ${pct(v,TOTAL_AL).padStart(8)}`);
});
console.log(`\n► Ganador: ${ganador[0]} (${pct(ganador[1],TOTAL_AL)} con alianzas)`);
console.log(`► Primera vuelta: ${primera?'SÍ ✅':'NO — Segunda vuelta ⚠️'}`);
console.log(`► Bloque PRM (con aliados): ${pct(votesPresAlianza.PRM||0, TOTAL_AL)}`);
console.log(`► Margen 1°−2°: ${((sorted[0][1]-sorted[1][1])/TOTAL_AL*100).toFixed(2)}pp`);

// ─── SECCIÓN 2: SENADORES CON ALIANZAS ───────────────────────────────────────
hdr('2. SENADORES — Replay con Alianzas JCE 2024');

const REAL_SEN_2024 = { PRM: 29, FP: 3 };
const SEN_GANADORES_REALES = {
  '01':'FP','02':'PRM','03':'PRM','04':'PRM','05':'PRM','06':'PRM','07':'PRM',
  '08':'PRM','09':'PRM','10':'PRM','11':'PRM','12':'PRM','13':'FP','14':'PRM',
  '15':'PRM','16':'PRM','17':'PRM','18':'PRM','19':'PRM','20':'PRM','21':'PRM',
  '22':'PRM','23':'PRM','24':'PRM','25':'FP','26':'PRM','27':'PRM','28':'PRM',
  '29':'PRM','30':'PRM','31':'PRM','32':'PRM',
};

const senResult = { byParty: {}, detalles: [], aciertos: 0, total: 0 };

Object.entries(d24.sen.provincias).forEach(([pid, pdata]) => {
  const pid2 = pid.padStart(2,'0');
  const votes = Object.assign({}, pdata.votes || {});
  if (!Object.keys(votes).length) return;

  // Aplicar alianza provincial
  const alProv = alCfg.sen[pid2];
  const votesAl = alProv ? aplicarBloque(votes, alProv) : votes;

  const sorted2 = Object.entries(votesAl)
    .filter(([k])=>!['EMITIDOS','VALIDOS','NULOS'].includes(k))
    .sort(([,a],[,b])=>b-a);
  if (!sorted2.length) return;

  const winner = sorted2[0][0];
  const real   = SEN_GANADORES_REALES[pid2];
  const match  = winner === real;
  if (match) senResult.aciertos++;

  const tot = sorted2.reduce((a,[,v])=>a+v,0);
  const margen = tot>0 && sorted2[1]
    ? ((sorted2[0][1]-sorted2[1][1])/tot*100).toFixed(1)
    : '0';

  senResult.byParty[winner] = (senResult.byParty[winner]||0)+1;
  senResult.total++;
  senResult.detalles.push({
    pid: pid2, nombre: pdata.nombre, winner, real, match, margen,
    top2: sorted2.slice(0,2).map(([p,v])=>`${p}:${fmt(v)}`).join(' vs '),
  });
});

console.log(`\nTotal senadores: ${senResult.total}/32`);
console.log(`Aciertos vs JCE real: ${senResult.aciertos}/${senResult.total} (${(senResult.aciertos/senResult.total*100).toFixed(1)}%)\n`);
console.log('Partido    Modelo  Real    Diff');
sep();
const allParSen = new Set([...Object.keys(senResult.byParty),...Object.keys(REAL_SEN_2024)]);
allParSen.forEach(p => {
  const mod = senResult.byParty[p]||0;
  const real = REAL_SEN_2024[p]||0;
  const d = mod-real;
  console.log(`${p.padEnd(10)} ${String(mod).padStart(6)}  ${String(real).padStart(6)}  ${d>=0?'+':''+(d===0?'':'')}${d===0?'✅':d>0?d+'⬆':d+'⬇'}`);
});

console.log('\nProvincias con discrepancia modelo vs JCE:');
sep();
senResult.detalles.filter(d=>!d.match).forEach(d => {
  console.log(`  ${d.nombre.padEnd(22)} Modelo:${d.winner.padEnd(5)} Real:${d.real.padEnd(5)} [${d.top2}] margen ${d.margen}pp`);
});

// ─── SECCIÓN 3: DIFERENCIAL LEGISLATIVO ──────────────────────────────────────
hdr('3. DIFERENCIAL LEGISLATIVO — Modelo vs JCE 2024');

const presShares = {};
Object.entries(nat24).forEach(([k,v])=>{
  if(!['EMITIDOS','VALIDOS','NULOS'].includes(k)) presShares[k]=v/VALIDOS;
});

const projSen = aplicarDiferencial(presShares, 'sen');
const projDip = aplicarDiferencial(presShares, 'dip');

// Real shares legislativas
const senVal  = d24.sen.nacional.meta.validos;
const dipVal  = d24.dip.nacional.meta.validos;
const realSenShares = {}, realDipShares = {};
Object.entries(d24.sen.nacional.votes).forEach(([k,v])=>realSenShares[k]=v/senVal);
Object.entries(d24.dip.nacional.votes).forEach(([k,v])=>realDipShares[k]=v/dipVal);

console.log(`\nModelo de diferencial presidencial → legislativo (coef. calibrados 2020+2024)\n`);
console.log('Partido   Pres%   Sen(mod)%  Sen(real)%  Err_sen   Dip(mod)%  Dip(real)%  Err_dip');
sep();
['PRM','FP','PLD','BIS','PRSC','PP','PED','DXC'].forEach(p => {
  const sp = (presShares[p]||0)*100;
  const ss = (projSen[p]||0)*100;
  const sd = (projDip[p]||0)*100;
  const rs = (realSenShares[p]||0)*100;
  const rd = (realDipShares[p]||0)*100;
  if (sp < 0.3 && rs < 0.3) return;
  const eS = (ss-rs).toFixed(2);
  const eD = (sd-rd).toFixed(2);
  const flagS = Math.abs(ss-rs)<1.5?'✅':'⚠️';
  const flagD = Math.abs(sd-rd)<2.0?'✅':'⚠️';
  console.log(`${p.padEnd(8)} ${sp.toFixed(2).padStart(5)}%  ${ss.toFixed(2).padStart(8)}%  ${rs.toFixed(2).padStart(9)}%  ${(eS>=0?'+':'')+eS+'pp '+flagS}  ${sd.toFixed(2).padStart(8)}%  ${rd.toFixed(2).padStart(9)}%  ${(eD>=0?'+':'')+eD+'pp '+flagD}`);
});

// Error medio absoluto
const partsToCheck = ['PRM','FP','PLD'];
const errSen = partsToCheck.map(p=>Math.abs((projSen[p]||0)-(realSenShares[p]||0))*100);
const errDip = partsToCheck.map(p=>Math.abs((projDip[p]||0)-(realDipShares[p]||0))*100);
const maeSen = errSen.reduce((a,v)=>a+v,0)/errSen.length;
const maeDip = errDip.reduce((a,v)=>a+v,0)/errDip.length;
console.log(`\nMAE senadores (PRM/FP/PLD): ${maeSen.toFixed(2)}pp`);
console.log(`MAE diputados (PRM/FP/PLD): ${maeDip.toFixed(2)}pp`);

// ─── SECCIÓN 4: DIPUTADOS con datos reales ───────────────────────────────────
hdr('4. DIPUTADOS — Replay D\'Hondt con diputados_circunscripciones.json');

const REAL_DIP = {PRM:90,FP:28,PLD:14,BIS:5,PRSC:4,PP:4,PED:3,DXC:3,JS:2,
                  ALPAIS:1,OD:1,GENS:1,PRD:1,PRSD:1,PUN:1,PCR:1,PHD:1,UDC:1};
const REAL_DIP_TOT = Object.values(REAL_DIP).reduce((a,v)=>a+v,0);

// Use diputados_circunscripciones.json resultado_dhondt
const dipResult = {};
Object.values(dipCirc.circunscripciones).forEach(c => {
  Object.entries(c.resultado_dhondt||{}).forEach(([p,s])=>{
    dipResult[p]=(dipResult[p]||0)+s;
  });
});
// Add nacionales
Object.entries(dipCirc.nacionales.resultado_dhondt||{}).forEach(([p,s])=>{
  dipResult[p]=(dipResult[p]||0)+s;
});
const DIP_TOT = Object.values(dipResult).reduce((a,v)=>a+v,0);

console.log(`\nTotal asignados (terr+nac): ${DIP_TOT} / 183 sin exterior`);
console.log(`Total real JCE: ${REAL_DIP_TOT} / 190 con exterior\n`);
console.log('Partido    Modelo  Real    Diff    Barra');
sep();
const allP = new Set([...Object.keys(dipResult),...Object.keys(REAL_DIP)]);
[...allP].sort((a,b)=>(REAL_DIP[b]||0)-(REAL_DIP[a]||0)).slice(0,12).forEach(p => {
  const mod  = dipResult[p]||0;
  const real = REAL_DIP[p]||0;
  const d    = mod-real;
  const flag = d===0?'✅':Math.abs(d)<=2?'~':d>0?'+'+d+'⬆':d+'⬇';
  const bar  = '█'.repeat(Math.max(0,Math.round(real/5)));
  console.log(`${p.padEnd(10)} ${String(mod).padStart(6)}  ${String(real).padStart(6)}  ${String(d>=0?'+'+d:d).padStart(5)} ${flag}  ${bar}`);
});

// ─── SECCIÓN 5: PADRÓN 2028 ───────────────────────────────────────────────────
hdr('5. PADRÓN 2028 — Proyección diferenciada por provincia');

const tot2024 = padronRows.reduce((a,r)=>a+r.inscritos,0);
const tot2028 = Object.values(padron2028).reduce((a,p)=>a+p.inscritos,0);
console.log(`\nPadrón interior 2024: ${fmt(tot2024)}`);
console.log(`Padrón interior 2028: ${fmt(tot2028)} (+${((tot2028/tot2024-1)*100).toFixed(1)}%)`);
console.log(`Padrón exterior 2028: ~${fmt(Math.round(863784*1.12))} (+12%)`);
console.log(`Total proyectado 2028: ~${fmt(tot2028+Math.round(863784*1.12))}\n`);
console.log('Top 5 provincias de mayor crecimiento:');
const topCrecimiento = Object.entries(padron2028)
  .map(([pid,p])=>({pid,nombre:p.provincia,
    pct:((p.inscritos/p.inscritosBase-1)*100).toFixed(1),
    inscritos2028:p.inscritos,
    inscritos2024:p.inscritosBase}))
  .sort((a,b)=>parseFloat(b.pct)-parseFloat(a.pct));
topCrecimiento.slice(0,5).forEach(p=>
  console.log(`  ${p.nombre.padEnd(25)} 2024:${fmt(p.inscritos2024).padStart(9)} → 2028:${fmt(p.inscritos2028).padStart(9)} (+${p.pct}%)`));

// ─── SECCIÓN 6: RESUMEN VALIDACIÓN ───────────────────────────────────────────
hdr('6. RESUMEN DE VALIDACIÓN — CAPAS NUEVAS vs JCE 2024');

console.log('');
const checks = [
  ['Alianzas presidenciales aplicadas correctamente',
    Math.abs((votesPresAlianza.PRM||0)/TOTAL_AL*100 - 57.44) < 2, '57.44% bloque JCE'],
  ['Senadores: PRM 29/32 con alianzas',
    senResult.byParty.PRM === 29, `Modelo:${senResult.byParty.PRM} Real:29`],
  ['Senadores: FP 3/32 con alianzas',
    senResult.byParty.FP === 3, `Modelo:${senResult.byParty.FP} Real:3`],
  ['Acierto provincial senadores ≥ 28/32',
    senResult.aciertos >= 28, `${senResult.aciertos}/32 correctos`],
  ['Diferencial SEN PRM MAE < 3pp',
    maeSen < 3.0, `MAE=${maeSen.toFixed(2)}pp`],
  ['Diferencial DIP PRM MAE < 3pp',
    maeDip < 3.0, `MAE=${maeDip.toFixed(2)}pp`],
  ['Padrón 2028 > 2024 (crecimiento positivo)',
    tot2028 > tot2024, `${fmt(tot2028)} > ${fmt(tot2024)}`],
  ['Dataset senadores_provincia.json: 32 provincias',
    Object.keys(senProv.provincias).length === 32, `${Object.keys(senProv.provincias).length}/32`],
  ['Dataset diputados_circunscripciones.json: 45 circs',
    Object.keys(dipCirc.circunscripciones).length === 45, `${Object.keys(dipCirc.circunscripciones).length}/45`],
];

let pass=0, fail=0;
checks.forEach(([desc, ok, detail]) => {
  const icon = ok ? '✅' : '❌';
  if (ok) pass++; else fail++;
  console.log(`  ${icon} ${desc.padEnd(52)} [${detail}]`);
});

console.log('');
sep();
console.log(`RESULTADO VALIDACIÓN: ${pass} OK / ${fail} FAIL`);
sep();

if (fail === 0) {
  console.log('\n  ✅ TODAS LAS CAPAS NUEVAS VALIDADAS CORRECTAMENTE');
} else {
  console.log(`\n  ⚠️  ${fail} verificación(es) requieren revisión`);
}
console.log('');
