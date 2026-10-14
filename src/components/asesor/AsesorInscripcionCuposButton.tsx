"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { invokeAgendaSheetLiveSync } from "@/domain/agenda-sheets/live-inventory-sync";

function today() {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Monterrey",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
type Status = {loading:boolean;available:number|null;error:string};
export function AsesorInscripcionCuposButton() {
  const [open,setOpen] = useState(false);
  const [date,setDate] = useState(today);
  const [tick,setTick] = useState(0);
  const [status,setStatus] = useState<Status>({loading:false,available:null,error:""});
  useEffect(()=>{
    if(!open || !date) return;
    let active = true;
    setStatus({loading:true,available:null,error:""});
    void (async ()=>{
      if(!supabaseBrowser) throw new Error("La agenda no está conectada.");
      await invokeAgendaSheetLiveSync(supabaseBrowser,{
        kind:"inscripcion",mode:"availability",bookingDate:date,locationId:"monterrey"
      });
      const {data,error} = await supabaseBrowser.rpc("agenda_sheet_inventory_availability",{
        p_kind:"inscripcion",p_date:date,p_location_id:"monterrey"
      });
      if(error) throw error;
      const p=data as {ok?:boolean;fresh?:boolean;enforced?:boolean;slots?:Array<{available?:number}>;daily_remaining?:number}|null;
      if(!p?.ok || !p.fresh || !p.enforced) throw new Error("Cupo no verificado.");
      return Math.max(0,Math.min(Number(p.slots?.[0]?.available??0),Number(p.daily_remaining??0)));
    })().then(n=>{if(active)setStatus({loading:false,available:n,error:""});})
      .catch(()=>{if(active)setStatus({loading:false,available:null,error:"No se pudo verificar en Drive. Intenta actualizar."});});
    return ()=>{active=false;};
  },[open,date,tick]);
  return <>
    <Button variant="outline" onClick={()=>setOpen(true)}>Ver cupos de inscripción</Button>
    {open && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3" onClick={()=>setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="Disponibilidad de inscripciones" className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-lg" onClick={ev=>ev.stopPropagation()}>
        <h2 className="text-base font-semibold">Inscripción Monterrey · 11:00 a. m.</h2>
        <p className="text-xs text-gray-600">Cupos físicos con límite compartido de firmas e inscripciones.</p>
        <label className="block text-sm">Fecha
          <input type="date" min={today()} className="mt-1 w-full rounded-md border p-2" value={date} onChange={ev=>setDate(ev.target.value)} />
        </label>
        <p role="status" className="rounded bg-gray-50 p-3 text-sm">
          {status.loading?"Consultando Drive…":status.error || (status.available===null?"Selecciona fecha.":status.available+" lugares reservables")}
        </p>
        <p className="text-xs text-gray-600">Solo consulta. Para reservar debes entrar al expediente autorizado, cumplir su etapa y no tener otra inscripción activa.</p>
        <div className="flex gap-2"><Button variant="outline" onClick={()=>setTick(n=>n+1)}>Actualizar</Button><Button onClick={()=>setOpen(false)}>Cerrar</Button></div>
      </section>
    </div>}
  </>;
}
