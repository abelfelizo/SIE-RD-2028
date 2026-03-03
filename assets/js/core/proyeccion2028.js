/**
 * SIE 2028  core/proyeccion2028.js  v6.0
 *
 * Motor de Proyección 2028 — Metodología Oficial Congelada
 * ─────────────────────────────────────────────────────────
 * PADRÓN 2024 (oficial JCE):
 *   Interior : 7,281,764
 *   Exterior :   863,784
 *   Total    : 8,145,548
 *
 * PROYECCIÓN 2028:
 *   Int_2028 = Int_2024 × (1 + 0.0166)^4   →  7,777,446
 *   Ext_2028 = Ext_2024 × (1 + 0.106 )^4   →  1,292,485
 *   Total_2028 = Int_2028 + Ext_2028        →  9,069,931
 *
 * PARTICIPACIÓN 2028:
 *   Part_2028 = Part_2024 + ajuste_slider   (−5pp a +5pp)
 *   Emitidos_2028 = Total_2028 × Part_2028
 *   Abstención_2028 = Total_2028 − Emitidos_2028
 *
 * RESULTADO ELECTORAL 2028:
 *   Si hay encuestas → promedio ponderado por recencia (1/(1+meses))
 *   Si no            → tendencia histórica 2020→2024 ajustada al 50%
 *
 * ALIANZAS: cada nivel tiene las suyas. No hay arrastre automático.
 * BASE 2024: inmutable. Toda simulación parte de ella.
 */

// ── Constantes oficiales ──────────────────────────────────────────────────────
export var PADRON_2024 = {
  interior:   7281764,
  exterior:    863784,
  total:      8145548,
  emitidos:   4429079,
  participacion: 0.543742,   // emitidos / total oficial
};

var G_INT   = 0.0166;   // tasa crecimiento interior 2024→2028
var G_EXT   = 0.1060;   // tasa crecimiento exterior 2024→2028
var ANIOS   = 4;
var SLIDER_MIN = -0.05; // −5pp
var SLIDER_MAX =  0.05; // +5pp

// ── Motor de padrón ──────────────────────────────────────────────────────────
/**
 * Proyecta el padrón 2028.
 * @param {number} ajusteParticipacion  delta pp del slider (−0.05 a +0.05)
 */
export function proyectarPadron(ctx, ajusteParticipacion) {
  var adj = typeof ajusteParticipacion === "number"
    ? Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, ajusteParticipacion))
    : 0;

  // Usar datos del meta si existen, si no caer a constantes
  var meta = ctx && ctx.meta && ctx.meta.totales ? ctx.meta.totales : {};
  var int2024 = meta.inscritos_interior || PADRON_2024.interior;
  var ext2024 = meta.inscritos_exterior || PADRON_2024.exterior;
  var em2024  = meta.emitidos_pres_total || PADRON_2024.emitidos;
  var tot2024 = int2024 + ext2024;

  var int2028 = Math.round(int2024 * Math.pow(1 + G_INT, ANIOS));
  var ext2028 = Math.round(ext2024 * Math.pow(1 + G_EXT, ANIOS));
  var tot2028 = int2028 + ext2028;

  var part2024 = tot2024 > 0 ? em2024 / tot2024 : PADRON_2024.participacion;
  var part2028 = Math.max(0.20, Math.min(0.95, part2024 + adj));

  var emitidos2028    = Math.round(tot2028 * part2028);
  var abstencion2028  = tot2028 - emitidos2028;

  return {
    // 2024 base
    interior2024:  int2024,
    exterior2024:  ext2024,
    total2024:     tot2024,
    emitidos2024:  em2024,
    part2024:      part2024,
    // 2028 proyectado
    interior:      int2028,
    exterior:      ext2028,
    total:         tot2028,
    participacion: part2028,
    ajuste:        adj,
    emitidosProyectados: emitidos2028,
    abstencionProyectada: abstencion2028,
    // Deltas
    deltaInterior: int2028 - int2024,
    deltaExterior: ext2028 - ext2024,
    deltaTotal:    tot2028 - tot2024,
    // Metadata para UI
    gInt: G_INT,
    gExt: G_EXT,
    anios: ANIOS,
    sliderMin: SLIDER_MIN * 100,
    sliderMax: SLIDER_MAX * 100,
  };
}

// ── Motor de resultados 2028 ──────────────────────────────────────────────────
/**
 * Peso de recencia: 1 / (1 + meses desde mayo 2024)
 */
