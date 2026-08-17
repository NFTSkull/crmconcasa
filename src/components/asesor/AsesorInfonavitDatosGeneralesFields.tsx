"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";
import {
  emptyInfonavitClienteDatosV1,
  formatInfonavitDwellingAddress,
  type InfonavitClienteDatosV1,
} from "@/domain/expediente-cliente-datos/infonavit-datos";
import type { ClienteDatosFieldErrors, ClienteDatosFieldKey } from "@/lib/clienteDatosValidation";
import {
  filterDigitsInput,
  filterPersonNameInput,
} from "@/lib/clienteDatosFieldFormats";
import { INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS } from "@/domain/expediente-cliente-datos/infonavit-datos";

type ClienteDatosFormState = ExpedienteClienteDatos["datos"];

function fieldInputClass(hasError: boolean): string {
  return hasError
    ? "rounded-md border border-red-400 bg-red-50/40 px-2 py-1 text-sm ring-1 ring-red-200"
    : "rounded-md border border-gray-300 px-2 py-1 text-sm";
}

function Field({
  label,
  fieldKey,
  error,
  showError,
  required = false,
  children,
}: {
  label: string;
  fieldKey: ClienteDatosFieldKey;
  error?: string;
  showError?: boolean;
  required?: boolean;
  children: ReactNode;
}) {
  const visible = showError && Boolean(error);
  return (
    <label className="grid gap-1 text-xs text-gray-600" data-field={fieldKey}>
      <span className="font-medium text-gray-800">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
      {visible ? (
        <span className="text-[11px] text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function patchInfonavit(
  setClienteDatos: Dispatch<SetStateAction<ClienteDatosFormState>>,
  updater: (inf: InfonavitClienteDatosV1) => InfonavitClienteDatosV1,
): void {
  setClienteDatos((p) => {
    const prev = p.infonavit ?? emptyInfonavitClienteDatosV1();
    return { ...p, infonavit: updater(prev) };
  });
}

export function AsesorInfonavitDatosGeneralesFields({
  clienteDatos,
  setClienteDatos,
  fieldErrors = {},
  showFieldErrors = false,
  fieldsRequired = false,
  optionalNote = null,
}: {
  clienteDatos: ClienteDatosFormState;
  setClienteDatos: Dispatch<SetStateAction<ClienteDatosFormState>>;
  fieldErrors?: ClienteDatosFieldErrors;
  showFieldErrors?: boolean;
  fieldsRequired?: boolean;
  optionalNote?: string | null;
}) {
  const inf = clienteDatos.infonavit ?? emptyInfonavitClienteDatosV1();
  const err = (key: ClienteDatosFieldKey) =>
    showFieldErrors ? fieldErrors[key] : undefined;
  const domicilioPreview = formatInfonavitDwellingAddress(inf.vivienda);
  const legacyNombre = clienteDatos.nombreCliente.trim();
  const showLegacyNombreHint =
    Boolean(legacyNombre) &&
    !(
      inf.titular.nombres.trim() &&
      inf.titular.apellidoPaterno.trim() &&
      inf.titular.apellidoMaterno.trim()
    );

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3">
        <p className="text-xs font-semibold text-gray-900">
          A. Identificación del cliente (Infonavit)
        </p>
        {optionalNote ? (
          <p className="mt-1 text-[11px] text-slate-600" role="note">
            {optionalNote}
          </p>
        ) : null}
        {showLegacyNombreHint ? (
          <p className="mt-1 text-[11px] text-slate-600" role="status">
            Nombre registrado actualmente: {legacyNombre}. Captura Nombre(s) y
            apellidos por separado (no se adivina).
          </p>
        ) : null}
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field
            label="Nombre(s)"
            fieldKey="infonavitTitularNombres"
            error={err("infonavitTitularNombres")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(Boolean(err("infonavitTitularNombres")))}
              value={inf.titular.nombres}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    nombres: filterPersonNameInput(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Apellido paterno"
            fieldKey="infonavitTitularApellidoPaterno"
            error={err("infonavitTitularApellidoPaterno")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitTitularApellidoPaterno")),
              )}
              value={inf.titular.apellidoPaterno}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    apellidoPaterno: filterPersonNameInput(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Apellido materno"
            fieldKey="infonavitTitularApellidoMaterno"
            error={err("infonavitTitularApellidoMaterno")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitTitularApellidoMaterno")),
              )}
              value={inf.titular.apellidoMaterno}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    apellidoMaterno: filterPersonNameInput(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Tipo de identificación"
            fieldKey="infonavitIdTipo"
            error={err("infonavitIdTipo")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(Boolean(err("infonavitIdTipo")))}
              placeholder="Ej. INE, pasaporte…"
              value={inf.titular.identificacion.tipo}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    identificacion: {
                      ...prev.titular.identificacion,
                      tipo: e.target.value,
                    },
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Número de identificación"
            fieldKey="infonavitIdNumero"
            error={err("infonavitIdNumero")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(Boolean(err("infonavitIdNumero")))}
              value={inf.titular.identificacion.numero}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    identificacion: {
                      ...prev.titular.identificacion,
                      numero: e.target.value,
                    },
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Vigencia"
            fieldKey="infonavitIdVigencia"
            error={err("infonavitIdVigencia")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              type="date"
              className={fieldInputClass(Boolean(err("infonavitIdVigencia")))}
              value={inf.titular.identificacion.vigencia}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    identificacion: {
                      ...prev.titular.identificacion,
                      vigencia: e.target.value,
                    },
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Género"
            fieldKey="infonavitGenero"
            error={err("infonavitGenero")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <select
              className={fieldInputClass(Boolean(err("infonavitGenero")))}
              value={inf.titular.genero}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    genero: (e.target.value === "M" || e.target.value === "F"
                      ? e.target.value
                      : "") as InfonavitClienteDatosV1["titular"]["genero"],
                  },
                }))
              }
            >
              <option value="">Selecciona…</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          </Field>
          <Field
            label="Estado civil"
            fieldKey="infonavitEstadoCivil"
            error={err("infonavitEstadoCivil")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <select
              className={fieldInputClass(Boolean(err("infonavitEstadoCivil")))}
              value={inf.titular.estadoCivil}
              onChange={(e) => {
                const next =
                  e.target.value === "soltero" || e.target.value === "casado"
                    ? e.target.value
                    : "";
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  titular: {
                    ...prev.titular,
                    estadoCivil: next,
                    regimenMatrimonial:
                      next === "casado" ? prev.titular.regimenMatrimonial : "",
                  },
                }));
              }}
            >
              <option value="">Selecciona…</option>
              <option value="soltero">Soltero(a)</option>
              <option value="casado">Casado(a)</option>
            </select>
          </Field>
          {inf.titular.estadoCivil === "casado" ? (
            <Field
              label="Régimen matrimonial"
              fieldKey="infonavitRegimen"
              error={err("infonavitRegimen")}
              showError={showFieldErrors}
            >
              <select
                className={fieldInputClass(Boolean(err("infonavitRegimen")))}
                value={inf.titular.regimenMatrimonial}
                onChange={(e) =>
                  patchInfonavit(setClienteDatos, (prev) => ({
                    ...prev,
                    titular: {
                      ...prev.titular,
                      regimenMatrimonial:
                        e.target.value === "separacion_bienes" ||
                        e.target.value === "sociedad_conyugal"
                          ? e.target.value
                          : "",
                    },
                  }))
                }
              >
                <option value="">Selecciona…</option>
                <option value="separacion_bienes">Separación de bienes</option>
                <option value="sociedad_conyugal">Sociedad conyugal</option>
              </select>
            </Field>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-900">
          B. Vivienda donde se realizará la mejora
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field
            label="Tipo de propiedad"
            fieldKey="infonavitViviendaTipoPropiedad"
            error={err("infonavitViviendaTipoPropiedad")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <select
              className={fieldInputClass(
                Boolean(err("infonavitViviendaTipoPropiedad")),
              )}
              value={inf.vivienda.tipoPropiedad}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: {
                    ...prev.vivienda,
                    tipoPropiedad:
                      e.target.value === "propia" ||
                      e.target.value === "conyuge_concubino" ||
                      e.target.value === "familiar"
                        ? e.target.value
                        : "",
                  },
                }))
              }
            >
              <option value="">Selecciona…</option>
              <option value="propia">Propia</option>
              <option value="conyuge_concubino">Cónyuge / concubino</option>
              <option value="familiar">Familiar</option>
            </select>
          </Field>
          <Field
            label="Localidad / ciudad"
            fieldKey="infonavitViviendaLocalidad"
            error={err("infonavitViviendaLocalidad")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitViviendaLocalidad")),
              )}
              value={inf.vivienda.localidad}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: { ...prev.vivienda, localidad: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Calle"
            fieldKey="infonavitViviendaCalle"
            error={err("infonavitViviendaCalle")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(Boolean(err("infonavitViviendaCalle")))}
              value={inf.vivienda.calle}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: { ...prev.vivienda, calle: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="No. exterior"
            fieldKey="infonavitViviendaNumeroExterior"
            error={err("infonavitViviendaNumeroExterior")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitViviendaNumeroExterior")),
              )}
              value={inf.vivienda.numeroExterior}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: {
                    ...prev.vivienda,
                    numeroExterior: e.target.value,
                  },
                }))
              }
            />
          </Field>
          <Field
            label="No. interior (opcional)"
            fieldKey="infonavitViviendaNumeroInterior"
            error={err("infonavitViviendaNumeroInterior")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitViviendaNumeroInterior")),
              )}
              value={inf.vivienda.numeroInterior}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: {
                    ...prev.vivienda,
                    numeroInterior: e.target.value,
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Lote (opcional)"
            fieldKey="infonavitViviendaLote"
            error={err("infonavitViviendaLote")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(Boolean(err("infonavitViviendaLote")))}
              value={inf.vivienda.lote}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: { ...prev.vivienda, lote: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Manzana (opcional)"
            fieldKey="infonavitViviendaManzana"
            error={err("infonavitViviendaManzana")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitViviendaManzana")),
              )}
              value={inf.vivienda.manzana}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: { ...prev.vivienda, manzana: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Colonia"
            fieldKey="infonavitViviendaColonia"
            error={err("infonavitViviendaColonia")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitViviendaColonia")),
              )}
              value={inf.vivienda.colonia}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: { ...prev.vivienda, colonia: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Entidad federativa"
            fieldKey="infonavitViviendaEntidad"
            error={err("infonavitViviendaEntidad")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitViviendaEntidad")),
              )}
              value={inf.vivienda.entidad}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: { ...prev.vivienda, entidad: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Municipio / alcaldía"
            fieldKey="infonavitViviendaMunicipio"
            error={err("infonavitViviendaMunicipio")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitViviendaMunicipio")),
              )}
              value={inf.vivienda.municipio}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: { ...prev.vivienda, municipio: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Código postal"
            fieldKey="infonavitViviendaCp"
            error={err("infonavitViviendaCp")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(Boolean(err("infonavitViviendaCp")))}
              inputMode="numeric"
              value={inf.vivienda.cp}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  vivienda: {
                    ...prev.vivienda,
                    cp: filterDigitsInput(e.target.value, 5),
                  },
                }))
              }
            />
          </Field>
        </div>
        {domicilioPreview ? (
          <p className="mt-2 text-[11px] text-slate-600" role="status">
            Domicilio que se guardará: {domicilioPreview}
          </p>
        ) : null}
      </div>

      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-900">D. Referencias</p>
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {([0, 1] as const).map((idx) => {
            const prefix = idx === 0 ? "infonavitRef1" : "infonavitRef2";
            const r = inf.referencias[idx];
            return (
              <div key={idx} className="rounded border border-gray-100 p-2">
                <p className="text-[11px] font-semibold text-gray-800">
                  Referencia {idx + 1}
                </p>
                <div className="mt-1 grid grid-cols-1 gap-2">
                  <Field
                    label="Nombre(s)"
                    fieldKey={`${prefix}Nombres` as ClienteDatosFieldKey}
                    error={err(`${prefix}Nombres` as ClienteDatosFieldKey)}
                    showError={showFieldErrors}
                  >
                    <input
                      className={fieldInputClass(
                        Boolean(err(`${prefix}Nombres` as ClienteDatosFieldKey)),
                      )}
                      value={r.nombres}
                      onChange={(e) =>
                        patchInfonavit(setClienteDatos, (prev) => {
                          const refs = [...prev.referencias] as InfonavitClienteDatosV1["referencias"];
                          refs[idx] = {
                            ...refs[idx],
                            nombres: filterPersonNameInput(e.target.value),
                          };
                          return { ...prev, referencias: refs };
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Apellido paterno"
                    fieldKey={`${prefix}ApellidoPaterno` as ClienteDatosFieldKey}
                    error={err(
                      `${prefix}ApellidoPaterno` as ClienteDatosFieldKey,
                    )}
                    showError={showFieldErrors}
                  >
                    <input
                      className={fieldInputClass(
                        Boolean(
                          err(
                            `${prefix}ApellidoPaterno` as ClienteDatosFieldKey,
                          ),
                        ),
                      )}
                      value={r.apellidoPaterno}
                      onChange={(e) =>
                        patchInfonavit(setClienteDatos, (prev) => {
                          const refs = [...prev.referencias] as InfonavitClienteDatosV1["referencias"];
                          refs[idx] = {
                            ...refs[idx],
                            apellidoPaterno: filterPersonNameInput(
                              e.target.value,
                            ),
                          };
                          return { ...prev, referencias: refs };
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Apellido materno"
                    fieldKey={`${prefix}ApellidoMaterno` as ClienteDatosFieldKey}
                    error={err(
                      `${prefix}ApellidoMaterno` as ClienteDatosFieldKey,
                    )}
                    showError={showFieldErrors}
                  >
                    <input
                      className={fieldInputClass(
                        Boolean(
                          err(
                            `${prefix}ApellidoMaterno` as ClienteDatosFieldKey,
                          ),
                        ),
                      )}
                      value={r.apellidoMaterno}
                      onChange={(e) =>
                        patchInfonavit(setClienteDatos, (prev) => {
                          const refs = [...prev.referencias] as InfonavitClienteDatosV1["referencias"];
                          refs[idx] = {
                            ...refs[idx],
                            apellidoMaterno: filterPersonNameInput(
                              e.target.value,
                            ),
                          };
                          return { ...prev, referencias: refs };
                        })
                      }
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field
                      label="LADA"
                      fieldKey={`${prefix}Lada` as ClienteDatosFieldKey}
                      error={err(`${prefix}Lada` as ClienteDatosFieldKey)}
                      showError={showFieldErrors}
                    >
                      <input
                        className={fieldInputClass(
                          Boolean(err(`${prefix}Lada` as ClienteDatosFieldKey)),
                        )}
                        inputMode="numeric"
                        value={r.lada}
                        onChange={(e) =>
                          patchInfonavit(setClienteDatos, (prev) => {
                            const refs = [...prev.referencias] as InfonavitClienteDatosV1["referencias"];
                            refs[idx] = {
                              ...refs[idx],
                              lada: filterDigitsInput(e.target.value, 3),
                            };
                            return { ...prev, referencias: refs };
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Teléfono"
                      fieldKey={`${prefix}Telefono` as ClienteDatosFieldKey}
                      error={err(`${prefix}Telefono` as ClienteDatosFieldKey)}
                      showError={showFieldErrors}
                    >
                      <input
                        className={fieldInputClass(
                          Boolean(
                            err(`${prefix}Telefono` as ClienteDatosFieldKey),
                          ),
                        )}
                        inputMode="tel"
                        value={r.telefono}
                        onChange={(e) =>
                          patchInfonavit(setClienteDatos, (prev) => {
                            const refs = [...prev.referencias] as InfonavitClienteDatosV1["referencias"];
                            refs[idx] = {
                              ...refs[idx],
                              telefono: filterDigitsInput(e.target.value, 8),
                            };
                            return { ...prev, referencias: refs };
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Celular"
                      fieldKey={`${prefix}Celular` as ClienteDatosFieldKey}
                      error={err(`${prefix}Celular` as ClienteDatosFieldKey)}
                      showError={showFieldErrors}
                    >
                      <input
                        className={fieldInputClass(
                          Boolean(
                            err(`${prefix}Celular` as ClienteDatosFieldKey),
                          ),
                        )}
                        inputMode="tel"
                        value={r.celular}
                        onChange={(e) =>
                          patchInfonavit(setClienteDatos, (prev) => {
                            const refs = [...prev.referencias] as InfonavitClienteDatosV1["referencias"];
                            refs[idx] = {
                              ...refs[idx],
                              celular: filterDigitsInput(e.target.value, 15),
                            };
                            return { ...prev, referencias: refs };
                          })
                        }
                      />
                    </Field>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-900">E. Beneficiario</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field
            label="Nombre(s)"
            fieldKey="infonavitBeneficiarioNombres"
            error={err("infonavitBeneficiarioNombres")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitBeneficiarioNombres")),
              )}
              value={inf.beneficiario.nombres}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  beneficiario: {
                    ...prev.beneficiario,
                    nombres: filterPersonNameInput(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Apellido paterno"
            fieldKey="infonavitBeneficiarioApellidoPaterno"
            error={err("infonavitBeneficiarioApellidoPaterno")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitBeneficiarioApellidoPaterno")),
              )}
              value={inf.beneficiario.apellidoPaterno}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  beneficiario: {
                    ...prev.beneficiario,
                    apellidoPaterno: filterPersonNameInput(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Apellido materno"
            fieldKey="infonavitBeneficiarioApellidoMaterno"
            error={err("infonavitBeneficiarioApellidoMaterno")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitBeneficiarioApellidoMaterno")),
              )}
              value={inf.beneficiario.apellidoMaterno}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  beneficiario: {
                    ...prev.beneficiario,
                    apellidoMaterno: filterPersonNameInput(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field
            label="Parentesco"
            fieldKey="infonavitBeneficiarioParentesco"
            error={err("infonavitBeneficiarioParentesco")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitBeneficiarioParentesco")),
              )}
              value={inf.beneficiario.parentesco}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  beneficiario: {
                    ...prev.beneficiario,
                    parentesco: filterPersonNameInput(e.target.value),
                  },
                }))
              }
            />
          </Field>
        </div>
      </div>

      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-900">F. Datos de la mejora</p>
        <p className="mt-1 text-[11px] text-gray-600">
          Independiente del monto Mejoravit / cobro. Máx.{" "}
          {INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS} caracteres.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <Field
            label="Descripción de la mejora"
            fieldKey="infonavitMejoraDescripcion"
            error={err("infonavitMejoraDescripcion")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <textarea
              className={fieldInputClass(
                Boolean(err("infonavitMejoraDescripcion")),
              )}
              rows={3}
              value={inf.mejora.descripcion}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  mejora: { ...prev.mejora, descripcion: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Presupuesto estimado de la mejora"
            fieldKey="infonavitMejoraPresupuesto"
            error={err("infonavitMejoraPresupuesto")}
            showError={showFieldErrors}
            required={fieldsRequired}
          >
            <input
              className={fieldInputClass(
                Boolean(err("infonavitMejoraPresupuesto")),
              )}
              inputMode="decimal"
              value={inf.mejora.presupuestoEstimado}
              onChange={(e) =>
                patchInfonavit(setClienteDatos, (prev) => ({
                  ...prev,
                  mejora: {
                    ...prev.mejora,
                    presupuestoEstimado: e.target.value,
                  },
                }))
              }
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
