import type {
  AsesorActivoOrg,
  AsesorLiderContext,
  AsesorLiderDashboard,
  AsesorLiderExpedientesPage,
  AsesorLiderMember,
  CreateExpedienteForAsesorInput,
} from "./types";
import {
  ASESOR_LIDER_DEFAULT_PAGE_SIZE,
  normalizeAsesorLiderPageOptions,
} from "./rpc";

const MOCK_TEAM_ID = "11111111-1111-4111-8111-111111111111";
const MOCK_ORG_ID = "22222222-2222-4222-8222-222222222222";
const MOCK_LEADER_ID = "33333333-3333-4333-8333-333333333333";
const MOCK_MEMBER_ID = "44444444-4444-4444-8444-444444444444";

const MOCK_MEMBERS: AsesorLiderMember[] = [
  {
    id: MOCK_LEADER_ID,
    full_name: "Líder Mock",
    email: "lider.mock@example.com",
    is_leader: true,
    active: true,
  },
  {
    id: MOCK_MEMBER_ID,
    full_name: "Asesor Mock",
    email: "asesor.mock@example.com",
    is_leader: false,
    active: true,
  },
];

function sampleDashboard(): AsesorLiderDashboard {
  return {
    activos: 3,
    cerrados: 1,
    total: 4,
    monto_total_aprobado: 120000,
    by_etapa: [
      { etapa: 1, nombre: "Integración", count: 2, monto: 0 },
      { etapa: 2, nombre: "Registro", count: 1, monto: 50000 },
      { etapa: 3, nombre: "Listo para cita de biométrico", count: 0, monto: 0 },
      { etapa: 4, nombre: "Cita agendada (biométricos)", count: 1, monto: 70000 },
      { etapa: 5, nombre: "Biometría (resultado)", count: 0, monto: 0 },
      { etapa: 6, nombre: "Inscripción", count: 0, monto: 0 },
      { etapa: 7, nombre: "Notificación", count: 0, monto: 0 },
      { etapa: 8, nombre: "Acuse / Aviso de retención", count: 0, monto: 0 },
      { etapa: 9, nombre: "Listo para agendar firma", count: 0, monto: 0 },
      { etapa: 10, nombre: "Cita para firma", count: 0, monto: 0 },
      { etapa: 11, nombre: "Firmado", count: 0, monto: 0 },
      { etapa: 12, nombre: "Pago a ConCasa", count: 0, monto: 0 },
    ],
    filters: {
      asesor_id: null,
      fecha_desde: null,
      fecha_hasta: null,
    },
  };
}

/** Repo mock: contexto sin dashboard líder por defecto. */
export class AsesorLiderMockRepo {
  private leaderMode: boolean;

  constructor(opts?: { leaderMode?: boolean }) {
    this.leaderMode = opts?.leaderMode === true;
  }

  async getContext(): Promise<AsesorLiderContext> {
    if (!this.leaderMode) {
      return {
        team_dashboard_read: false,
        capabilities: [],
        team: null,
      };
    }
    return {
      team_dashboard_read: true,
      capabilities: ["team_dashboard_read", "create_for_any_advisor"],
      team: {
        id: MOCK_TEAM_ID,
        nombre: "Equipo Mock",
        leader_id: MOCK_LEADER_ID,
        organization_id: MOCK_ORG_ID,
      },
    };
  }

  async listMembers(): Promise<readonly AsesorLiderMember[]> {
    if (!this.leaderMode) return [];
    return MOCK_MEMBERS;
  }

  async getDashboard(): Promise<AsesorLiderDashboard> {
    return sampleDashboard();
  }

  async listExpedientesPage(input?: {
    page?: number;
    page_size?: number;
  }): Promise<AsesorLiderExpedientesPage> {
    const { page, pageSize } = normalizeAsesorLiderPageOptions({
      page: input?.page,
      pageSize: input?.page_size ?? ASESOR_LIDER_DEFAULT_PAGE_SIZE,
    });
    const items = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        cliente_nombre: "Cliente Mock",
        nss: "12345678901",
        telefono_cliente: "5512345678",
        asesor_id: MOCK_MEMBER_ID,
        asesor_nombre: "Asesor Mock",
        etapa_actual: 1,
        ciclo_estado: "activo",
        subestado: "pendiente",
        submitted_to_mesa: false,
        monto_aprobado: null,
        monto_aprobado_al_aprobar: null,
        decision: "pendiente",
        created_at: new Date().toISOString(),
        fecha_envio_mesa: null,
      },
    ];
    return {
      items,
      total_count: items.length,
      page,
      page_size: pageSize,
      has_more: false,
    };
  }

  async listAsesoresActivosOrg(): Promise<readonly AsesorActivoOrg[]> {
    return MOCK_MEMBERS.map((m) => ({
      id: m.id,
      full_name: m.full_name,
      email: m.email,
    }));
  }

  async createExpedienteForAsesor(
    input: CreateExpedienteForAsesorInput,
  ): Promise<{ id: string; asesor_id: string }> {
    return {
      id: "66666666-6666-4666-8666-666666666666",
      asesor_id: input.asesorId,
    };
  }
}
