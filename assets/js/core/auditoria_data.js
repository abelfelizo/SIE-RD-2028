/**
 * SIE 2028 — core/auditoria_data.js
 *
 * Auditoría de integridad de la base de datos.
 * REGLA ABSOLUTA: no inventa, no supone, no rellena.
 * Si un dato falta → error/alerta visible. Nunca silencio.
 *
 * Severidades:
 *   ERROR   — dato faltante que rompe cálculos
 *   ALERTA  — dato incompleto que afecta precisión
 *   INFO    — observación, no bloquea
 */

// ── Constantes de referencia (fuente: JCE oficial) ──────────────────────────
var REF = {
  PROVINCIAS_INTERIOR: 32,
  MUNICIPIOS:          158,
  CIRCS_INTERIOR:      19,
  CIRCS_EXTERIOR:       3,
  CURULES_TOTAL:       190,
  SENADORES_TOTAL:      32,
  PADRON_INTERIOR:   7281764,
  PADRON_EXTERIOR:    863784,
  PADRON_TOTAL:      8145548,
  EMITIDOS_PRES:     4429079,
  PART_PRES_2024:    0.543742,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function err(codigo, msg, detalle) {
  return { severidad: "ERROR", codigo: codigo, msg: msg, detalle: detalle || "" };
}
function alerta(codigo, msg, detalle) {
  return { severidad: "ALERTA", codigo: codigo, msg: msg, detalle: detalle || "" };
}
function info(codigo, msg, detalle) {
  return { severidad: "INFO", codigo: codigo, msg: msg, detalle: detalle || "" };
}

// ── Auditorías individuales ──────────────────────────────────────────────────

function auditarPadron(ctx) {
  var issues = [];
  var meta   = ctx && ctx.meta && ctx.meta.totales ? ctx.meta.totales : null;

  if (!meta) {
    issues.push(err("PAD-001", "padron_2024_meta.json no cargado", "Requerido para proyección 2028"));
    return issues;
  }

  var int24 = meta.inscritos_interior || 0;
  var ext24 = meta.inscritos_exterior || 0;
  var tot24 = meta.inscritos_total    || 0;
  var em24  = meta.emitidos_pres_total || 0;

  if (int24 !== REF.PADRON_INTERIOR)
    issues.push(alerta("PAD-002",
      "Padrón interior difiere del oficial",
      "Esperado: " + REF.PADRON_INTERIOR.toLocaleString() + " · Encontrado: " + int24.toLocaleString()));

  if (ext24 !== REF.PADRON_EXTERIOR)
    issues.push(alerta("PAD-003",
      "Padrón exterior difiere del oficial",
      "Esperado: " + REF.PADRON_EXTERIOR.toLocaleString() + " · Encontrado: " + ext24.toLocaleString()));

  if (tot24 !== REF.PADRON_TOTAL)
    issues.push(alerta("PAD-004",
      "Padrón total difiere del oficial",
      "Esperado: " + REF.PADRON_TOTAL.toLocaleString() + " · Encontrado: " + tot24.toLocaleString()));

  if (Math.abs(em24 - REF.EMITIDOS_PRES) > 100)
    issues.push(alerta("PAD-005",
      "Emitidos presidenciales difieren del oficial",
      "Esperado: " + REF.EMITIDOS_PRES.toLocaleString() + " · Encontrado: " + em24.toLocaleString()));

  var partCalc = tot24 > 0 ? em24 / tot24 : 0;
  if (Math.abs(partCalc - REF.PART_PRES_2024) > 0.0001)
    issues.push(alerta("PAD-006",
      "Participación calculada no coincide con oficial",
      "Oficial: 54.3742% · Calculada: " + (partCalc * 100).toFixed(4) + "%"));

  if (issues.length === 0)
    issues.push(info("PAD-OK", "Padrón 2024 íntegro y verificado", "Interior + Exterior + Total + Emitidos OK"));

  return issues;
}

function auditarResultados2024(ctx) {
  var issues = [];
  if (!ctx || !ctx.r || !ctx.r[2024]) {
    issues.push(err("R24-001", "results_2024.json no cargado", "Sin este archivo el sistema no funciona"));
    return issues;
  }

  var r = ctx.r[2024];

  // PRES
  var pres = r.pres;
  var presNat = pres && pres.nacional;
  if (!presNat || !presNat.emitidos) {
    issues.push(err("R24-PRES-001", "Resultado presidencial nacional 2024 faltante", ""));
  } else {
    if (Math.abs(presNat.emitidos - REF.EMITIDOS_PRES) > 100)
      issues.push(alerta("R24-PRES-002",
        "Emitidos pres nacional no coinciden con padrón_meta",
        presNat.emitidos.toLocaleString() + " vs " + REF.EMITIDOS_PRES.toLocaleString()));
    var nProv = Object.keys(pres.prov || {}).length;
    if (nProv !== REF.PROVINCIAS_INTERIOR)
      issues.push(alerta("R24-PRES-003",
        "Provincias presidenciales interiores: " + nProv + "/" + REF.PROVINCIAS_INTERIOR,
        "Revisar provincias faltantes"));
    // Votos negativos o cero total
    var totalVotos = Object.values(presNat.votes || {}).reduce(function(s,v){return s+v;},0);
    if (totalVotos === 0)
      issues.push(err("R24-PRES-004", "Votos presidenciales nacionales suman 0", ""));
  }

  // SEN
  var sen = r.sen;
  var nProvSen = Object.keys(sen.prov || {}).length;
  if (nProvSen !== REF.PROVINCIAS_INTERIOR)
    issues.push(err("R24-SEN-001",
      "Provincias senatoriales: " + nProvSen + "/" + REF.PROVINCIAS_INTERIOR,
      "Cada provincia elige 1 senador"));
  else
    issues.push(info("R24-SEN-OK", "Senadores 2024: 32/32 provincias presentes", ""));

  // DIP
  var dip = r.dip;
  var nProvDip  = Object.keys(dip.prov  || {}).length;
  var nCircDip  = Object.keys(dip.circ  || {}).length;
  if (nCircDip !== REF.CIRCS_INTERIOR)
    issues.push(err("R24-DIP-001",
      "Circunscripciones DIP interiores: " + nCircDip + "/" + REF.CIRCS_INTERIOR,
      "Requeridas para D'Hondt correcto"));
  else
    issues.push(info("R24-DIP-OK", "Diputados 2024: 19/19 circunscripciones OK", ""));
  var nExtDip = Object.keys(dip.extDip || {}).length;
  if (nExtDip < 3)
    issues.push(alerta("R24-DIP-002",
      "Circunscripciones DIP exterior: " + nExtDip + "/3",
      "Circunscripciones C1, C2, C3 del exterior"));

  // MUN
  var mun = r.mun;
  var nMun = Object.keys(mun.mun || {}).length;
  if (nMun < REF.MUNICIPIOS)
    issues.push(alerta("R24-MUN-001",
      "Municipios: " + nMun + "/" + REF.MUNICIPIOS,
      "Faltan " + (REF.MUNICIPIOS - nMun) + " municipios"));
  else
    issues.push(info("R24-MUN-OK", "Municipios 2024: 158/158 OK", ""));

  // DM
  var dm   = r.dm;
  var nDm  = Object.keys(dm.dm || {}).length;
  if (nDm === 0)
    issues.push(alerta("R24-DM-001", "Distritos municipales: sin datos", "DM puede estar vacío en resultados"));
  else
    issues.push(info("R24-DM-OK", "DM 2024: " + nDm + " distritos presentes", ""));

  return issues;
}

function auditarResultados2020(ctx) {
  var issues = [];
  if (!ctx || !ctx.r || !ctx.r[2020]) {
    issues.push(err("R20-001", "results_2020.json no cargado",
      "Sin 2020 no hay cálculo de tendencia histórica"));
    return issues;
  }

  var r = ctx.r[2020];

  var nProvPres = Object.keys(r.pres.prov || {}).length;
  if (nProvPres !== REF.PROVINCIAS_INTERIOR)
    issues.push(alerta("R20-PRES-001",
      "Provincias presidenciales 2020: " + nProvPres + "/" + REF.PROVINCIAS_INTERIOR, ""));
  else
    issues.push(info("R20-PRES-OK", "Pres 2020: 32/32 provincias OK", ""));

  var nProvSen = Object.keys(r.sen.prov || {}).length;
  if (nProvSen !== REF.PROVINCIAS_INTERIOR)
    issues.push(alerta("R20-SEN-001",
      "Senadores 2020: " + nProvSen + "/" + REF.PROVINCIAS_INTERIOR, ""));

  var nMun = Object.keys(r.mun.mun || {}).length;
  if (nMun < 140)
    issues.push(alerta("R20-MUN-001",
      "Municipios 2020: " + nMun + "/" + REF.MUNICIPIOS, ""));
  else
    issues.push(info("R20-MUN-OK", "Municipios 2020: " + nMun + " OK", ""));

  return issues;
}

function auditarCurules(ctx) {
  var issues = [];
  if (!ctx || !ctx.curules) {
    issues.push(err("CUR-001", "curules_2024.json no cargado", "Sin curules no hay D'Hondt de referencia"));
    return issues;
  }

  var cur = ctx.curules;
  var terr = cur.territorial || [];
  var ext  = cur.exterior    || [];
  var nac  = cur.nacionales  || {};

  var total = terr.reduce(function(s,c){return s+c.seats;},0) +
              ext.reduce(function(s,c){return s+c.seats;},0)  +
              (nac.seats || 0);

  if (total !== REF.CURULES_TOTAL)
    issues.push(err("CUR-002",
      "Total curules: " + total + "/" + REF.CURULES_TOTAL,
      "Territoriales:" + terr.reduce(function(s,c){return s+c.seats;},0) +
      " Exterior:" + ext.reduce(function(s,c){return s+c.seats;},0) +
      " Nacionales:" + (nac.seats||0)));
  else
    issues.push(info("CUR-OK", "Curules 2024: 190/190 verificadas", "Territorial + Exterior + Nacional"));

  return issues;
}

function auditarAlianzas(ctx) {
  var issues = [];
  var al = ctx && ctx.alianzas;

  if (!al) {
    issues.push(err("ALZ-001",
      "alianzas_2024.json no cargado",
      "Sin alianzas: D'Hondt usa votos individuales. Boleta y Simulador (tab Alianzas) muestran advertencia."));
    return issues;
  }

  var niveles = ["pres","sen","dip","mun"];
  niveles.forEach(function(nv) {
    if (!al[nv]) {
      issues.push(err("ALZ-" + nv.toUpperCase() + "-001",
        "Alianzas " + nv + " ausentes en el archivo",
        "Bloque '" + nv + "' no encontrado"));
      return;
    }

    var bloques = [];
    if (nv === "pres") {
      bloques = al[nv].bloques || [];
    } else {
      var sub = al[nv].por_provincia || al[nv].por_circ || al[nv].por_municipio || {};
      bloques = Object.values(sub).reduce(function(acc, pv) {
        return acc.concat(pv.bloques || []);
      }, []);
    }

    var pending = bloques.filter(function(b) {
      return !b.aliados || b.aliados.length === 0;
    }).length;
    var total   = bloques.length;

    if (nv === "pres" && total === 0) {
      issues.push(err("ALZ-PRES-002",
        "Alianzas presidenciales: sin bloques definidos",
        "Estructura lista pero vacía. Completar con datos reales."));
    } else if (pending > 0 && total > 0) {
      issues.push(alerta("ALZ-" + nv.toUpperCase() + "-002",
        "Alianzas " + nv + ": " + pending + "/" + total + " bloques sin aliados",
        "Bloques con lista vacía de aliados. Pueden ser candidaturas individuales."));
    } else if (total === 0) {
      issues.push(alerta("ALZ-" + nv.toUpperCase() + "-003",
        "Alianzas " + nv + ": estructura lista, sin datos",
        "Pendiente de completar con datos JCE 2024."));
    } else {
      issues.push(info("ALZ-" + nv.toUpperCase() + "-OK",
        "Alianzas " + nv + ": " + total + " bloques definidos", ""));
    }
  });

  return issues;
}

function auditarEncuestas(ctx) {
  var issues = [];
  var polls = ctx && ctx.polls;

  if (!polls || !Array.isArray(polls) || polls.length === 0) {
    issues.push(alerta("ENC-001",
      "Sin encuestas cargadas",
      "La proyección 2028 usará tendencia histórica 2020→2024 en lugar de encuestas."));
    return issues;
  }

  var now = new Date("2026-03-03");
  polls.forEach(function(p, i) {
    var label = "Encuesta #" + (i+1) + " (" + (p.encuestadora||"?") + " " + (p.fecha||"?") + ")";

    if (!p.fecha)
      issues.push(alerta("ENC-" + i + "-001", label + ": sin fecha", ""));
    if (!p.resultados || Object.keys(p.resultados).length === 0)
      issues.push(err("ENC-" + i + "-002", label + ": sin resultados", ""));

    var sum = Object.values(p.resultados || {}).reduce(function(s,v){return s+v;},0);
    if (sum > 0 && (sum < 85 || sum > 115))
      issues.push(alerta("ENC-" + i + "-003",
        label + ": porcentajes suman " + sum.toFixed(1) + "%",
        "Esperado ~100%. Verificar si incluye indecisos."));

    if (p.fecha) {
      var fechaEnc = new Date(p.fecha);
      var meses = (now - fechaEnc) / (1000 * 60 * 60 * 24 * 30);
      if (meses > 18)
        issues.push(alerta("ENC-" + i + "-004",
          label + ": encuesta tiene " + Math.round(meses) + " meses de antigüedad",
          "Peso reducido automáticamente en proyección."));
    }

    if (!p.encuestadora || p.encuestadora === "Ejemplo")
      issues.push(alerta("ENC-" + i + "-005",
        label + ": encuestadora es placeholder ('Ejemplo')",
        "Reemplazar con encuesta real."));
  });

  if (issues.filter(function(i){return i.severidad==="ERROR";}).length === 0)
    issues.push(info("ENC-OK",
      polls.length + " encuesta(s) cargada(s)",
      "Usadas en proyección 2028 con peso por recencia."));

  return issues;
}

function auditarGeografia(ctx) {
  var issues = [];
  // El mapa SVG es el que define la geografía visual
  // Solo verificamos que los IDs del SVG coincidan con los datos
  // Esto se hace en runtime con _mapApi.validate()
  issues.push(info("GEO-INFO",
    "Validación geográfica: se ejecuta al cargar el mapa SVG",
    "Usa _mapApi.validate() en consola para ver discrepancias de IDs."));
  return issues;
}

// ── Función principal exportada ───────────────────────────────────────────────
export function runDataAudit(ctx) {
  var all = []
    .concat(auditarPadron(ctx))
    .concat(auditarResultados2024(ctx))
    .concat(auditarResultados2020(ctx))
    .concat(auditarCurules(ctx))
    .concat(auditarAlianzas(ctx))
    .concat(auditarEncuestas(ctx))
    .concat(auditarGeografia(ctx));

  var errores  = all.filter(function(i){return i.severidad==="ERROR";});
  var alertas  = all.filter(function(i){return i.severidad==="ALERTA";});
  var infos    = all.filter(function(i){return i.severidad==="INFO";});

  return {
    items:    all,
    errores:  errores,
    alertas:  alertas,
    infos:    infos,
    ok:       errores.length === 0,
    resumen:  errores.length + " errores · " + alertas.length + " alertas · " + infos.length + " info",
  };
}

/**
 * Devuelve true si alianzas están disponibles y completas para un nivel.
 * Usar antes de cualquier cálculo que dependa de alianzas.
 */
export function alianzasDisponibles(ctx, nivel) {
  var al = ctx && ctx.alianzas;
  if (!al || !al[nivel]) return false;
  var bloques = al[nivel].bloques || [];
  if (nivel !== "pres") {
    var sub = al[nivel].por_provincia || al[nivel].por_circ || al[nivel].por_municipio || {};
    bloques = Object.values(sub).reduce(function(acc, pv) {
      return acc.concat(pv.bloques || []);
    }, []);
  }
  return bloques.some(function(b){return b.aliados && b.aliados.length > 0;});
}

/**
 * Devuelve los bloques de alianza para un nivel + territorio.
 * Si no existen → retorna [] (nunca inventa).
 */
export function getAlianzas(ctx, nivel, territorioId) {
  var al = ctx && ctx.alianzas;
  if (!al || !al[nivel]) return [];

  if (nivel === "pres") {
    return (al.pres.bloques || []).filter(function(b){return b.aliados && b.aliados.length > 0;});
  }

  var subKey = nivel === "sen" ? "por_provincia"
             : nivel === "dip" ? "por_circ"
             : nivel === "mun" ? "por_municipio"
             : nivel === "dm"  ? "por_dm"
             : null;

  if (!subKey || !al[nivel][subKey]) return [];

  var entry = al[nivel][subKey][territorioId];
  if (!entry || !entry.bloques) return [];
  return entry.bloques.filter(function(b){return b.aliados && b.aliados.length > 0;});
}
