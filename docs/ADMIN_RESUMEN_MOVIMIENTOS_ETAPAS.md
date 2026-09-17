# Resumen Admin — flujo unificado de expedientes

## Objetivo

Mostrar en una sola lectura la operación del periodo sin modificar las métricas existentes ni la lógica de los expedientes.

- **Resumen del periodo**: conserva sus KPI actuales.
- **Flujo de expedientes**: sustituye visualmente los dos cuadros anteriores y reúne en una sola tabla los ingresos del periodo, los movimientos ocurridos dentro del rango y la foto actual del CRM.
- No se altera la semántica de las consultas existentes; únicamente se presentan juntas para evitar que el usuario tenga que reconciliar dos secciones distintas.

## Semántica de la vista unificada

La cabecera muestra tres referencias compactas:

- **Ingresos del periodo**: expedientes enviados a Mesa dentro del rango seleccionado.
- **Expedientes con movimiento**: expedientes únicos que registraron al menos una entrada a una etapa dentro del rango, aunque hayan sido enviados a Mesa antes.
- **Expedientes actuales**: stock vigente total del CRM con los mismos filtros de asesor, estado y búsqueda; no depende de la fecha seleccionada.

La tabla tiene una fila por cada uno de los 11 pasos visuales canónicos y tres lecturas comparables:

- **Pasaron en el periodo**: expedientes únicos que tuvieron una entrada a ese paso dentro del rango. Incluye primera entrada, avance, reingreso o retroceso. Debajo se desglosa cuántos ingresaron a Mesa dentro del rango y cuántos ya venían de antes.
- **Siguen aquí**: de los expedientes enviados a Mesa dentro del rango, cuántos se encuentran actualmente en ese paso y qué porcentaje representan.
- **Total actual**: todos los expedientes que actualmente se encuentran en ese paso, independientemente de cuándo entraron a Mesa.

Cada expediente cuenta una sola vez por etapa dentro del rango, aunque reingrese varias veces. Un expediente sí puede aparecer en más de una fila durante el mismo rango si pasó por varias etapas. Por esta razón no se representa como un embudo estricto.

## Cobertura histórica

Los movimientos se calculan exclusivamente con `expediente_paso_visual_transiciones`. No se inventa backfill. Si el rango empieza antes del primer evento disponible, la UI muestra una advertencia de cobertura incompleta; la ubicación actual de los ingresos del periodo y el total actual siguen siendo válidos.

## Seguridad

La RPC `admin_resumen_movimientos_etapas` sigue siendo `STABLE`, `SECURITY DEFINER`, exige `super_admin` y solo ejecuta lecturas. La vista reutiliza `getMesaCohortByEtapa` para la ubicación actual de los ingresos del periodo. Este rediseño no modifica expedientes, citas, cupos, agenda, documentos ni Google Sheets.
