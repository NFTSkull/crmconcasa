# Resumen Admin — movimientos del periodo + foto actual

## Objetivo

Agregar información al Resumen sin modificar las métricas existentes:

- **Resumen del periodo**: permanece sin cambios.
- **Etapas del periodo**: permanece sin cambios; es la cohorte enviada a Mesa dentro del rango, agrupada por su etapa actual.
- **Movimientos del periodo + foto actual**: bloque adicional read-only.

## Semántica del bloque adicional

Por cada uno de los 11 pasos visuales canónicos:

- **Llegaron en periodo**: expediente único que tuvo una entrada a ese paso dentro del rango. Incluye primera entrada, avance, reingreso o retroceso para no ocultar actividad real de una etapa.
- **De antes**: parte de «Llegaron en periodo» cuya `fecha_envio_mesa` es anterior al inicio del rango.
- **Ingresaron en rango**: parte de «Llegaron en periodo» cuya `fecha_envio_mesa` está dentro del rango.
- **Ahora**: stock vigente en ese paso, independiente del rango de fechas.

Cada expediente cuenta una sola vez por etapa dentro del rango, aunque reingrese varias veces. Un expediente sí puede aparecer en más de una etapa durante el mismo rango si pasó por varias.

## Cobertura histórica

Los movimientos se calculan exclusivamente con `expediente_paso_visual_transiciones`. No se inventa backfill. Si el rango empieza antes del primer evento disponible, la UI muestra una advertencia de cobertura incompleta; la foto actual sigue siendo válida.

## Seguridad

La RPC `admin_resumen_movimientos_etapas` es `STABLE`, `SECURITY DEFINER`, exige `super_admin` y solo ejecuta lecturas. No modifica expedientes, citas, cupos, agenda, documentos ni Google Sheets.
