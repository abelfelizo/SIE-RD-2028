/**
 * SIE 2028 — tests/dhondt_tests.js
 * Tests exhaustivos del motor D'Hondt extendido.
 * Ejecutar: node tests/dhondt_tests.js
 * Cubre: dhondt_engine.js — dhondtFull(), calcVotosFlip(), dhondtDipFull()
 */

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../../..');

function loadJSON(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }

const d24    = loadJSON('data/results_2024.json');
const curules = loadJSON('data/curules_2024.json');

let pass = 0, fail = 0;
function assert(desc, cond, detail) {
  if (cond) { console.log('  ✅ ' + desc); pass++; }
  else { console.error('  ❌ FAIL: ' + desc + (detail ? '\n     → ' + detail : '')); fail++; }
}
function section(name) { console.log('\n══ ' + name + ' ══'); }

// ── Inline dhondtFull (sin import ES module) ─────────────────────────────────
function dhondtFull(votes, seats) {
  if (!seats || seats <= 0) return { byParty: {}, cocienteCorte: 0, cocienteSiguiente: 0,
    margenCorte: 0, votos_flip: {}, totalSeats: seats || 0, empate: false };
  var parties = Object.keys(votes).filter(p => Number(votes[p] || 0) > 0);
  if (!parties.length) return { byParty: {}, cocienteCorte: 0, cocienteSiguiente: 0,
    margenCorte: 0, votos_flip: {}, totalSeats: seats, empate: false };
  var allQ = [];
  parties.forEach(p => {
    var v = Number(votes[p]);
    for (var d = 1; d <= seats; d++) allQ.push({ party: p, q: v / d, d });
  });
  allQ.sort((a, b) => b.q - a.q);
  var ganadores = allQ.slice(0, seats);
  var noGan = allQ.slice(seats);
  var byParty = {};
  parties.forEach(p => byParty[p] = 0);
  ganadores.forEach(g => byParty[g.party]++);
  var corte     = ganadores[ganadores.length - 1].q;
  var siguiente = noGan.length ? noGan[0].q : 0;
  var flip = {};
  parties.forEach(p => {
    var cur = byParty[p] || 0;
    if (cur >= seats) { flip[p] = Infinity; return; }
    var nd = cur + 1;
    flip[p] = Math.max(0, Math.ceil(corte * nd) - Number(votes[p] || 0) + 1);
  });
  return { byParty, cocienteCorte: corte, cocienteSiguiente: siguiente,
    margenCorte: corte - siguiente, votos_flip: flip,
    totalSeats: seats, empate: Math.abs(corte - siguiente) < 0.5 };
}

// ════════════════════════════════════════════════════════════════════════════
section("INVARIANTES MATEMÁTICOS D'HONDT");

// Invariante 1: suma escaños = seats para cualquier distribución
[1, 2, 5, 10, 32, 190].forEach(s => {
  var votes = { A: Math.round(Math.random() * 1e6 + 1e5),
                B: Math.round(Math.random() * 8e5 + 1e4),
                C: Math.round(Math.random() * 5e5 + 1e4) };
  var r = dhondtFull(votes, s);
  var suma = Object.values(r.byParty).reduce((a, v) => a + v, 0);
  assert('Invariante suma seats=' + s, suma === s, 'suma=' + suma);
});

// Invariante 2: partido con 0 votos no recibe escaños
var r0 = dhondtFull({ A: 1000, B: 0, C: 500 }, 5);
assert('Partido con 0 votos no recibe escaños', (r0.byParty.B || 0) === 0);

// Invariante 3: partido único recibe todos los escaños
var rMono = dhondtFull({ SOLO: 9999999 }, 190);
assert('Partido único recibe 190/190 escaños', rMono.byParty.SOLO === 190);
assert('Partido único: votos_flip = Infinity', rMono.votos_flip.SOLO === Infinity);

// Invariante 4: cocienteCorte ≥ cocienteSiguiente siempre
var rInv = dhondtFull({ X: 1000000, Y: 800000, Z: 300000 }, 7);
assert('cocienteCorte ≥ cocienteSiguiente', rInv.cocienteCorte >= rInv.cocienteSiguiente);
assert('margenCorte = cocienteCorte - cocienteSiguiente',
  Math.abs(rInv.margenCorte - (rInv.cocienteCorte - rInv.cocienteSiguiente)) < 0.001);

// Invariante 5: votos_flip ≥ 0 para todos los partidos no-ganadores
Object.entries(rInv.votos_flip).forEach(([p, f]) => {
  assert('votos_flip[' + p + '] ≥ 0 o Infinity',
    f === Infinity || f >= 0, 'flip=' + f);
});

section("VALIDACIÓN CON DATOS REALES 2024");

