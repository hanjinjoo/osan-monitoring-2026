-- 2026-2: explicitly requested admin-only permanent deletion of cancelled bookings.
-- Existing cancelled rows are NOT purged by applying this migration.
-- Both reservation history tables have non-cascading foreign keys to reservations.
-- This service-role RPC removes dependent history and booking in one transaction.
BEGIN;
CREATE OR REPLACE FUNCTION public.monitoring_delete_cancelled_booking(
 p_id uuid,
 p_group text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_booking public.reservations%ROWTYPE;
 v_deleted_count integer;
BEGIN
 IF p_id IS NULL OR p_group IS NULL OR p_group NOT IN ('integrated','startup') THEN
  RAISE EXCEPTION '요청한 예약 또는 담당자 정보가 유효하지 않습니다.' USING ERRCODE='P0001';
 END IF;

 -- Lock and check actual status and group; the client-side status is not trusted.
 SELECT * INTO v_booking
 FROM public.reservations
 WHERE id=p_id
 FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION '삭제할 예약을 찾을 수 없습니다. 목록을 새로고침해 주세요.' USING ERRCODE='P0001';
 END IF;
 IF v_booking.reservation_group<>p_group THEN
  RAISE EXCEPTION '다른 담당자 그룹의 예약은 삭제할 수 없습니다.' USING ERRCODE='P0001';
 END IF;
 IF v_booking.status<>'cancelled' THEN
  RAISE EXCEPTION '취소한 예약만 영구 삭제할 수 있습니다.' USING ERRCODE='P0001';
 END IF;

 DELETE FROM public.monitoring_reservation_location_history WHERE reservation_id=p_id;
 DELETE FROM public.reservation_history WHERE reservation_id=p_id;
 DELETE FROM public.reservations WHERE id=p_id AND status='cancelled' AND reservation_group=p_group;
 GET DIAGNOSTICS v_deleted_count=ROW_COUNT;
 IF v_deleted_count<>1 THEN
  RAISE EXCEPTION '삭제 중 예약 상태가 변경되었습니다. 새로고침해 주세요.' USING ERRCODE='P0001';
 END IF;

 RETURN jsonb_build_object('deleted',true,'reservation_id',p_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.monitoring_delete_cancelled_booking(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_delete_cancelled_booking(uuid,text) TO service_role;
COMMIT;
