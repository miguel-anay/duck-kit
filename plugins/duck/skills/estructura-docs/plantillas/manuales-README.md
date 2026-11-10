# Manuales

Los manuales son un entregable del sistema, no un extra: sin ellos el conocimiento queda en quien lo construyó.

| Archivo | Para quién | Qué responde |
|---|---|---|
| `usuario.html` | Quien usa el sistema | Qué puedo hacer y cómo. |
| `tecnico.html` | Quien lo mantiene | Cómo está construido y qué se conecta con qué. |

Reglas:

- **Salen del código real**: vistas y rutas, permisos, validaciones, integraciones, configuración, dependencias. Cada sección dice de qué parte del código sale, para poder verificar si sigue vigente.
- **Describen lo que hay**, nunca lo que el sistema debería hacer. Sin código funcionando, el manual espera.
- **Un solo archivo HTML** cada uno, que abre sin servidor ni conexión; las capturas, si las hay, van embebidas.
- Se actualizan en el mismo cambio que modifica lo que describen.