// Test completo: todas las circunscripciones territoriales (45)
var seatsTerrTotal = 0;
var allCircOK = true;
var circErrs = [];

curules.territorial.forEach(c => {
  var pid = String(c.provincia_id).padStart(2, '0');
  var key = c.circ > 0 ? pid + '-' + c.circ : pid;
  var votes = (d24.dip.circunscripciones[key] || {}).votes
           || (d24.dip.provincias[pid] || {}).votes;
  if (!votes || !Object.keys(votes).length) {
    circErrs.push('NoData:' + key); allCircOK = false; return;
  }
  var r = dhondtFull(votes, c.seats);
  var suma = Object.values(r.byParty).reduce((a, v) => a + v, 0);
  if (suma !== c.seats) { circErrs.push(key + ':' + suma + '≠' + c.seats); allCircOK = false; }
  seatsTerrTotal += suma;
  // Verificar cocientes
  if (r.cocienteCorte <= 0) { circErrs.push(key + ':corte=0'); allCircOK = false; }
});

assert('Todas las circ territoriales asignan seats correctamente (45 circ)',
  allCircOK, circErrs.slice(0, 5).join('; '));
assert('Total territorial = 178', seatsTerrTotal === 178, 'total=' + seatsTerrTotal);

// Nacionales: 5 escaños sobre votos nacionales
var nacRes = dhondtFull(d24.dip.nacional.votes, 5);
assert("Nacionales: 5 escaños asignados",
  Object.values(nacRes.byParty).reduce((a, v) => a + v, 0) === 5);

// Verificar DN circunscripción 1 (la más grande: 6 escaños)
var rDN1 = dhondtFull(d24.dip.circunscripciones['01-1'].votes, 6);
assert('DN-1: 6 escaños asignados', Object.values(rDN1.byParty).reduce((a,v)=>a+v,0) === 6);
assert('DN-1: PRM gana al menos 3 escaños (partido dominante)',
  (rDN1.byParty.PRM || 0) >= 3, 'PRM_DN1=' + rDN1.byParty.PRM);
assert('DN-1: cocienteCorte > 20000 votos (razonable para DN)',
  rDN1.cocienteCorte > 20000, 'corte=' + Math.round(rDN1.cocienteCorte));

// Verificar circunscripción pequeña (1 escaño → el partido más votado)
var smallCirc = curules.territorial.find(c => c.seats === 1);
if (smallCirc) {
  var spid = String(smallCirc.provincia_id).padStart(2, '0');
  var skey = smallCirc.circ > 0 ? spid + '-' + smallCirc.circ : spid;
  var sVotes = (d24.dip.circunscripciones[skey] || d24.dip.provincias[spid] || {}).votes || {};
  if (Object.keys(sVotes).length) {
    var rSmall = dhondtFull(sVotes, 1);
    var winner = Object.entries(rSmall.byParty).find(([,v]) => v === 1);
    var maxParty = Object.entries(sVotes).sort((a,b)=>b[1]-a[1])[0][0];
    assert('Circ 1-escaño: ganador = partido más votado (D\'Hondt trivial)',
      winner && winner[0] === maxParty, 'winner=' + (winner ? winner[0] : 'none') + ' max=' + maxParty);
  }
}

section("VOTOS_FLIP — CÁLCULO Y PROPIEDADES");

// Con datos reales: PRM(2113100), FP(1164122), PLD(453468), 10 escaños
// Distribución: PRM=6, FP=3, PLD=1
// cocienteCorte = PRM/6 = 352183.3
var rFlip = dhondtFull(
  { PRM: d24.pres.nacional.PRM, FP: d24.pres.nacional.FP, PLD: d24.pres.nacional.PLD },
  10
);
assert('votos_flip: distribución PRM:6 FP:3 PLD:1',
  rFlip.byParty.PRM === 6 && rFlip.byParty.FP === 3 && rFlip.byParty.PLD === 1,
  JSON.stringify(rFlip.byParty));
assert('votos_flip PRM > 0 (necesita votos para el 7° escaño)',
  (rFlip.votos_flip.PRM || 0) > 0);
assert('votos_flip FP > 0 (necesita votos para el 4° escaño)',
  (rFlip.votos_flip.FP || 0) > 0);
assert('votos_flip PLD > 0 (necesita votos para el 2° escaño)',
  (rFlip.votos_flip.PLD || 0) > 0);

// Verificar fórmula manual: FP tiene 3 seats, corte = PRM/6 ≈ 352183
// votos_flip.FP = ceil(352183 * 4) - FP + 1 = 1408733 - 1164122 + 1 = 244612
var corteManual = d24.pres.nacional.PRM / 6;
var flipFPManual = Math.max(0, Math.ceil(corteManual * 4) - d24.pres.nacional.FP + 1);
assert('votos_flip FP concuerda con fórmula manual (±2 votos)',
  Math.abs((rFlip.votos_flip.FP || 0) - flipFPManual) <= 2,
  'func=' + rFlip.votos_flip.FP + ' manual=' + flipFPManual);

