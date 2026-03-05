/**
 * SIE 2028 — core/capa3_resultados.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Capa 3: Motor de resultados electorales finales.
 * Convierte votos proyectados (output de Capa 2) en escaños y ganadores.
 *
 * NIVELES:
 *   presidencial  — regla >50% voto válido; si ninguno → segunda vuelta
 *   senadores     — pluralidad simple por provincia (32 provincias = 32 senadores)
 *   diputados     — D'Hondt por circunscripción (178 terr + 7 ext + 5 nac = 190)
 *   alcaldes/DM   — pluralidad simple por municipio/DM
 *
 * COMPATIBILIDAD:
 *   - No modifica ningún archivo existente
 *   - Input: ctx con r[2028] (construido por buildCtx2028 + renormalizarCtx)
 *   - Output: electoralResult2028 — shape compatible con lo que simular() ya produce
 *     para que views/simulador.js, views/dashboard.js y views/objetivo.js
 *     puedan consumirlo sin cambios
 *
 * DATOS REALES VALIDADOS:
 *   PRM 2024: 48.41% → segunda vuelta (< 50%) en datos JCE
 *   Sen: 32 provincias, pluralidad → 32 senadores
 *   Dip: 45 circ territorial + 3 exterior + 1 nacional = 190
 */

import { dhondtFull, dhondtDipFull }          from './dhondt_engine.js';
import { renormalizarNivel, renormalizarCtx }  from './renormalizar_votos.js';
import { rankVotes }                           from './utils.js';
import { getLevel }                            from './data.js';

// ─── Constantes ──────────────────────────────────────────────────────────────
var UMBRAL_PRES     = 0.50;  // >50% votos válidos para ganar en primera vuelta
var TOTAL_SENADORES = 32;
var TOTAL_DIP_TERR  = 178;
var TOTAL_DIP_EXT   = 7;
var TOTAL_DIP_NAC   = 5;
var TOTAL_DIP       = 190;   // 178 + 7 + 5

// ─── Presidencial ────────────────────────────────────────────────────────────

/**
 * Resultado presidencial nacional.
 *
 * @param {object} votes    { partido: votos }
 * @param {number} validos  total votos válidos (denominador para el 50%)
 * @param {number} emitidos total emitidos (para participación)
 * @param {number} inscritos padrón total
 * @returns {PresResult}
 *
 * @typedef {object} PresResult
 * @property {string}  ganador           partido ganador (o null si segunda vuelta)
 * @property {boolean} primeraVuelta     true si ganador > 50%
 * @property {boolean} segundaVuelta     true si nadie llega a 50%
 * @property {number}  pctGanador        % del ganador sobre votos válidos
 * @property {number}  margenHacia50     pctGanador - 0.50 (negativo si en riesgo)
 * @property {number}  votosParaGanar    votos adicionales para llegar a 50%+1 (0 si ya ganó)
 * @property {Array}   ranked            [{p, v, pct}] ordenado
 * @property {number}  participacion     emitidos / inscritos
 * @property {object}  rawVotes          copia de votes (para arrastre)
 * @property {number}  emitidos
 * @property {number}  validos
 */
