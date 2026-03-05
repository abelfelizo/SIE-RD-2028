/**
 * SIE 2028 — core/dhondt_engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor D'Hondt completo para Capa 3.
 * Extiende dhondt.js con: cociente de corte, votos_flip, auditoría completa.
 *
 * COMPATIBILIDAD: No modifica dhondt.js.
 * Exporta funciones nuevas que Capa 3 (capa3_resultados.js) llama directamente.
 *
 * TERMINOLOGÍA:
 *   cociente_corte    = el cociente del último escaño asignado (threshold)
 *   votos_flip        = votos adicionales para que targetParty gane 1 escaño más
 *                       a costa del partido con el cociente más bajo entre ganadores
 *   margen_escano     = distancia entre el cociente_corte del ganador y el siguiente
 *                       partido no ganador (qué tan "seguro" está el último escaño)
 *
 * DATOS VALIDADOS 2024 (curules_2024.json):
 *   territorial: 178 escaños en 45 circunscripciones (circ > 0 → key = "PP-C")
 *   exterior:      7 escaños en 3 circunscripciones (C1, C2, C3)
 *   nacionales:    5 escaños sobre totales nacionales
 *   total:       190 escaños
 */

import { clamp } from './utils.js';

// ─── Core D'Hondt con auditoría ───────────────────────────────────────────────

/**
 * D'Hondt completo para una circunscripción.
 *
 * @param {object} votes  { partido: votos_enteros }
 * @param {number} seats  escaños a repartir
 * @returns {DhondtResult}
 *
 * @typedef {object} DhondtResult
 * @property {object}  byParty          { partido: escaños_asignados }
 * @property {number}  cocienteCorte    cociente del último escaño asignado
 * @property {number}  cocienteSiguiente cociente del primer partido no asignado
 * @property {number}  margenCorte      cocienteCorte - cocienteSiguiente (≥ 0)
 * @property {object}  cocientes        { partido: [q1, q2, ...] } todos los cocientes
 * @property {object}  votos_flip       { partido: votos_adicionales_para_ganar_1_mas }
 * @property {number}  totalSeats       suma de escaños = seats
 * @property {boolean} empate           true si hubo empate exacto en el corte
 */
export function dhondtFull(votes, seats) {
  if (!seats || seats <= 0) {
    return _emptyResult(votes, seats);
  }

  var parties = Object.keys(votes).filter(function(p) {
    return Number(votes[p] || 0) > 0;
  });

  if (!parties.length) return _emptyResult(votes, seats);

  // Generar todos los cocientes v/d para d = 1..seats
  var allQ = [];
  var cocientesByParty = {};
  parties.forEach(function(p) {
    var v = Number(votes[p]);
    cocientesByParty[p] = [];
    for (var d = 1; d <= seats; d++) {
      var q = v / d;
      allQ.push({ party: p, q: q, d: d });
      cocientesByParty[p].push(q);
    }
  });

  // Ordenar y tomar top-seats
  allQ.sort(function(a, b) { return b.q - a.q; });
  var ganadores = allQ.slice(0, seats);
  var noGanadores = allQ.slice(seats);

  // Contar escaños por partido
  var byParty = {};
  parties.forEach(function(p) { byParty[p] = 0; });
  ganadores.forEach(function(g) { byParty[g.party]++; });

  var cocienteCorte     = ganadores.length ? ganadores[ganadores.length - 1].q : 0;
  var cocienteSiguiente = noGanadores.length ? noGanadores[0].q : 0;
  var margenCorte       = cocienteCorte - cocienteSiguiente;
  var empate            = Math.abs(margenCorte) < 0.5; // < 0.5 votos = empate práctico

  // votos_flip: para cada partido no-ganador (o con escaños < max posible),
  // ¿cuántos votos necesita para arrebatar el escaño más débil al ganador actual?
  var votosFlip = _calcVotosFlip(votes, seats, byParty, cocienteCorte, parties);

  return {
    byParty:           byParty,
    cocienteCorte:     cocienteCorte,
    cocienteSiguiente: cocienteSiguiente,
    margenCorte:       margenCorte,
    cocientes:         cocientesByParty,
    votos_flip:        votosFlip,
    totalSeats:        seats,
    empate:            empate,
  };
}

/**
 * votos_flip: votos adicionales para que targetParty gane 1 escaño más.
 * Fórmula: targetParty necesita un cociente q > cocienteCorte para el divisor (actual+1).
 *   votos_necesarios = ceil(cocienteCorte * (escaños_actuales + 1))
 *   votos_flip = max(0, votos_necesarios - votos_actuales + 1)
 *
 * Si targetParty ya tiene todos los escaños posibles, retorna Infinity.
 */
export function calcVotosFlip(votes, seats, targetParty) {
  var { byParty, cocienteCorte } = dhondtFull(votes, seats);
  var current = byParty[targetParty] || 0;
  if (current >= seats) return Infinity;
  var nextDiv    = current + 1;
  var vNecesario = Math.ceil(cocienteCorte * nextDiv);
  return Math.max(0, vNecesario - (Number(votes[targetParty] || 0)) + 1);
}

function _calcVotosFlip(votes, seats, byParty, cocienteCorte, parties) {
  var out = {};
  parties.forEach(function(p) {
    var current    = byParty[p] || 0;
    if (current >= seats) { out[p] = Infinity; return; }
    var nextDiv    = current + 1;
    var vNecesario = Math.ceil(cocienteCorte * nextDiv);
    out[p] = Math.max(0, vNecesario - Number(votes[p] || 0) + 1);
  });
  return out;
}

