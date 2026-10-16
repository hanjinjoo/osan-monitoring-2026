-- 오산대학교 동아리 모니터링 예약 시스템 (PostgreSQL / Supabase)
-- 서비스 역할만 데이터에 직접 접근. 공개 요청은 Edge Function이 검증하여 수행.
CREATE TABLE IF NOT EXISTS public.clubs (
 id text PRIMARY KEY,
 name text NOT NULL,
 category text NOT NULL CHECK(category IN ('major','employment','startup','general')),
 reservation_group text NOT NULL CHECK(reservation_group IN ('integrated','startup')),
 is_active boolean NOT NULL DEFAULT true,
 CONSTRAINT club_group_correct CHECK ((category='startup' AND reservation_group='startup') OR (category<>'startup' AND reservation_group='integrated'))
);
CREATE TABLE IF NOT EXISTS public.reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id text NOT NULL REFERENCES public.clubs(id),
 reservation_group text NOT NULL CHECK(reservation_group IN ('integrated','startup')),
 reservation_date date NOT NULL,
 reservation_time time without time zone NOT NULL,
 status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT reservation_date_range CHECK(reservation_date BETWEEN DATE '2026-10-26' AND DATE '2026-11-27'),
 CONSTRAINT reservation_time_range CHECK(reservation_time>=TIME '09:00' AND reservation_time<TIME '18:00' AND NOT(reservation_time>=TIME '12:00' AND reservation_time<TIME '13:00')),
 CONSTRAINT reservation_time_quarter CHECK(extract(minute from reservation_time)::int % 15 = 0 AND extract(second from reservation_time)=0)
);
CREATE UNIQUE INDEX IF NOT EXISTS reservation_one_active_slot ON public.reservations(reservation_group,reservation_date,reservation_time) WHERE status='confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS reservation_one_active_club ON public.reservations(club_id) WHERE status='confirmed';
CREATE INDEX IF NOT EXISTS idx_reservations_group_date ON public.reservations(reservation_group,reservation_date);
CREATE TABLE IF NOT EXISTS public.blocked_slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_group text NOT NULL CHECK(reservation_group IN ('integrated','startup')),
 blocked_date date NOT NULL CHECK(blocked_date BETWEEN DATE '2026-10-26' AND DATE '2026-11-27'),
 blocked_time time without time zone NOT NULL CHECK(blocked_time>=TIME '09:00' AND blocked_time<TIME '18:00' AND NOT(blocked_time>=TIME '12:00' AND blocked_time<TIME '13:00') AND extract(minute from blocked_time)::int % 15=0 AND extract(second from blocked_time)=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reservation_group,blocked_date,blocked_time)
);
CREATE TABLE IF NOT EXISTS public.reservation_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 action text NOT NULL CHECK(action IN ('updated','cancelled')),
 previous_date date,
 previous_time time without time zone,
 new_date date,
 new_time time without time zone,
 changed_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: 외부 브라우저의 직접 읽기/수정 모두 차단; Edge 함수의 service_role만 접근.
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clubs,public.reservations,public.blocked_slots,public.reservation_history FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.clubs,public.reservations,public.blocked_slots,public.reservation_history TO service_role;

-- 공통 검사: 날짜/시각/주말 + 과거 일정 예약 방지.
CREATE OR REPLACE FUNCTION public.monitoring_validate_slot(p_date date,p_time time,p_weekends boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_date IS NULL OR p_time IS NULL THEN RAISE EXCEPTION '날짜와 시간을 선택해 주세요.' USING ERRCODE='P0001'; END IF;
 IF p_date NOT BETWEEN DATE '2026-10-26' AND DATE '2026-11-27' THEN RAISE EXCEPTION '모니터링 기간 내에서 날짜를 선택해 주세요.' USING ERRCODE='P0001'; END IF;
 IF p_date<(now() AT TIME ZONE 'Asia/Seoul')::date THEN RAISE EXCEPTION '이미 지난 날짜에는 예약할 수 없습니다.' USING ERRCODE='P0001'; END IF;
 IF extract(dow from p_date) IN (0,6) AND NOT p_weekends THEN RAISE EXCEPTION '주말은 예약할 수 없습니다.' USING ERRCODE='P0001'; END IF;
 IF p_time < TIME '09:00' OR p_time>=TIME '18:00' OR (p_time>=TIME '12:00' AND p_time<TIME '13:00') OR extract(minute from p_time)::int % 15 <> 0 OR extract(second from p_time)<>0 THEN
  RAISE EXCEPTION '예약 시간은 09:00~17:45, 점심시간 제외, 15분 간격으로 선택해 주세요.' USING ERRCODE='P0001';
 END IF;
END $$;

-- 같은 예약 그룹의 같은 슬롯 변경과 관리자 차단 작업은 같은 트랜잭션 락을 사용.
CREATE OR REPLACE FUNCTION public.monitoring_lock_slot(p_group text,p_date date,p_time time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_group||'|'||p_date::text||'|'||p_time::text,12784));
END $$;

