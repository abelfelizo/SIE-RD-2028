/**
 * SIE 2028 — core/alianzas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de alianzas electorales territoriales.
 *
 * RESPONSABILIDAD:
 *   Agrega los votos de partidos aliados en un bloque único ANTES de que
 *   capa3_resultados.js y dhondt_engine.js calculen curules y pluralidades.
 *
 * FUENTE DE DATOS:
 *   data/alianzas_2024.json — alianzas reales JCE 2024 por nivel y provincia
 *
 * MODELO DE ALIANZA:
 *   Una alianza tiene un partido "lider" que recibe los votos del bloque.
 *   Los partidos "aliados" transfieren sus votos al lider según transferPct.
 *   El lider compite en nombre de todo el bloque.
 *
 * USO:
 *   // Aplica alianzas 2024 a votos senatoriales de provincia 28 (Santiago)
 *   const vAgregados = aplicarAlianzas(votes, 'sen', '28', alianzas2024);
 *
 *   // Agrega para D'Hondt: partido aliado desaparece, lider crece
 *   const vBloque = agregarBloque(votes, ['FP','PLD','BIS'], 'BLOQUE_OPO');
 *
 * INTEGRACIÓN:
 *   Se llama en pipeline2028.js antes de calcResultados2028():
 *
 *     const votesAliados = aplicarAlianzasTodos(ctx2028, alianzasDef);
 *     const resultados   = calcResultados2028(votesAliados);
 *
 * GARANTÍAS:
 *   - Suma de votos del nivel preservada (transferencias no crean votos)
 *   - Aliados con transferPct < 100 retienen fracción como "votos independientes"
 *   - Si no hay alianza definida para un territorio, votos pasan sin cambio
 *   - Compatible con cualquier configuración (2024 o hipotética 2028)
 */

'use strict';

// ─── Tipos documentados ───────────────────────────────────────────────────────
/**
 * @typedef {Object} AlianzaDef
 * @property {string}   lider         — partido que recibe los votos del bloque
 * @property {string[]} aliados        — partidos que transfieren votos al lider
 * @property {number}   [transferPct]  — fracción global a transferir (0-1, default 1.0)
 */

/**
 * @typedef {Object} ConfigAlianzas
 * @property {AlianzaDef[]} [pres]              — alianzas presidenciales
 * @property {{ [provId]: AlianzaDef }} [sen]    — alianzas senatoriales por provincia
 * @property {AlianzaDef[]} [dip]               — alianzas de diputados (nacional)
 * @property {{ [munId]: AlianzaDef }} [mun]     — alianzas municipales por municipio
 */

// ─── Carga alianzas JCE 2024 desde JSON ──────────────────────────────────────

/**
 * Construye ConfigAlianzas compatible con este módulo a partir del JSON
 * data/alianzas_2024.json (formato real JCE).
 *
 * @param {object} alianzasJSON — contenido de alianzas_2024.json
 * @returns {ConfigAlianzas}
 */
export function parsearAlianzasJCE(alianzasJSON) {
  if (!alianzasJSON) return {};
  var cfg = {};

  // ── PRESIDENCIAL ──
  if (alianzasJSON.pres && alianzasJSON.pres.bloques) {
    cfg.pres = alianzasJSON.pres.bloques.map(function(b) {
      return {
        lider:       b.lider,
        aliados:     (b.aliados || []).map(function(a) { return a.partido; }),
        transferPct: (b.transferPct != null ? b.transferPct : 100) / 100,
      };
    });
  }

  // ── SENADORES por provincia ──
  if (alianzasJSON.sen && alianzasJSON.sen.por_provincia) {
    cfg.sen = {};
    Object.keys(alianzasJSON.sen.por_provincia).forEach(function(provId) {
      var b = alianzasJSON.sen.por_provincia[provId];
      var pid = String(provId).padStart(2, '0');
      cfg.sen[pid] = {
        lider:   b.lider,
        aliados: (b.aliados || []).map(function(a) { return a.partido; }),
        transferPct: (b.transferPct != null ? b.transferPct : 100) / 100,
      };
      // Si hay sub-bloques (oposición fragmentada), añadir como bloques adicionales
      if (b.bloques_adicionales) {
        cfg.sen[pid]._bloques = b.bloques_adicionales.map(function(bb) {
          return {
            lider:       bb.lider,
            aliados:     (bb.aliados || []).map(function(a) { return a.partido; }),
            transferPct: (bb.transferPct != null ? bb.transferPct : 100) / 100,
          };
        });
      }
    });
  }

  // ── DIPUTADOS (bloque nacional, aplicado a todas las circs) ──
  if (alianzasJSON.dip && alianzasJSON.dip.bloques) {
    cfg.dip = alianzasJSON.dip.bloques.map(function(b) {
      return {
        lider:       b.lider,
        aliados:     (b.aliados || []).map(function(a) { return a.partido; }),
        transferPct: (b.transferPct != null ? b.transferPct : 100) / 100,
      };
    });
  }

  // ── MUNICIPIOS ──
  if (alianzasJSON.mun && alianzasJSON.mun.por_municipio) {
    cfg.mun = {};
    Object.keys(alianzasJSON.mun.por_municipio).forEach(function(munId) {
      var b = alianzasJSON.mun.por_municipio[munId];
      cfg.mun[munId] = {
        lider:       b.lider,
        aliados:     (b.aliados || []).map(function(a) { return a.partido; }),
        transferPct: (b.transferPct != null ? b.transferPct : 100) / 100,
      };
    });
  }

  return cfg;
}

