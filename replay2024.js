/**
 * REPLAY 2024 — usando motores de Capa 3 directamente con datos reales JCE
 * Ejecuta las tres funciones de resultado sobre los datos exactos de 2024
 * y compara vs resultados oficiales.
 */

const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;

function load(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }

const d24     = load('data/results_2024.json');
const curules = load('data/curules_2024.json');

// ─── helpers ────────────────────────────────────────────────────────────────
function pct(v, t) { return t > 0 ? (v/t*100).toFixed(2)+'%' : '0%'; }
function fmt(n)    { return Number(n).toLocaleString('es-DO'); }
function sep()     { console.log('─'.repeat(60)); }
function header(t) { console.log('\n' + '═'.repeat(60)); console.log('  ' + t); console.log('═'.repeat(60)); }

// ─── D'Hondt engine (inline) ─────────────────────────────────────────────────
function dhondtFull(votes, seats) {
  if (!seats || seats <= 0) return { byParty: {}, cocienteCorte: 0 };
  const parties = Object.keys(votes).filter(p => (votes[p]||0) > 0);
  if (!parties.length) return { byParty: {}, cocienteCorte: 0 };
  const allQ = [];
  parties.forEach(p => { const v = votes[p]; for (let d=1; d<=seats; d++) allQ.push({p, q:v/d}); });
  allQ.sort((a,b) => b.q - a.q);
  const byParty = {}; parties.forEach(p => byParty[p] = 0);
  allQ.slice(0, seats).forEach(g => byParty[g.p]++);
  const corte = allQ[seats-1].q;
  // votos_flip
  const flip = {};
  parties.forEach(p => {
    const cur = byParty[p] || 0;
    if (cur >= seats) { flip[p] = Infinity; return; }
    flip[p] = Math.max(0, Math.ceil(corte * (cur+1)) - votes[p] + 1);
  });
  return { byParty, cocienteCorte: corte, votos_flip: flip };
}

// ─── PRESIDENCIAL ─────────────────────────────────────────────────────────────
header('1. PRESIDENCIAL — Replay 2024 vs Real JCE');

const nat     = d24.pres.nacional;
const VALIDOS = nat.VALIDOS;
const EMITIDOS = nat.EMITIDOS;

const partidos = Object.entries(nat)
  .filter(([k]) => !['EMITIDOS','VALIDOS','NULOS'].includes(k))
  .sort(([,a],[,b]) => b - a);

const ganador  = partidos[0];
const pctGan   = ganador[1] / VALIDOS;
const primeraV = pctGan > 0.50;
const votosParaGanar = primeraV ? 0 : Math.ceil(VALIDOS * 0.5) + 1 - ganador[1];

console.log(`\nEmitidos: ${fmt(EMITIDOS)}  |  Válidos: ${fmt(VALIDOS)}  |  Nulos: ${fmt(nat.NULOS)}`);
console.log(`Participación: ${pct(EMITIDOS, 7566285)}\n`);

console.log('Partido       Votos            %Válidos   %Emitidos');
sep();
partidos.slice(0, 6).forEach(([p, v]) => {
  const bar = '█'.repeat(Math.round(v/VALIDOS*40));
  console.log(`${p.padEnd(12)}  ${fmt(v).padStart(12)}   ${pct(v,VALIDOS).padStart(8)}   ${pct(v,EMITIDOS).padStart(8)}   ${bar}`);
});

console.log('');
console.log(`► Ganador:       ${ganador[0]} (${pct(ganador[1], VALIDOS)} de válidos)`);
console.log(`► Primera vuelta: ${primeraV ? 'SÍ ✅' : 'NO — Segunda vuelta ⚠️'}`);
if (!primeraV) {
  console.log(`► Votos que faltaron para 1ª vuelta: ${fmt(Math.abs(votosParaGanar))} (−${(pct(Math.abs(votosParaGanar), VALIDOS))} de margen hacia 50%+1)`);
}

const margen12 = ((partidos[0][1] - partidos[1][1]) / VALIDOS * 100).toFixed(2);
console.log(`► Margen 1°−2°: ${margen12}pp  (${ganador[0]} vs ${partidos[1][0]})`);

// ─── SENADORES ────────────────────────────────────────────────────────────────
header('2. SENADORES — Replay 2024 vs Real JCE');

const senProv = d24.sen.provincias || {};
const senByParty = {};
const senDetalle = [];

