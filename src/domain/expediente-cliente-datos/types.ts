import type { InfonavitClienteDatosV1 } from "./infonavit-datos";
import type { ClienteDatosPerfilCaptura } from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";

export type ExpedienteClienteDatosEstado =
  | "pendiente"
  | "completo"
  | "validado"
  | "rechazado";

export type {
  InfonavitBeneficiarioForm,
  InfonavitClienteDatosV1,
  InfonavitEstadoCivilForm,
  InfonavitGeneroForm,
  InfonavitMejoraForm,
  InfonavitReferenciaForm,
  InfonavitRegimenForm,
  InfonavitTipoPropiedadForm,
  InfonavitTitularForm,
  InfonavitViviendaForm,
} from "./infonavit-datos";

/** Lectura batch para bandeja Mesa (estado + fechas de corrección). */
export type ClienteDatosEstadoBatch = Readonly<{
  estado: ExpedienteClienteDatosEstado;
  updatedAt: string | null;
  validatedAt: string | null;
}>;

/** Metadata de evidencia en columna `cliente_datos.imagenes` (sin rutas Storage en UI). */
export type ClienteDatosImagen = {
  tipo?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
};

export type ExpedienteClienteDatos = {
  expedienteId: string;

  datos: {
    nombreCliente: string;
    nss: string;
    curp: string;
    rfc: string;
    celular: string;
    correo: string;
    empresa: string;
    registroPatronal: string;
    telefonoEmpresa: string;
    referencias: {
      nombre: string;
      celular: string;
    }[];
    beneficiario: {
      nombre: string;
      parentesco: string;
    };
    direccionEmpresa: {
      calle: string;
      colonia: string;
      municipio: string;
      cp: string;
    };
    /** Monto Mejoravit derivado del editor (JSON `datos.montoMejoravit`; solo Mejoravit). */
    montoMejoravit: string;
    /** Plazo del crédito (JSON `datos.plazo`). */
    plazo: string;
    /** Porcentaje de cobro (captura asesor, ej. "12.5"). */
    porcentajeCobro: string;
    /** Monto calculado (columna `monto_calculado`; editable con default automático). */
    montoCalculado: string;
    /** Método de pago (`transferencia`, `efectivo`, `tarjeta`, `domiciliado`). */
    metodoPago: string;
    /** Nota opcional del asesor visible para Mesa Control (JSON `datos.notaMesa`). */
    notaMesa?: string;
    /**
     * P189 B2 — datos estructurados Infonavit (solo Mejoravit).
     * Legacy sin bloque: mapper rellena defaults seguros.
     */
    infonavit?: InfonavitClienteDatosV1;
  };

  /** Columna `porcentaje_cobro` (lectura). */
  porcentajeCobro?: number | null;
  /** Columna `monto_calculado` (lectura). */
  montoCalculado?: number | null;
  /** Columna `metodo_pago` (lectura). */
  metodoPago?: string | null;

  estado: ExpedienteClienteDatosEstado;

  /** Evidencias guardadas vía `save_cliente_datos` (columna `imagenes`). */
  imagenes?: ClienteDatosImagen[];

  /** Columna `telefono_normalizado`: celular principal normalizado. */
  telefonoNormalizado?: string;
  /** `expedientes.telefono_cliente`: teléfono de casa capturado en precalificación. */
  telefonoCasa?: string;

  /** Solo aplica cuando `estado === "rechazado"` */
  comentarioRechazo?: string;

  validatedAt?: string;
  validatedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;

  updatedAt: string;
  updatedBy: string;
};

export type SaveExpedienteClienteDatosInput = {
  expedienteId: string;
  datos: ExpedienteClienteDatos["datos"];
  /** Dirección del cliente (`expedientes.direccion_opcional`). */
  direccionOpcional: string;
  updatedBy: string;
  /** Programa DB (`mejoravit`, `compro_tu_casa`, …) para validar payload. */
  programaDb?: string | null;
  /** Si true, envía p_monto_calculado_manual; si false, el servidor recalcula automático. */
  montoCalculadoEsManual?: boolean;
  /**
   * Perfil de captura. `asesor_equipo_silvia_simplificado` → `p_referencias: []`
   * y no exige plazo en Mejoravit.
   */
  perfilCaptura?: ClienteDatosPerfilCaptura;
};

export type UpdateEstadoExpedienteClienteDatosInput = {
  expedienteId: string;
  estado: ExpedienteClienteDatosEstado;
  updatedBy: string;
  comentarioRechazo?: string;
};