CREATE OR REPLACE FUNCTION public.monitoring_create_booking(p_club_id text,p_date date,p_time time,p_weekends boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_club public.clubs%rowtype; v_row public.reservations%rowtype;
BEGIN
 SELECT * INTO v_club FROM public.clubs WHERE id=p_club_id AND is_active=true;
 IF NOT FOUND THEN RAISE EXCEPTION '등록되지 않은 동아리입니다.' USING ERRCODE='P0001'; END IF;
 PERFORM public.monitoring_validate_slot(p_date,p_time,p_weekends);
 PERFORM public.monitoring_lock_slot(v_club.reservation_group,p_date,p_time);
 IF EXISTS(SELECT 1 FROM public.blocked_slots WHERE reservation_group=v_club.reservation_group AND blocked_date=p_date AND blocked_time=p_time) THEN RAISE EXCEPTION '담당자가 예약을 차단한 시간입니다.' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM public.reservations WHERE club_id=v_club.id AND status='confirmed') THEN RAISE EXCEPTION '해당 동아리는 이미 모니터링 일정이 예약되어 있습니다.' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM public.reservations WHERE reservation_group=v_club.reservation_group AND reservation_date=p_date AND reservation_time=p_time AND status='confirmed') THEN RAISE EXCEPTION '선택한 시간은 이미 예약되었습니다.' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.reservations(club_id,reservation_group,reservation_date,reservation_time)
 VALUES(v_club.id,v_club.reservation_group,p_date,p_time) RETURNING * INTO v_row;
 RETURN to_jsonb(v_row);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION '해당 동아리가 이미 예약했거나 선택한 시간이 방금 예약되었습니다.' USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION public.monitoring_update_booking(p_id uuid,p_group text,p_date date,p_time time,p_weekends boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old public.reservations%rowtype;v_row public.reservations%rowtype;
BEGIN
 SELECT * INTO v_old FROM public.reservations WHERE id=p_id AND status='confirmed' FOR UPDATE;
 IF NOT FOUND OR v_old.reservation_group<>p_group THEN RAISE EXCEPTION '수정 권한이 없거나 예약을 찾지 못했습니다.' USING ERRCODE='P0001'; END IF;
 PERFORM public.monitoring_validate_slot(p_date,p_time,p_weekends);
 PERFORM public.monitoring_lock_slot(p_group,p_date,p_time);
 IF EXISTS(SELECT 1 FROM public.blocked_slots WHERE reservation_group=p_group AND blocked_date=p_date AND blocked_time=p_time) THEN RAISE EXCEPTION '차단된 시간입니다.' USING ERRCODE='P0001'; END IF;
 IF EXISTS(SELECT 1 FROM public.reservations WHERE id<>p_id AND reservation_group=p_group AND reservation_date=p_date AND reservation_time=p_time AND status='confirmed') THEN RAISE EXCEPTION '선택한 시간은 이미 예약되었습니다.' USING ERRCODE='P0001'; END IF;
 UPDATE public.reservations SET reservation_date=p_date,reservation_time=p_time,updated_at=now() WHERE id=p_id RETURNING * INTO v_row;
 INSERT INTO public.reservation_history(reservation_id,action,previous_date,previous_time,new_date,new_time)
 VALUES(p_id,'updated',v_old.reservation_date,v_old.reservation_time,p_date,p_time);
 RETURN to_jsonb(v_row);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION '선택한 시간은 이미 예약되었습니다.' USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION public.monitoring_cancel_booking(p_id uuid,p_group text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old public.reservations%rowtype;v_row public.reservations%rowtype;
BEGIN
 SELECT * INTO v_old FROM public.reservations WHERE id=p_id AND status='confirmed' FOR UPDATE;
 IF NOT FOUND OR v_old.reservation_group<>p_group THEN RAISE EXCEPTION '취소 권한이 없거나 예약을 찾지 못했습니다.' USING ERRCODE='P0001'; END IF;
 UPDATE public.reservations SET status='cancelled',updated_at=now() WHERE id=p_id RETURNING * INTO v_row;
 INSERT INTO public.reservation_history(reservation_id,action,previous_date,previous_time)
 VALUES(p_id,'cancelled',v_old.reservation_date,v_old.reservation_time);
 RETURN to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.monitoring_block_slot(p_group text,p_date date,p_time time,p_weekends boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.blocked_slots%rowtype;
BEGIN
 IF p_group NOT IN ('integrated','startup') THEN RAISE EXCEPTION '잘못된 예약 그룹입니다.' USING ERRCODE='P0001'; END IF;
 PERFORM public.monitoring_validate_slot(p_date,p_time,p_weekends);
 PERFORM public.monitoring_lock_slot(p_group,p_date,p_time);
 IF EXISTS(SELECT 1 FROM public.reservations WHERE reservation_group=p_group AND reservation_date=p_date AND reservation_time=p_time AND status='confirmed') THEN RAISE EXCEPTION '해당 시간에 예약이 있어 차단할 수 없습니다.' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.blocked_slots(reservation_group,blocked_date,blocked_time) VALUES(p_group,p_date,p_time)
 ON CONFLICT(reservation_group,blocked_date,blocked_time) DO UPDATE SET reservation_group=excluded.reservation_group RETURNING * INTO v_row;
 RETURN to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.monitoring_unblock_slot(p_group text,p_date date,p_time time)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_group NOT IN ('integrated','startup') THEN RAISE EXCEPTION '잘못된 예약 그룹입니다.' USING ERRCODE='P0001'; END IF;
 DELETE FROM public.blocked_slots WHERE reservation_group=p_group AND blocked_date=p_date AND blocked_time=p_time;
 RETURN jsonb_build_object('success',true);
END $$;

-- RPC: 앱은 서비스 롤로만 호출하도록 강제.
REVOKE ALL ON FUNCTION public.monitoring_validate_slot(date,time,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_lock_slot(text,date,time) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_create_booking(text,date,time,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_update_booking(uuid,text,date,time,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_cancel_booking(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_block_slot(text,date,time,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.monitoring_unblock_slot(text,date,time) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_validate_slot(date,time,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_lock_slot(text,date,time) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_create_booking(text,date,time,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_update_booking(uuid,text,date,time,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_cancel_booking(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_block_slot(text,date,time,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_unblock_slot(text,date,time) TO service_role;