function pesoRecencia(fecha) {
  if (!fecha) return 0.5;
  try {
    var p = String(fecha).split("-");
    var y = parseInt(p[0], 10) || 2024;
    var m = parseInt(p[1], 10) || 5;
    var base = new Date(2024, 4, 1);
    var enc  = new Date(y, m - 1, 1);
    var meses = Math.max(0, (enc - base) / (1000 * 60 * 60 * 24 * 30.44));
    return 1 / (1 + meses);
  } catch(e) { return 0.5; }
}

/**
 * Proyecta resultados 2028 para un nivel.
 * @returns {votes2028: {partido: pct}, fuente, polls_usados}
 */
export function proyectarResultados(ctx, nivel) {
  // Filtrar encuestas relevantes al nivel
  var polls = (ctx.polls || []).filter(function(p) {
    if (!p.nivel) return true;
    var n = p.nivel.toLowerCase();
    return n === nivel || n === "pres" || n === "presidencial";
  });

  if (polls.length) return _desdeEncuestas(polls, ctx, nivel);
  return _desdeTendencia(ctx, nivel);
}

function _desdeEncuestas(polls, ctx, nivel) {
  var pesos   = polls.map(function(p) { return pesoRecencia(p.fecha); });
  var sumP    = pesos.reduce(function(a, v) { return a + v; }, 0) || 1;
  var acc     = {};

  polls.forEach(function(p, i) {
    var w   = pesos[i] / sumP;
    var res = p.resultados || {};
    Object.keys(res).forEach(function(partido) {
      acc[partido] = (acc[partido] || 0) + (res[partido] / 100) * w;
    });
  });

  // Renormalizar
  var tot = Object.values(acc).reduce(function(a, v) { return a + v; }, 0) || 1;
  var out = {};
  Object.keys(acc).forEach(function(p) { out[p] = acc[p] / tot; });
  return { votes2028: out, fuente: "encuestas", polls_usados: polls.length };
}

function _desdeTendencia(ctx, nivel) {
  var lv24 = ctx.r && ctx.r[2024] && ctx.r[2024][nivel] ? ctx.r[2024][nivel] : {};
  var lv20 = ctx.r && ctx.r[2020] && ctx.r[2020][nivel] ? ctx.r[2020][nivel] : {};
  var nat24 = lv24.nacional || {};
  var nat20 = lv20.nacional || {};
  var em24  = nat24.emitidos || 1;
  var em20  = nat20.emitidos || 1;
  var v24   = nat24.votes || {};
  var v20   = nat20.votes || {};
  var out   = {};
  var parties = Object.keys(v24);

  parties.forEach(function(p) {
    var pct24 = (v24[p] || 0) / em24;
    var pct20 = v20[p]  ? (v20[p] / em20) : null;
    var tend  = pct20 !== null ? (pct24 - pct20) * 0.5 : 0;
    out[p] = Math.max(0, pct24 + tend);
  });

  var tot = Object.values(out).reduce(function(a, v) { return a + v; }, 0) || 1;
  Object.keys(out).forEach(function(p) { out[p] = out[p] / tot; });
  return { votes2028: out, fuente: "tendencia", polls_usados: 0 };
}

// ── buildCtx2028 ─────────────────────────────────────────────────────────────
/**
 * Construye ctx2028: clone del ctx con r[2028] calculado.
 * La BASE 2024 (ctx.r[2024]) es INMUTABLE y nunca se toca.
 * @param {number} ajusteParticipacion  del slider (−0.05 … +0.05)
 */
