/**
 * SIE 2028 — capa1_proyeccion.js + capa2_arrastre.js (integrado)
 * ────────────────────────────────────────────────────────────────
 *
 * REEMPLAZA/EXTIENDE: assets/js/core/proyeccion2028.js → _desdeTendencia()
 * CONECTA CON:        assets/js/core/simulacion.js → applyArrastre()
 *
 * DATOS EMPÍRICOS USADOS (calculados de results_2024.json / results_2020.json):
 *
 * ARRASTRE REAL 2024 (PRM ganó con 21.74pp de margen):
 *   pres→sen: PRM diff = −4.34pp (arrastre negativo = ticket splitting)
 *   pres→dip: PRM diff = −3.41pp
 *   pres→sen: FP  diff = −7.95pp (mayor sangría en legislativo)
 *   pres→dip: FP  diff = −10.68pp
 *
 * ARRASTRE REAL 2020 (PRM ganó con 15.73pp de margen):
 *   pres→sen: PRM diff = −3.46pp
 *   pres→dip: PRM diff = −8.30pp
 *
 * CONCLUSIÓN METODOLÓGICA:
 *   El "arrastre" en RD para el ganador es NEGATIVO (ticket-splitting estructural).
 *   El coeficiente k NO se aplica como boost, sino como factor de retención.
 *   La función applyArrastre() existente asume boost positivo → está invertida.
 *   Esta capa corrige el modelo con datos reales.
 *
 * COEFICIENTES CALIBRADOS (promedio 2020+2024 del partido ganador):
 *   SEN:  retención = pres_share × 0.9254  (−7.46% promedio de sangría)
 *   DIP:  retención = pres_share × 0.8955  (−10.45% promedio de sangría)
 *   MUN:  interpolado = pres_share × 0.88  (patrón JCE histórico)
 *   DM:   retención = pres_share × 0.87
 */

import { getMeta } from './capa0_clasificador.js';
import { clamp }   from './utils.js';

// ── Coeficientes empíricos calibrados con 2020+2024 ──────────────────────────
var RETENCION_EMPIRICA = {
  sen: 0.9254,   // retención promedio del ganador pres→sen
  dip: 0.8955,   // retención promedio del ganador pres→dip
  mun: 0.8800,   // estimado (sin datos directos cross-nivel mun)
  dm:  0.8700,
};

// Variación máxima absoluta de coeficiente según margen pres
// Margen >20pp → coeficiente más favorable (menos sangría)
// Margen <5pp  → más sangría (pres débil no arrastra nada)
function factorMargen(margenPres) {
  if (margenPres > 0.20) return 1.02;   // victoria holgada: un poco menos de sangría
  if (margenPres > 0.10) return 1.00;   // victoria normal: coeficiente base
  if (margenPres > 0.05) return 0.97;   // victoria apretada
  return 0.93;                           // elección reñida: más sangría
}

/**
 * Capa 2: Aplica arrastre presidencial CORRECTO (modelo calibrado).
 *
 * DIFERENCIA CON simulacion.applyArrastre():
 *   - La función existente asume boost positivo (incorrecto empíricamente).
 *   - Esta función aplica retención: cada partido en nivel X hereda su
 *     share presidencial × coeficiente_retención del nivel.
 *   - El partido ganador pierde menos que otros (ticket-splitting asimétrico).
 *
 * @param {object} presVotes    - { PARTIDO: votos_pres_2024 }
 * @param {number} presEmitidos - total emitidos pres 2024
 * @param {string} nivel        - 'sen' | 'dip' | 'mun' | 'dm'
 * @param {number} emitidosNivel - total emitidos del nivel en 2024
 * @param {string} ganadorPres  - código partido ganador pres
 * @param {number} margenPres   - margen fraccional (ej 0.2174)
 * @param {Map}    clasificacion - output de capa0_clasificador.clasificarPartidos()
 * @returns {{ votes: object, trazabilidad: object }}
 */
