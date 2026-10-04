-- ============================================================
-- HAKCC — Development Seed Data
-- 004_seed_data.sql
-- Run ONLY in development environments.
-- ============================================================

-- Known UUIDs for development (deterministic for easy reference)
DO $$
DECLARE
  v_admin_id    UUID := '00000000-0000-0000-0000-000000000001';
  v_teacher_id  UUID := '00000000-0000-0000-0000-000000000002';
  v_student1_id UUID := '00000000-0000-0000-0000-000000000003';
  v_student2_id UUID := '00000000-0000-0000-0000-000000000004';
  v_course_id   UUID := '00000000-0000-0000-0001-000000000001';
  v_space_id    UUID := '00000000-0000-0000-0002-000000000001';
  v_note1_id    UUID := gen_random_uuid();
  v_note2_id    UUID := gen_random_uuid();
  v_note3_id    UUID := gen_random_uuid();
BEGIN

  -- ── Seed courses ──────────────────────────────────────────
  INSERT INTO courses (id, title, instructor_id, tags, verification_code)
  VALUES (v_course_id, 'Computational Thinking for Problem Solving-2025',
          v_teacher_id, ARRAY['computation', 'ai', '2025'], 'CT2025')
  ON CONFLICT (id) DO NOTHING;

  -- ── Enroll everyone ───────────────────────────────────────
  INSERT INTO course_members (course_id, user_id) VALUES
    (v_course_id, v_teacher_id),
    (v_course_id, v_student1_id),
    (v_course_id, v_student2_id)
  ON CONFLICT DO NOTHING;

  -- ── Seed inquiry space ────────────────────────────────────
  INSERT INTO spaces (id, title, course_id, created_by, description)
  VALUES (v_space_id, 'Main Inquiry Space',
          v_course_id, v_teacher_id,
          '欢迎大家来到计算思维与问题解决知识建构社区')
  ON CONFLICT (id) DO NOTHING;

  -- ── Seed sample notes ─────────────────────────────────────
  INSERT INTO notes (id, space_id, author_id, type, title, content, x, y)
  VALUES
    (v_note1_id, v_space_id, v_teacher_id, 'note',
     '欢迎大家来到计算思维与问题解决网络学习与创作社区',
     'Welcome to the Computational Thinking & Problem Solving Learning Community!',
     200, 150),
    (v_note2_id, v_space_id, v_student1_id, 'note',
     '什么是计算思维？',
     '计算思维是指用计算机科学领域的思想方法，包括分解、模式识别、抽象和算法设计。',
     500, 300),
    (v_note3_id, v_space_id, v_student2_id, 'note',
     '计算思维在日常生活中的应用',
     '计算思维不仅仅是编程。它帮助我们系统化地解决复杂问题，例如规划旅行路线。',
     800, 200)
  ON CONFLICT (id) DO NOTHING;

  -- Initialize metrics for each note
  INSERT INTO note_metrics_realtime (note_id)
  VALUES (v_note1_id), (v_note2_id), (v_note3_id)
  ON CONFLICT (note_id) DO NOTHING;

  -- ── Seed a sample Build-on ────────────────────────────────
  INSERT INTO relations (source_note_id, target_note_id, relation_type, creator_id)
  VALUES (v_note3_id, v_note2_id, 'extend', v_student2_id)
  ON CONFLICT DO NOTHING;

  -- Update metrics for the target note
  PERFORM increment_note_metric(v_note2_id, 'build_on_count', 1);
  PERFORM increment_direct_degrees(v_note3_id, v_note2_id);

  -- ── Seed global scaffolds ─────────────────────────────────
  INSERT INTO scaffolds (title, description, category, icon, color, steps, is_recommended)
  VALUES
    ('My theory is...', 'Share your core idea or hypothesis',
     'Knowledge Building/Theory', 'Lightbulb', 'text-blue-500',
     '[{"id":"s1","prompt":"My theory is...","placeholder":"Describe your core idea","type":"textarea","required":true}]'::jsonb,
     true),
    ('I need to understand...', 'Identify what you want to learn',
     'Knowledge Building/Question', 'HelpCircle', 'text-yellow-500',
     '[{"id":"s1","prompt":"I need to understand...","placeholder":"What is puzzling you?","type":"textarea","required":true},{"id":"s2","prompt":"This matters because...","placeholder":"Why is this question important?","type":"textarea","required":false}]'::jsonb,
     true),
    ('This evidence suggests...', 'Support an idea with evidence',
     'Knowledge Building/Evidence', 'FileCheck', 'text-green-500',
     '[{"id":"s1","prompt":"This evidence suggests...","placeholder":"Describe the evidence","type":"textarea","required":true},{"id":"s2","prompt":"The source is...","placeholder":"Citation or reference","type":"text","required":false}]'::jsonb,
     true),
    ('Building on [idea]...', 'Extend or elaborate on a previous idea',
     'Knowledge Building/BuildOn', 'ArrowRight', 'text-purple-500',
     '[{"id":"s1","prompt":"Building on this idea...","placeholder":"How does your idea connect?","type":"textarea","required":true}]'::jsonb,
     true),
    ('I wonder if...', 'Explore a speculative or curious thought',
     'Metacognition/Reflection', 'Sparkles', 'text-pink-500',
     '[{"id":"s1","prompt":"I wonder if...","placeholder":"Share your speculation","type":"textarea","required":true}]'::jsonb,
     false),
    ('In summary...', 'Synthesize multiple ideas',
     'Knowledge Building/Synthesis', 'GitMerge', 'text-orange-500',
     '[{"id":"s1","prompt":"The key ideas here are...","placeholder":"List 2-3 core ideas","type":"textarea","required":true},{"id":"s2","prompt":"Taken together, this suggests...","placeholder":"Your synthesis","type":"textarea","required":true}]'::jsonb,
     true)
  ON CONFLICT DO NOTHING;

END $$;
