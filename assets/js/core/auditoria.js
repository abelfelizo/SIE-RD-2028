/**
 * SIE 2028 — core/auditoria.js  v7.0
 *
 * POLÍTICA: Cero datos inventados. Si falta un dato → error visible, nunca silencio.
 *
 * Secciones:
 *  1. Padrón 2024 oficial (interior + exterior + totales)
 *  2. Resultados 2024 por nivel (nacional + territorios)
 *  3. Resultados 2020 (para tendencias)
 *  4. Circunscripciones DIP (19 int + 3 ext)
 *  5. Curules 2024 (suma exacta = 190)
 *  6. Alianzas 2024 (confirmadas vs pendientes)
 *  7. Encuestas / polls (calidad y cobertura)
 *  8. Catálogo de partidos
 *  9. Proyección 2028 (pre-condiciones verificables)
 * 10. Consistencia cruzada
 */

import { getLevel, getInscritos } from "./data.js";

var NL = { pres:"Presidencial", sen:"Senadores", dip:"Diputados", mun:"Alcaldes", dm:"DM" };

function fmt(n)  { return (Math.round(Number(n)||0)).toLocaleString("en-US"); }
function pct(x)  { return (Number(x||0)*100).toFixed(2)+"%"; }
function sumObj(obj) {
  return Object.values(obj||{}).reduce(function(a,v){return a+(Number(v)||0);},0);
}