export function calcArrastre(
  presVotes, presEmitidos,
  nivel, emitidosNivel,
  ganadorPres, margenPres,
  clasificacion
) {
  if (!presVotes || !presEmitidos || !emitidosNivel) {
    return { votes: {}, trazabilidad: { error: 'datos_insuficientes' } };
  }

  var coefBase  = RETENCION_EMPIRICA[nivel] || 0.90;
  var ajuste    = factorMargen(margenPres);
  var coefGan   = clamp(coefBase * ajuste, 0.80, 0.99);
  var coefResto = clamp(coefBase * ajuste * 0.93, 0.70, 0.97); // mayor sangría para no-ganador

  var votes = {};
  var traz  = { nivel, coefGanador: coefGan, coefResto, margenPres, fuente: 'empirico_2020_2024' };
  var total  = 0;

  Object.keys(presVotes).forEach(function(p) {
    var vPres  = presVotes[p] || 0;
    var coef   = (p === ganadorPres) ? coefGan : coefResto;
    var vBase  = Math.round((vPres / presEmitidos) * emitidosNivel);
    var vArras = Math.round(vBase * coef);
    votes[p]   = vArras;
    total     += vArras;
  });

  // Renormalizar al total emitidos del nivel (sum debe ser ≤ emitidosNivel)
  if (total > 0 && Math.abs(total - emitidosNivel) > emitidosNivel * 0.05) {
    var scale = emitidosNivel / total;
    Object.keys(votes).forEach(function(p) { votes[p] = Math.round(votes[p] * scale); });
  }

  traz.totalRaw     = total;
  traz.emitidosNivel = emitidosNivel;
  return { votes, trazabilidad: traz };
}

// ── Capa 1: Motor de proyección con blindaje anti-exponencial ────────────────

/**
 * Función logística normalizada (evita explosión exponencial).
 * Salida: fracción de share en [0, techo].
 *
 * @param {number} share2024  - share fraccional en 2024 (ej 0.2667)
 * @param {number} share2020  - share fraccional en 2020 (ej 0.0563)
 * @param {number} techo      - share máximo proyectable (ej share2024 * techo_factor)
 * @returns {number} share proyectado 2028
 */
export function proyectarLogistica(share2024, share2020, techo) {
  if (!techo || techo <= 0) techo = share2024 * 1.30;
  var L = techo;
  var k = 2.0;        // pendiente de la curva (calibrable)
  var t = 1.0;        // un ciclo adelante

  // Punto de inflexión basado en tendencia observada
  var delta = share2024 - share2020;

  // Si la tendencia desacelera (crec% ↓), reducir delta para 2028
  var crec2024 = share2020 > 0 ? delta / share2020 : 0;
  var factorDesacelera = crec2024 > 1.0 ? 0.30 :   // creció >100%: fuerte desaceleración
                         crec2024 > 0.5  ? 0.50 :   // creció 50-100%: moderada
                         crec2024 > 0.1  ? 0.70 :   // creció 10-50%: leve
                         1.00;                        // crecimiento lento: normal

  var shareProyectado = share2024 + (delta * factorDesacelera * 0.5);

  // Aplicar techo logístico: nunca superar L
  shareProyectado = L - (L - share2024) * Math.exp(-k * t * (shareProyectado / L));
  return clamp(shareProyectado, 0, L);
}

/**
 * Proyecta share lineal (partidos estables).
 * Aplica 50% de la tendencia 2020→2024 para 2024→2028.
 */
export function proyectarLineal(share2024, share2020, deltaMax) {
  var delta = share2020 > 0 ? share2024 - share2020 : 0;
  var proyectado = share2024 + (delta * 0.50);
  // Guardrail: no puede moverse más de deltaMax fraccionalmente
  var cambio = Math.abs(proyectado - share2024);
  var maxCambio = share2024 * deltaMax;
  if (cambio > maxCambio) {
    proyectado = share2024 + Math.sign(proyectado - share2024) * maxCambio;
  }
  return clamp(proyectado, 0, 1);
}

