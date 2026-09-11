import { AdminAgendaEmbed } from "@/components/admin/AdminAgendaEmbed";
import { MesaAgendaHojaOperativaClient } from "@/components/mesa-control/MesaAgendaHojaOperativaClient";

export default function AdminAgendaHojaPage() {
  return (
    <AdminAgendaEmbed
      backHref="/admin/agenda"
      backLabel="← Volver a Agenda"
      contextLabel="Vista tipo Drive"
      hideMesaAgendaBackLink
    >
      <MesaAgendaHojaOperativaClient />
    </AdminAgendaEmbed>
  );
}
