-- 2026학년도 2학기: 동아리별 완료된 증빙사진은 반드시 최대 1장.
-- 기존 예약 테이블 및 데이터에는 영향 없음. 기존 reports/photos는 아직 빈 상태에서 적용.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT report_id FROM public.monitoring_report_photos
    WHERE upload_status='ready' GROUP BY report_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION '동아리별 기존 완료 사진이 2장 이상입니다. 수동 확인 후 다시 적용하세요.';
  END IF;
  IF EXISTS (
    SELECT report_id FROM public.monitoring_report_photos
    WHERE upload_status='pending' GROUP BY report_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION '동아리별 기존 업로드 중 사진이 2장 이상입니다. 수동 확인 후 다시 적용하세요.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS monitoring_photo_one_ready_per_report
  ON public.monitoring_report_photos(report_id)
  WHERE upload_status='ready';

CREATE UNIQUE INDEX IF NOT EXISTS monitoring_photo_one_pending_per_report
  ON public.monitoring_report_photos(report_id)
  WHERE upload_status='pending';

-- service_role 전용 원자적 전환: 원본 파일 검증은 Edge에서 미리 실행.
-- 먼저 metadata를 한 트랜잭션 안에서 교체. 이전 스토리지 파일은 응답 후 삭제.
-- 실패/충돌 시 전체 DB 트랜잭션이 취소되어 이전 'ready' 연결을 유지.
CREATE OR REPLACE FUNCTION public.monitoring_finish_single_photo(p_photo_id uuid,p_group text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  candidate public.monitoring_report_photos%ROWTYPE;
  previous_path text;
BEGIN
  SELECT ph.* INTO candidate
  FROM public.monitoring_report_photos ph
  WHERE ph.id=p_photo_id
  FOR UPDATE;
  IF NOT FOUND OR candidate.upload_status<>'pending' THEN
    RAISE EXCEPTION '완료할 업로드를 찾을 수 없습니다.';
  END IF;

  PERFORM 1 FROM public.monitoring_reports rep
    JOIN public.monitoring_report_scope sc
      ON sc.academic_term=rep.academic_term AND sc.club_id=rep.club_id
  WHERE rep.id=candidate.report_id
    AND sc.reservation_group=p_group
    AND rep.academic_term='2026-2'
  FOR UPDATE OF rep;
  IF NOT FOUND THEN
    RAISE EXCEPTION '사진 변경 권한이 없습니다.';
  END IF;

  SELECT storage_path INTO previous_path
    FROM public.monitoring_report_photos
   WHERE report_id=candidate.report_id AND upload_status='ready'
   FOR UPDATE;

  DELETE FROM public.monitoring_report_photos
   WHERE report_id=candidate.report_id AND upload_status='ready';
  UPDATE public.monitoring_report_photos
     SET upload_status='ready', display_order=0
   WHERE id=candidate.id;

  RETURN jsonb_build_object('replaced_path',previous_path);
END $$;

REVOKE ALL ON FUNCTION public.monitoring_finish_single_photo(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_finish_single_photo(uuid,text) TO service_role;

COMMIT;