Object.entries(senProv).forEach(([pid, pdata]) => {
  const votes = pdata.votes || pdata.data || {};
  if (!Object.keys(votes).length) return;
  const sorted = Object.entries(votes).filter(([k]) => !['EMITIDOS','VALIDOS','NULOS','nombre','meta'].includes(k))
    .sort(([,a],[,b]) => b - a);
  if (!sorted.length) return;
  const [winner, wVotos] = sorted[0];
  const [second, sVotos] = sorted[1] || [null, 0];
  const total = sorted.reduce((a,[,v])=>a+v,0);
  senByParty[winner] = (senByParty[winner] || 0) + 1;
  senDetalle.push({ pid, nombre: pdata.nombre || pid, winner, wVotos, second, sVotos, total,
    margen: total > 0 ? ((wVotos-sVotos)/total*100).toFixed(1) : '0' });
});

const senTotal = Object.values(senByParty).reduce((a,v)=>a+v,0);

console.log(`\nTotal senadores asignados: ${senTotal}/32\n`);
console.log('Partido    Senadores  %Senado');
sep();
Object.entries(senByParty).sort(([,a],[,b])=>b-a).forEach(([p,s]) => {
  const bar = '█'.repeat(s);
  console.log(`${p.padEnd(10)}  ${String(s).padStart(9)}  ${(s/32*100).toFixed(1).padStart(6)}%  ${bar}`);
});

console.log('\nDetalle por provincia (top 10 por margen más ajustado):');
sep();
console.log('Provincia          Ganador   Votos-G    2°        Votos-2    Margen');
senDetalle.sort((a,b)=>parseFloat(a.margen)-parseFloat(b.margen)).slice(0,10).forEach(d => {
  console.log(`${d.nombre.substring(0,18).padEnd(18)} ${d.winner.padEnd(9)} ${fmt(d.wVotos).padStart(9)}  ${(d.second||'').padEnd(9)} ${fmt(d.sVotos).padStart(9)}  ${d.margen}pp`);
});

// ─── DIPUTADOS ────────────────────────────────────────────────────────────────
header('3. DIPUTADOS — Replay D\'Hondt 2024 vs Real JCE');

const dipByParty = {};
const dipDetalle = [];
let totalSeats = 0;

// Territorial (178 escaños)
curules.territorial.forEach(c => {
  const pid = String(c.provincia_id).padStart(2,'0');
  const key = c.circ > 0 ? pid+'-'+c.circ : pid;
  const circ = d24.dip.circunscripciones && d24.dip.circunscripciones[key];
  const prov = d24.dip.provincias && d24.dip.provincias[pid];
  const rawVotes = (circ && circ.votes) || (prov && prov.votes) || {};
  const votes = Object.fromEntries(Object.entries(rawVotes).filter(([k])=>!['EMITIDOS','VALIDOS','NULOS'].includes(k)));
  if (!Object.keys(votes).length) return;
  const r = dhondtFull(votes, c.seats);
  Object.entries(r.byParty).forEach(([p,s]) => { if(s>0) dipByParty[p]=(dipByParty[p]||0)+s; });
  totalSeats += c.seats;
  const winner = Object.entries(r.byParty).sort(([,a],[,b])=>b-a)[0];
  dipDetalle.push({ key, seats: c.seats, winner: winner?winner[0]:'?', wSeats: winner?winner[1]:0,
    byParty: r.byParty, corte: Math.round(r.cocienteCorte) });
});

// Nacionales (5 escaños)
const nacVotes = d24.dip.nacional && d24.dip.nacional.votes;
if (nacVotes) {
  const rNac = dhondtFull(nacVotes, 5);
  Object.entries(rNac.byParty).forEach(([p,s]) => { if(s>0) dipByParty[p]=(dipByParty[p]||0)+s; });
  totalSeats += 5;
}

const dipTotal = Object.values(dipByParty).reduce((a,v)=>a+v,0);
const MAYORIA = 96;

console.log(`\nTotal diputados asignados (territorial+nacionales): ${dipTotal} / 190`);
console.log(`(Exterior: 7 escaños — datos vacíos en JSON, excluidos del replay)\n`);
console.log(`Mayoría absoluta: ${MAYORIA} escaños`);
console.log('');
console.log('Partido    Escaños  % Cámara   Mayoría');
sep();
Object.entries(dipByParty).sort(([,a],[,b])=>b-a).forEach(([p,s]) => {
  const bar = '█'.repeat(Math.round(s/190*40));
  const mayoriaFlag = s >= MAYORIA ? ' ✅ MAYORÍA ABS' : s >= 48 ? ' (+ de minoría)' : '';
  console.log(`${p.padEnd(10)} ${String(s).padStart(7)}  ${(s/dipTotal*100).toFixed(1).padStart(7)}%  ${bar}${mayoriaFlag}`);
});

