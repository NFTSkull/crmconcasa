export type ExpedienteClienteDatosEstado =
  | "pendiente"
  | "completo"
  | "validado"
  | "rechazado";

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
  };

  estado: ExpedienteClienteDatosEstado;

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

