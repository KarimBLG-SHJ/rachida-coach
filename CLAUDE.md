# CLAUDE.md — Rachida Health Coach Agent

## What we are building

A personal AI health coach for Rachida.
It runs on her Mac. It connects to her devices.
It reminds her, tracks her, explains everything, and motivates her — every single day.

This is NOT a generic fitness app.
Every recommendation is built for Rachida specifically.

---

## Rachida's profile

```json
{
  "name": "Rachida",
  "age": 48,
  "weight_kg": 75,
  "height_cm": 165,
  "goal": "Lose weight progressively and sustainably",
  "activity_level": "sedentary_with_walking",
  "location": "Sharjah, UAE",
  "diet": "halal_only",
  "religion": "Muslim — 5 daily prayers",
  "work": "Desk work, Mac, seated most of the day",
  "devices": ["Withings scale", "Apple Watch Series 7", "iPhone 17", "MacBook"],
  "supplements": "Yes — list in supplements.json",
  "bloodwork": "Available on demand"
}
```

---

## Tech stack

- **Runtime**: Node.js 20+
- **AI**: Anthropic Claude API (`claude-sonnet-4-20250514`)
- **Database**: SQLite (via `better-sqlite3`) — simple, local, no cloud needed
- **Scheduler**: `node-cron` — triggers reminders and briefs
- **Notifications**: `node-notifier` — Mac desktop notifications
- **Withings**: Official Withings API (OAuth2)
- **Prayer times**: Aladhan API (free, no key needed)
- **Weather**: Open-Meteo API (free, no key needed)
- **UI**: Simple terminal chat + daily HTML report

---

## Project structure

```
rachida-health-coach/
├── CLAUDE.md                    ← this file
├── .env                         ← API keys (never commit)
├── package.json
├── index.js                     ← entry point
│
├── /data
│   ├── profile.json             ← Rachida's fixed profile
│   ├── supplements.json         ← her supplements + timing
│   ├── macros.json              ← her daily macro targets (auto-calculated)
│   └── /bloodwork               ← PDF uploads go here
│
├── /db
│   └── health.db                ← SQLite database
│   └── schema.sql               ← DB schema
│
├── /integrations
│   ├── withings.js              ← weight, fat %, sleep
│   ├── apple-health.js          ← steps, calories, heart rate
│   ├── prayer-times.js          ← 5 daily prayer times for Sharjah
│   └── weather.js               ← UAE weather (walk outside or not)
│
├── /agent
│   ├── coach.js                 ← main AI brain (calls Claude API)
│   ├── memory.js                ← reads/writes to SQLite
│   ├── macros.js                ← calculates daily macro targets
│   ├── motivation.js            ← generates daily motivational context
│   └── /prompts
│       ├── system.md            ← master system prompt
│       ├── morning-brief.md     ← 7:30am daily brief template
│       ├── meal-log.md          ← prompt for analyzing a meal
│       ├── reminder.md          ← push reminder tone
│       └── weekly-review.md    ← Sunday weekly summary
│
├── /reminders
│   ├── scheduler.js             ← all cron jobs
│   └── notifications.js         ← Mac desktop notification sender
│
├── /commands
│   ├── log-meal.js              ← "I ate chicken and rice"
│   ├── log-weight.js            ← manual weight entry
│   ├── ask-coach.js             ← free chat with coach
│   ├── show-today.js            ← today's summary
│   ├── upload-bloodwork.js      ← PDF analysis
│   └── show-week.js             ← weekly report
│
└── /ui
    └── daily-report.html        ← visual daily summary (opens in browser)
```

---

## Core feature 1 — Daily macro targets

Calculate Rachida's macros every morning using:

**Step 1: BMR (Mifflin-St Jeor for women)**
```
BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) − 161
```

**Step 2: TDEE (Total Daily Energy)**
```
TDEE = BMR × 1.2  (sedentary factor)
```

**Step 3: Target calories (deficit for weight loss)**
```
Target = TDEE − 400  (safe deficit, never below 1200 kcal)
```

