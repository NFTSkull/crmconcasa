import { AdminAgendaEmbed } from "@/components/admin/AdminAgendaEmbed";
import { MesaAgendaCitasClient } from "@/components/mesa-control/MesaAgendaCitasClient";

export default function AdminAgendaPage() {
  return (
    <AdminAgendaEmbed
      backHref="/admin"
      backLabel="← Volver al Admin"
      contextLabel="Agenda de citas"
    >
      <MesaAgendaCitasClient />
    </AdminAgendaEmbed>
  );
}
