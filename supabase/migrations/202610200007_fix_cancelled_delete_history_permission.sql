-- Fix: permanent deletion of cancelled bookings failed because the recently added
-- location-history table granted service_role SELECT/INSERT but not DELETE.
-- Keep anon/authenticated privileges unchanged. Do not delete any existing rows.
BEGIN;
GRANT DELETE ON TABLE public.monitoring_reservation_location_history TO service_role;
COMMIT;