// ─── Función core: aplicar un bloque de alianza a un objeto de votos ──────────

/**
 * Aplica UN bloque de alianza sobre un objeto de votos.
 * Los votos de aliados se transfieren al lider según transferPct.
 *
 * @param {object}     votes       — { PARTIDO: votos }
 * @param {AlianzaDef} alianza     — definición de la alianza
 * @returns {object} votos modificados (copia, no muta el original)
 */
export function aplicarBloque(votes, alianza) {
  if (!alianza || !alianza.lider || !alianza.aliados || !alianza.aliados.length) {
    return Object.assign({}, votes);
  }

  var out = Object.assign({}, votes);
  var tPct = alianza.transferPct != null ? alianza.transferPct : 1.0;

  alianza.aliados.forEach(function(aliado) {
    var vAliado = out[aliado] || 0;
    if (vAliado <= 0) return;

    var transferencia = Math.round(vAliado * tPct);
    var remanente     = vAliado - transferencia;

    // Transferir al lider
    out[alianza.lider] = (out[alianza.lider] || 0) + transferencia;

    // El aliado retiene el remanente (si transferPct < 1) o desaparece
    if (remanente > 0) {
      out[aliado] = remanente;
    } else {
      delete out[aliado];
    }
  });

  return out;
}

/**
 * Aplica una lista de bloques de alianza secuencialmente.
 *
 * @param {object}       votes    — { PARTIDO: votos }
 * @param {AlianzaDef[]} bloques  — array de alianzas a aplicar
 * @returns {object} votos con alianzas aplicadas
 */
export function aplicarBloques(votes, bloques) {
  if (!bloques || !bloques.length) return Object.assign({}, votes);
  return bloques.reduce(function(acc, bloque) {
    return aplicarBloque(acc, bloque);
  }, Object.assign({}, votes));
}

// ─── Aplicación por nivel y territorio ───────────────────────────────────────

/**
 * Aplica alianzas a votos de un nivel/territorio específico.
 *
 * @param {object}         votes        — { PARTIDO: votos }
 * @param {'pres'|'sen'|'dip'|'mun'} nivel
 * @param {string}         [territorioId] — id de provincia/municipio (para sen/mun)
 * @param {ConfigAlianzas} config
 * @returns {object} votos con alianzas aplicadas
 */
export function aplicarAlianzas(votes, nivel, territorioId, config) {
  if (!config || !votes) return Object.assign({}, votes || {});

  var bloques;

  if (nivel === 'sen' && config.sen) {
    var pid = territorioId ? String(territorioId).padStart(2, '0') : null;
    var cfgProv = pid && config.sen[pid];
    if (cfgProv) {
      // Bloque principal + bloques adicionales si los hay
      bloques = [cfgProv];
      if (cfgProv._bloques) bloques = bloques.concat(cfgProv._bloques);
    }
  } else if ((nivel === 'dip' || nivel === 'diputados') && config.dip) {
    bloques = config.dip;
  } else if (nivel === 'pres' && config.pres) {
    bloques = config.pres;
  } else if (nivel === 'mun' && config.mun) {
    var mid = territorioId ? String(territorioId) : null;
    if (mid && config.mun[mid]) bloques = [config.mun[mid]];
  }

  if (!bloques || !bloques.length) return Object.assign({}, votes);
  return aplicarBloques(votes, bloques);
}

// ─── Aplicación masiva a un ctx completo ─────────────────────────────────────

/**
 * Aplica alianzas a todos los territorios de un nivel dentro de ctx.r[year].
 *
 * @param {object}         ctx      — contexto SIE (ctx.r[year][nivel])
 * @param {number}         year     — año (2024 o 2028)
 * @param {'sen'|'dip'|'mun'|'pres'} nivel
 * @param {ConfigAlianzas} config
 * @returns {object} copia del nivel con alianzas aplicadas
 */