**Step 4: Macros split**
```
Protein  = 1.6g per kg of body weight  → in grams → × 4 = kcal
Fat      = 25% of total calories       → ÷ 9 = grams
Carbs    = remaining calories          → ÷ 4 = grams
```

**Step 5: Adjust if Ramadan**
- If today is Ramadan: adjust meal timing (Suhoor + Iftar pattern)
- Calorie target stays the same, spread across 2 main meals

Save result to `data/macros.json` and to SQLite daily.

---

## Core feature 2 — Reminder system

These are all the reminders. Each one has a time, a message, and a reason.

### Morning reminders

| Time | Reminder | Why |
|------|----------|-----|
| 7:15 AM | "Rachida, pèse-toi maintenant — avant de manger, après les toilettes" | Weight is most accurate in the morning fasted |
| 7:30 AM | Send morning brief (see below) | Start the day with a plan |
| 8:00 AM | "N'oublie pas tes compléments du matin 💊" | Supplements need consistency |

### Meal reminders

| Time | Reminder | Why |
|------|----------|-----|
| 12:30 PM | "C'est l'heure du déjeuner — note ce que tu vas manger" | Log BEFORE eating, not after |
| 1:00 PM | If no lunch logged → "Tu as mangé quoi ? Dis-moi, même vite fait 🍽️" | Follow-up if no log |
| 7:00 PM | "Dîner — qu'est-ce qu'il y a ce soir ? On vérifie les macros" | End of day calorie check |
| 8:00 PM | If no dinner logged → "Rachida, le dîner ? Pour que je calcule ta journée 😊" | Follow-up |

### Sedentary alerts (work hours only: 9am–6pm)

Every 90 minutes of detected inactivity (from Apple Watch data):
```
"Tu es assise depuis [X] minutes. 
Lève-toi, marche 5 minutes. 
Ça brûle 20 kcal et ça relance ton métabolisme."
```
Rule: Never send this during prayer times. Never send more than 4 times per day.

### Evening reminders

| Time | Reminder | Why |
|------|----------|-----|
| 9:00 PM | "Compléments du soir 🌙" | Evening supplements |
| 9:30 PM | Daily summary + tomorrow preview | Close the day |

### Weekly reminder

| Day/Time | Reminder |
|----------|----------|
| Sunday 10:00 AM | Full weekly review + next week's focus |

---

## Core feature 3 — Morning brief

Sent every day at 7:30 AM as a Mac notification + text in terminal.

**Content:**
1. Today's date + day of week
2. Weight this morning vs yesterday vs last week
3. Progress towards goal (X kg lost, Y kg to go)
4. Today's macro targets (calculated fresh)
5. Prayer times for today (Sharjah)
6. Best window for a walk (between 2 prayers, good weather)
7. Supplement schedule for today
8. 1 micro-objective for today (simple, specific, achievable)
9. 1 pedagogical fact (rotating — explains WHY something works)

**Example pedagogical facts (rotate daily):**
- "Les protéines te rassasient 2x plus que les glucides. Manger plus de poulet = moins de fringales."
- "Ton corps brûle des calories même en dormant. Mieux dormir = plus de perte de poids."
- "Marcher 10 minutes après un repas réduit le pic de glycémie de 30%."
- "La balance peut monter de 1kg en 1 jour à cause de l'eau. Ce n'est pas de la graisse. Ne t'inquiète pas."
- "Le cortisol (stress) stocke la graisse autour du ventre. Les prières sont une vraie aide."

---

## Core feature 4 — Meal logging

Rachida types in natural French: *"j'ai mangé du riz avec du poulet grillé et une salade"*

The agent must:
1. Identify each food item
2. Estimate portion size (ask if unclear)
3. Calculate calories + macros (protein, fat, carbs, fiber)
4. Verify everything is halal (flag if unsure)
5. Add to today's total
6. Show remaining budget: "Il te reste 620 kcal pour ce soir"
7. Suggest what to eat for the next meal to hit the day's targets

