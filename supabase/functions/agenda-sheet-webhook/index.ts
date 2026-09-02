// P213: entrypoint oficial Sheets → CRM.
// El guard de hard-cap relee la sección física y bloquea una entrada manual nueva
// si Biométricos Monterrey ya tiene 15 personas. El core anterior permanece
// congelado en agenda-sheet-webhook-core para no alterar sus rutas certificadas.
import "../agenda-sheet-webhook-cap-guard/index.ts";
