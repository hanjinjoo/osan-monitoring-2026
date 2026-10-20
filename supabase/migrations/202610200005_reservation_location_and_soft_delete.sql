-- 2026-2 monitoring improvements: additive migration only. DO NOT APPLY until approved.
BEGIN;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS reservation_location text;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_location_length;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_location_length
 CHECK (reservation_location IS NULL OR (char_length(reservation_location) BETWEEN 1 AND 120 AND reservation_location=btrim(reservation_location)));

CREATE TABLE IF NOT EXISTS public.monitoring_reservation_location_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 previous_location text,
 new_location text,
 updated_by_group text NOT NULL CHECK (updated_by_group IN ('integrated','startup')),
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitoring_reservation_location_history_by_booking
 ON public.monitoring_reservation_location_history(reservation_id,changed_at DESC);
ALTER TABLE public.monitoring_reservation_location_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitoring_reservation_location_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.monitoring_reservation_location_history TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.monitoring_reservation_location_history_id_seq TO service_role;

-- New booking RPC copies existing collision and advisory-lock protections.
CREATE OR REPLACE FUNCTION public.monitoring_create_booking_with_location(
 p_club_id text,p_date date,p_time time without time zone,p_weekends boolean,p_location text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_club public.clubs%rowtype; v_row public.reservations%rowtype; v_location text;
BEGIN
 v_location:=btrim(coalesce(p_location,''));
 IF v_location='' OR char_length(v_location)>120 THEN RAISE EXCEPTION '모니터링 진행 장소를 1~120자로 입력해 주세요.' USING ERRCODE='P0001'; END IF;
 SELECT * INTO v_club FROM public.clubs WHERE id=p_club_id AND is_active=true;
 IF NOT FOUND THEN RAISE EXCEPTION '등록되지 않은 동아리입니다.' USING ERRCODE='P0001'; END IF;
 PERFORM public.monitoring_validate_slot(p_date,p_time,p_weekends);
 PERFORM public.monitoring_lock_slot(v_club.reservation_group,p_date,p_time);
 IF EXISTS(SELECT 1 FROM public.blocked_slots WHERE reservation_group=v_club.reservation_group AND blocked_date=p_date AND blocked_time=p_time) THEN RAISE EXCEPTION '담당자가 예약을 차단한 시간입니다.' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM public.reservations WHERE club_id=v_club.id AND status='confirmed') THEN RAISE EXCEPTION '해당 동아리는 이미 모니터링 일정이 예약되어 있습니다.' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM public.reservations WHERE reservation_group=v_club.reservation_group AND reservation_date=p_date AND reservation_time=p_time AND status='confirmed') THEN RAISE EXCEPTION '선택한 시간은 이미 예약되었습니다.' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.reservations(club_id,reservation_group,reservation_date,reservation_time,reservation_location)
 VALUES(v_club.id,v_club.reservation_group,p_date,p_time,v_location) RETURNING * INTO v_row;
 RETURN to_jsonb(v_row);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION '해당 동아리가 이미 예약했거나 선택한 시간이 방금 예약되었습니다.' USING ERRCODE='P0001';
END $fn$;