function _emptyResult(votes, seats) {
  var byParty = {};
  Object.keys(votes || {}).forEach(function(p) { byParty[p] = 0; });
  return {
    byParty: byParty, cocienteCorte: 0, cocienteSiguiente: 0,
    margenCorte: 0, cocientes: {}, votos_flip: {}, totalSeats: seats || 0, empate: false,
  };
}

// ─── D'Hondt para todas las circunscripciones de diputados ───────────────────

/**
 * Corre D'Hondt en todas las circunscripciones (territorial + exterior + nacionales).
 * Fuente de datos: ctx.r[year].dip (normalizado por data.js).
 *
 * @param {object} ctx            - contexto SIE con ctx.curules y ctx.r[year].dip
 * @param {object} votesOverride  - { circKey: {partido: votos} } — si se pasa, usa esto
 *                                  en vez de los datos base. Para simulaciones 2028.
 * @param {number} [year=2024]
 * @returns {DhondtDipResult}
 *
 * @typedef {object} DhondtDipResult
 * @property {object} totalByParty   { partido: escaños_totales }
 * @property {object} byCirc         { circKey: DhondtResult & { seats, circKey, provincia, circ } }
 * @property {number} totalSeats     debe ser 190
 * @property {object} trazabilidad  { totalSeats, circCount, warnings[] }
 */
export function dhondtDipFull(ctx, votesOverride, year) {
  year = year || 2024;
  var cur = ctx.curules;
  if (!cur || !cur.territorial) {
    return { totalByParty: {}, byCirc: {}, totalSeats: 0,
             trazabilidad: { warnings: ['curules.territorial no encontrado'] } };
  }

  var lv       = (ctx.r && ctx.r[year] && ctx.r[year].dip) || { nacional: {}, prov: {}, circ: {}, extDip: {} };
  var override = votesOverride || {};
  var totalByParty = {};
  var byCirc       = {};
  var warnings     = [];

  // ── Territorial ──────────────────────────────────────────────────────────
  cur.territorial.forEach(function(c) {
    var pid  = String(c.provincia_id).padStart(2, '0');
    var key  = c.circ > 0 ? pid + '-' + c.circ : pid;

    var votes = override[key] || _getCircVotes(lv, key, pid);

    if (!votes || !Object.keys(votes).length) {
      warnings.push('Sin datos para circ ' + key);
      return;
    }

    var res = dhondtFull(votes, c.seats);
    byCirc[key] = Object.assign({}, res, {
      seats: c.seats, circKey: key,
      provincia: c.provincia, circ: c.circ,
    });

    Object.entries(res.byParty).forEach(function(e) {
      totalByParty[e[0]] = (totalByParty[e[0]] || 0) + e[1];
    });
  });

  // ── Exterior ─────────────────────────────────────────────────────────────
  (cur.exterior || []).forEach(function(ext) {
    var ckey  = 'C' + ext.circ_exterior;
    var votes = override[ckey] || (lv.extDip && lv.extDip[ckey] && lv.extDip[ckey].votes) || lv.nacional.votes || {};

    if (!Object.keys(votes).length) {
      warnings.push('Sin datos para exterior ' + ckey);
      return;
    }

    var res = dhondtFull(votes, ext.seats);
    byCirc[ckey] = Object.assign({}, res, {
      seats: ext.seats, circKey: ckey, exterior: true,
    });
    Object.entries(res.byParty).forEach(function(e) {
      totalByParty[e[0]] = (totalByParty[e[0]] || 0) + e[1];
    });
  });

  // ── Nacionales ───────────────────────────────────────────────────────────
  var nacSeats = (cur.nacionales && cur.nacionales.seats) || 0;
  if (nacSeats > 0) {
    // Nacionales usan los totales acumulados del territorial como proxy de votos
    var nacVotes = override['_nacionales'] || lv.nacional.votes || {};
    if (Object.keys(nacVotes).length) {
      var res = dhondtFull(nacVotes, nacSeats);
      byCirc['_nacionales'] = Object.assign({}, res, {
        seats: nacSeats, circKey: '_nacionales', nacionales: true,
      });
      Object.entries(res.byParty).forEach(function(e) {
        totalByParty[e[0]] = (totalByParty[e[0]] || 0) + e[1];
      });
    }
  }

  var totalSeats = Object.values(totalByParty).reduce(function(a, v) { return a + v; }, 0);

  return {
    totalByParty: totalByParty,
    byCirc:       byCirc,
    totalSeats:   totalSeats,
    trazabilidad: {
      totalSeats:  totalSeats,
      circCount:   Object.keys(byCirc).length,
      year:        year,
      warnings:    warnings,
    },
  };
}

function _getCircVotes(lv, key, pid) {
  if (lv.circ && lv.circ[key] && lv.circ[key].votes) return lv.circ[key].votes;
  if (lv.prov && lv.prov[pid] && lv.prov[pid].votes) return lv.prov[pid].votes;
  return lv.nacional ? lv.nacional.votes : {};
}

// ─── Shims de compatibilidad ────────────────────────────────────────────────
// Permiten que simulacion.js, alertas.js y boleta.js importen desde aquí
// sin cambiar sus import paths (solo cambian "./dhondt.js" → "./dhondt_engine.js")

/**
 * dhondt() — shim compatible con la firma original de dhondt.js
 * @returns {{ byParty, threshold }}
 */
export function dhondt(votes, seats) {
  var r = dhondtFull(votes, seats);
  return { byParty: r.byParty, threshold: r.cocienteCorte };
}

/**
 * nextSeatVotes() — shim compatible con alertas.js
 */
export function nextSeatVotes(votes, seats, targetParty) {
  return calcVotosFlip(votes, seats, targetParty);
}
