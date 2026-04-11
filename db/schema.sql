-- Rachida Health Coach — SQLite Schema v2.0

CREATE TABLE IF NOT EXISTS weight_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, time TEXT,
  weight_kg REAL NOT NULL, fat_percent REAL, muscle_percent REAL,
  bone_mass_kg REAL, hydration_percent REAL,
  source TEXT DEFAULT 'manual', created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meal_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, time TEXT NOT NULL, meal_type TEXT NOT NULL,
  description TEXT NOT NULL, calories REAL, protein_g REAL, fat_g REAL,
  carbs_g REAL, fiber_g REAL, is_halal INTEGER DEFAULT 1, halal_flag TEXT,
  iron_mg REAL, zinc_mg REAL, calcium_mg REAL, magnesium_mg REAL, potassium_mg REAL,
  vit_a_mcg REAL, vit_c_mg REAL, vit_d_ui REAL, vit_b12_mcg REAL, vit_b9_mcg REAL, selenium_mcg REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE NOT NULL, weight_used_kg REAL, bmr REAL, tdee REAL,
  calories_target REAL, protein_target_g REAL, fat_target_g REAL,
  carbs_target_g REAL, is_ramadan INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, steps INTEGER, active_calories REAL, total_calories REAL,
  exercise_minutes INTEGER, stand_hours INTEGER, resting_heart_rate INTEGER,
  avg_heart_rate INTEGER, distance_km REAL, source TEXT DEFAULT 'apple_watch',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bloodwork (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_date TEXT NOT NULL, marker TEXT NOT NULL, value REAL NOT NULL,
  unit TEXT, reference_min REAL, reference_max REAL,
  status TEXT, is_critical INTEGER DEFAULT 0, note TEXT, pdf_source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bloodwork_marker ON bloodwork(marker, test_date);

CREATE TABLE IF NOT EXISTS progress_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, filename TEXT NOT NULL, filepath TEXT NOT NULL,
  view_type TEXT DEFAULT 'front', notes TEXT,
  analyzed INTEGER DEFAULT 0, analysis TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, weight_kg REAL,
  waist_cm REAL, hips_cm REAL, chest_cm REAL,
  thigh_cm REAL, arm_cm REAL, neck_cm REAL,
  waist_hip_ratio REAL, body_fat_percent REAL,
  notes TEXT, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplement_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, supplement_id TEXT NOT NULL, supplement_name TEXT NOT NULL,
  scheduled_time TEXT, taken INTEGER DEFAULT 0, taken_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, time TEXT NOT NULL, reminder_type TEXT NOT NULL,
  message TEXT, was_sent INTEGER DEFAULT 0, was_acknowledged INTEGER DEFAULT 0,
  blocked_by_prayer TEXT, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coach_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL, value TEXT NOT NULL, category TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Medications (prescribed by doctor — coach never changes doses)
CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,          -- 'daily', 'twice_daily', 'as_needed', etc.
  timing TEXT,             -- 'morning', 'evening', 'with_food', 'before_sleep'
  reason TEXT,
  prescriber TEXT,
  start_date TEXT DEFAULT (date('now')),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS medication_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  medication_id INTEGER,
  medication_name TEXT NOT NULL,
  taken INTEGER DEFAULT 0,
  taken_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO coach_memory (key, value, category) VALUES
('favorite_protein', 'poulet grillé, œufs', 'preference'),
('favorite_carbs', 'riz, pain arabe', 'preference'),
('dislikes', '', 'preference'),
('best_time_for_walk', 'après Asr', 'pattern'),
('start_weight', '75', 'achievement'),
('start_date', date('now'), 'achievement'),
('measurement_frequency', 'monthly', 'preference'),
('photo_frequency', 'monthly', 'preference');

CREATE VIEW IF NOT EXISTS daily_summary AS
SELECT m.date,
  COALESCE(SUM(m.calories),0) AS total_calories,
  COALESCE(SUM(m.protein_g),0) AS total_protein,
  COALESCE(SUM(m.fat_g),0) AS total_fat,
  COALESCE(SUM(m.carbs_g),0) AS total_carbs,
  t.calories_target, t.protein_target_g,
  w.weight_kg AS weight_today, a.steps AS steps_today
FROM meal_log m
LEFT JOIN daily_targets t ON m.date = t.date
LEFT JOIN (SELECT date, weight_kg FROM weight_log GROUP BY date HAVING id = MAX(id)) w ON m.date = w.date
LEFT JOIN activity_log a ON m.date = a.date
GROUP BY m.date;

CREATE VIEW IF NOT EXISTS measurement_progress AS
SELECT
  first.date AS start_date, last.date AS latest_date,
  first.weight_kg AS start_weight, last.weight_kg AS current_weight,
  ROUND(first.weight_kg - last.weight_kg, 1) AS weight_lost_kg,
  first.waist_cm AS start_waist, last.waist_cm AS current_waist,
  ROUND(first.waist_cm - last.waist_cm, 1) AS waist_lost_cm,
  first.hips_cm AS start_hips, last.hips_cm AS current_hips,
  ROUND(first.hips_cm - last.hips_cm, 1) AS hips_lost_cm
FROM
  (SELECT * FROM measurements ORDER BY date ASC LIMIT 1) first,
  (SELECT * FROM measurements ORDER BY date DESC LIMIT 1) last;
