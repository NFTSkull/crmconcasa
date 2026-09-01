"use client";

import { Select } from "@/components/ui/Select";
import type { AsesorActivoOrg } from "@/domain/asesor-lider";

type Props = Readonly<{
  asesores: readonly AsesorActivoOrg[];
  currentUserId: string;
  ownerAsesorId: string;
  onOwnerChange: (ownerId: string) => void;
}>;

export function AsesorOperacionDelegadaBar({
  asesores,
  currentUserId,
  ownerAsesorId,
  onOwnerChange,
}: Props) {
  const titular = asesores.find((a) => a.id === ownerAsesorId);
  const esDelegado = ownerAsesorId !== currentUserId;
  const ownerOptions = asesores.map((a) => ({
    value: a.id,
    label: `${a.full_name || a.email}${a.id === currentUserId ? " (yo)" : ""}`,
  }));

  return (
    <div
      className="mb-4 rounded-lg border border-indigo-200/80 bg-indigo-50/70 px-4 py-3"
      data-testid="asesor-operacion-delegada-bar"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <p className="text-xs font-medium text-indigo-950">Trabajando para:</p>
          <Select
            value={ownerAsesorId}
            onChange={(e) => onOwnerChange(e.target.value)}
            options={ownerOptions}
            data-testid="asesor-delegado-owner-select"
            aria-label="Asesor titular"
          />
        </div>
        {esDelegado && titular ? (
          <p
            className="text-[11px] leading-snug text-indigo-900/80"
            data-testid="asesor-delegado-titular-label"
          >
            Titular del expediente:{" "}
            <span className="font-medium">{titular.full_name || titular.email}</span>
            . Tus acciones se registran a tu nombre.
          </p>
        ) : null}
      </div>
    </div>
  );
}
