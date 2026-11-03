CREATE OR REPLACE FUNCTION public.monitoring_block_day(p_group text, p_date date, p_weekends boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_slot time without time zone;
 v_added integer;
 v_reserved integer;
 v_blocked integer;
BEGIN
 IF p_group IS NULL OR p_group NOT IN ('integrated','startup') THEN
  RAISE EXCEPTION '잘못된 예약 그룹입니다.' USING ERRCODE='P0001';
 END IF;
 -- 공통 기간, 과거 날짜, 주말 차단 정책 재사용.
 PERFORM public.monitoring_validate_slot(p_date,TIME '09:00',p_weekends);
 -- 기존 예약 생성/이동/차단이 사용하는 슬롯별 잠금을 같은 순서로 획득.
 -- 모든 잠금을 얻은 뒤 예약 여부를 조회하므로 요청은 원자적으로 처리됩니다.
 FOR v_slot IN
  SELECT (TIMESTAMP '2000-01-01 09:00:00' + s.i * INTERVAL '15 minutes')::time
  FROM generate_series(0,35) AS s(i)
  WHERE s.i NOT BETWEEN 12 AND 15
  ORDER BY s.i
 LOOP
  PERFORM public.monitoring_lock_slot(p_group,p_date,v_slot);
 END LOOP;

 SELECT count(DISTINCT reservation_time) INTO v_reserved FROM public.reservations
 WHERE reservation_group=p_group AND reservation_date=p_date AND status='confirmed';

 -- 이미 차단한 개별 시간은 그대로 보존. 재시도해도 중복 행이 생기지 않음.
 INSERT INTO public.blocked_slots(reservation_group,blocked_date,blocked_time)
 SELECT p_group,p_date,(TIMESTAMP '2000-01-01 09:00:00' + s.i * INTERVAL '15 minutes')::time
 FROM generate_series(0,35) AS s(i)
 WHERE s.i NOT BETWEEN 12 AND 15
 AND NOT EXISTS (
  SELECT 1 FROM public.reservations AS r
  WHERE r.reservation_group=p_group AND r.reservation_date=p_date AND r.status='confirmed'
   AND r.reservation_time=(TIMESTAMP '2000-01-01 09:00:00' + s.i * INTERVAL '15 minutes')::time
 )
 ON CONFLICT(reservation_group,blocked_date,blocked_time) DO NOTHING;

 GET DIAGNOSTICS v_added = ROW_COUNT;
 SELECT count(*) INTO v_blocked FROM public.blocked_slots
 WHERE reservation_group=p_group AND blocked_date=p_date;
 RETURN jsonb_build_object('success',true,'blocked_slots',v_blocked,'newly_blocked_slots',v_added,'preserved_bookings',v_reserved);
END $function$;