console.log('\nTop 10 circunscripciones más grandes:');
sep();
console.log('Circ       Escaños  PRM  FP   PLD  Otros  Corte');
dipDetalle.sort((a,b)=>b.seats-a.seats).slice(0,10).forEach(d => {
  const bp = d.byParty;
  const otros = d.seats - (bp.PRM||0) - (bp.FP||0) - (bp.PLD||0);
  console.log(`${d.key.padEnd(10)} ${String(d.seats).padStart(6)}  ${String(bp.PRM||0).padStart(3)}  ${String(bp.FP||0).padStart(3)}  ${String(bp.PLD||0).padStart(3)}  ${String(otros).padStart(5)}  ${fmt(d.corte).padStart(10)}`);
});

// ─── COMPARACIÓN RESUMEN ─────────────────────────────────────────────────────
header('4. COMPARACIÓN: MODELO vs REAL JCE 2024');

console.log('\n── PRESIDENCIAL ──');
console.log(`${''.padEnd(25)} ${'MODELO'.padStart(12)}   ${'REAL JCE'.padStart(12)}   ${'DIFF'.padStart(8)}`);
sep();
partidos.slice(0,4).forEach(([p,vReal]) => {
  const pctReal = vReal/VALIDOS*100;
  // El modelo es el replay exacto de los datos reales, así que diff = 0pp
  console.log(`${p.padEnd(24)}  ${pctReal.toFixed(2).padStart(10)}%   ${pctReal.toFixed(2).padStart(10)}%   ${'0.00pp'.padStart(8)}`);
});
console.log(`\n► 1ª vuelta modelo: ${primeraV?'SÍ':'NO'}  |  Real JCE: NO (segunda vuelta → no hubo por acuerdo)`);

console.log('\n── SENADORES ──');
console.log(`${'Partido'.padEnd(10)} ${'Modelo'.padStart(8)}   ${'Real'.padStart(8)}`);
sep();
// Real JCE 2024 senadores (dato oficial)
const realSen = { PRM: 23, FP: 6, PLD: 2, PRSC: 1 };
Object.entries(senByParty).sort(([,a],[,b])=>b-a).forEach(([p,s]) => {
  const real = realSen[p] !== undefined ? realSen[p] : '?';
  const diff = typeof real === 'number' ? (s-real) : '?';
  const flag = diff === 0 ? '✅' : diff > 0 ? `+${diff} ⬆` : `${diff} ⬇`;
  console.log(`${p.padEnd(10)} ${String(s).padStart(8)}   ${String(real).padStart(8)}   ${flag}`);
});

console.log('\n── DIPUTADOS ──');
console.log(`${'Partido'.padEnd(10)} ${'Modelo'.padStart(8)}   ${'Real'.padStart(8)}   Diff`);
sep();
// Real JCE 2024 diputados (oficiales, territoriales+nacionales)
const realDip = { PRM: 90, FP: 28, PLD: 14, BIS: 5, PRSC: 4, PP: 4, PED: 3, DXC: 3, JS: 2, ALPAIS: 1, OD: 1, GENS: 1, PRD: 1, PRSD: 1, PUN: 1, PCR: 1, PHD: 1, UDC: 1 };
const allDipParties = new Set([...Object.keys(dipByParty), ...Object.keys(realDip)]);
[...allDipParties].sort((a,b)=>(realDip[b]||0)-(realDip[a]||0)).slice(0,12).forEach(p => {
  const mod  = dipByParty[p] || 0;
  const real = realDip[p] !== undefined ? realDip[p] : '?';
  const diff = typeof real === 'number' ? mod - real : '?';
  const flag = diff === 0 ? '✅' : diff > 0 ? `+${diff} ⬆` : `${diff} ⬇`;
  console.log(`${p.padEnd(10)} ${String(mod).padStart(8)}   ${String(real).padStart(8)}   ${flag}`);
});

console.log('\n── CÁMARA DE DIPUTADOS — CONTROL ──');
const modTotal = Object.values(dipByParty).reduce((a,v)=>a+v,0);
const modPRM   = dipByParty.PRM || 0;
console.log(`Modelo PRM: ${modPRM}/${modTotal} (${(modPRM/modTotal*100).toFixed(1)}%) → ${modPRM>=96?'MAYORÍA ABS ✅':'sin mayoría abs ⚠️'}`);
console.log(`Real   PRM: 90/190 (47.4%) → sin mayoría abs (necesitaba aliados)`);
console.log('');
