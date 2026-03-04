# SIE 2028 — Changelog v8.0

## Resumen de cambios

### Arquitectura general
- Versión v8.0 — build final completo
- Ruta "Boleta única" eliminada del nav; funcionalidad fusionada en Simulador (tab D'Hondt)
- 8 módulos en navegación: Dashboard, Mapa, Simulador, Potencial, Movilización, Objetivo, Encuestas, Auditoría

---

### Simulador (views.js + simulacion.js)
- **Selector de territorio**: permite correr simulación para una provincia, municipio o circunscripción específica
- **Tab D'Hondt fusionado**: calcula distribución de escaños por circunscripción desde el simulador
- **Encuesta local**: si hay encuesta por territorio, aplica automáticamente; si no, usa simpatía general + arrastre presidencial
- **Definición de pp clarificada**: texto explicativo en UI — "adición aritmética al % base, renormalizada"
- **Arrastre presidencial — metodología profesional** (Feigert-Norris 1990, datos JCE 2004-2024):
  - Coeficientes k: >10pp → 0.55 | 5-10pp → 0.35 | <5pp → 0.18
  - Tope del 15% del total emitido del nivel
  - Descripción metodológica visible en UI
- **"Delta pp" renombrado a "Ajuste pp"** en toda la UI
- **Circunscripciones completas en tab D'Hondt**: DN (3 circ), La Vega (2), Pto. Plata (2), S. Cristóbal (3), Santiago (3), Sto. Domingo (6)

---

### Motor Potencial (potencial.js)
- **Corrección FP/nuevos actores**: partidos con crecimiento >80% en un ciclo (ej: FP 2020→2024, +~200%) usan "arraigo relativo" (diferencia local vs media nacional en 2024) en vez de tendencia 2020→2024 que daría resultados distorsionados
- **Nuevo componente**: Potencial de Conversión (base × reserva) — peso 20
- **Pesos calibrados**: Margen 35, Abstención 25, Conversión 20, Padrón 10, Tendencia 10
- Indicador "nuevo actor" visible en tabla

---

### Motor Objetivo (objetivo.js)
- **Plan de Acción Estratégico** (nuevo): genera recomendaciones priorizadas:
  - 📢 Movilización: si abstención >25% y votos recuperables >1,000
  - 🤝 Alianzas — ganancia residual: si hay partidos aliables (2-15% cada uno)
  - 📍 Inversión territorial selectiva: top 5 territorios por ROI
  - 🎯 Arrastre presidencial: si el partido tiene >40% presidencial
  - 🛡 Consolidación de territorios frágiles: margen <10pp
- **ROI por territorio**: eficiencia × (1 + abstención)
- **Tabla de territorios críticos mejorada**: incluye votos necesarios, ROI y tipo
- Backsolve calibrado con parámetros `ajustePP` (no `deltaPP`)

---

### Motor Movilización (simulacion.js + renderMovilizacion)
- **Techo corregido a 40%** de la abstención (antes 60% — sobreestimaba)
- Justificación: 60% de la abstención es estructural (emigrantes no depurados, fallecidos, desinterés crónico)
- Coeficientes de cascada actualizados: sen=0.88, dip=0.78, mun=0.72 (antes 0.85/0.75/0.70)

---

### Mapa (renderMapa)
- **Botón "Con aliados"**: pinta el mapa acumulando transferencia de aliados al líder de cada bloque
- **Botón "Sin aliados"**: resultado individual por partido (por defecto)
- Modo activo resaltado en UI
- Nota de circunscripción en panel de provincia para nivel diputados

---

### Criterio PP — definición formal
> pp (puntos porcentuales) = adición aritmética al porcentaje base.
> Ejemplo: PRM en 48.0% + 3 pp → 51.0%. No es un promedio.
> El sistema renormaliza todos los partidos para que sumen 100%.
> Esto es "Uniform Swing Model" estándar en análisis electoral.

---

### Corrección FP — justificación técnica
> La Fuerza del Pueblo nació de la escisión del PLD en 2019.
> En 2020 obtuvo ~7% como partido nuevo. En 2024 obtuvo ~22%.
> Ese +215% no es tendencia real: es efecto de fundación del partido.
> Usar pct_2020 como base para proyectar 2028 sobreestima el potencial.
> Solución v8: si un partido creció >80% en un solo ciclo, la tendencia
> se calcula como diferencia local vs media nacional en el año más reciente (2024).
