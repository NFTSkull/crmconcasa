"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SupabaseSessionError, useSessionRepo } from "@/domain/session";
import { redirectAfterLogin } from "@/lib/loginRedirect";
import { getEffectiveMockRole, persistMockUser } from "@/lib/mockUser";
import { isSupabaseAuthEnabled } from "@/lib/supabaseBrowser";

type MockLoginRole =
  | "super_admin"
  | "editor"
  | "asesor"
  | "mesa_control_admin"
  | "mesa_control_interno"
  | "mesa_control_externo";

const VISION_OPTIONS: { value: MockLoginRole; label: string }[] = [
  { value: "super_admin", label: "Super Admin" },
  { value: "editor", label: "Editor" },
  { value: "asesor", label: "Asesor" },
  { value: "mesa_control_admin", label: "Mesa Control - Admin (Cynthia)" },
  { value: "mesa_control_interno", label: "Mesa Control - Interno" },
  { value: "mesa_control_externo", label: "Mesa Control - Externo" },
];

function defaultNameForVision(vision: MockLoginRole, emailLocal: string): string {
  if (vision === "mesa_control_admin") return emailLocal ? `Cynthia (${emailLocal})` : "Cynthia";
  if (vision.startsWith("mesa_control")) return emailLocal || "Operador mesa";
  return emailLocal || "Usuario";
}

export default function LoginPage() {
  const router = useRouter();
  const { sessionRepo } = useSessionRepo();
  const supabaseAuth = isSupabaseAuthEnabled();
  const [vision, setVision] = useState<MockLoginRole>("asesor");
  const [nombre, setNombre] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const visionLabel = useMemo(
    () => VISION_OPTIONS.find((o) => o.value === vision)?.label ?? vision,
    [vision],
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoginError(null);
    const form = e.currentTarget;
    const emailRaw = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    if (supabaseAuth) {
      if (!emailRaw || !password) {
        setLoginError("Correo o usuario y contraseña son obligatorios.");
        return;
      }
      setSubmitting(true);
      try {
        await sessionRepo.login(emailRaw, password);
        const mockRole = getEffectiveMockRole();
        if (!mockRole) {
          setLoginError("No se pudo resolver el rol de sesión.");
          return;
        }
        redirectAfterLogin(router, mockRole);
      } catch (err) {
        const message =
          err instanceof SupabaseSessionError
            ? err.message
            : "No se pudo iniciar sesión. Intenta de nuevo.";
        setLoginError(message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const email = emailRaw || "anon@mock.local";
    void password;

    const emailLocal = email.includes("@") ? email.split("@")[0] ?? "" : email;
    const nameFinal =
      nombre.trim() ||
      defaultNameForVision(vision, emailLocal);

    if (typeof window !== "undefined") {
      persistMockUser({
        email,
        role: vision,
        name: nameFinal,
      });
    }

    redirectAfterLogin(router, vision);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200/80 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-lg">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          ConCasa CRM
        </h1>
        {supabaseAuth ? (
          <p className="mt-1 text-sm text-slate-500">
            Inicia sesión con tu cuenta de ConCasa. El rol se obtiene de tu perfil en Supabase.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Demo sin seguridad: no se valida contraseña; el correo puede ir vacío (se usa{" "}
            <code className="text-[10px]">anon@mock.local</code>). Sesión en este navegador.
          </p>
        )}
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Input
            name="email"
            type="text"
            label={supabaseAuth ? "Correo o usuario" : "Correo (opcional)"}
            placeholder={
              supabaseAuth
                ? "tu.correo@concasa.com o usuario autorizado"
                : "cynthia@concasa.test · vacío = anon@mock.local"
            }
            autoComplete="username"
            required={supabaseAuth}
          />
          {!supabaseAuth ? (
            <div>
              <Input
                name="nombre"
                type="text"
                label="Nombre para mostrar"
                placeholder="Ej. Cynthia López"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Opcional · si lo dejas vacío usamos un nombre según el perfil y tu correo.
              </p>
            </div>
          ) : null}
          <Input
            name="password"
            type="password"
            label={supabaseAuth ? "Contraseña" : "Contraseña (ignorada)"}
            placeholder={supabaseAuth ? "Tu contraseña" : "cualquier valor o vacío"}
            autoComplete="current-password"
            required={supabaseAuth}
          />
          {!supabaseAuth ? (
            <>
              <Select
                label="Perfil (mock)"
                name="vision"
                value={vision}
                onChange={(e) => setVision(e.target.value as MockLoginRole)}
                options={VISION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
                Perfil seleccionado: <span className="font-medium text-slate-800">{visionLabel}</span>.
                Los datos se guardan en <code className="text-[10px]">mock_user</code> (correo, rol y nombre)
                y se sincronizan las claves legacy <code className="text-[10px]">mock_role</code> /{" "}
                <code className="text-[10px]">mock_email</code>.
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
              Tras validar credenciales, leemos tu perfil en Supabase y sincronizamos{" "}
              <code className="text-[10px]">mock_user</code> para compatibilidad con la UI actual.
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="mt-1 w-full"
            disabled={submitting}
          >
            {submitting ? "Entrando…" : "Entrar"}
          </Button>
          {loginError ? <p className="text-xs text-red-600">{loginError}</p> : null}
        </form>
      </div>
    </div>
  );
}
