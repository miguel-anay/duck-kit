---
name: evidencia-de-pruebas
description: Usar cuando se cierra una sub-tarea de Jira y hay que publicar su comentario de cierre (solo lo que otra persona tiene que saber o hacer: decisiones para validar con negocio, pendientes y cambios de alcance), o cuando se pida armar, redactar o preparar la evidencia, el comentario de pruebas o el reporte de cierre de un ticket.
---

# Comentario de cierre de una sub-tarea

Arma el comentario que se publica en una **sub-tarea** de Jira al cerrarla. La obligación de
publicarlo la fija la sección «La evidencia de pruebas se escribe en la sub-tarea» de
`METODO.md`.

> **Convenciones del proyecto.** Si `.claude/duck.json` define `convenciones`, leé ese archivo
> antes: dice quién lee estos comentarios en ese proyecto, dónde vive el plan de la historia y
> qué escalones de verificación existen.

## 1. Qué lleva, y qué NO lleva

**La regla: solo lo que otra persona tiene que saber o hacer.** Quien lee una sub-tarea es la
PM, QA, negocio o el otro carril — no quien desarrolló. Antes de escribir cada línea, preguntar:
*¿alguien que no estuvo en la sesión hace algo distinto por leer esto?* Si no, no va.

Entra solo en tres casos, cada uno con su bloque (un bloque sin contenido se omite):

1. **Para validar con negocio.** Decisiones tomadas en el desarrollo que le tocan a negocio:
   un valor, un texto, una severidad, un supuesto. Escritas en su idioma, no en el del código.
2. **Pendiente.** Lo que queda por hacer y **de quién** es: aplicar en un ambiente, una pregunta
   abierta, una prueba humana, un escalón de verificación que no se pudo correr (con el motivo).
3. **Cambio de alcance.** Si lo hubo y se ve desde afuera: algo que la historia prometía y no se
   hizo, o al revés.

Si no hay nada de los tres, el comentario es una línea: «Sin observaciones. PR: <enlaces>».

**NO lleva lo técnico.** Desvíos del diseño, hallazgos de implementación, renumeraciones,
tamaños de columna: van a la bitácora del plan de la historia y al PR. Tampoco lleva lo que ya
dice el plan («lo cubre la sub-tarea X»). Y si una descripción de Jira quedó desactualizada,
**se corrige la descripción** (con pedido explícito), no se anuncia en un comentario.

**NO lleva resultados de tests.** Ni la suite, ni conteos de pruebas, ni cobertura, ni el CI,
ni pasos ejecutados, ni datos ficticios. Esa evidencia **vive en el PR**, en su sección de
validaciones, y repetirla en Jira es ruido. La firma de las pruebas automatizadas es el PR,
enlazado desde el comentario; Jira guarda lo que el PR no cuenta.

Si un escalón de verificación **no se pudo correr** (por ejemplo: la sesión del navegador venció
y la captura salió en blanco), eso **sí** va, en «Pendiente», con el motivo. No es un resultado
de test, es algo sin validar.

## 2. La línea humana queda en blanco

El comentario termina con la línea «Verificado visualmente por», **vacía**. El agente nunca la
completa, nunca la tacha, nunca pone «pendiente» en su lugar. Un agente reporta; no confirma.
Lo mismo vale para cualquier etiqueta de prueba humana: la pone una persona, nunca el agente.

Va **separada por una regla horizontal** (`---`): sin ella, el markdown de Jira la funde con la
última lista y la muestra como una viñeta más.

## 3. Nada se inventa, nada sensible

- Cada línea cuenta algo que pasó en la sesión o que está escrito en el repo. Si no se sabe,
  no se escribe.
- Sin secretos, datos personales reales ni payloads sensibles.

## 4. Publicación: mostrar antes, y la sub-tarea correcta

- Se publica con `addOrEditJiraIssueComment` sobre la **sub-tarea**, nunca sobre la historia.
- **Antes de publicar: mostrar el borrador completo y esperar.** Una corrección al borrador no
  es permiso para publicar — hay que mostrarlo de nuevo después de corregirlo.
- **Excepción ya resuelta**: en modo flujo, este comentario se publica sin volver a pedir
  permiso (es la única excepción). Cualquier otro texto en Jira sigue necesitando pedido
  explícito en esa misma sesión (la regla de `METODO.md`: transicionar es automático, escribir
  texto no).

## Plantilla

```
**Para validar con negocio:**
- <decisión tomada en el desarrollo, en lenguaje de negocio, y qué pasa si prefieren otra>

**Pendiente:**
- <qué falta y de quién es>

**Cambio de alcance:**
- <qué prometía la historia y no se hizo, o al revés>

**PR:** <enlaces a los PR mergeados; ahí están las validaciones automatizadas>

---

Verificado visualmente por: ______  Fecha: ______
```

Los bloques vacíos se omiten. Ejemplo:

```
**Para validar con negocio:**
- Severidad de las notificaciones nuevas: «Pedido aprobado» = éxito (verde), «Pedido rechazado» = peligro (rojo). Elegida en el desarrollo; se cambia si prefieren otra.

**Pendiente:**
- Aplicar en el ambiente de pruebas (despliegue manual). Desarrollo ya la recibió con el merge.

**PR:** api #131 · docs #50
```
