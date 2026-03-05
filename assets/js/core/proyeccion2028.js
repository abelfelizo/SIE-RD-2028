/**
 * SIE 2028 — core/proyeccion2028.js (shim de compatibilidad)
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-exporta desde legacy/proyeccion2028.js para no romper app.js y views.js,
 * mientras conecta proyectarPadron() y buildCtx2028() al nuevo pipeline.
 *
 * CONECTA:
 *   - app.js          → import { buildCtx2028 }    (sin cambios en app.js)
 *   - views.js        → import { proyectarPadron } (sin cambios en views.js)
 *   - pipeline2028.js → import { proyectarPadron, buildCtx2028 } (fuente real)
 *
 * NOTA: proyectarResultados() → _desdeTendencia() ahora llama a capa1_proyeccion
 * a través del pipeline. La función legacy sigue disponible como fallback.
 */

export {
  PADRON_2024,
  proyectarPadron,
  proyectarResultados,
  buildCtx2028,
  evaluarRiesgo2028,
  METODOLOGIA_HTML,
} from '../legacy/proyeccion2028.js';