export function aplicarAlianzasNivel(ctx, year, nivel, config) {
  var lv = ctx && ctx.r && ctx.r[year] && ctx.r[year][nivel];
  if (!lv) return {};

  var out = { nacional: Object.assign({}, lv.nacional) };

  // Aplicar al nacional
  if (lv.nacional && lv.nacional.votes) {
    out.nacional = Object.assign({}, lv.nacional, {
      votes: aplicarAlianzas(lv.nacional.votes, nivel, null, config),
    });
  }

  // Aplicar a cada provincia/territorio
  ['prov', 'mun', 'dm', 'circ'].forEach(function(key) {
    if (!lv[key]) return;
    out[key] = {};
    Object.keys(lv[key]).forEach(function(id) {
      var t = lv[key][id];
      var territorioId = (nivel === 'sen' || nivel === 'mun') ? id : null;
      out[key][id] = Object.assign({}, t, {
        votes: t.votes ? aplicarAlianzas(t.votes, nivel, territorioId, config) : {},
      });
    });
  });

  return out;
}

// ─── Constructor de alianza hipotética 2028 ───────────────────────────────────

/**
 * Construye una ConfigAlianzas para un escenario hipotético.
 * Permite definir alianzas ad-hoc para simulación 2028.
 *
 * @example
 * const alianza2028 = construirAlianza([
 *   { nivel: 'sen', territorio: '28', lider: 'FP', aliados: ['PLD','BIS'], transferPct: 0.90 },
 *   { nivel: 'dip', lider: 'FP', aliados: ['PLD'], transferPct: 1.0 },
 * ]);
 *
 * @param {object[]} definiciones
 * @returns {ConfigAlianzas}
 */
export function construirAlianza(definiciones) {
  var config = { pres: [], sen: {}, dip: [], mun: {} };

  (definiciones || []).forEach(function(def) {
    var bloque = {
      lider:       def.lider,
      aliados:     def.aliados || [],
      transferPct: def.transferPct != null ? def.transferPct : 1.0,
    };

    if (def.nivel === 'pres') {
      config.pres.push(bloque);
    } else if (def.nivel === 'sen') {
      if (def.territorio) {
        var pid = String(def.territorio).padStart(2, '0');
        config.sen[pid] = bloque;
      } else {
        // Sin territorio = aplica a todas las provincias
        config._senGlobal = bloque;
      }
    } else if (def.nivel === 'dip') {
      config.dip.push(bloque);
    } else if (def.nivel === 'mun' && def.territorio) {
      config.mun[String(def.territorio)] = bloque;
    }
  });

  return config;
}

// ─── Análisis de impacto de alianza ──────────────────────────────────────────

/**
 * Calcula el impacto de una alianza: cuántos votos gana el lider
 * y cuántos partidos quedan en el resultado.
 *
 * @param {object}     votes    — votos originales
 * @param {AlianzaDef} alianza
 * @returns {{ votosOriginales, votosBloque, gananciaAbsoluta, gananciaPct, partidosRestantes }}
 */
export function calcImpactoAlianza(votes, alianza) {
  var original   = votes[alianza.lider] || 0;
  var merged     = aplicarBloque(votes, alianza);
  var bloque     = merged[alianza.lider] || 0;
  var total      = Object.values(votes).reduce(function(a, v) { return a + v; }, 0);

  return {
    lider:             alianza.lider,
    votosOriginales:   original,
    votosBloque:       bloque,
    gananciaAbsoluta:  bloque - original,
    gananciaPct:       total > 0 ? ((bloque - original) / total * 100).toFixed(2) : '0',
    pctBloque:         total > 0 ? (bloque / total * 100).toFixed(2) : '0',
    partidosRestantes: Object.keys(merged).length,
    aliados:           alianza.aliados,
  };
}

/**
 * Analiza el impacto de todas las alianzas de un nivel sobre votos dados.
 *
 * @param {object}         votes
 * @param {'pres'|'sen'|'dip'} nivel
 * @param {string}         [territorioId]
 * @param {ConfigAlianzas} config
 * @returns {object[]} array de impactos por bloque
 */
export function analizarAlianzas(votes, nivel, territorioId, config) {
  var bloques = [];

  if (nivel === 'sen' && config.sen) {
    var pid = territorioId ? String(territorioId).padStart(2, '0') : null;
    if (pid && config.sen[pid]) bloques = [config.sen[pid]];
  } else if (nivel === 'dip' && config.dip) {
    bloques = config.dip;
  } else if (nivel === 'pres' && config.pres) {
    bloques = config.pres;
  }

  return bloques.map(function(b) { return calcImpactoAlianza(votes, b); });
}

// ─── Exportar configuración 2024 para uso directo ────────────────────────────

/**
 * Genera la ConfigAlianzas estándar 2024 desde el JSON de alianzas.
 * Requiere pasar el contenido de data/alianzas_2024.json.
 *
 * Uso en pipeline:
 *   import { parsearAlianzasJCE } from './alianzas.js';
 *   const cfg = parsearAlianzasJCE(alianzasJSON);
 */
export { parsearAlianzasJCE as default };