/**
 * Capa 1: Motor principal de proyección 2028 con blindaje.
 *
 * CONECTA CON: proyeccion2028.js → _desdeTendencia()
 *   Puedes reemplazar _desdeTendencia() con esta función, o llamarla desde
 *   proyectarResultados() si las encuestas no están disponibles.
 *
 * @param {object} ctx        - ctx SIE (tiene ctx.r[2024] y ctx.r[2020])
 * @param {Map}    clasificacion - output de clasificarPartidos()
 * @param {string} nivel      - 'pres' | 'sen' | 'dip' | 'mun' | 'dm'
 * @returns {{ votes2028: object, trazabilidad: object[], fuente: string }}
 */
export function proyectarConBlindaje(ctx, clasificacion, nivel) {
  var lv24 = ctx.r && ctx.r[2024] && ctx.r[2024][nivel] ? ctx.r[2024][nivel] : {};
  var lv20 = ctx.r && ctx.r[2020] && ctx.r[2020][nivel] ? ctx.r[2020][nivel] : {};
  var nat24 = lv24.nacional || {};
  var nat20 = lv20.nacional || {};
  var em24  = nat24.emitidos || 1;
  var em20  = nat20.emitidos || 1;
  var v24   = nat24.votes    || {};
  var v20   = nat20.votes    || {};

  var out  = {};
  var traz = [];

  Object.keys(v24).forEach(function(codigo) {
    var meta = getMeta(clasificacion, codigo);
    var s24  = (v24[codigo] || 0) / em24;
    var s20  = v20[codigo] != null ? v20[codigo] / em20 : null;

    var s28;
    if (meta.tipo === 'partido_nuevo' || meta.tipo === 'partido_reconfigurado') {
      var techo = s24 * meta.techo_factor;
      s28 = proyectarLogistica(s24, s20 || (s24 * 0.20), techo);
    } else {
      s28 = proyectarLineal(s24, s20 || s24, meta.delta_max_pct);
    }

    // Guardrail final: variación máxima por ciclo
    var cambio = Math.abs(s28 - s24);
    var maxCambio = s24 * meta.delta_max_pct;
    if (cambio > maxCambio) {
      s28 = s24 + Math.sign(s28 - s24) * maxCambio;
      traz.push({ codigo, alerta: 'guardrail_activado', s24, s28_raw: s28, s28_capped: s28 });
    }

    out[codigo] = Math.max(0, s28);
    traz.push({ codigo, tipo: meta.tipo, s20: s20?.toFixed(4), s24: s24.toFixed(4), s28: out[codigo].toFixed(4) });
  });

  // Renormalizar
  var tot = Object.values(out).reduce(function(a, v) { return a + v; }, 0) || 1;
  Object.keys(out).forEach(function(p) { out[p] = out[p] / tot; });

  return { votes2028: out, trazabilidad: traz, fuente: 'capa1_blindada' };
}

/**
 * Peso de encuesta (Capa 1 — ponderación).
 * CONECTA CON: proyeccion2028.js → _desdeEncuestas() → pesoRecencia()
 *
 * Extiende el peso simple de recencia con score de calidad metodológica.
 *
 * @param {object} encuesta - { muestra, margen_error, fecha }
 * @param {string} tipoPart - 'partido_estable'|'partido_nuevo'|'partido_reconfigurado'
 * @returns {number} peso (0-1)
 */
export function calcPesoEncuesta(encuesta, tipoPart) {
  var n   = encuesta.muestra      || 0;
  var moe = encuesta.margen_error || 5;
  var dias = _diasDesde(encuesta.fecha);

  var scoreMuestra  = clamp(n / 1500, 0.5, 1.0);
  var scoreMOE      = clamp(1 - (moe - 2.0) / 6.0, 0.4, 1.0);
  var scoreRecencia = clamp(1 - (dias / 365), 0.3, 1.0);
  var scoreBase     = scoreMuestra * scoreMOE * scoreRecencia;

  var factores = { partido_estable: 0.70, partido_nuevo: 0.50, partido_reconfigurado: 0.60 };
  return clamp(scoreBase * (factores[tipoPart] || 0.60), 0, 1);
}

function _diasDesde(fechaStr) {
  if (!fechaStr) return 365;
  var d = new Date(fechaStr);
  var now = new Date();
  return Math.max(0, Math.round((now - d) / 86400000));
}

export { RETENCION_EMPIRICA };