export function runAuditoria(ctx) {
  var issues=[], warnings=[], ok=[], notas=[], pendientes=[];
  function err(m,s)  { issues.push({msg:m, seccion:s||"general"}); }
  function warn(m,s) { warnings.push({msg:m, seccion:s||"general"}); }
  function good(m,s) { ok.push({msg:m, seccion:s||"general"}); }
  function nota(m,s) { notas.push({msg:m, seccion:s||"general"}); }
  function pend(m,s) { pendientes.push({msg:m, seccion:s||"general"}); }

  // ── 1. PADRÓN 2024 ──────────────────────────────────────────────────────────
  var meta = ctx && ctx.meta && ctx.meta.totales ? ctx.meta.totales : null;
  if (!meta) {
    err("padron_2024_meta.json: NO cargado — padrón oficial no disponible", "padron");
  } else {
    var int24=meta.inscritos_interior||0, ext24=meta.inscritos_exterior||0;
    var tot24=meta.inscritos_total||0,    em24=meta.emitidos_pres_total||0;

    if (int24===7281764) good("Padrón interior: "+fmt(int24)+" ✓", "padron");
    else err("Padrón interior: esperado 7,281,764 — encontrado "+fmt(int24), "padron");

    if (ext24===863784) good("Padrón exterior: "+fmt(ext24)+" ✓", "padron");
    else err("Padrón exterior: esperado 863,784 — encontrado "+fmt(ext24), "padron");

    if (Math.abs(tot24-(int24+ext24))<=1) good("Total = interior+exterior ✓", "padron");
    else err("Total "+fmt(tot24)+" ≠ "+fmt(int24+ext24), "padron");

    if (em24>0) good("Emitidos pres 2024: "+fmt(em24)+" ("+pct(tot24?em24/tot24:0)+") ✓", "padron");
    else err("Emitidos presidenciales 2024: NO disponibles", "padron");
  }

  // ── 2. RESULTADOS 2024 ──────────────────────────────────────────────────────
  var niveles=["pres","sen","dip","mun","dm"];
  for (var ni=0; ni<niveles.length; ni++) {
    var nivel=niveles[ni], lbl=NL[nivel], lv, nat;
    try { lv=getLevel(ctx,2024,nivel); nat=lv.nacional; }
    catch(e) { err("["+lbl+"] Error al cargar: "+e.message, "resultados2024"); continue; }

    if (!nat||!nat.emitidos) { err("["+lbl+"] Sin emitidos nacionales", "resultados2024"); continue; }

    var sumVN=(nat.validos||0)+(nat.nulos||0);
    if (Math.abs(nat.emitidos-sumVN)>500)
      warn("["+lbl+"] Emitidos ("+fmt(nat.emitidos)+") ≠ Válidos+Nulos ("+fmt(sumVN)+")", "resultados2024");
    else good("["+lbl+"] Emitidos = Válidos+Nulos ✓", "resultados2024");

    var sumPart=sumObj(nat.votes);
    if (Math.abs(sumPart-(nat.validos||0))>1000)
      warn("["+lbl+"] Suma partidos ("+fmt(sumPart)+") ≠ Válidos ("+fmt(nat.validos||0)+")", "resultados2024");
    else good("["+lbl+"] Suma partidos ≈ Válidos ✓", "resultados2024");

    var terr=nivel==="mun"?(lv.mun||{}):nivel==="dm"?(lv.dm||{}):(lv.prov||{});
    var tc=Object.keys(terr).length;
    if (nivel==="pres"||nivel==="sen"||nivel==="dip") {
      if (tc===32) good("["+lbl+"] 32 provincias ✓","resultados2024");
      else warn("["+lbl+"] "+tc+"/32 provincias","resultados2024");
    } else if (nivel==="mun") {
      if (tc>=155) good("[Alcaldes] "+tc+"/158 municipios ✓","resultados2024");
      else warn("[Alcaldes] "+tc+"/158 municipios — faltan "+(158-tc),"resultados2024");
    } else if (nivel==="dm") {
      if (tc===0) warn("[DM] Sin distritos municipales desagregados","resultados2024");
      else good("[DM] "+tc+" DM con datos ✓","resultados2024");
    }
  }

  // Circunscripciones DIP interior + exterior
  try {
    var dipLv=getLevel(ctx,2024,"dip");
    var nCirc=Object.keys(dipLv.circ||{}).length;
    var nExtD=Object.keys(dipLv.extDip||{}).length;
    if (nCirc===19) good("[Diputados] 19 circ. interiores ✓","resultados2024");
    else warn("[Diputados] "+nCirc+"/19 circ. interiores","resultados2024");
    if (nExtD>=3) good("[Diputados] "+nExtD+" circ. exteriores ✓","resultados2024");
    else warn("[Diputados] "+nExtD+"/3 circ. exteriores","resultados2024");
  } catch(e) { err("Error circunscripciones: "+e.message,"resultados2024"); }

  // ── 3. RESULTADOS 2020 ──────────────────────────────────────────────────────
  var n20s=["pres","sen","dip","mun"];
  for (var i20=0; i20<n20s.length; i20++) {
    var n20=n20s[i20];
    try {
      var lv20=getLevel(ctx,2020,n20), nat20=lv20.nacional;
      if (!nat20||!nat20.emitidos) {
        warn("["+NL[n20]+" 2020] Sin emitidos — tendencias no disponibles","resultados2020");
      } else {
        var t20=n20==="mun"?(lv20.mun||{}):(lv20.prov||{});
        var tc20=Object.keys(t20).length;
        if (tc20>=30||(n20==="mun"&&tc20>=100))
          good("["+NL[n20]+" 2020] "+fmt(nat20.emitidos)+" emitidos, "+tc20+" territorios ✓","resultados2020");
        else
          warn("["+NL[n20]+" 2020] Solo "+tc20+" territorios — tendencias parciales","resultados2020");
      }
    } catch(e) { warn("["+NL[n20]+" 2020] No disponible: "+e.message,"resultados2020"); }
  }

  // ── 4. CURULES 2024 ─────────────────────────────────────────────────────────
  try {
    var cur=ctx.curules||{};
    var sTerr=(cur.territorial||[]).reduce(function(a,c){return a+(c.seats||0);},0);
    var sExt=(cur.exterior||[]).reduce(function(a,c){return a+(c.seats||0);},0);
    var sNac=cur.nacionales?(cur.nacionales.seats||0):0;
    var total=sTerr+sExt+sNac;
    if (total===190) good("Curules: "+sTerr+" terr + "+sExt+" ext + "+sNac+" nac = 190 ✓","curules");
    else err("Curules: suma = "+total+" ≠ 190 (error crítico en curules_2024.json)","curules");
    var nTerr=(cur.territorial||[]).length;
    if (nTerr>=40) good("Demarcaciones territoriales: "+nTerr+" ✓","curules");
    else err("Solo "+nTerr+" demarcaciones territoriales (esperado ≥40)","curules");
  } catch(e) { err("Error curules: "+e.message,"curules"); }

  // ── 5. ALIANZAS 2024 ────────────────────────────────────────────────────────
  var alianzas=ctx.alianzas||null;
  if (!alianzas) {
    warn("alianzas_2024.json: no cargado en ctx — agregar fetchJSON a loadCTX()","alianzas");
    pend("Alianzas 2024: estructura lista en data/alianzas_2024.json — datos pendientes de confirmación","alianzas");
  } else {
    var alMeta=alianzas._meta||{};
    if (alMeta.confirmado===true) {
      good("Alianzas 2024: confirmadas y activas ✓","alianzas");
    } else {
      var senProv=alianzas.sen&&alianzas.sen.por_provincia?alianzas.sen.por_provincia:{};
      var senPend=Object.values(senProv).filter(function(p){return p._pendiente;}).length;
      var dipCirc=alianzas.dip&&alianzas.dip.por_circ?alianzas.dip.por_circ:{};
      var dipPend=Object.values(dipCirc).filter(function(c){return c._pendiente;}).length;
      var presBloq=(alianzas.pres&&alianzas.pres.bloques)||[];
      var presConf=presBloq.filter(function(b){return !b._pendiente&&b.aliados&&b.aliados.length>0;}).length;
      var munMuni=alianzas.mun&&alianzas.mun.por_municipio?alianzas.mun.por_municipio:{};

      pend("Alianzas pres: "+presConf+"/"+presBloq.length+" bloques con aliados confirmados","alianzas");
      pend("Alianzas sen:  "+(Object.keys(senProv).length-senPend)+"/32 provincias, "+senPend+" pendientes","alianzas");
      pend("Alianzas dip:  "+(Object.keys(dipCirc).length-dipPend)+"/"+Object.keys(dipCirc).length+" circ., "+dipPend+" pendientes","alianzas");
      pend("Alianzas mun:  "+Object.keys(munMuni).length+" municipios con entrada (de 158)","alianzas");
      nota("Regla: sin alianza activa en simulador → votos individuales por partido (base 2024)","alianzas");
    }
  }

  // ── 6. ENCUESTAS ─────────────────────────────────────────────────────────────
  try {
    var polls=ctx.polls||[];
    if (polls.length===0) {
      warn("polls.json: sin encuestas — proyección usará solo tendencia histórica","encuestas");
    } else {
      good("Encuestas: "+polls.length+" registro(s) cargados","encuestas");
      for (var pi=0; pi<polls.length; pi++) {
        var p=polls[pi];
        if (!p.encuestadora) warn("Encuesta "+(pi+1)+": sin encuestadora","encuestas");
        if (!p.nivel)        warn("Encuesta "+(pi+1)+": sin nivel especificado","encuestas");
        if (!p.resultados||Object.keys(p.resultados).length===0) {
          err("Encuesta "+(pi+1)+" ("+(p.encuestadora||"?")+") sin resultados","encuestas");
        } else {
          var sumE=Object.values(p.resultados).reduce(function(a,v){return a+v;},0);
          if (sumE<90||sumE>110) warn("Encuesta "+(pi+1)+": suma = "+sumE.toFixed(1)+"% (esperado ~100%)","encuestas");
        }
        if (!p.muestra) nota("Encuesta "+(pi+1)+" ("+(p.encuestadora||"?")+") sin muestra declarada","encuestas");
      }
    }
  } catch(e) { err("Error encuestas: "+e.message,"encuestas"); }

  // ── 7. CATÁLOGO DE PARTIDOS ──────────────────────────────────────────────────
  try {
    var partidos=ctx.partidos||[];
    if (partidos.length===0) {
      warn("partidos.json: vacío — se derivarán de los resultados","partidos");
    } else {
      good("partidos.json: "+partidos.length+" partidos ✓","partidos");
      ["PRM","FP","PLD"].forEach(function(pp) {
        var found=partidos.filter(function(p){return p.codigo===pp;})[0];
        if (!found) err("Partido "+pp+" no encontrado en catálogo","partidos");
        else if (!found.pct_pres_2024) warn(pp+": sin pct_pres_2024 en catálogo","partidos");
        else good(pp+": "+found.pct_pres_2024+"% pres 2024 ✓","partidos");
      });
    }
  } catch(e) { err("Error partidos: "+e.message,"partidos"); }

  // ── 8. PROYECCIÓN 2028 ──────────────────────────────────────────────────────
  try {
    if (!meta) {
      err("Proyección 2028: no calculable sin padrón meta","proyeccion");
    } else {
      var i28=Math.round((meta.inscritos_interior||0)*Math.pow(1.0166,4));
      var e28=Math.round((meta.inscritos_exterior||0)*Math.pow(1.106,4));
      var t28=i28+e28;
      var tot24b=(meta.inscritos_interior||0)+(meta.inscritos_exterior||0);
      var em24b=meta.emitidos_pres_total||0;
      var p24=tot24b>0?em24b/tot24b:0;
      good("Proyección padrón 2028: "+fmt(t28)+" inscritos ✓","proyeccion");
      good("  Int: "+fmt(meta.inscritos_interior||0)+" × (1+1.66%)⁴ = "+fmt(i28),"proyeccion");
      good("  Ext: "+fmt(meta.inscritos_exterior||0)+" × (1+10.6%)⁴ = "+fmt(e28),"proyeccion");
      good("  Emitidos base (part="+pct(p24)+"): "+fmt(Math.round(t28*p24)),"proyeccion");
      nota("Slider participación ±5pp sobre "+pct(p24)+" base (rango: "+pct(p24-0.05)+" — "+pct(p24+0.05)+")","proyeccion");
    }
  } catch(e) { err("Error proyección: "+e.message,"proyeccion"); }

  // ── 9. CONSISTENCIA CRUZADA ──────────────────────────────────────────────────
  try {
    var insP2=getInscritos(ctx,"mayo2024");
    var lvP=getLevel(ctx,2024,"pres"), lvD=getLevel(ctx,2024,"dip");
    if (insP2>0&&lvP.nacional.emitidos&&lvD.nacional.emitidos) {
      var pP=lvP.nacional.emitidos/insP2;
      var pD=lvD.nacional.emitidos/(lvD.nacional.inscritos||insP2);
      var gap=pP-pD;
      if (gap>=0&&gap<=0.20) nota("Voto diferenciado Pres–Dip: "+pct(gap)+" — normal en RD","consistencia");
      else if (gap<0) warn("Participación Dip > Pres en "+pct(-gap)+" — verificar datos","consistencia");
      else warn("Brecha Pres–Dip: "+pct(gap)+" (>20pp) — revisar","consistencia");
    }
    var senLv=getLevel(ctx,2024,"sen");
    var sumSen=Object.values(senLv.prov||{}).reduce(function(a,p){return a+(p.emitidos||0);},0);
    var natSen=senLv.nacional.emitidos||0;
    if (natSen>0) {
      if (Math.abs(sumSen-natSen)/natSen>0.02)
        warn("[Senadores] Suma prov ("+fmt(sumSen)+") vs nacional ("+fmt(natSen)+") dif="+pct(Math.abs(sumSen-natSen)/natSen),"consistencia");
      else good("[Senadores] Suma provincias ≈ nacional ✓","consistencia");
    }
  } catch(e) { warn("Error consistencia: "+e.message,"consistencia"); }

  return {
    issues:issues, warnings:warnings, ok:ok, notas:notas, pendientes:pendientes,
    resumen:{
      errores:issues.length, advertencias:warnings.length,
      correctos:ok.length, notas:notas.length, pendientes:pendientes.length,
      total:issues.length+warnings.length+ok.length+notas.length+pendientes.length,
    },
  };
}
