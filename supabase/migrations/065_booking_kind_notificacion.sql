-- ConCasa CRM — P065: enum booking_kind + valor 'notificacion'
-- Aplicar antes de 066 (PostgreSQL no permite usar el nuevo enum en la misma transacción).

ALTER TYPE public.booking_kind ADD VALUE IF NOT EXISTS 'notificacion';