**Response format (always):**
```
🍽️ Déjeuner enregistré

Riz blanc (200g)       — 260 kcal | P: 5g | L: 0g | G: 57g
Poulet grillé (150g)   — 248 kcal | P: 46g | L: 6g | G: 0g
Salade verte (100g)    — 15 kcal  | P: 1g  | L: 0g | G: 3g
─────────────────────────────────────────────────────────
Total déjeuner         — 523 kcal | P: 52g | L: 6g | G: 60g

📊 Aujourd'hui (cumulé)
Consommé : 823 kcal / 1650 kcal
Protéines : 72g / 120g ✅
Lipides   : 28g / 46g  ✅
Glucides  : 98g / 165g ✅

💡 Ce soir : vise 827 kcal max.
   Idée : omelette (3 œufs) + légumes sautés + pain pita.
   Ça couvre tes protéines restantes (48g) et reste dans ton budget.
```

---

## Core feature 5 — Pedagogy engine

For every recommendation, the agent ALWAYS explains WHY.

Rules:
- Never say "mange moins de sucre" without explaining what sugar does
- Never say "bois plus d'eau" without saying why water helps weight loss
- Explanations are short (2–3 sentences max)
- Use simple words — no medical jargon
- Connect to Rachida's real life (UAE heat, prayer schedule, desk work)

**Example:**
```
❌ Bad: "Évite les dattes le soir."

✅ Good: "Les dattes sont bonnes pour rompre le jeûne — elles remontent 
vite l'énergie. Mais le soir, si tu n'es plus active, le sucre qu'elles 
contiennent sera stocké comme graisse. Mange-les plutôt à midi."
```

---

## Core feature 6 — Blood work analysis

When Rachida uploads a PDF blood test:

1. Extract all values using Claude vision
2. Compare each value to reference ranges for women aged 45–55
3. Flag anything outside range (low or high)
4. Connect findings to her supplements and goals:
   - Low Vitamin D → increase sun exposure + dosage
   - Low ferritin → iron-rich halal foods to add
   - High glucose → reduce simple carbs, add walk after meals
   - Low B12 → check supplement timing (must be taken with food)
5. Generate a plain-language summary: what is good, what to watch, what to do
6. Save to bloodwork history for comparison next time

**Rule:** If any value is severely abnormal → "Consulte ton médecin pour ce résultat."

---

## Core feature 7 — Supplement tracker

File: `data/supplements.json`

```json
[
  {
    "name": "Vitamine D3",
    "dose": "2000 IU",
    "timing": "morning_with_food",
    "reason": "Sunlight limited in office work, affects mood and metabolism"
  },
  {
    "name": "Magnésium",
    "dose": "300mg",
    "timing": "evening_before_sleep",
    "reason": "Improves sleep quality, reduces cortisol"
  },
  {
    "name": "Oméga-3",
    "dose": "1000mg",
    "timing": "lunch",
    "reason": "Reduces inflammation, supports fat metabolism"
  }
]
```

Agent checks:
- Is she taking them at the right time?
- Are they compatible with each other?
- Do her blood results suggest adjusting doses?
- Send reminder at the right meal each day

---

## Core feature 8 — Weekly review (Sunday)

Sent every Sunday at 10:00 AM.

**Content:**
1. Weight this week vs last week
2. Average daily calories (target vs actual)
3. Best day and worst day (no guilt — just facts)
4. Steps average (Apple Watch)
5. Number of reminders answered vs ignored
6. 1 thing that worked this week
7. 1 thing to improve next week (ONLY ONE — not a list)
8. Encouragement based on real progress (not generic)
9. Next week's macro targets (recalculated if weight changed)

---

## Database schema

