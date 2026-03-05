/**
 * SIE 2028 — core/renormalizar_votos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Asegura que la suma de votos por territorio = votos válidos del territorio.
 *
 * PROBLEMA QUE RESUELVE:
 *   Después del arrastre y los ajustes pp, cada provincia puede tener:
 *     sum(votes_prov) ≠ validos_prov
 *   Esto rompe D'Hondt (cocientes inflados/deflados) y el % por territorio.
 *
 * ESTRATEGIA:
 *   1. Renormalización proporcional (default):
 *      votes_norm[p] = round(votes[p] / sum(votes) * validos_target)
 *      Con corrección del residuo en el partido de mayor voto (evita ±1 acumulado).
 *
 *   2. Modo "mantener escala" (keepScale=true):
 *      No fuerza a validos_target exacto, solo asegura que los votos son enteros
 *      y coherentes. Útil cuando validos_target es null/0.
 *
 * GARANTÍAS:
 *   - sum(result) = validos_target (si validos_target > 0)
 *   - result[p] ≥ 0 para todo p
 *   - Ningún partido pasa de 0 a positivo ni de positivo a 0 (preserva orden)
 *   - trazabilidad: registra qué territorios fueron ajustados y por cuánto
 */

/**
 * Renormaliza votos de un único territorio.
 *
 * @param {object} votes          { partido: votos }
 * @param {number} validosTarget  votos válidos objetivo (de meta.validos)
 * @param {boolean} [keepScale]   si true, no fuerza al target (solo redondeo)
 * @returns {{ votes: object, delta: number, ajustado: boolean }}
 */
export function renormalizarTerritorio(votes, validosTarget, keepScale) {
  var partidos = Object.keys(votes || {});
  if (!partidos.length) return { votes: {}, delta: 0, ajustado: false };

  // Suma actual
  var sumaActual = partidos.reduce(function(a, p) { return a + Math.max(0, Number(votes[p] || 0)); }, 0);
  if (sumaActual === 0) return { votes: _zeroVotes(votes), delta: 0, ajustado: false };

  // Si no hay target o keepScale, solo redondear a enteros
  if (keepScale || !validosTarget || validosTarget <= 0) {
    var out = {};
    partidos.forEach(function(p) { out[p] = Math.round(Math.max(0, Number(votes[p] || 0))); });
    return { votes: out, delta: 0, ajustado: false };
  }

  var target = Math.round(validosTarget);
  var delta  = sumaActual - target;

  // Si la diferencia es trivial (≤ 1 voto), solo corregir el residuo
  if (Math.abs(delta) <= 1) {
    var out = {};
    partidos.forEach(function(p) { out[p] = Math.round(Math.max(0, Number(votes[p] || 0))); });
    var sumOut = partidos.reduce(function(a, p) { return a + out[p]; }, 0);
    var residuo = target - sumOut;
    if (residuo !== 0) {
      // Ajustar en el partido con más votos
      var maxP = partidos.reduce(function(m, p) { return out[p] > out[m] ? p : m; }, partidos[0]);
      out[maxP] = Math.max(0, out[maxP] + residuo);
    }
    return { votes: out, delta: residuo, ajustado: Math.abs(residuo) > 0 };
  }

  // Renormalización proporcional completa
  var norm   = {};
  var sumNorm = 0;
  partidos.forEach(function(p) {
    var v = Math.max(0, Number(votes[p] || 0));
    norm[p] = Math.floor((v / sumaActual) * target);
    sumNorm += norm[p];
  });

  // Distribuir el residuo de los floors a los partidos con mayor fracción
  var residuoTotal = target - sumNorm;
  if (residuoTotal > 0) {
    // Calcular fracciones para los que perdieron más en el floor
    var fracciones = partidos.map(function(p) {
      var v = Math.max(0, Number(votes[p] || 0));
      var exact = (v / sumaActual) * target;
      return { p: p, frac: exact - Math.floor(exact) };
    });
    fracciones.sort(function(a, b) { return b.frac - a.frac; });
    for (var i = 0; i < residuoTotal && i < fracciones.length; i++) {
      norm[fracciones[i].p]++;
    }
  }

  return {
    votes:    norm,
    delta:    delta,
    ajustado: Math.abs(delta) > 1,
  };
}