export function buildCtx2028(ctx, ajusteParticipacion) {
  var padron = proyectarPadron(ctx, ajusteParticipacion || 0);
  var em2028 = padron.emitidosProyectados;

  var ctx2028 = Object.assign({}, ctx, {
    padron2028: padron,
    r: Object.assign({}, ctx.r),    // shallow clone — r[2024] intacto
  });

  ctx2028.r[2028] = {};

  var niveles = ["pres", "sen", "dip", "mun", "dm"];
  niveles.forEach(function(nivel) {
    var proj   = proyectarResultados(ctx2028, nivel);
    var lv24   = (ctx.r[2024] && ctx.r[2024][nivel]) ? ctx.r[2024][nivel] : {};
    var nat24  = lv24.nacional || {};
    var em24   = nat24.emitidos || 1;
    var v24    = nat24.votes    || {};

    // Escalar votos nacionales al nuevo emitidos
    var votes2028 = {};
    Object.keys(proj.votes2028).forEach(function(p) {
      votes2028[p] = Math.round(proj.votes2028[p] * em2028);
    });

    // Proyectar provincias proporcionalmente al swing nacional
    var prov2028 = {};
    var prov24   = lv24.prov || {};
    var scale    = em24 > 0 ? em2028 / em24 : 1;

    Object.keys(prov24).forEach(function(id) {
      var p24     = prov24[id];
      var newVotes = {};
      Object.keys(p24.votes || {}).forEach(function(par) {
        var baseShare = v24[par] ? v24[par] / em24 : 0;
        var projShare = proj.votes2028[par] || 0;
        var ratio     = baseShare > 0 ? projShare / baseShare : 1;
        newVotes[par] = Math.round((p24.votes[par] || 0) * ratio);
      });
      prov2028[id] = Object.assign({}, p24, {
        votes:    newVotes,
        emitidos: Math.round((p24.emitidos || 0) * scale),
        inscritos: Math.round((p24.inscritos || 0) * (padron.total / padron.total2024)),
      });
    });

    ctx2028.r[2028][nivel] = Object.assign({}, lv24, {
      nacional: Object.assign({}, nat24, {
        votes:    votes2028,
        emitidos: em2028,
        inscritos: padron.total,
      }),
      prov:        prov2028,
      _proyeccion: proj,
    });
  });

  return ctx2028;
}

// ── Evaluación de riesgo 2028 ────────────────────────────────────────────────
/**
 * Evalúa riesgos según metodología oficial.
 * Presidencial: <50% = riesgo alto.
 * Legislativo:  margen <3pp = competitivo; cambio D'Hondt = alerta.
 */
export function evaluarRiesgo2028(nivel, ranked, curules) {
  var alertas = [];
  if (!ranked || !ranked.length) return alertas;
  var top1 = ranked[0];
  var top2 = ranked[1];

  if (nivel === "pres") {
    if (top1.pct < 0.50) {
      alertas.push({ nivel_alerta: "error", tipo: "2da_vuelta",
        msg: "Riesgo 2ª vuelta",
        detalle: top1.p + " proyectado " + (top1.pct*100).toFixed(1) +
          "% — necesita 50%+1 (faltan " + ((0.5-top1.pct)*100).toFixed(1) + "pp)" });
    }
    if (top2 && (top1.pct - top2.pct) < 0.05) {
      alertas.push({ nivel_alerta: "warn", tipo: "margen_bajo",
        msg: "Margen presidencial <5pp",
        detalle: top1.p + " vs " + top2.p + ": " + ((top1.pct-top2.pct)*100).toFixed(1) + "pp" });
    }
  }

  if ((nivel === "sen" || nivel === "dip") && curules && top1) {
    var c       = (curules.totalByParty && curules.totalByParty[top1.p]) || 0;
    var mayoria = nivel === "sen" ? 17 : 96;
    var total   = nivel === "sen" ? 32 : 190;
    if (c < mayoria) {
      alertas.push({ nivel_alerta: "warn", tipo: "sin_mayoria",
        msg: top1.p + " sin mayoría: " + c + "/" + total,
        detalle: "Necesita " + mayoria + " para mayoría absoluta" });
    }
    if (top2 && (top1.pct - top2.pct) < 0.03) {
      alertas.push({ nivel_alerta: "error", tipo: "margen_critico",
        msg: "Margen <3pp a nivel nacional",
        detalle: "Territorios legislativos en disputa total" });
    }
  }

  return alertas;
}

// ── Texto metodología para UI ────────────────────────────────────────────────
export var METODOLOGIA_HTML =
  "<h4 style=\"margin-bottom:8px;\">Metodologia Proyeccion 2028</h4>" +
  "<table class=\"tbl\">" +
  "<thead><tr><th>Variable</th><th>Formula</th><th>Valor base</th></tr></thead>" +
  "<tbody>" +
  "<tr><td>Interior 2028</td><td>7,281,764 × (1+0.0166)⁴</td><td>7,777,446</td></tr>" +
  "<tr><td>Exterior 2028</td><td>863,784 × (1+0.106)⁴</td><td>1,292,485</td></tr>" +
  "<tr><td>Padron total 2028</td><td>Int + Ext</td><td>9,069,931</td></tr>" +
  "<tr><td>Participacion 2028</td><td>54.37% + ajuste slider (±5pp)</td><td>Ajustable</td></tr>" +
  "<tr><td>Emitidos 2028</td><td>Padron × Participacion</td><td>~4,931,705</td></tr>" +
  "<tr><td>Resultado electoral</td><td>Enc. ponderada por recencia o tendencia 2020→2024</td><td>Ver encuestas</td></tr>" +
  "</tbody>" +
  "</table>";
