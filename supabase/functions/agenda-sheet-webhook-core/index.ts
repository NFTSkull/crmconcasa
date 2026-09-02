// P213: core congelado del webhook anterior. Se importa por commit inmutable
// para que agenda-sheet-webhook pueda envolverlo con hard-cap sin reescribir
// las rutas de operaciones/reagendos ya certificadas.
import "https://raw.githubusercontent.com/NFTSkull/crmconcasa/f9ce39f29ad074b1c9e6991f33e76b49f463e7f2/supabase/functions/agenda-sheet-webhook/index.ts";
