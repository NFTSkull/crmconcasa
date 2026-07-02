export type ExpedienteClienteDatosEstado =
  | "pendiente"
  | "completo"
  | "validado"
  | "rechazado";

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
    /** Porcentaje de cobro (captura asesor, ej. "12.5"). */
    porcentajeCobro: string;
    /** Método de pago (`transferencia`, `efectivo`, `tarjeta`, `otro`). */
    metodoPago: string;
  };

  /** Columna `porcentaje_cobro` (lectura). */
  porcentajeCobro?: number | null;
  /** Columna `monto_calculado` (servidor). */
  montoCalculado?: number | null;
  /** Columna `metodo_pago` (lectura). */
  metodoPago?: string | null;

  estado: ExpedienteClienteDatosEstado;

  /** Evidencias guardadas vía `save_cliente_datos` (columna `imagenes`). */
  imagenes?: ClienteDatosImagen[];

  /** Columna `telefono_normalizado` (solo lectura Mesa). */
  telefonoNormalizado?: string;

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
  updatedBy: string;
};

export type UpdateEstadoExpedienteClienteDatosInput = {
  expedienteId: string;
  estado: ExpedienteClienteDatosEstado;
  updatedBy: string;
  comentarioRechazo?: string;
};

