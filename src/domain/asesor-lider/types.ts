/** Capabilities de perfil usadas por el módulo líder / alta por asesor. */
export type AsesorLiderCapability =
  | "team_dashboard_read"
  | "create_for_any_advisor"
  | "integrate_for_any_advisor"
  | (string & {});

export type AsesorLiderTeam = Readonly<{
  id: string;
  nombre: string;
  leader_id: string;
  organization_id: string;
}>;

export type AsesorLiderContext = Readonly<{
  team_dashboard_read: boolean;
  capabilities: readonly string[];
  team: AsesorLiderTeam | null;
}>;

export type AsesorLiderMember = Readonly<{
  id: string;
  full_name: string;
  email: string;
  is_leader: boolean;
  active: boolean;
}>;

export type AsesorLiderEtapaBucket = Readonly<{
  etapa: number;
  nombre: string;
  count: number;
  monto: number;
}>;

export type AsesorLiderDashboard = Readonly<{
  activos: number;
  cerrados: number;
  total: number;
  monto_total_aprobado: number;
  by_etapa: readonly AsesorLiderEtapaBucket[];
  filters: Readonly<{
    asesor_id: string | null;
    fecha_desde: string | null;
    fecha_hasta: string | null;
  }>;
}>;

export type AsesorLiderExpedienteRow = Readonly<{
  id: string;
  cliente_nombre: string;
  nss: string;
  telefono_cliente?: string | null;
  asesor_id: string;
  asesor_nombre?: string | null;
  etapa_actual?: number | null;
  ciclo_estado?: string | null;
  subestado?: string | null;
  submitted_to_mesa: boolean;
  monto_aprobado?: number | null;
  monto_aprobado_al_aprobar?: number | null;
  decision?: string | null;
  created_at: string;
  fecha_envio_mesa?: string | null;
}>;

export type AsesorLiderExpedientesPage = Readonly<{
  items: readonly AsesorLiderExpedienteRow[];
  total_count: number;
  page: number;
  page_size: number;
  has_more: boolean;
}>;

export type AsesorActivoOrg = Readonly<{
  id: string;
  full_name: string;
  email: string;
}>;

export type AsesorLiderDashboardFilters = Readonly<{
  asesorId: string | null;
  fechaDesde: string | null;
  fechaHasta: string | null;
  buscar: string | null;
  etapaExacta: number | null;
  ciclo: "activo" | "cerrado" | null;
  page: number;
  pageSize: number;
}>;

export type CreateExpedienteForAsesorInput = Readonly<{
  asesorId: string;
  programa: string;
  /** Label UI opcional; si viene, tiene prioridad al mapear a enum DB. */
  programaUi?: string;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  direccion_opcional: string;
}>;