export function calcPresidencial(votes, validos, emitidos, inscritos) {
  var ranked    = rankVotes(votes, validos);
  if (!ranked.length) return _emptyPresResult(emitidos, inscritos);

  var top1      = ranked[0];
  var pct1      = top1.pct;                     // sobre votos válidos
  var primera   = pct1 > UMBRAL_PRES;
  var segunda   = !primera;
  var margen50  = pct1 - UMBRAL_PRES;
  var vPara50   = primera ? 0 : Math.ceil(UMBRAL_PRES * validos) - top1.v + 1;

  // Alertas
  var alertas = [];
  if (segunda) {
    alertas.push({
      tipo: 'segunda_vuelta',
      nivel_alerta: 'error',
      msg: 'Segunda vuelta requerida',
      detalle: top1.p + ' con ' + (pct1 * 100).toFixed(2) +
               '% — necesita 50%+1 (faltan ' + Math.ceil(Math.abs(margen50) * 100 * 10) / 10 + 'pp)',
    });
  }
  if (ranked.length >= 2 && (pct1 - ranked[1].pct) < 0.05) {
    alertas.push({
      tipo: 'margen_bajo',
      nivel_alerta: 'warn',
      msg: 'Margen presidencial < 5pp',
      detalle: top1.p + ' vs ' + ranked[1].p + ': ' + ((pct1 - ranked[1].pct) * 100).toFixed(1) + 'pp',
    });
  }

  return {
    nivel:          'pres',
    ganador:        primera ? top1.p : null,
    primeraVuelta:  primera,
    segundaVuelta:  segunda,
    pctGanador:     pct1,
    margenHacia50:  margen50,
    votosParaGanar: vPara50,
    ranked:         ranked,
    participacion:  inscritos ? emitidos / inscritos : 0,
    rawVotes:       Object.assign({}, votes),
    emitidos:       emitidos,
    validos:        validos,
    inscritos:      inscritos || 0,
    alertas:        alertas,
  };
}

function _emptyPresResult(emitidos, inscritos) {
  return {
    nivel: 'pres', ganador: null, primeraVuelta: false, segundaVuelta: true,
    pctGanador: 0, margenHacia50: -0.5, votosParaGanar: 0,
    ranked: [], participacion: 0, rawVotes: {}, emitidos: emitidos || 0,
    validos: 0, inscritos: inscritos || 0, alertas: [],
  };
}

// ─── Senadores ────────────────────────────────────────────────────────────────

/**
 * Resultado senatorial: pluralidad por provincia.
 * 32 provincias → 32 senadores (1 por provincia).
 *
 * @param {object} provVotes  { provId: { votes: {partido: n}, meta: {...} } }
 *                            | { provId: {partido: n} }  (formato simplificado)
 * @returns {SenResult}
 *
 * @typedef {object} SenResult
 * @property {object} byProv        { provId: { ganador, vGanador, vSegundo, margen, ranked } }
 * @property {object} totalByParty  { partido: num_senadores }
 * @property {number} totalSeats    debe ser 32
 * @property {object} votos_flip    { provId: votos_adicionales_para_voltear }
 */
export function calcSenadores(provVotes) {
  var byProv       = {};
  var totalByParty = {};
  var votosFlip    = {};

  Object.entries(provVotes || {}).forEach(function(e) {
    var id   = e[0];
    var data = e[1];

    // Acepta tanto { votes, meta } como { partido: n } directo
    var votes   = (data && data.votes) ? data.votes : data;
    var validos = (data && data.meta && data.meta.validos) || null;
    var ranked  = rankVotes(votes, validos);
    if (!ranked.length) return;

    var ganador  = ranked[0];
    var segundo  = ranked[1] || { p: null, v: 0, pct: 0 };
    var margen   = ganador.pct - segundo.pct;

    byProv[id] = {
      ganador:   ganador.p,
      vGanador:  ganador.v,
      pctGanador: ganador.pct,
      vSegundo:  segundo.v,
      pctSegundo: segundo.pct,
      margen:    margen,
      ranked:    ranked,
    };

    totalByParty[ganador.p] = (totalByParty[ganador.p] || 0) + 1;

    // votos_flip: votos que necesita el segundo para voltear
    // = ceil((vGanador - vSegundo) / 2) + 1
    if (segundo.v > 0) {
      votosFlip[id] = {
        targetParty: segundo.p,
        votosNecesarios: Math.ceil((ganador.v - segundo.v) / 2) + 1,
      };
    }
  });

  var totalSeats = Object.values(totalByParty).reduce(function(a, v) { return a + v; }, 0);
  var alertas    = [];
  if (totalSeats !== TOTAL_SENADORES) {
    alertas.push({ tipo: 'suma_senadores', msg: 'Senadores asignados: ' + totalSeats + ' (esperado ' + TOTAL_SENADORES + ')' });
  }

  return {
    nivel:        'sen',
    byProv:       byProv,
    totalByParty: totalByParty,
    totalSeats:   totalSeats,
    votos_flip:   votosFlip,
    alertas:      alertas,
  };
}