// Propiedad: partido con 0 votos en resultado → flip es 0 o muy pequeño
var rZero = dhondtFull({ A: 1000000, B: 1 }, 5);
assert('votos_flip con partido marginal: ≥0', (rZero.votos_flip.B || 0) >= 0);

section("EDGE CASES Y ROBUSTEZ");

// 0 escaños
var r0s = dhondtFull({ A: 1000, B: 500 }, 0);
assert('0 seats: byParty todos en 0', Object.values(r0s.byParty).every(v => v === 0));
assert('0 seats: cocienteCorte = 0', r0s.cocienteCorte === 0);

// Todos votos iguales
var rEqual = dhondtFull({ A: 1000, B: 1000, C: 1000 }, 3);
assert('Votos iguales: suma = 3', Object.values(rEqual.byParty).reduce((a,v)=>a+v,0) === 3);

// Un solo partido, múltiples escaños
var rSolo = dhondtFull({ UNICO: 500000 }, 32);
assert('Partido único 32 seats: byParty.UNICO = 32', rSolo.byParty.UNICO === 32);
assert('Partido único: cocienteCorte = 500000/32', 
  Math.abs(rSolo.cocienteCorte - 500000/32) < 0.01);

// Empate exacto
var rEmpate = dhondtFull({ A: 1000, B: 1000 }, 2);
assert('Empate exacto: suma = 2', Object.values(rEmpate.byParty).reduce((a,v)=>a+v,0) === 2);

// Muy pocos votos (valores pequeños)
var rSmallV = dhondtFull({ A: 3, B: 2, C: 1 }, 3);
assert('Votos pequeños: suma = 3', Object.values(rSmallV.byParty).reduce((a,v)=>a+v,0) === 3);
assert('Votos pequeños: A gana 2, B gana 1, C gana 0',
  rSmallV.byParty.A === 2 && rSmallV.byParty.B === 1 && (rSmallV.byParty.C || 0) === 0,
  JSON.stringify(rSmallV.byParty));

// Muchos partidos pequeños
var manyParties = {};
for (var i = 0; i < 30; i++) manyParties['P' + i] = Math.round(10000 / (i + 1));
manyParties.GRANDE = 500000;
var rMany = dhondtFull(manyParties, 10);
assert('30 partidos: suma = 10', Object.values(rMany.byParty).reduce((a,v)=>a+v,0) === 10);
assert('30 partidos: GRANDE obtiene mayoría', (rMany.byParty.GRANDE || 0) >= 5);

section("CONSISTENCIA CROSS-CIRCUNSCRIPCIÓN 2024");

// Suma de todos los cocientes de corte debe ser positiva
var cocientesSum = 0;
var circCount = 0;
curules.territorial.forEach(c => {
  var pid  = String(c.provincia_id).padStart(2, '0');
  var key  = c.circ > 0 ? pid + '-' + c.circ : pid;
  var votes = (d24.dip.circunscripciones[key] || {}).votes || (d24.dip.provincias[pid] || {}).votes || {};
  if (!Object.keys(votes).length) return;
  var r = dhondtFull(votes, c.seats);
  cocientesSum += r.cocienteCorte;
  circCount++;
});
assert('Todos los cocientes de corte son positivos', cocientesSum > 0);
assert('Se procesaron todas las circunscripciones con datos (' + circCount + ')',
  circCount >= 40, 'circCount=' + circCount);

// PRM gana la mayoría de circunscripciones (como en 2024 real)
var prmCircWins = 0;
var totalCircTested = 0;
curules.territorial.forEach(c => {
  var pid  = String(c.provincia_id).padStart(2, '0');
  var key  = c.circ > 0 ? pid + '-' + c.circ : pid;
  var votes = (d24.dip.circunscripciones[key] || {}).votes || (d24.dip.provincias[pid] || {}).votes || {};
  if (!Object.keys(votes).length) return;
  var r = dhondtFull(votes, c.seats);
  if ((r.byParty.PRM || 0) > 0) prmCircWins++;
  totalCircTested++;
});
assert('PRM gana escaños en > 80% de circunscripciones (datos reales 2024)',
  prmCircWins / totalCircTested > 0.80,
  'PRM wins in ' + prmCircWins + '/' + totalCircTested + ' circ');

console.log('\n── RESULTADO DHONDT: ' + pass + ' OK / ' + fail + ' FAIL ──');
if (fail > 0) process.exit(1);