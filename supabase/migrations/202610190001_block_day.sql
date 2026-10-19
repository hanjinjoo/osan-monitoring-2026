-- 2026-10-19: 관리자 날짜 전체 차단 (32개 예약 시작 시각).
-- 기존 예약 및 개별 차단은 보존. 동일 예약 그룹의 해당 날짜에 활성 예약이 있으면
-- 오류로 전체 작업을 취소하며, 일부 시간만 차단되는 상황을 만들지 않습니다.
CREATE OR REPLACE FUNCTION public.monitoring_block_day(
 p_group text,
 p_date date,
 p_weekends boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_slot time without time zone;
 v_added integer;
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

 IF EXISTS (
  SELECT 1 FROM public.reservations
  WHERE reservation_group=p_group AND reservation_date=p_date AND status='confirmed'
 ) THEN
  RAISE EXCEPTION '선택한 날짜에 이미 예약된 동아리가 있어 전체 차단할 수 없습니다. 기존 예약은 유지됩니다.' USING ERRCODE='P0001';
 END IF;

 -- 이미 차단한 개별 시간은 그대로 보존. 재시도해도 중복 행이 생기지 않음.
 INSERT INTO public.blocked_slots(reservation_group,blocked_date,blocked_time)
 SELECT p_group,p_date,(TIMESTAMP '2000-01-01 09:00:00' + s.i * INTERVAL '15 minutes')::time
 FROM generate_series(0,35) AS s(i)
 WHERE s.i NOT BETWEEN 12 AND 15
 ON CONFLICT(reservation_group,blocked_date,blocked_time) DO NOTHING;

 GET DIAGNOSTICS v_added = ROW_COUNT;
 RETURN jsonb_build_object('success',true,'blocked_slots',32,'newly_blocked_slots',v_added);
END $$;

-- RPC를 서비스 롤로만 호출할 수 있게 유지.
REVOKE ALL ON FUNCTION public.monitoring_block_day(text,date,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_block_day(text,date,boolean) TO service_role;
