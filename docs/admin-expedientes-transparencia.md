# Admin — transparencia de expedientes

## Objetivo

La pestaña **Expedientes** del Super Admin abre un inventario actual separado del reporte histórico de producción. El inventario incluye expedientes **enviados a Mesa** y **no enviados a Mesa**.

## Filtros

- Estado de envío a Mesa: Todos / Enviados a Mesa / No enviados.
- Asesor.
- Etapa actual.
- Estado del expediente.
- Búsqueda por cliente, NSS, asesor o programa.

El inventario no usa el periodo de producción porque un expediente no enviado todavía no tiene `fecha_envio_mesa`.

## Detalle

`/admin/expedientes/[id]` es solo lectura y muestra:

- estado e instante exacto de envío a Mesa;
- precalificación y Datos Generales;
- documentos activos e históricos, versiones, hora de carga, actor y revisión;
- apertura del archivo para documentos activos usando el acceso RLS existente;
- lotes de corrección y cambios solicitados;
- citas, decisiones, cancelaciones/reagendas;
- rechazos y reactivaciones;
- retención;
- historial completo de acciones.

## Backend

RPCs read-only:

- `admin_list_expedientes_overview_page`;
- `admin_list_expedientes_overview_asesores`.

Ambas requieren `super_admin`, aplican scope por `organization_id` y no escriben datos. La vista de detalle reutiliza `admin_get_expediente_full_detail`.