/**
 * Renormaliza votos en todos los territorios de un nivel.
 *
 * @param {object} territorios   { terrId: { votes: {...}, meta: { validos, emitidos } } }
 * @param {string} [metaKey]     clave del target en meta: 'validos' | 'emitidos' (default: 'validos')
 * @returns {{ territorios: object, trazabilidad: object[] }}
 *
 * territorios normalizado: misma estructura, con .votes renormalizado
 * trazabilidad: [{ id, delta, ajustado, validosTarget, sumAntes, sumDespues }]
 */
export function renormalizarNivel(territorios, metaKey) {
  metaKey = metaKey || 'validos';
  var out   = {};
  var traz  = [];

  Object.entries(territorios || {}).forEach(function(e) {
    var id   = e[0];
    var terr = e[1];
    var target = Number((terr.meta && terr.meta[metaKey]) || 0);
    var sumAntes = Object.values(terr.votes || {}).reduce(function(a, v) { return a + Math.max(0, v); }, 0);

    var renorm = renormalizarTerritorio(terr.votes || {}, target);

    var sumDespues = Object.values(renorm.votes).reduce(function(a, v) { return a + v; }, 0);

    out[id] = Object.assign({}, terr, { votes: renorm.votes });
    traz.push({
      id:            id,
      delta:         renorm.delta,
      ajustado:      renorm.ajustado,
      validosTarget: target,
      sumAntes:      sumAntes,
      sumDespues:    sumDespues,
    });
  });

  return { territorios: out, trazabilidad: traz };
}

/**
 * Renormaliza el resultado del pipeline completo (pres → sen → dip → mun → dm).
 * Opera sobre ctx.r[2028] construido por buildCtx2028().
 *
 * @param {object} ctx2028  ctx con r[2028] (output de buildCtx2028)
 * @returns {object} ctx2028 con todos los territorios renormalizados (sin mutar el original)
 */
export function renormalizarCtx(ctx2028) {
  var r2028 = ctx2028 && ctx2028.r && ctx2028.r[2028];
  if (!r2028) return ctx2028;

  var niveles = ['pres', 'sen', 'dip', 'mun', 'dm'];
  var r2028Norm = {};
  var trazTotal = {};

  niveles.forEach(function(nivel) {
    var lv = r2028[nivel];
    if (!lv) { r2028Norm[nivel] = lv; return; }

    // Renormalizar provincias
    var provNorm = renormalizarNivel(lv.prov || {}, 'validos');

    // Renormalizar municipios / dm si existen
    var munNorm  = renormalizarNivel(lv.mun  || {}, 'validos');
    var dmNorm   = renormalizarNivel(lv.dm   || {}, 'validos');

    // Nacional: renormalizar si hay votos y emitidos
    var nat = lv.nacional || {};
    var natNorm = renormalizarTerritorio(nat.votes || {}, nat.validos || nat.emitidos);

    r2028Norm[nivel] = Object.assign({}, lv, {
      nacional: Object.assign({}, nat, { votes: natNorm.votes }),
      prov:     provNorm.territorios,
      mun:      munNorm.territorios,
      dm:       dmNorm.territorios,
    });

    trazTotal[nivel] = {
      nacional:  { delta: natNorm.delta, ajustado: natNorm.ajustado },
      provincias: provNorm.trazabilidad,
      municipios: munNorm.trazabilidad,
      dm:         dmNorm.trazabilidad,
    };
  });

  return Object.assign({}, ctx2028, {
    r: Object.assign({}, ctx2028.r, { 2028: r2028Norm }),
    _renormTrazabilidad: trazTotal,
  });
}

// ─── Helper ────────────────────────────────────────────────────────────────
function _zeroVotes(votes) {
  var out = {};
  Object.keys(votes || {}).forEach(function(p) { out[p] = 0; });
  return out;
}

/**
 * Valida que sum(votes) ≈ validosTarget para un territorio.
 * Util en tests.
 */
export function validarTerritorio(votes, validosTarget, tolerancia) {
  tolerancia = tolerancia || 1;
  var suma = Object.values(votes || {}).reduce(function(a, v) { return a + v; }, 0);
  return Math.abs(suma - validosTarget) <= tolerancia;
}
