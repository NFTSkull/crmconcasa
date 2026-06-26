# Deploy targets ConCasa

## CRM antiguo / operativo legacy

NO TOCAR salvo autorización explícita del owner.

- Vercel project: `concasacrm`
- Production URL: `https://concasacrm.vercel.app`
- GitHub repo: `NFTSkull/concasacrm`
- Ruta operativa legacy: `/revisor`
- Estado esperado: `/mesa-control` no existe aquí

Este proyecto contiene el CRM antiguo en producción. No desplegar el CRM Supabase aquí.

## CRM nuevo Supabase

Proyecto correcto para desarrollo y producción del CRM nuevo.

- Vercel project: `crmconcasa`
- Production URL: `https://crmconcasa.vercel.app`
- GitHub repo: `NFTSkull/crmconcasa`
- Rama principal: `main`
- Estado actual: Supabase operativo etapas 1→10 + P3R.0

## Reglas

1. Antes de cualquier push/merge/deploy, confirmar repo y proyecto Vercel.
2. Nunca hacer push a `NFTSkull/concasacrm` para cambios del CRM nuevo.
3. Nunca redeployar `concasacrm` para cambios del CRM nuevo.
4. Cualquier migración Supabase requiere autorización explícita.
5. No ejecutar `db push` ni `migration repair` sin autorización explícita.
