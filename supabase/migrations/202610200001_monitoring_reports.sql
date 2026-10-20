-- 2026-10-20 · 모니터링 결과 기록(81개) — 신규 객체만 추가.
-- 이 파일은 운영 DB에 아직 적용하지 마세요. 적용 전 데이터 백업 및 현재 정책 점검 필수.
-- 기존 clubs / reservations / blocked_slots / reservation_history 데이터·함수 무변경.
BEGIN;

CREATE TABLE IF NOT EXISTS public.monitoring_report_scope (
  academic_term text NOT NULL CHECK (academic_term ~ '^[0-9]{4}-[12]$'),
  club_id text NOT NULL REFERENCES public.clubs(id),
  reservation_group text NOT NULL CHECK (reservation_group IN ('integrated','startup')),
  project_type text,
  department text,
  professor_name text,
  student_representative text,
  PRIMARY KEY(academic_term,club_id)
);

CREATE TABLE IF NOT EXISTS public.monitoring_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_term text NOT NULL,
  club_id text NOT NULL,
  monitoring_date date,
  monitoring_time time without time zone,
  monitoring_location text NOT NULL DEFAULT '',
  activity_description text NOT NULL DEFAULT '',
  staff_evaluation text NOT NULL DEFAULT '',
  staff_opinion text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed','not_conducted')),
  not_conducted_reason text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  created_by_group text NOT NULL CHECK(created_by_group IN ('integrated','startup')),
  updated_by_group text NOT NULL CHECK(updated_by_group IN ('integrated','startup')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT monitoring_reports_one_per_club UNIQUE(academic_term,club_id),
  FOREIGN KEY(academic_term,club_id) REFERENCES public.monitoring_report_scope(academic_term,club_id)
);

CREATE TABLE IF NOT EXISTS public.monitoring_report_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.monitoring_reports(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  file_size bigint NOT NULL CHECK(file_size>0),
  width integer,
  height integer,
  display_order integer NOT NULL DEFAULT 0,
  upload_status text NOT NULL DEFAULT 'pending' CHECK(upload_status IN ('pending','ready')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.monitoring_report_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.monitoring_reports(id) ON DELETE CASCADE,
  change_type text NOT NULL,
  staff_group text NOT NULL CHECK (staff_group IN ('integrated','startup')),
  old_status text,
  new_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS monitoring_reports_term_status_idx
  ON public.monitoring_reports(academic_term,status);
CREATE INDEX IF NOT EXISTS monitoring_report_photos_report_idx
  ON public.monitoring_report_photos(report_id,display_order);
CREATE INDEX IF NOT EXISTS monitoring_report_history_report_idx
  ON public.monitoring_report_history(report_id,created_at DESC);

-- 예약 DB의 기존 club_id를 참조. 전공 혁신: major-001~036,
-- 전공 부트·앵커_신산업: major-037~043 제외,
-- 취업 19 / 일반 10 / 창업 16 포함.
INSERT INTO public.monitoring_report_scope
  (academic_term,club_id,reservation_group,project_type)
SELECT '2026-2', c.id, c.reservation_group,
  CASE WHEN c.category='major' THEN '혁신사업'
       WHEN c.category='startup' THEN '앵커'
       ELSE NULL END
FROM public.clubs c
WHERE (c.category='major' AND c.id BETWEEN 'major-001' AND 'major-036')
   OR c.category IN ('employment','startup','general')
ON CONFLICT(academic_term,club_id) DO NOTHING;

DO $$
DECLARE total integer; majors integer; jobs integer; startups integer; generals integer;
BEGIN
 SELECT count(*),
   count(*) FILTER(WHERE c.category='major'),
   count(*) FILTER(WHERE c.category='employment'),
   count(*) FILTER(WHERE c.category='startup'),
   count(*) FILTER(WHERE c.category='general')
 INTO total,majors,jobs,startups,generals
 FROM public.monitoring_report_scope s
 JOIN public.clubs c ON c.id=s.club_id
 WHERE s.academic_term='2026-2';
 IF total<>81 OR majors<>36 OR jobs<>19 OR startups<>16 OR generals<>10 THEN
  RAISE EXCEPTION '작성대상 검증 실패: total=%, major=%, employment=%, startup=%, general=%',
    total,majors,jobs,startups,generals;
 END IF;
END $$;

-- 비공개 스토리지 버킷. 업로드 한도는 프로젝트 전역 상한을 상속.
INSERT INTO storage.buckets(id,name,public,allowed_mime_types)
VALUES ('monitoring-report-photos','monitoring-report-photos',false,
 ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT(id) DO NOTHING;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='monitoring-report-photos' AND public) THEN
  RAISE EXCEPTION '결과 사진 버킷은 반드시 비공개여야 합니다.';
 END IF;
END $$;

ALTER TABLE public.monitoring_report_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_report_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_report_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.monitoring_report_scope,
 public.monitoring_reports, public.monitoring_report_photos,
 public.monitoring_report_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.monitoring_report_scope,
 public.monitoring_reports, public.monitoring_report_photos,
 public.monitoring_report_history TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMIT;
