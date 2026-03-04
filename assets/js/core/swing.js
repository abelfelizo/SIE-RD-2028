/**
 * SIE 2028 — core/swing.js  v8.0
 * Motor de Análisis Swing — territorios donde el resultado puede cambiar
 *
 * METODOLOGÍA:
 * Usado en campañas LATAM (MX, CO, BR, CL) como herramienta de targeting.
 *
 * Swing Territory = territorio donde:
 *   1. Margen actual (ganador - segundo) ≤ umbral (típicamente 5-10pp)
 *   2. Tendencia 2020→2024 favorable al partido objetivo
 *   3. Padrón suficientemente grande para impactar resultado nacional
 *
 * Score Swing (0-100):
 *   vulnerabilidad  = 1 - (margen / umbral_max)   → más alto si más competitivo
 *   tendencia_favor = sign(tend) * |tend| * k      → +10 si creciendo, -10 si cayendo
 *   peso_padron     = ins / max_ins                → territorios más grandes ponderan más
 *   swing_score     = 0.5*vulnerabilidad + 0.3*tendencia_favor + 0.2*peso_padron
 *
 * Riesgo Segunda Vuelta (solo pres):
 *   Si top1.pct < 0.50 → en riesgo
 *   Votos necesarios para 50%+1 = (emitidos/2 + 1) - votos_top1
 *
 * Política de datos: cero inventados. Si faltan datos, swing_score = null.
 */

import { rankVotes } from "./utils.js";

var UMBRAL_SWING = 0.10;  // 10pp — territorios con margen ≤ este valor son "swing"
var UMBRAL_CRITICO = 0.05; // 5pp — críticos

/**
 * Analiza territorios swing para un partido objetivo.
 * @param {object} ctx
 * @param {string} nivel
 * @param {string} lider - partido objetivo
 * @param {number} year
 * @returns {Array} territorios ordenados por swing_score desc
 */
export function calcSwing(ctx, nivel, lider, year) {
  year = year || 2024;
  var lv24 = (ctx.r && ctx.r[2024] && ctx.r[2024][nivel]) ? ctx.r[2024][nivel] : null;
  var lv20 = (ctx.r && ctx.r[2020] && ctx.r[2020][nivel]) ? ctx.r[2020][nivel] : null;
  var lv   = (ctx.r && ctx.r[year] && ctx.r[year][nivel]) ? ctx.r[year][nivel] : lv24;

  if (!lv) return [];

  var terr   = nivel === "mun" ? (lv.mun || {}) : nivel === "dm" ? (lv.dm || {}) : (lv.prov || {});
  var terr24 = nivel === "mun" ? (lv24 && lv24.mun || {}) : nivel === "dm" ? (lv24 && lv24.dm || {}) : (lv24 && lv24.prov || {});
  var terr20 = nivel === "mun" ? (lv20 && lv20.mun || {}) : nivel === "dm" ? (lv20 && lv20.dm || {}) : (lv20 && lv20.prov || {});

  var ids = Object.keys(terr);
  if (!ids.length) return [];

  var maxIns = Math.max.apply(null, ids.map(function(id) {
    return (terr[id] && terr[id].inscritos) || 0;
  }).concat([1]));

  return ids.map(function(id) {
    var t     = terr[id];
    var t24   = terr24[id] || t;
    var t20   = terr20 ? terr20[id] : null;

    var em    = t24.emitidos || 0;
    var ranked24 = rankVotes(t24.votes || {}, em || 1);
    var ranked20 = t20 ? rankVotes(t20.votes || {}, t20.emitidos || 1) : [];

    // Posición del partido objetivo
    var lidEntry24 = ranked24.filter(function(r) { return r.p === lider; })[0];
    var lidEntry20 = ranked20.filter(function(r) { return r.p === lider; })[0];

    if (!ranked24.length) return null;

    var top1 = ranked24[0];
    var top2 = ranked24[1] || { pct: 0, p: "-", v: 0 };
    var margen = top1.pct - top2.pct;

    var pct24 = lidEntry24 ? lidEntry24.pct : 0;
    var pct20 = lidEntry20 ? lidEntry20.pct : null;
    var tend  = pct20 !== null ? pct24 - pct20 : 0;

    // ¿Puede el lider voltear este territorio?
    var lidEsTop1 = top1.p === lider;
    var lidEsTop2 = top2 && top2.p === lider;

    // Scores componentes (0-1)
    var vulnScore  = margen <= UMBRAL_SWING ? Math.max(0, 1 - margen / UMBRAL_SWING) : 0;
    var tendScore  = pct20 !== null ? Math.min(1, Math.max(0, 0.5 + tend * 5)) : 0.5;
    var padronScore = t24.inscritos ? t24.inscritos / maxIns : 0;

    // Swing Score final
    var swingScore = Math.round((0.5 * vulnScore + 0.3 * tendScore + 0.2 * padronScore) * 100);

    // Votos que necesita el lider para voltear (si está perdiendo en este terr)
    var votosParaVoltear = null;
    if (!lidEsTop1 && lidEntry24) {
      var vRef = t24.validos || em;
      votosParaVoltear = Math.round((top1.v - lidEntry24.v) / 2) + 1;
    }

    // Clasificación
    var tipo = margen <= UMBRAL_CRITICO ? "critico"
             : margen <= UMBRAL_SWING  ? "swing"
             : margen <= 0.20          ? "proximo"
             : "seguro";

    return {
      id:         id,
      nombre:     t24.nombre || id,
      ins:        t24.inscritos || 0,
      emitidos:   em,
      margen:     margen,
      top1:       top1.p,
      top1pct:    top1.pct,
      top2:       top2.p,
      top2pct:    top2.pct,
      liderPct:   pct24,
      liderTend:  tend,
      lidEsTop1:  lidEsTop1,
      lidEsTop2:  lidEsTop2,
      swingScore: swingScore,
      votosParaVoltear: votosParaVoltear,
      tipo:       tipo,
    };
  })
  .filter(Boolean)
  .sort(function(a, b) { return b.swingScore - a.swingScore; });
}