-- Admin combined date/time/location update, preserving legacy slot validation and history.
CREATE OR REPLACE FUNCTION public.monitoring_update_booking_with_location(
 p_id uuid,p_group text,p_date date,p_time time without time zone,p_weekends boolean,p_location text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_old public.reservations%rowtype;v_row public.reservations%rowtype;v_location text;
BEGIN
 SELECT * INTO v_old FROM public.reservations WHERE id=p_id AND status='confirmed' FOR UPDATE;
 IF NOT FOUND OR v_old.reservation_group<>p_group THEN RAISE EXCEPTION '수정 권한이 없거나 예약을 찾지 못했습니다.' USING ERRCODE='P0001'; END IF;
 v_location:=NULLIF(btrim(coalesce(p_location,'')),'');
 IF v_location IS NOT NULL AND char_length(v_location)>120 THEN RAISE EXCEPTION '모니터링 장소는 120자 이내로 입력해 주세요.' USING ERRCODE='P0001'; END IF;
 PERFORM public.monitoring_validate_slot(p_date,p_time,p_weekends);
 PERFORM public.monitoring_lock_slot(p_group,p_date,p_time);
 IF EXISTS(SELECT 1 FROM public.blocked_slots WHERE reservation_group=p_group AND blocked_date=p_date AND blocked_time=p_time) THEN RAISE EXCEPTION '차단된 시간입니다.' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM public.reservations WHERE id<>p_id AND reservation_group=p_group AND reservation_date=p_date AND reservation_time=p_time AND status='confirmed') THEN RAISE EXCEPTION '선택한 시간은 이미 예약되었습니다.' USING ERRCODE='P0001'; END IF;
 UPDATE public.reservations SET reservation_date=p_date,reservation_time=p_time,reservation_location=v_location,updated_at=now()
 WHERE id=p_id RETURNING * INTO v_row;
 IF v_old.reservation_date<>p_date OR v_old.reservation_time<>p_time THEN
  INSERT INTO public.reservation_history(reservation_id,action,previous_date,previous_time,new_date,new_time)
  VALUES(p_id,'updated',v_old.reservation_date,v_old.reservation_time,p_date,p_time);
 END IF;
 IF v_old.reservation_location IS DISTINCT FROM v_location THEN
  INSERT INTO public.monitoring_reservation_location_history(reservation_id,previous_location,new_location,updated_by_group)
  VALUES(p_id,v_old.reservation_location,v_location,p_group);
 END IF;
 RETURN to_jsonb(v_row);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION '선택한 시간은 이미 예약되었습니다.' USING ERRCODE='P0001';
END $fn$;

-- Location-only update accepts existing reservations even when dates are in the past.
CREATE OR REPLACE FUNCTION public.monitoring_update_booking_location(p_id uuid,p_group text,p_location text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_old public.reservations%rowtype;v_row public.reservations%rowtype;v_location text;
BEGIN
 v_location:=NULLIF(btrim(coalesce(p_location,'')),'');
 IF v_location IS NOT NULL AND char_length(v_location)>120 THEN RAISE EXCEPTION '모니터링 장소는 120자 이내로 입력해 주세요.' USING ERRCODE='P0001'; END IF;
 SELECT * INTO v_old FROM public.reservations WHERE id=p_id AND status='confirmed' FOR UPDATE;
 IF NOT FOUND OR v_old.reservation_group<>p_group THEN RAISE EXCEPTION '수정 권한이 없거나 예약을 찾지 못했습니다.' USING ERRCODE='P0001'; END IF;
 UPDATE public.reservations SET reservation_location=v_location,updated_at=now() WHERE id=p_id RETURNING * INTO v_row;
 IF v_old.reservation_location IS DISTINCT FROM v_location THEN
  INSERT INTO public.monitoring_reservation_location_history(reservation_id,previous_location,new_location,updated_by_group)
  VALUES(p_id,v_old.reservation_location,v_location,p_group);
 END IF;
 RETURN to_jsonb(v_row);
END $fn$;

REVOKE ALL ON FUNCTION public.monitoring_create_booking_with_location(text,date,time without time zone,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_update_booking_with_location(uuid,text,date,time without time zone,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_update_booking_location(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_create_booking_with_location(text,date,time without time zone,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_update_booking_with_location(uuid,text,date,time without time zone,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_update_booking_location(uuid,text,text) TO service_role;

-- Reversible record deletion, protect original photo binary and previous content.
ALTER TABLE public.monitoring_reports ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.monitoring_reports ADD COLUMN IF NOT EXISTS deleted_by_group text CHECK (deleted_by_group IN ('integrated','startup'));
ALTER TABLE public.monitoring_reports ADD COLUMN IF NOT EXISTS deleted_prev_status text CHECK(deleted_prev_status IN ('draft','completed','not_conducted'));
CREATE INDEX IF NOT EXISTS monitoring_reports_deleted_idx
 ON public.monitoring_reports(academic_term,deleted_at);
COMMIT;