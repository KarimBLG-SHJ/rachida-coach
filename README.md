# Rachida Health Coach

AI health coach personnel pour Rachida.
Tourne sur Mac. Se connecte à la balance Withings et à l'Apple Watch.
Rappels intelligents. Analyse de prises de sang. Suivi des mensurations.

---

## Installation

```bash
# 1. Clone ou copie ce dossier sur ton Mac
cd rachida-health-coach

# 2. Installe les dépendances
npm install

# 3. Crée ton fichier .env
cp .env.template .env
# Ouvre .env et mets ta clé Anthropic

# 4. Setup initial
npm run setup

# 5. Lance le coach
npm start
```

---

## Commandes disponibles

| Commande | Ce que ça fait |
|----------|----------------|
| `npm start` | Chat interactif avec le coach |
| `npm run brief` | Brief du matin maintenant |
| `npm run semaine` | Bilan hebdomadaire |
| `npm run setup` | Configuration initiale |
| `node index.js daemon` | Rappels automatiques en arrière-plan |
| `node index.js mensuration` | Saisir les mensurations du mois |
| `node index.js photo ./photo.jpg` | Uploader une photo de progression |
| `node index.js analyse-sang ./bilan.pdf` | Analyser une prise de sang |
| `node index.js historique` | Voir tous les historiques |

---

## Dans le chat

Parle normalement en français :

- `j'ai mangé du poulet avec du riz` → analyse et log automatique
- `/repas lunch` → logger déjeuner
- `/repas dinner` → logger dîner  
- `/brief` → brief du matin
- `/jour` → résumé du jour
- `/semaine` → bilan de la semaine
- `/quitter` → fermer

---

## Rappels intelligents — comment ça marche

Le système vérifie les données **avant** d'envoyer un rappel.
Si l'information existe déjà → pas de notification.

| Ce qu'il vérifie | Si déjà fait → |
|-----------------|----------------|
| Poids du matin | Pas de rappel pesée |
| Déjeuner loggé | Pas de rappel repas midi |
| Dîner loggé | Pas de rappel repas soir |
| Mensurations < 28 jours | Pas de rappel mensurations |
| Photo < 28 jours | Pas de rappel photo |
| Bilan sanguin < 80 jours | Pas de rappel prise de sang |

Fréquences réelles :
- **Poids** → quotidien (matin), seulement si non enregistré
- **Repas** → aux heures de repas, max 2 rappels par repas
- **Activité sédentaire** → toutes les 90min en heures de bureau, max 4/jour
- **Mensurations** → 1 fois par mois (1er du mois)
- **Photo** → 1 fois par mois (1er du mois)
- **Prise de sang** → 1 fois par trimestre

---

## Données et vie privée

- Tout est stocké **localement** sur le Mac
- La base de données : `./db/health.db`
- Les photos : `./data/photos/`
- Les PDFs sanguins : `./data/bloodwork/`
- Aucune donnée envoyée dans le cloud (sauf les appels API Anthropic pour l'analyse)

---

## Structure du projet

```
rachida-health-coach/
├── index.js                    ← Point d'entrée
├── package.json
├── .env                        ← Clés API (ne pas committer)
│
├── /agent
│   ├── coach.js               ← Cerveau AI principal
│   ├── macros.js              ← Calcul macros quotidien
│   └── /prompts
│       └── system.md          ← Personnalité du coach
│
├── /commands
│   ├── upload-bloodwork.js    ← Analyse PDF prise de sang
│   ├── upload-photo.js        ← Photos + mensurations
│   └── log-measurements.js   ← Wizard mensurations
│
├── /reminders
│   ├── smart-schedule.js      ← Rappels intelligents (adaptatifs)
│   └── notifications.js       ← Notifications Mac
│
├── /integrations
│   └── prayer-times.js        ← Horaires prières Sharjah
│
├── /data
│   ├── profile.json           ← Profil Rachida
│   ├── supplements.json       ← Compléments
│   ├── /photos                ← Photos progression (local)
│   └── /bloodwork             ← PDFs prises de sang
│
└── /db
    ├── schema.sql             ← Structure base de données
    └── health.db              ← Base SQLite (créée au setup)
```

