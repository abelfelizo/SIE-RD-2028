/**
 * SIE 2028 — core/movilizacion.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de movilización electoral.
 *
 * OBJETIVO:
 *   Identificar los territorios donde reducir la abstención genera el mayor
 *   impacto electoral (más curules, mayor margen presidencial).
 *
 * LÓGICA:
 *   1. Para cada provincia, calcula el "potencial de movilización":
 *      potencial = inscritos_abstenciones × (share_partido_objetivo / 100)
 *      → Votos adicionales que ganaría el partido si convierte abstenciones
 *
 *   2. Para senadores: calcula cuántos votos adicionales necesita el
 *      "partido objetivo" para voltear cada provincia (margen_flip).
 *
 *   3. Para diputados: calcula cuántos votos adicionales necesita para
 *      ganar el siguiente escaño (votos_flip del D'Hondt).
 *
 *   4. Retorna un ranking de territorios por ROI electoral (escaños/votos).
 *
 * DATOS:
 *   Usa datos 2024 como baseline de abstención territorial.
 *   Compatible con padron proyectado 2028.
 */

'use strict';

// ─── Análisis de abstención por provincia ────────────────────────────────────

/**
 * Calcula el padrón de abstenciones y potencial de movilización por provincia.
 *
 * @param {object[]} padronRows   — rows de padron_2024_unificado.json
 * @param {object}   sharesPres   — { PARTIDO: fraccion } presidencial proyectado
 * @param {string}   [partido]    — partido objetivo (default 'PRM')
 * @returns {object[]} ranking por potencial de movilización
 */
export function calcPotencialMov(padronRows, sharesPres, partido) {
  var p = partido || 'PRM';
  var shareP = sharesPres[p] || 0;

  return (padronRows || []).map(function(row) {
    var pid          = String(row.provincia_id).padStart(2, '0');
    var abstenciones = row.abstencion_pres || (row.inscritos - (row.emitidos_pres || 0));
    var participacion = row.participacion_pres || (row.emitidos_pres / row.inscritos);

    // Votos adicionales si convirtiera 10% de abstenciones
    var potencial10  = Math.round(abstenciones * 0.10 * shareP);
    // Votos adicionales si convirtiera 5%
    var potencial5   = Math.round(abstenciones * 0.05 * shareP);
    // Potencial máximo si participación llegara a 70%
    var partObj      = Math.max(0, 0.70 - participacion);
    var potencialMax = Math.round(row.inscritos * partObj * shareP);

    return {
      provincia_id:  row.provincia_id,
      provincia:     row.provincia,
      pid:           pid,
      inscritos:     row.inscritos,
      emitidos:      row.emitidos_pres || Math.round(row.inscritos * participacion),
      abstenciones:  abstenciones,
      participacion: (participacion * 100).toFixed(1) + '%',
      tasa:          participacion,
      share_partido: (shareP * 100).toFixed(1) + '%',
      potencial_5pct:  potencial5,
      potencial_10pct: potencial10,
      potencial_hasta70: potencialMax,
    };
  }).sort(function(a, b) { return b.potencial_10pct - a.potencial_10pct; });
}

// ─── Análisis de flip senatorial ──────────────────────────────────────────────

/**
 * Para cada provincia, calcula cuántos votos necesita el partido objetivo
 * para ganar el senado (margen_flip).
 *
 * @param {object}   senProv    — { provId: { votes, ganador } } del senado proyectado
 * @param {string}   partido    — partido objetivo
 * @param {object[]} padronRows — para cruzar con abstención
 * @returns {object[]} ranking de provincias por flip más fácil (menor margen_flip)
 */
export function calcFlipSenatorial(senProv, partido, padronRows) {
  var padronByPid = {};
  (padronRows || []).forEach(function(r) {
    padronByPid[String(r.provincia_id).padStart(2,'0')] = r;
  });

  var resultado = [];

  Object.keys(senProv).forEach(function(pid) {
    var prov = senProv[pid] || {};
    var votes = prov.votes || {};
    var sorted = Object.entries(votes).filter(function(e) {
      return !['EMITIDOS','VALIDOS','NULOS'].includes(e[0]);
    }).sort(function(a, b) { return b[1] - a[1]; });

    if (!sorted.length) return;

    var ganadorActual = sorted[0][0];
    var votosGanador  = sorted[0][1];
    var votosPartido  = votes[partido] || 0;
    var total         = sorted.reduce(function(a,e){return a+e[1];},0);

    // Margen para voltear la provincia
    var margenFlip   = votosGanador - votosPartido + 1;
    var margenFlipPct = total > 0 ? margenFlip / total : 1;

    // Comparar con potencial de abstenciones
    var padronRow     = padronByPid[pid];
    var abstenciones  = padronRow ? padronRow.abstencion_pres : 0;
    var flipConAbst   = abstenciones > 0 ? (margenFlip / abstenciones) : null;

    resultado.push({
      pid:           pid,
      nombre:        prov.nombre || pid,
      ganador_actual: ganadorActual,
      votos_ganador: votosGanador,
      votos_partido: votosPartido,
      margen_flip:   margenFlip,
      margen_pct:    (margenFlipPct * 100).toFixed(2) + '%',
      es_objetivo:   ganadorActual === partido,
      abstenciones:  abstenciones,
      flip_req_pct_abst: flipConAbst != null ? (flipConAbst * 100).toFixed(1) + '%' : 'n/a',
      flippable:     abstenciones > 0 && margenFlip > 0 && margenFlip < abstenciones * 0.20,
    });
  });

  // Ordenar: primero las que el partido ya NO gana, por menor margen_flip
  return resultado
    .filter(function(r) { return !r.es_objetivo; })
    .sort(function(a, b) { return a.margen_flip - b.margen_flip; })
    .concat(resultado.filter(function(r) { return r.es_objetivo; })
      .sort(function(a, b) { return a.margen_flip - b.margen_flip; }));
}