// ─── Diputados (D'Hondt) ─────────────────────────────────────────────────────

/**
 * Resultado de diputados usando D'Hondt en todas las circunscripciones.
 * Delega en dhondtDipFull() del dhondt_engine.
 *
 * @param {object} ctx          - contexto SIE
 * @param {object} [votesOvr]   - { circKey: {partido: votos} } para simulación 2028
 * @param {number} [year]       - año base para datos (default 2024)
 * @returns {DipResult}
 *
 * @typedef {object} DipResult
 * @property {object} totalByParty { partido: escaños_totales }
 * @property {object} byCirc       { circKey: DhondtResult + metadata }
 * @property {number} totalSeats   debe ser 190
 * @property {object} mayoria      { tiene: bool, partido, escaños, faltanPara96: n }
 * @property {object} trazabilidad
 */
export function calcDiputados(ctx, votesOvr, year) {
  var result = dhondtDipFull(ctx, votesOvr, year || 2024);

  // Evaluar mayoría absoluta (96/190)
  var MAYORIA_ABS = 96;
  var topParty    = Object.entries(result.totalByParty)
    .sort(function(a, b) { return b[1] - a[1]; })[0];
  var topEscanos  = topParty ? topParty[1] : 0;
  var mayoria = {
    tiene:         topEscanos >= MAYORIA_ABS,
    partido:       topParty ? topParty[0] : null,
    escanos:       topEscanos,
    faltanPara96:  Math.max(0, MAYORIA_ABS - topEscanos),
  };

  var alertas = [];
  if (result.totalSeats !== TOTAL_DIP) {
    alertas.push({ tipo: 'suma_dip', nivel_alerta: 'warn',
      msg: 'Diputados asignados: ' + result.totalSeats + ' (esperado ' + TOTAL_DIP + ')' });
  }
  if (!mayoria.tiene) {
    alertas.push({ tipo: 'sin_mayoria_dip', nivel_alerta: 'warn',
      msg: mayoria.partido + ' sin mayoría absoluta: ' + mayoria.escanos + '/190',
      detalle: 'Faltan ' + mayoria.faltanPara96 + ' para mayoría' });
  }

  return {
    nivel:        'dip',
    totalByParty: result.totalByParty,
    byCirc:       result.byCirc,
    totalSeats:   result.totalSeats,
    mayoria:      mayoria,
    trazabilidad: result.trazabilidad,
    alertas:      alertas,
  };
}

// ─── Alcaldes / DM ───────────────────────────────────────────────────────────

/**
 * Resultado de alcaldes o directores de DM: pluralidad por territorio.
 * @param {object} territorios  { terrId: { votes, meta } } o { terrId: { partido: n } }
 * @param {string} nivel        'mun' | 'dm'
 */
export function calcGanadoresPluralidad(territorios, nivel) {
  var byTerritory  = {};
  var totalByParty = {};

  Object.entries(territorios || {}).forEach(function(e) {
    var id   = e[0];
    var data = e[1];
    var votes  = (data && data.votes) ? data.votes : data;
    var ranked = rankVotes(votes, null);
    if (!ranked.length) return;

    byTerritory[id] = {
      ganador:    ranked[0].p,
      pctGanador: ranked[0].pct,
      margen:     ranked.length >= 2 ? ranked[0].pct - ranked[1].pct : ranked[0].pct,
      ranked:     ranked,
    };
    totalByParty[ranked[0].p] = (totalByParty[ranked[0].p] || 0) + 1;
  });

  return {
    nivel:        nivel,
    byTerritory:  byTerritory,
    totalByParty: totalByParty,
    totalWon:     Object.values(totalByParty).reduce(function(a, v) { return a + v; }, 0),
  };
}

// ─── Pipeline completo Capa 3 ────────────────────────────────────────────────

