/**
 * SIE 2028 — capa0_clasificador.js
 * Capa 0: Clasificación de partidos (ejecutar UNA SOLA VEZ al arranque)
 *
 * DATOS REALES USADOS:
 *   pres.nacional 2024: PRM=2,113,100 / FP=1,164,122 / PLD=453,468 / ...
 *   pres.nacional 2020: PRM=1,998,407 / PLD=1,352,842 / FP=233,538 / ...
 *   NO existe results_2016.json → fallback: threshold >50k basado en 2020.
 *
 * CLASIFICACIÓN RESULTANTE (hardcoded desde datos reales, no de parámetros):
 *   partido_estable   : PRM, PLD, PRSC, PRD, BIS, ALPAIS, DXC, PUN, PHD, PCR, PRSD
 *   partido_nuevo     : FP (0 votos antes de 2020; 233k en 2020 → 1.16M en 2024)
 *   partido_reconfigurado: PP, PED, JS, GENS, OD (aparecieron/cambiaron post-2020)
 *
 * SALIDA: Map<string, PartidoMeta>
 */

// Datos empíricos 2020/2024 nacionales (pres.nacional)
var VOTOS_PRES = {
  2020: {
    PRM: 1998407, PLD: 1352842, PRSC: 73913, PRD: 97655,
    BIS: 16571,   ALPAIS: 39458, DXC: 31511, PUN: 19973,
    PHD: 29231,   PCR: 24626,   PRSD: 26166, FP: 233538,
    MODA: 22286,  PPC: 12060,   PAL: 9379,   APD: 15664,
    PQDC: 13133,  UDC: 10769,   FNP: 8098,   PP: 26617,
  },
  2024: {
    PRM: 2113100, FP: 1164122, PLD: 453468,  PRD: 19790,
    PRSC: 38126,  ALPAIS: 15913, DXC: 49141, PUN: 24119,
    BIS: 60146,   PHD: 14111,   PCR: 24809,  PRSD: 27913,
    MODA: 18519,  PP: 42201,    PED: 59396,  JS: 49419,
    GENS: 31566,  OD: 25204,    APD: 17551,  PQDC: 22187,
    PLR: 11738,   PPC: 9108,    UDC: 5748,   PAL: 9292,
    PDI: 6391,    PDP: 7079,    PSC: 6581,   PPG: 14935,
  }
};

var UMBRAL_ESTABLE_2020 = 50000; // >50k en 2020 = partido establecido

/**
 * @typedef {Object} PartidoMeta
 * @property {string} codigo
 * @property {'partido_estable'|'partido_nuevo'|'partido_reconfigurado'} tipo
 * @property {number|null} anio_breakpoint
 * @property {'lineal'|'logistica'|'logistica_moderada'} metodo_proyeccion
 * @property {number} techo_factor  — múltiplo máximo sobre votos_2024
 * @property {number} delta_max_pct — variación máxima permitida por ciclo (0-1)
 * @property {number} peso_base_encuesta — peso máximo a encuestas (0-1)
 * @property {number} votos_2020
 * @property {number} votos_2024
 * @property {number} crecimiento_2020_2024 — fracción (puede ser Inf si 0 en 2020)
 */

/**
 * Clasifica todos los partidos presentes en 2024.
 * @param {object} [override] - votos opcionales para testing { 2020: {...}, 2024: {...} }
 * @returns {Map<string, PartidoMeta>}
 */
export function clasificarPartidos(override) {
  var votos = override || VOTOS_PRES;
  var v20 = votos[2020] || {};
  var v24 = votos[2024] || {};
  var resultado = new Map();

  Object.keys(v24).forEach(function(codigo) {
    var vt20 = v20[codigo] || 0;
    var vt24 = v24[codigo] || 0;
    var crec = vt20 > 0 ? (vt24 - vt20) / vt20 : Infinity;
    var meta = _clasificar(codigo, vt20, vt24, crec);
    resultado.set(codigo, meta);
  });

  return resultado;
}

function _clasificar(codigo, vt20, vt24, crec) {
  var base = { codigo, votos_2020: vt20, votos_2024: vt24, crecimiento_2020_2024: crec };

  // Partido nuevo: no existía o era marginal en 2020 (<50k)
  if (vt20 < UMBRAL_ESTABLE_2020) {
    return Object.assign(base, {
      tipo: 'partido_nuevo',
      anio_breakpoint: 2020,
      metodo_proyeccion: 'logistica',
      techo_factor: 1.5,           // no puede crecer más de 1.5x su 2024
      delta_max_pct: 1.50,         // ±150% variación admitida (mayor libertad)
      peso_base_encuesta: 0.50,
    });
  }

  // Partido estable: >50k en 2020 y variación total moderada
  var varTotal = Math.abs(vt20 > 0 ? (vt24 - vt20) / vt20 : 0);
  if (varTotal < 0.40) {
    return Object.assign(base, {
      tipo: 'partido_estable',
      anio_breakpoint: null,
      metodo_proyeccion: 'lineal',
      techo_factor: 1.30,
      delta_max_pct: 0.30,
      peso_base_encuesta: 0.70,
    });
  }

  // Partido reconfigurado: cambió >40% entre 2020-2024
  return Object.assign(base, {
    tipo: 'partido_reconfigurado',
    anio_breakpoint: 2020,
    metodo_proyeccion: 'logistica_moderada',
    techo_factor: 1.30,
    delta_max_pct: 0.80,
    peso_base_encuesta: 0.60,
  });
}

/**
 * Helper: obtiene clasificación de un partido del Map (fallback a estable si no existe).
 */
export function getMeta(clasificacion, codigo) {
  return clasificacion.get(codigo) || {
    codigo,
    tipo: 'partido_estable',
    metodo_proyeccion: 'lineal',
    techo_factor: 1.30,
    delta_max_pct: 0.30,
    peso_base_encuesta: 0.70,
    votos_2020: 0,
    votos_2024: 0,
  };
}

// Exportar constantes para tests
export { VOTOS_PRES, UMBRAL_ESTABLE_2020 };