```sql
-- Daily weight log
CREATE TABLE weight_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  weight_kg REAL,
  fat_percent REAL,
  muscle_percent REAL,
  source TEXT  -- 'withings' or 'manual'
);

-- Meal log
CREATE TABLE meal_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  meal_type TEXT,  -- breakfast, lunch, dinner, snack
  description TEXT,
  calories REAL,
  protein_g REAL,
  fat_g REAL,
  carbs_g REAL,
  fiber_g REAL
);

-- Daily macro targets
CREATE TABLE daily_targets (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  calories_target REAL,
  protein_target_g REAL,
  fat_target_g REAL,
  carbs_target_g REAL,
  bmr REAL,
  tdee REAL
);

-- Activity log (from Apple Watch)
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  steps INTEGER,
  active_calories REAL,
  exercise_minutes INTEGER,
  stand_hours INTEGER
);

-- Blood work results
CREATE TABLE bloodwork (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  marker TEXT,  -- 'vitamin_d', 'ferritin', 'glucose', etc.
  value REAL,
  unit TEXT,
  reference_min REAL,
  reference_max REAL,
  status TEXT  -- 'normal', 'low', 'high'
);

-- Reminder log (track which reminders were acknowledged)
CREATE TABLE reminder_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT,
  reminder_type TEXT,
  was_acknowledged INTEGER  -- 0 or 1
);

-- Coach memory (key facts to remember about Rachida)
CREATE TABLE coach_memory (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  value TEXT,
  updated_at TEXT
);
```

---

## System prompt for the AI coach

```
Tu es le coach de santé personnel de Rachida.

Tu la connais bien. Tu suis ses données chaque jour.
Tu parles en français. Toujours.

PROFIL DE RACHIDA :
- 48 ans, 75 kg, objectif : perdre du poids progressivement
- Sédentaire (bureau Mac) mais marche
- Mange halal strictement
- 5 prières par jour — respecte ces moments
- Vit à Sharjah, UAE (chaud, humide l'été)
- Prend des compléments vitamines
- Peut faire des prises de sang

TON RÔLE :
- Analyser ses données du jour
- Calculer ses macros personnalisées
- Lui expliquer POURQUOI chaque recommandation
- La motiver avec des faits réels, pas des slogans
- L'aider à comprendre son corps, pas juste suivre des règles

TON STYLE :
- Chaleureux mais direct
- Court — elle est occupée
- Pédagogique — toujours expliquer le "pourquoi"
- Jamais culpabilisant — les erreurs sont des données
- Encourageant quand elle progresse, réaliste quand elle stagne

TES RÈGLES ABSOLUES :
1. Jamais de médicament recommandé
2. Si anomalie grave dans une prise de sang → "Consulte ton médecin"
3. Jamais envoyer une notif pendant une prière
4. Déficit calorique max : 500 kcal/jour
5. Objectif de perte : 0.5 kg/semaine (soutenable, réaliste)
6. Chaque conseil a une explication
7. Un seul objectif à la fois — pas une liste

MÉMOIRE :
Tu as accès aux 30 derniers jours de données.
Tu te souviens de ce qu'elle aime manger.
Tu notes ce qui fonctionne et ce qui ne fonctionne pas pour elle.
```

---

## How to build this — step by step for Claude Code

### Step 1 — Project setup
```
"Create the project structure exactly as defined in CLAUDE.md.
Initialize package.json with: better-sqlite3, node-cron, 
node-notifier, axios, dotenv. 
Create the SQLite database with the schema from CLAUDE.md."
```

### Step 2 — Macro calculator
```
"Build macros.js. It must calculate BMR using Mifflin-St Jeor 
for women, apply sedentary multiplier (1.2), subtract 400 kcal 
deficit, then split into protein/fat/carbs as defined in CLAUDE.md.
Save result to data/macros.json and insert into daily_targets table."
```

### Step 3 — Prayer times integration
```
"Build prayer-times.js. Call Aladhan API for Sharjah UAE.
Return today's 5 prayer times as objects with name and time.
The scheduler must use this to block reminders during prayer windows."
```

### Step 4 — Reminder scheduler
```
"Build scheduler.js using node-cron.
Implement all reminders from the table in CLAUDE.md.
Each reminder must check prayer times before firing.
Log every reminder to the reminder_log table."
```

### Step 5 — Meal logging command
```
"Build log-meal.js. Accept free French text as input.
Call Claude API with the meal-log.md prompt.
Parse the response and insert into meal_log table.
Output the formatted summary as defined in CLAUDE.md."
```

