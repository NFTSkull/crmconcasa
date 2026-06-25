import type { AgendaBiometricosWeeklyConfig } from "./map-agenda-config";

export type AgendaBiometricosConfigRecord = Readonly<{
  id: string;
  organizationId: string;
  kind: "biometricos";
  config: AgendaBiometricosWeeklyConfig;
  updatedAt: string;
  updatedBy: string | null;
}>;

export type UpsertAgendaBiometricosConfigResult = Readonly<{
  ok: true;
  agendaConfigId: string;
  organizationId: string;
  kind: "biometricos";
  config: AgendaBiometricosWeeklyConfig;
  created: boolean;
  updatedAt: string;
  updatedBy: string | null;
  warnings: readonly string[];
}>;

export interface AgendaBiometricosConfigRepo {
  getBiometricosConfig(): Promise<AgendaBiometricosConfigRecord | null>;
  upsertBiometricosConfig(
    config: AgendaBiometricosWeeklyConfig,
  ): Promise<UpsertAgendaBiometricosConfigResult>;
}
