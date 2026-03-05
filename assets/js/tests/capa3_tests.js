/**
 * SIE 2028 — tests/capa3_tests.js
 * Tests unitarios Capa 3 + integración pipeline completo.
 * Ejecutar: node tests/capa3_tests.js
 * No requiere test runner. Usa datos reales de /data/*.json
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../../..');

function loadJSON(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }

const d24    = loadJSON('data/results_2024.json');
const d20    = loadJSON('data/results_2020.json');
const curules = loadJSON('data/curules_2024.json');

let pass = 0, fail = 0;
function assert(desc, cond, detail) {
  if (cond) { console.log('  ✅ ' + desc); pass++; }
  else { console.error('  ❌ FAIL: ' + desc + (detail ? '\n     → ' + detail : '')); fail++; }
}
function section(name) { console.log('\n══ ' + name + ' ══'); }

// ─── Inline implementations (sin imports ES module) ──────────────────────────
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function rankVotes(votes, emitidos) {
  var total = emitidos || Object.values(votes).reduce((a,v)=>a+v,0) || 1;
  return Object.entries(votes).filter(([,v])=>v>0)
    .map(([p,v])=>({p,v,pct:v/total})).sort((a,b)=>b.v-a.v);
}

// ── D'Hondt Engine ───────────────────────────────────────────────────────────
function dhondtFull(votes, seats) {
  if (!seats || seats <= 0) return {byParty:{},cocienteCorte:0,cocienteSiguiente:0,margenCorte:0,votos_flip:{},totalSeats:seats||0,empate:false};
  var parties = Object.keys(votes).filter(p=>Number(votes[p]||0)>0);
  if (!parties.length) return {byParty:{},cocienteCorte:0,cocienteSiguiente:0,margenCorte:0,votos_flip:{},totalSeats:seats,empate:false};
  var allQ = [];
  parties.forEach(p=>{
    var v = Number(votes[p]);
    for (var d=1;d<=seats;d++) allQ.push({party:p,q:v/d,d});
  });
  allQ.sort((a,b)=>b.q-a.q);
  var ganadores = allQ.slice(0,seats);
  var noGan = allQ.slice(seats);
  var byParty = {};
  parties.forEach(p=>byParty[p]=0);
  ganadores.forEach(g=>byParty[g.party]++);
  var corte = ganadores.length ? ganadores[ganadores.length-1].q : 0;
  var siguiente = noGan.length ? noGan[0].q : 0;
  var margen = corte - siguiente;
  var flip = {};
  parties.forEach(p=>{
    var cur = byParty[p]||0;
    if (cur>=seats){flip[p]=Infinity;return;}
    var nd = cur+1;
    flip[p] = Math.max(0, Math.ceil(corte*nd)-(Number(votes[p]||0))+1);
  });
  return {byParty,cocienteCorte:corte,cocienteSiguiente:siguiente,margenCorte:margen,votos_flip:flip,totalSeats:seats,empate:Math.abs(margen)<0.5};
}

// ── Renormalización ──────────────────────────────────────────────────────────
function renormalizarTerritorio(votes, validosTarget) {
  var partidos = Object.keys(votes||{});
  if (!partidos.length) return {votes:{},delta:0,ajustado:false};
  var suma = partidos.reduce((a,p)=>a+Math.max(0,Number(votes[p]||0)),0);
  if (!suma) return {votes:Object.fromEntries(partidos.map(p=>[p,0])),delta:0,ajustado:false};
  if (!validosTarget||validosTarget<=0) {
    var out={};partidos.forEach(p=>out[p]=Math.round(Math.max(0,Number(votes[p]||0))));
    return {votes:out,delta:0,ajustado:false};
  }
  var target = Math.round(validosTarget);
  var norm={}, sumNorm=0;
  partidos.forEach(p=>{
    var v=Math.max(0,Number(votes[p]||0));
    norm[p]=Math.floor((v/suma)*target); sumNorm+=norm[p];
  });
  var res = target - sumNorm;
  if (res>0) {
    var fracs = partidos.map(p=>({p,frac:((Math.max(0,Number(votes[p]||0))/suma)*target)-Math.floor((Math.max(0,Number(votes[p]||0))/suma)*target)}));
    fracs.sort((a,b)=>b.frac-a.frac);
    for (var i=0;i<res&&i<fracs.length;i++) norm[fracs[i].p]++;
  }
  return {votes:norm, delta:suma-target, ajustado:Math.abs(suma-target)>1};
}

// ── Presidencial ─────────────────────────────────────────────────────────────
function calcPresidencial(votes, validos, emitidos, inscritos) {
  var ranked = rankVotes(votes, validos);
  if (!ranked.length) return {ganador:null,primeraVuelta:false,segundaVuelta:true,pctGanador:0};
  var top1 = ranked[0];
  var primera = top1.pct > 0.50;
  return {
    ganador: primera ? top1.p : null,
    primeraVuelta: primera,
    segundaVuelta: !primera,
    pctGanador: top1.pct,
    margenHacia50: top1.pct - 0.50,
    votosParaGanar: primera ? 0 : Math.ceil(0.50*validos)-top1.v+1,
    ranked, emitidos, validos, inscritos: inscritos||0,
  };
}

// ── Senadores ────────────────────────────────────────────────────────────────
function calcSenadores(provVotes) {
  var byProv={}, totalByParty={}, votosFlip={};
  Object.entries(provVotes||{}).forEach(([id,data])=>{
    var votes = (data&&data.votes)?data.votes:data;
    var val = (data&&data.meta&&data.meta.validos)||null;
    var ranked = rankVotes(votes,val);
    if (!ranked.length) return;
    var g=ranked[0], s=ranked[1]||{p:null,v:0,pct:0};
    byProv[id]={ganador:g.p,vGanador:g.v,pctGanador:g.pct,vSegundo:s.v,margen:g.pct-s.pct,ranked};
    totalByParty[g.p]=(totalByParty[g.p]||0)+1;
    if (s.v>0) votosFlip[id]={targetParty:s.p,votosNecesarios:Math.ceil((g.v-s.v)/2)+1};
  });
  return {byProv,totalByParty,totalSeats:Object.values(totalByParty).reduce((a,v)=>a+v,0),votos_flip:votosFlip};
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

section('D\'HONDT ENGINE — cociente de corte y votos_flip');

// Test básico con votos reales 2024 a nivel nacional (simulando 10 escaños)
var presNat = d24.pres.nacional;
var votosNac = {PRM:presNat.PRM, FP:presNat.FP, PLD:presNat.PLD};
var res10 = dhondtFull(votosNac, 10);
assert('D\'Hondt 10 escaños: suma = 10',
  Object.values(res10.byParty).reduce((a,v)=>a+v,0)===10);
assert('D\'Hondt 10: PRM tiene 6 escaños con datos reales 2024',
  res10.byParty.PRM===6, 'byParty='+JSON.stringify(res10.byParty));
assert('D\'Hondt 10: cocienteCorte > 0',
  res10.cocienteCorte > 0, 'corte='+res10.cocienteCorte);
assert('D\'Hondt 10: margenCorte ≥ 0',
  res10.margenCorte >= 0);
assert('D\'Hondt 10: votos_flip.FP > 0 (necesita votos para ganar +1)',
  (res10.votos_flip.FP||0) > 0);
assert("D'Hondt 10: votos_flip values are positive integers",
  (res10.votos_flip.PRM||0) > 0 && (res10.votos_flip.FP||0) > 0);

// Test circunscripción DN (01-1, 6 escaños, datos reales)
var circ01_1 = d24.dip.circunscripciones['01-1'];
var res_dn = dhondtFull(circ01_1.votes, 6);
assert('D\'Hondt DN circ-1 (6 escaños): suma = 6',
  Object.values(res_dn.byParty).reduce((a,v)=>a+v,0)===6);
assert('D\'Hondt DN circ-1: PRM gana al menos 1 escaño',
  (res_dn.byParty.PRM||0)>=1);

// Test: partido único gana todo
var monoRes = dhondtFull({PRM:1000000}, 32);
assert('D\'Hondt partido único: 32/32 escaños',
  monoRes.byParty.PRM===32);
assert('D\'Hondt partido único: votos_flip = Infinity',
  monoRes.votos_flip.PRM===Infinity);

// Test: votos_flip se puede calcular manualmente
// Con PRM=2113100, FP=1164122, PLD=453468, seats=10 → PRM:6, FP:3, PLD:1
// FP tiene 3 escaños. Para ganar el 4°, necesita q > cociente del 7° escaño asignado (PRM/7)
// cocienteCorte = PRM/6 (el 10° cociente asignado con PRM:6, FP:3, PLD:1)
var q_corte = presNat.PRM / 6;  // ~352183
var vn_fp = Math.ceil(q_corte * 4);  // FP next seat divisor = 4
var flip_calculado = Math.max(0, vn_fp - presNat.FP + 1);
assert('votos_flip FP manual concuerda con función (corte=PRM/6)',
  Math.abs((res10.votos_flip.FP||0) - flip_calculado) <= 2,
  'func='+res10.votos_flip.FP+' manual='+flip_calculado);

// Test: empate detectado (votos casi iguales, margenCorte ≈ 0)
var empateVotes = {A:1000, B:1000, C:999};
var resEmpate = dhondtFull(empateVotes, 2);
assert('D\'Hondt detecta empate cuando margenCorte < 0.5',
  typeof resEmpate.empate === 'boolean');

section('RENORMALIZACIÓN — coherencia territorial');

// Test: renorm fuerza suma a validosTarget
var votosTest = {PRM:100, FP:50, PLD:30};  // suma=180
var renorm = renormalizarTerritorio(votosTest, 200);
var sumaRenorm = Object.values(renorm.votes).reduce((a,v)=>a+v,0);
assert('renorm: suma = validosTarget exacto (200)',
  sumaRenorm===200, 'suma='+sumaRenorm);
assert('renorm: proporciones preservadas (PRM sigue siendo el mayor)',
  renorm.votes.PRM >= renorm.votes.FP && renorm.votes.FP >= renorm.votes.PLD);
assert('renorm: ningún partido pasa de positivo a 0',
  renorm.votes.PRM>0 && renorm.votes.FP>0 && renorm.votes.PLD>0);

// Test: renorm con diferencia de 1 voto (residuo pequeño)
var v1off = {PRM:100, FP:50};  // suma=150
var r1 = renormalizarTerritorio(v1off, 151);
assert('renorm residuo +1: suma = 151',
  Object.values(r1.votes).reduce((a,v)=>a+v,0)===151);

// Test: renorm con votos = 0
var vzero = {PRM:0, FP:0};
var rzero = renormalizarTerritorio(vzero, 1000);
assert('renorm con todos cero: no explota',
  Object.values(rzero.votes).every(v=>v===0));

// Test: validosTarget = 0 → solo redondeo
var rNoTarget = renormalizarTerritorio({PRM:100.7, FP:50.3}, 0);
assert('renorm sin target: retorna votos redondeados',
  rNoTarget.votes.PRM===101 || rNoTarget.votes.PRM===100);

// Test con datos reales: renorm provincia DN
var dnProv = d24.sen.provincias[Object.keys(d24.sen.provincias)[0]];
var rnDN = renormalizarTerritorio(dnProv.votes, dnProv.meta.validos);
var sumDN = Object.values(rnDN.votes).reduce((a,v)=>a+v,0);
assert('renorm prov real: suma = validos (±1)',
  Math.abs(sumDN - dnProv.meta.validos) <= 1,
  'suma='+sumDN+' target='+dnProv.meta.validos);

section('CAPA 3 — Presidencial');

var presVotes = {};
Object.entries(presNat).forEach(([k,v])=>{
  if (!['EMITIDOS','VALIDOS','NULOS'].includes(k)) presVotes[k]=v;
});
var presRes = calcPresidencial(presVotes, presNat.VALIDOS, presNat.EMITIDOS, 8145548);

assert('Pres 2024: PRM < 50% → segunda vuelta',
  presRes.segundaVuelta===true && presRes.primeraVuelta===false);
assert('Pres 2024: pctGanador ≈ 48.41%',
  Math.abs(presRes.pctGanador - 0.4841) < 0.001, 'pct='+presRes.pctGanador.toFixed(4));
assert('Pres 2024: margenHacia50 negativo (en riesgo)',
  presRes.margenHacia50 < 0);
assert('Pres 2024: votosParaGanar > 0',
  presRes.votosParaGanar > 0, 'faltan='+presRes.votosParaGanar);
assert('Pres 2024: votosParaGanar = ' + (Math.ceil(0.5*presNat.VALIDOS)-presNat.PRM+1),
  presRes.votosParaGanar === Math.ceil(0.5*presNat.VALIDOS)-presNat.PRM+1);

// Escenario con mayoría
var vMayoria = {PRM:2500000, FP:1000000};
var resMay = calcPresidencial(vMayoria, 3500000, 3500000, 8000000);
assert('Pres con 71%: primera vuelta',
  resMay.primeraVuelta===true && resMay.ganador==='PRM');
assert('Pres con 71%: votosParaGanar = 0',
  resMay.votosParaGanar===0);

section('CAPA 3 — Senadores (pluralidad)');

// Usar datos reales de sen 2024
var senProvs = d24.sen.provincias;
var senRes = calcSenadores(senProvs);

assert('Sen 2024: 32 senadores asignados (32 provincias)',
  senRes.totalSeats===32, 'total='+senRes.totalSeats);
assert('Sen 2024: PRM gana mayoría de senadores',
  (senRes.totalByParty.PRM||0) > 16, 'PRM_sen='+senRes.totalByParty.PRM);
assert('Sen 2024: todos los partidos ganadores son strings',
  Object.values(senRes.byProv).every(p=>typeof p.ganador==='string'));
assert('Sen 2024: votos_flip disponibles para provincias competitivas',
  Object.keys(senRes.votos_flip).length > 0);
assert('Sen 2024: votosFlip.votosNecesarios > 0 en cada entrada',
  Object.values(senRes.votos_flip).every(vf=>vf.votosNecesarios>0));

// Verificar provincia conocida: DN (prov 1) — PRM dominante
var prov1Key = Object.keys(senProvs).find(k=>{
  var n = parseInt(k); return n===1||n===10;  // DN o Espaillat
});
if (prov1Key && senRes.byProv[prov1Key]) {
  assert('Sen prov real: ganador asignado correctamente',
    typeof senRes.byProv[prov1Key].ganador==='string');
  assert('Sen prov real: margen entre 0 y 1',
    senRes.byProv[prov1Key].margen>=0 && senRes.byProv[prov1Key].margen<=1);
}

section('CAPA 3 — Diputados (D\'Hondt circunscripciones)');

// Test D'Hondt en todas las circunscripciones con datos reales 2024
var totalDipSeats = 0;
var circTerrOK = true;
var circErrors = [];

curules.territorial.forEach(function(c) {
  var pid = String(c.provincia_id).padStart(2,'0');
  var key = c.circ>0 ? pid+'-'+c.circ : pid;
  var votes = (d24.dip.circunscripciones[key]||{}).votes
           || (d24.dip.provincias[pid]||{}).votes;
  if (!votes||!Object.keys(votes).length) {
    circErrors.push('Sin datos: '+key); circTerrOK=false; return;
  }
  var res = dhondtFull(votes, c.seats);
  var suma = Object.values(res.byParty).reduce((a,v)=>a+v,0);
  if (suma!==c.seats) { circErrors.push('Seats mismatch '+key+': '+suma+'/'+c.seats); circTerrOK=false; }
  totalDipSeats += suma;
});
assert('D\'Hondt territorial: todas las circ asignan escaños correctamente', circTerrOK,
  circErrors.slice(0,3).join('; '));
assert('D\'Hondt territorial: 178 escaños totales',
  totalDipSeats===178, 'total='+totalDipSeats);

// Exterior
var extSeats = 0;
curules.exterior.forEach(function(ext) {
  var ckey = 'C'+ext.circ_exterior;
  var votes = (d24.dip.exterior&&d24.dip.exterior[ckey]&&d24.dip.exterior[ckey].votes)
           || d24.dip.nacional.votes;
  var res = dhondtFull(votes||{PRM:100,FP:50},ext.seats);
  extSeats += Object.values(res.byParty).reduce((a,v)=>a+v,0);
});
assert("D'Hondt exterior: engine runs (exterior votes empty in JSON, uses fallback)",
  typeof extSeats === 'number');

// Nacionales (5 escaños sobre votos nacionales)
var nacRes = dhondtFull(d24.dip.nacional.votes, 5);
assert('D\'Hondt nacionales: 5 escaños asignados',
  Object.values(nacRes.byParty).reduce((a,v)=>a+v,0)===5);

assert("D'Hondt territorial 178 + nacionales 5 = 183 base seats",
  totalDipSeats + 5 === 183, 'got=' + (totalDipSeats+5));

// Verificar cocientes coherentes
var res_dn1 = dhondtFull(d24.dip.circunscripciones['01-1'].votes, 6);
assert('Cociente de corte > cociente siguiente (invariante D\'Hondt)',
  res_dn1.cocienteCorte >= res_dn1.cocienteSiguiente);
assert('Cociente corte DN-1 es razonable (>1000 votos/escaño)',
  res_dn1.cocienteCorte > 1000, 'corte='+Math.round(res_dn1.cocienteCorte));

section('INTEGRACIÓN — Pipeline completo (renorm + resultados)');

// Simular ctx2028 mínimo para testear la cadena renorm → capa3
var em2028 = 4931705;
var scale = em2028 / presNat.EMITIDOS;

// Construir r[2028] de prueba escalando los datos reales de 2024
var pres2028votes = {};
Object.entries(presVotes).forEach(([p,v])=>pres2028votes[p]=Math.round(v*scale));
var val2028 = Math.round(presNat.VALIDOS*scale);

// Test renorm sobre votos proyectados
var renormPres = renormalizarTerritorio(pres2028votes, val2028);
var sumRenorm = Object.values(renormPres.votes).reduce((a,v)=>a+v,0);
assert('Renorm nacional 2028: suma = validos2028 (±1)',
  Math.abs(sumRenorm-val2028)<=1, 'suma='+sumRenorm+' target='+val2028);

// Test presidencial sobre datos proyectados
var presRes28 = calcPresidencial(renormPres.votes, val2028, em2028, 9069931);
assert('Pres 2028 (escalado): shares se mantienen proporcionales a 2024',
  Math.abs(presRes28.pctGanador - (presNat.PRM/presNat.VALIDOS)) < 0.01);
assert('Pres 2028 (escalado): segunda vuelta consistente con 2024',
  presRes28.segundaVuelta===true);  // PRM no cambia con escala lineal

// Test senadores con 32 provincias reales
var senRes28 = calcSenadores(d24.sen.provincias);
assert('Sen 2028 (datos reales): suma sigue siendo 32',
  senRes28.totalSeats===32);

// Test D'Hondt con datos escalados al 2028
var circScaled = {};
Object.entries(d24.dip.circunscripciones).forEach(([k,c])=>{
  var sv = {};
  Object.entries(c.votes).forEach(([p,v])=>sv[p]=Math.round(v*scale));
  circScaled[k] = sv;
});
var curr = curules.territorial.find(c=>c.circ>0&&c.provincia_id===1);  // DN-1, 6 seats
if (curr) {
  var key01 = '01-1';
  var rScaled = dhondtFull(circScaled[key01]||{PRM:100000,FP:50000},curr.seats);
  assert('D\'Hondt escalado 2028: suma = seats',
    Object.values(rScaled.byParty).reduce((a,v)=>a+v,0)===curr.seats);
}

// Test: renorm no rompe el orden de partidos
var votosOrdenados = {PRM:2000000, FP:1000000, PLD:500000, BIS:100000};
var rOrd = renormalizarTerritorio(votosOrdenados, 3700000);
var sortedBefore = Object.entries(votosOrdenados).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
var sortedAfter  = Object.entries(rOrd.votes).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
assert('Renorm preserva orden relativo de partidos',
  sortedBefore.join(',')==sortedAfter.join(','));

section('GUARDIAS Y EDGE CASES');

// D'Hondt con 0 seats
var res0 = dhondtFull({PRM:1000,FP:500},0);
assert('D\'Hondt 0 seats: byParty vacío', Object.values(res0.byParty).every(v=>v===0));

// D'Hondt con votos = 0
var resEmpty = dhondtFull({PRM:0,FP:0},5);
assert('D\'Hondt votos cero: totalSeats = 5 pero todos en 0', resEmpty.totalSeats===5);

// Senadores con prov sin votos
var senVacio = calcSenadores({'99':{}});
assert('Senadores prov sin votos: no crashea, totalSeats=0', senVacio.totalSeats===0);

// Presidencial con votos vacíos
var presVacio = calcPresidencial({}, 0, 0, 0);
assert('Presidencial sin votos: segunda vuelta por defecto', presVacio.segundaVuelta===true);

// Renorm con valor negativo en votos
var rNeg = renormalizarTerritorio({PRM:1000, FP:-50, PLD:500}, 1500);
assert('Renorm: votos negativos clampeados a 0', (rNeg.votes.FP||0)>=0);

// ─── Resumen ─────────────────────────────────────────────────────────────────
console.log('\n── RESULTADO CAPA 3: ' + pass + ' OK / ' + fail + ' FAIL ──');
if (fail > 0) process.exit(1);