### Step 6 — Morning brief
```
"Build the morning brief. It assembles: today's macro targets, 
yesterday's weight (from Withings or SQLite), prayer schedule,
weather from Open-Meteo for Sharjah, supplement schedule, 
1 rotating pedagogical fact. Format as clean terminal output 
and also send as Mac desktop notification."
```

### Step 7 — Withings integration
```
"Build withings.js. Implement OAuth2 flow for Withings API.
Fetch latest weight measurement. Store in weight_log table.
Handle token refresh automatically."
```

### Step 8 — Weekly review
```
"Build the Sunday weekly review. Query last 7 days from all tables.
Calculate averages, trends, best/worst days.
Generate report using Claude API with the weekly-review.md prompt.
Output as both terminal text and HTML file."
```

### Step 9 — Blood work analyzer
```
"Build upload-bloodwork.js. Accept a PDF file path.
Send to Claude API as a document. Extract all lab values.
Compare to reference ranges for women 45-55.
Insert each marker into bloodwork table.
Generate plain-French summary with recommendations."
```

---

## .env file (template — never commit the real one)

```
ANTHROPIC_API_KEY=your_key_here
WITHINGS_CLIENT_ID=your_withings_client_id
WITHINGS_CLIENT_SECRET=your_withings_client_secret
WITHINGS_REDIRECT_URI=http://localhost:3000/callback
CITY=Sharjah
COUNTRY=AE
```

---

## Definition of done

The app is done when Rachida can do this every day without help:

1. Wake up → step on scale → weight auto-synced
2. 7:30am → morning brief appears on screen automatically
3. At lunch → she gets a reminder to log her meal
4. She types what she ate → gets calories + macros instantly
5. During work → she gets a "stand up" alert every 90 min
6. Evening → she sees her daily summary without asking
7. Sunday → weekly review arrives automatically
8. When she has blood results → she uploads PDF, gets plain-language analysis in 60 seconds

**If she has to think about how to use it — it is not finished.**

---

## Smart context — what to ask and when

The file `agent/smart-context.js` controls this.

**The rule: never ask for something unless it is due.**

| Data | Frequency | Logic |
|------|-----------|-------|
| Weight | Daily | Only if no Withings sync AND 2+ days since last entry. Never nag if she weighed yesterday. |
| Meals | Daily | Only remind if that specific meal is not yet logged. If lunch is logged, no lunch reminder. |
| Measurements | Monthly | 1st of month AND 25+ days since last. Never mid-month. |
| Progress photo | Monthly | 1st of month AND 25+ days since last. Never mid-month. |
| Blood work | Quarterly | 1st of Jan/Apr/Jul/Oct AND 80+ days since last. |
| Supplements | Daily | Always — they need daily consistency. |
| Sedentary alerts | Daily | Max 4 per day. Never during prayer. Stop if Apple Watch shows movement. |

**Morning brief content is filtered through smart-context.**
The brief only includes what is relevant today.
If she weighed herself this morning via Withings — weight section is skipped.
If it's not the 1st of the month — no measurement reminder in the brief.

---

## Upload capabilities

### Blood test PDF
```bash
node index.js sang ./bilan-mars-2025.pdf
```
- Claude reads the PDF
- Extracts ALL markers automatically
- Compares to female age 45-55 norms
- Flags anything abnormal
- Links findings to her supplements
- Links findings to weight loss ability
- Archives PDF in ./data/bloodwork/
- Saves values in SQLite for trend tracking

### Progress photo
```bash
node index.js photo ./photo-avril.jpg            # store only
node index.js photo ./photo-avril.jpg --analyser  # store + posture analysis
node index.js photo ./photo-avril.jpg --analyser --comparer  # compare to previous
```
- Photos NEVER leave the Mac
- Claude Vision analysis only if explicitly requested
- Analysis focuses on posture and health, never appearance
- Monthly reminder only if 25+ days since last photo

### Body measurements (guided session)
```bash
node index.js mensuration
```
- Interactive wizard — one question at a time
- Each field includes how-to-measure instructions
- Calculates waist-to-hip ratio automatically
- Estimates body fat % (US Navy formula)
- Shows trend vs previous measurement
- Monthly reminder only if 25+ days since last session