/**
 * Análisis de riesgo de segunda vuelta (presidencial).
 * En RD la segunda vuelta se activa si ningún candidato supera 50%+1.
 *
 * @param {object} ctx
 * @param {number} year
 * @returns {object} { enRiesgo, pctTop1, votosNecesarios, margenHacia50, partido, escenarios }
 */
export function calcRiesgoSegundaVuelta(ctx, year) {
  year = year || 2024;
  var lv = (ctx.r && ctx.r[year] && ctx.r[year].pres) ? ctx.r[year].pres : null;
  if (!lv) return null;

  var nat     = lv.nacional || {};
  var em      = nat.emitidos || 0;
  var ranked  = rankVotes(nat.votes || {}, em);
  if (!ranked.length) return null;

  var top1    = ranked[0];
  var top2    = ranked[1] || { p: "-", pct: 0, v: 0 };
  var pct50   = 0.5001;  // 50%+1 voto (aproximado como fracción)
  var enRiesgo = top1.pct < pct50;
  var margenHacia50 = top1.pct - pct50;
  var votosNecesarios = enRiesgo ? Math.round((pct50 * em) - top1.v) + 1 : 0;

  // Simulación de escenarios:
  // A. Si todos los votos de 3°, 4°... van a top1
  var votosTercerosMas = ranked.slice(2).reduce(function(sum, r) { return sum + (r.v || 0); }, 0);
  var pctConTransferencia = em > 0 ? (top1.v + votosTercerosMas) / em : top1.pct;

  // B. Si top1 crece +5pp (movilización máxima)
  var pctConMovilizacion = Math.min(1, top1.pct + 0.05);

  return {
    enRiesgo:         enRiesgo,
    pctTop1:          top1.pct,
    top1:             top1.p,
    top2:             top2.p,
    pctTop2:          top2.pct,
    margenHacia50:    margenHacia50,         // negativo si en riesgo
    votosNecesarios:  votosNecesarios,       // 0 si ya tiene mayoría
    votosTerceros:    votosTercerosMas,
    pctConTransferencia: pctConTransferencia, // si todos los terceros apoyan a top1
    pctConMovilizacion:  pctConMovilizacion,
    llegaraConTransferencia: pctConTransferencia >= pct50,
    llegaraConMovilizacion:  pctConMovilizacion >= pct50,
    totalCandidatos:  ranked.length,
    participacion:    em > 0 && nat.inscritos ? em / nat.inscritos : null,
  };
}