/**
 * Ejecuta la Capa 3 completa sobre un ctx con r[2028] ya construido.
 *
 * PIPELINE:
 *   1. renormalizarCtx(ctx2028)         — asegura coherencia territorial
 *   2. calcPresidencial(votes, validos) — presidencial nacional
 *   3. calcSenadores(provVotesSen)      — 32 senadores por pluralidad
 *   4. calcDiputados(ctx, circVotes)    — 190 dip por D'Hondt
 *   5. calcGanadoresPluralidad(mun)     — alcaldes
 *   6. calcGanadoresPluralidad(dm)      — directores DM
 *
 * @param {object} ctx2028   ctx con r[2028] (de buildCtx2028)
 * @returns {ElectoralResult2028}
 *
 * @typedef {object} ElectoralResult2028
 * @property {PresResult}  pres
 * @property {SenResult}   sen
 * @property {DipResult}   dip
 * @property {object}      mun
 * @property {object}      dm
 * @property {object[]}    alertas   todas las alertas de todos los niveles
 * @property {object}      trazabilidad
 */
export function calcResultados2028(ctx2028) {
  // 0. Renormalizar votos territoriales
  var ctxNorm = renormalizarCtx(ctx2028);
  var r2028   = ctxNorm.r[2028];

  // 1. Presidencial
  var natPres = r2028.pres && r2028.pres.nacional || {};
  var pres = calcPresidencial(
    natPres.votes    || {},
    natPres.validos  || natPres.emitidos || 0,
    natPres.emitidos || 0,
    natPres.inscritos || 0
  );

  // 2. Senadores — provincias del nivel sen
  var provSen  = (r2028.sen && r2028.sen.prov) || {};
  var sen      = calcSenadores(provSen);

  // 3. Diputados — D'Hondt por circunscripción
  // Construir votesOverride desde r[2028].dip.circ y prov
  var dipLv    = r2028.dip || {};
  var circOvr  = _buildCircOverride(dipLv, ctxNorm);
  var dip      = calcDiputados(ctxNorm, circOvr, 2028);

  // 4. Alcaldes
  var munTerr  = (r2028.mun && r2028.mun.mun) || {};
  var mun      = calcGanadoresPluralidad(munTerr, 'mun');

  // 5. DM
  var dmTerr   = (r2028.dm && r2028.dm.dm) || {};
  var dm       = calcGanadoresPluralidad(dmTerr, 'dm');

  // Consolidar alertas
  var alertas  = [].concat(
    pres.alertas || [],
    sen.alertas  || [],
    dip.alertas  || []
  );

  return {
    pres:  pres,
    sen:   sen,
    dip:   dip,
    mun:   mun,
    dm:    dm,
    alertas: alertas,
    trazabilidad: {
      renorm:    ctxNorm._renormTrazabilidad || {},
      dip:       dip.trazabilidad,
      padron2028: ctxNorm.padron2028 || {},
    },
  };
}

// ─── Helper: construir override de votos por circunscripción 2028 ─────────────
function _buildCircOverride(dipLv, ctx) {
  var override = {};
  var circ = dipLv.circ || {};
  var prov = dipLv.prov || {};

  // circ keys: "01-1", "01-2", ... → preferir circ sobre prov
  Object.entries(circ).forEach(function(e) {
    if (e[1] && e[1].votes) override[e[0]] = e[1].votes;
  });

  // provincias sin circ (circ=0 en curules): key = "PP"
  Object.entries(prov).forEach(function(e) {
    if (!override[e[0]] && e[1] && e[1].votes) override[e[0]] = e[1].votes;
  });

  // exterior
  var ext = dipLv.extDip || {};
  Object.entries(ext).forEach(function(e) {
    if (e[1] && e[1].votes) override[e[0]] = e[1].votes;
  });

  // nacional para escaños nacionales
  if (dipLv.nacional && dipLv.nacional.votes) {
    override['_nacionales'] = dipLv.nacional.votes;
  }

  return override;
}
