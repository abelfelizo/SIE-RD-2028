# /legacy

Archivos movidos aquí al integrar Capas 0–3 (release SIE-2028).
No eliminar — los shims en core/ los re-exportan para compatibilidad.

| Archivo | Reemplazado por |
|---|---|
| `dhondt.js` | `core/dhondt_engine.js` (shims `dhondt()` y `nextSeatVotes()` incluidos) |
| `proyeccion2028.js` | `core/capa1_proyeccion.js` + `core/pipeline2028.js` |

Los archivos en core/ que importaban de estos módulos
ahora apuntan a los nuevos (simulacion.js, alertas.js, boleta.js).