// ─── ROI electoral de movilización ───────────────────────────────────────────

/**
 * Combina el análisis senatorial y de diputados para rankear provincias
 * por ROI electoral de movilización (escaños posibles / votos necesarios).
 *
 * @param {object[]} potencialMov — output de calcPotencialMov()
 * @param {object[]} flipSen      — output de calcFlipSenatorial()
 * @param {object}   dipFlips     — { circKey: votos_flip } del D'Hondt
 * @returns {object[]} ranking ROI por provincia
 */
export function rankROIMov(potencialMov, flipSen, dipFlips) {
  var senByPid = {};
  (flipSen || []).forEach(function(r) { senByPid[r.pid] = r; });

  var potByPid = {};
  (potencialMov || []).forEach(function(r) { potByPid[r.pid] = r; });

  var resultado = [];

  Object.keys(potByPid).forEach(function(pid) {
    var pot = potByPid[pid];
    var sen = senByPid[pid];

    var escanosSen = 0;
    var votosNecSen = Infinity;
    if (sen && !sen.es_objetivo && sen.flippable) {
      escanosSen  = 1;
      votosNecSen = sen.margen_flip;
    }

    // Diputados: buscar circs de esta provincia con flip posible
    var dipEscanos = 0;
    var dipVotosNec = 0;
    if (dipFlips) {
      Object.keys(dipFlips).forEach(function(key) {
        if (key.startsWith(pid)) {
          var flip = dipFlips[key];
          if (flip && flip > 0 && flip < (pot.potencial_10pct || 0)) {
            dipEscanos++;
            dipVotosNec += flip;
          }
        }
      });
    }

    var totalEscanos = escanosSen + dipEscanos;
    var roi = totalEscanos > 0 && pot.potencial_10pct > 0
      ? (totalEscanos / (votosNecSen < Infinity ? votosNecSen : pot.potencial_10pct) * 10000).toFixed(2)
      : '0';

    resultado.push({
      pid:           pid,
      provincia:     pot.provincia,
      abstenciones:  pot.abstenciones,
      potencial_10p: pot.potencial_10pct,
      sen_flippable: escanosSen > 0,
      dip_escanos:   dipEscanos,
      total_escanos: totalEscanos,
      roi:           parseFloat(roi),
      prioridad:     totalEscanos > 0 ? 'ALTA' : pot.potencial_10pct > 10000 ? 'MEDIA' : 'BAJA',
    });
  });

  return resultado.sort(function(a, b) {
    // Primero por total_escanos, luego por ROI, luego por potencial
    if (b.total_escanos !== a.total_escanos) return b.total_escanos - a.total_escanos;
    if (b.roi !== a.roi) return b.roi - a.roi;
    return b.potencial_10p - a.potencial_10p;
  });
}

// ─── Informe de movilización completo ────────────────────────────────────────

/**
 * Genera el informe completo de movilización para el partido objetivo.
 *
 * @param {object} params
 * @param {object[]} params.padronRows     — rows padron_2024_unificado.json
 * @param {object}   params.sharesPres     — shares proyectados 2028
 * @param {object}   params.senProv        — resultados senatoriales proyectados por provincia
 * @param {object}   [params.dipFlips]     — flip votes del D'Hondt por circuito
 * @param {string}   [params.partido]      — partido objetivo (default 'PRM')
 * @returns {InformeMov}
 */
export function generarInformeMov(params) {
  var partido = params.partido || 'PRM';

  var potencial = calcPotencialMov(params.padronRows, params.sharesPres, partido);
  var flipSen   = calcFlipSenatorial(params.senProv, partido, params.padronRows);
  var roi       = rankROIMov(potencial, flipSen, params.dipFlips || {});

  // Resumen ejecutivo
  var totalAbst = potencial.reduce(function(a, r) { return a + r.abstenciones; }, 0);
  var topProvincias = roi.slice(0, 10);

  return {
    partido:        partido,
    resumen: {
      total_abstencion_nacional: totalAbst,
      provincias_flippables_sen: flipSen.filter(function(r) { return r.flippable; }).length,
      provincias_alta_prioridad: roi.filter(function(r) { return r.prioridad === 'ALTA'; }).length,
      top_3_por_roi:             topProvincias.slice(0, 3).map(function(r) { return r.provincia; }),
    },
    ranking_potencial:   potencial.slice(0, 15),
    ranking_flip_sen:    flipSen.slice(0, 10),
    ranking_roi:         topProvincias,
    todas_provincias:    roi,
  };
}

/**
 * @typedef {Object} InformeMov
 * @property {string}   partido
 * @property {object}   resumen
 * @property {object[]} ranking_potencial
 * @property {object[]} ranking_flip_sen
 * @property {object[]} ranking_roi
 */
