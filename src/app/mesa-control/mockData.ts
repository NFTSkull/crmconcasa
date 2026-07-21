export type Subestado =
  | "pendiente"
  | "en_validacion_mesa"
  | "en_proceso"
  | "aprobado"
  | "rechazado";

export interface CasoMock {
  id: string;
  cliente_nombre: string;
  telefono_cliente: string;
  programa: string;
  nss?: string;
  asesorNombre: string;
  etapaActual: number;
  subestado: Subestado;
  /** Ciclo operativo; default activo si se omite (mock legacy). */
  cicloEstado?: string | null;
  motivoRechazo?: string;
  fechaCita?: string;
  /** Alta del expediente (precalificación); fallback de urgencia si no hay `fechaEnvioMesa`. */
  createdAt?: string;
  /** Si el inbox la guarda; prioridad sobre `createdAt` / `updatedAt` para orden en bandeja. */
  fechaEnvioMesa?: string | null;
  updatedAt: string;
  submittedToMesa: boolean;
  /** Origen comercial (inbox mock); filtros “Internos / Externos” solo admin. */
  origenMesa?: "interno" | "externo" | null;
}

export const ETAPAS_LABELS: Record<number, string> = {
  1: "Integración",
  2: "Registro",
  3: "Listo cita biométricos",
  4: "Cita agendada (biométricos)",
  5: "Biometría (resultado)",
  6: "Inscripción",
  7: "Notificación",
  8: "Acuse / Aviso retención",
  9: "Listo agendar firma",
  10: "Cita para firma",
  11: "Firmado",
  12: "Pago a ConCasa",
};

export function getTodayYMD(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

const todayYMD = getTodayYMD();

export const CASOS_MOCK: CasoMock[] = [
  { id: "mc-1", cliente_nombre: "Ana García López", telefono_cliente: "5512345678", programa: "Mejoravit", asesorNombre: "Carlos R.", etapaActual: 1, subestado: "en_proceso", updatedAt: "2025-03-12T10:00:00.000Z", submittedToMesa: true },
  { id: "mc-2", cliente_nombre: "Roberto Sánchez", telefono_cliente: "5598765432", programa: "Subcuenta", asesorNombre: "María T.", etapaActual: 2, subestado: "en_proceso", updatedAt: "2025-03-12T09:30:00.000Z", submittedToMesa: true },
  { id: "mc-3", cliente_nombre: "Laura Martínez", telefono_cliente: "5511223344", programa: "Compro tu casa", asesorNombre: "Carlos R.", etapaActual: 4, subestado: "en_proceso", fechaCita: todayYMD, updatedAt: "2025-03-12T09:00:00.000Z", submittedToMesa: true },
  { id: "mc-4", cliente_nombre: "Pedro Hernández", telefono_cliente: "5544556677", programa: "Mejoravit", asesorNombre: "María T.", etapaActual: 5, subestado: "rechazado", motivoRechazo: "Huellas ilegibles", updatedAt: "2025-03-11T16:00:00.000Z", submittedToMesa: true },
  { id: "mc-5", cliente_nombre: "Sofía Ramírez", telefono_cliente: "5588990011", programa: "Subcuenta", asesorNombre: "Carlos R.", etapaActual: 3, subestado: "pendiente", updatedAt: "2025-03-11T14:00:00.000Z", submittedToMesa: true },
  { id: "mc-6", cliente_nombre: "Miguel Torres", telefono_cliente: "5533445566", programa: "Mejoravit", asesorNombre: "María T.", etapaActual: 10, subestado: "en_proceso", fechaCita: todayYMD, updatedAt: "2025-03-11T12:00:00.000Z", submittedToMesa: true },
  { id: "mc-7", cliente_nombre: "Elena Díaz", telefono_cliente: "5566778899", programa: "Compro tu casa", asesorNombre: "Carlos R.", etapaActual: 1, subestado: "pendiente", updatedAt: "2025-03-10T18:00:00.000Z", submittedToMesa: true },
  { id: "mc-8", cliente_nombre: "Jorge Flores", telefono_cliente: "5500112233", programa: "Subcuenta", asesorNombre: "María T.", etapaActual: 7, subestado: "aprobado", updatedAt: "2025-03-10T15:00:00.000Z", submittedToMesa: true },
  { id: "mc-9", cliente_nombre: "Carmen Ruiz", telefono_cliente: "5577889900", programa: "Mejoravit", asesorNombre: "Carlos R.", etapaActual: 2, subestado: "rechazado", motivoRechazo: "Registrado con otro proveedor", updatedAt: "2025-03-10T11:00:00.000Z", submittedToMesa: true },
  { id: "mc-10", cliente_nombre: "Luis Morales", telefono_cliente: "5522334455", programa: "Compro tu casa", asesorNombre: "María T.", etapaActual: 4, subestado: "en_proceso", fechaCita: "2025-03-15", updatedAt: "2025-03-09T17:00:00.000Z", submittedToMesa: true },
  { id: "mc-11", cliente_nombre: "Patricia Vega", telefono_cliente: "5544667788", programa: "Mejoravit", asesorNombre: "Carlos R.", etapaActual: 6, subestado: "en_proceso", updatedAt: "2025-03-09T14:00:00.000Z", submittedToMesa: true },
  { id: "mc-12", cliente_nombre: "Fernando Castro", telefono_cliente: "5599001122", programa: "Subcuenta", asesorNombre: "María T.", etapaActual: 9, subestado: "pendiente", updatedAt: "2025-03-08T16:00:00.000Z", submittedToMesa: true },
  { id: "mc-13", cliente_nombre: "Claudia Reyes", telefono_cliente: "5511335577", programa: "Compro tu casa", asesorNombre: "Carlos R.", etapaActual: 12, subestado: "en_proceso", updatedAt: "2025-03-08T10:00:00.000Z", submittedToMesa: true },
  { id: "mc-14", cliente_nombre: "Ricardo Soto", telefono_cliente: "5566889944", programa: "Mejoravit", asesorNombre: "María T.", etapaActual: 1, subestado: "en_proceso", updatedAt: "2025-03-07T18:30:00.000Z", submittedToMesa: true },
  { id: "mc-15", cliente_nombre: "Adriana Mendoza", telefono_cliente: "5533669988", programa: "Subcuenta", asesorNombre: "Carlos R.", etapaActual: 10, subestado: "rechazado", motivoRechazo: "No asistió", updatedAt: "2025-03-07T12:00:00.000Z", submittedToMesa: true },
];
