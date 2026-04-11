// motivation.js — Pedagogical engine
// Every recommendation includes WHY
// Rotates daily facts, generates micro-objectives

import db from '../db/connection.js';

// ─────────────────────────────────────────────
// PEDAGOGICAL FACTS — one per day, rotating
// Each explains something useful about the body
// Written for a 48-year-old woman in the UAE
// ─────────────────────────────────────────────

// Chaque fait est relié à ce qui compte pour Rachida :
// gras (perte de poids), faim (satiété), cheveux, sommeil
const FACTS = [
  {
    fact: "Le poulet grillé, c'est ton meilleur allié. 46g de protéines pour 250 kcal — rien ne te cale autant pour aussi peu. Tes fringales de l'après-midi vont disparaître.",
    category: 'faim'
  },
  {
    fact: "Bien dormir, c'est maigrir. Quand tu dors mal, ton corps produit plus de ghréline — l'hormone qui donne faim. Le magnésium le soir t'aide à dormir profond.",
    category: 'sommeil'
  },
  {
    fact: "Marche 10 minutes après le déjeuner. Ça réduit le pic de sucre dans le sang de 30%. Résultat : moins de coup de barre à 15h et moins de stockage de gras.",
    category: 'gras'
  },
  {
    fact: "La balance monte d'1 kg en un jour ? C'est de l'eau, pas du gras. Le sel, la chaleur, les hormones — ça joue. Regarde la tendance sur 2 semaines, pas un seul jour.",
    category: 'gras'
  },
  {
    fact: "Les 5 prières, c'est aussi de la santé. Elles réduisent le cortisol — l'hormone du stress qui stocke la graisse autour du ventre.",
    category: 'gras'
  },
  {
    fact: "Si tu as tout le temps faim, vérifie ta vitamine D. Elle contrôle les hormones de la faim. Au bureau toute la journée à Sharjah, on en manque facilement.",
    category: 'faim'
  },
  {
    fact: "Un grand verre d'eau avant de manger. Ça remplit l'estomac et tu manges 20% de moins sans t'en rendre compte. Simple et efficace.",
    category: 'faim'
  },
  {
    fact: "Les œufs, c'est un trésor. Protéines pour te caler, biotine pour tes cheveux, et seulement 70 kcal pièce. 2 œufs le matin = zéro fringale avant midi.",
    category: 'cheveux'
  },
  {
    fact: "Sauter le petit-déj, c'est piéger ton corps. Il croit qu'il y a une famine, produit du cortisol, et stocke plus au repas suivant. Mange le matin, même léger.",
    category: 'gras'
  },
  {
    fact: "La chaleur de Sharjah te fait transpirer — mais c'est de l'eau, pas du gras. Bois 2.5L par jour sinon tu es fatiguée, tu as faim, et tes cheveux deviennent secs.",
    category: 'cheveux'
  },
  {
    fact: "Les lentilles, c'est sous-estimé. Plein de fibres, ça te cale longtemps. Et le fer dedans nourrit tes cheveux — c'est un aliment 2 en 1.",
    category: 'cheveux'
  },
  {
    fact: "Mange lentement. Le cerveau met 20 minutes pour sentir que t'es calée. Si tu manges vite, tu manges trop avant de t'en rendre compte.",
    category: 'faim'
  },
  {
    fact: "Le riz blanc fait monter le sucre vite et redescendre vite — du coup t'as faim 1h après. Le riz complet ou basmati tient beaucoup plus longtemps.",
    category: 'faim'
  },
  {
    fact: "Ton magnésium du soir, c'est pas juste pour dormir. Il réduit aussi le stress, les crampes, et aide tes muscles à récupérer de la marche.",
    category: 'sommeil'
  },
  {
    fact: "2h assise sans bouger, ton métabolisme ralentit de 20%. 5 minutes debout suffisent à le relancer. Lève-toi, marche jusqu'à la cuisine, reviens.",
    category: 'gras'
  },
  {
    fact: "Les oméga-3 de ton complément réduisent l'inflammation. Résultat : tu perds du gras plus facilement et tes cheveux sont plus forts.",
    category: 'cheveux'
  },
  {
    fact: "Tu as soif ? T'es déjà déshydratée. La déshydratation donne faim (le corps confond soif et faim). Bois d'abord, mange après.",
    category: 'faim'
  },
  {
    fact: "Des légumes à chaque repas. Les fibres ralentissent la digestion — ton sucre reste stable et tu n'as pas le coup de barre de l'après-midi.",
    category: 'faim'
  },
  {
    fact: "Pas d'écran 30 min avant de dormir. La lumière bleue bloque la mélatonine. Tu t'endors plus vite, tu dors plus profond, et le lendemain t'as moins faim.",
    category: 'sommeil'
  },
  {
    fact: "Les dattes c'est bien le matin — ça donne de l'énergie vite. Le soir, le sucre se stocke direct parce que ton corps ne bouge plus. Garde-les pour midi.",
    category: 'gras'
  },
  {
    fact: "Fatiguée l'après-midi ? Vérifie ta B12. C'est elle qui donne l'énergie. Et si t'es fatiguée, tu grignotes. La B12 se prend le matin avec le petit-déj.",
    category: 'faim'
  },
  {
    fact: "Le yaourt grec, c'est un super snack. 15g de protéines, ça cale 3-4h. Ajoute 5 amandes : du bon gras pour tes cheveux et ta peau.",
    category: 'cheveux'
  },
  {
    fact: "Le poisson le soir c'est top. Les oméga-3 améliorent la qualité du sommeil. Et mieux tu dors, plus ton corps brûle du gras la nuit.",
    category: 'sommeil'
  },
  {
    fact: "Le labneh c'est riche en protéines et facile à digérer. Avec du concombre et du pain arabe le matin, ça te cale sans être lourd.",
    category: 'faim'
  }
];

/**
 * Get today's pedagogical fact (rotates daily)
 */
export function getDailyFact() {
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return FACTS[dayOfYear % FACTS.length];
}

/**
 * Get a fact by category (for targeted advice)
 */
export function getFactByCategory(category) {
  const matching = FACTS.filter(f => f.category === category);
  if (matching.length === 0) return null;
  return matching[Math.floor(Math.random() * matching.length)];
}

/**
 * Generate a micro-objective for today
 * Based on real data — not generic advice
 */
export function getMicroObjective() {
  const today = new Date().toISOString().split('T')[0];

  // Check what happened yesterday
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const yesterdayMeals = db.prepare(
    'SELECT COALESCE(SUM(protein_g), 0) as protein FROM meal_log WHERE date = ?'
  ).get(yesterday);

  const todayWeight = db.prepare(
    'SELECT id FROM weight_log WHERE date = ? LIMIT 1'
  ).get(today);

  const todayTarget = db.prepare(
    'SELECT protein_target_g FROM daily_targets WHERE date = ?'
  ).get(today);

  // Priority-ordered objectives
  if (!todayWeight) {
    return {
      objective: 'Pèse-toi ce matin avant de manger.',
      why: 'C\'est le seul moment de la journée où ton poids est fiable — à jeun, après les toilettes.',
      type: 'weight'
    };
  }

  if (yesterdayMeals && todayTarget && yesterdayMeals.protein < todayTarget.protein_target_g * 0.7) {
    return {
      objective: `Atteins ${todayTarget.protein_target_g}g de protéines aujourd'hui.`,
      why: 'Hier tes protéines étaient basses. Ajoute du poulet, des œufs ou du labneh à chaque repas.',
      type: 'nutrition'
    };
  }

  const dayOfWeek = new Date().getDay();
  const objectives = [
    {
      objective: 'Fais 20 minutes de marche après Asr.',
      why: 'La marche après une prière est le moment parfait — tu es déjà debout et le soleil baisse.',
      type: 'activity'
    },
    {
      objective: 'Bois 500ml d\'eau avant chaque repas aujourd\'hui.',
      why: 'L\'eau avant le repas réduit la faim et augmente le métabolisme de 30% pendant 1h.',
      type: 'hydration'
    },
    {
      objective: 'Note tous tes repas aujourd\'hui — même les petits snacks.',
      why: 'Les calories invisibles (biscuit, jus, dattes) s\'accumulent vite. Les noter = les contrôler.',
      type: 'tracking'
    },
    {
      objective: 'Lève-toi de ta chaise toutes les heures pendant le travail.',
      why: 'Rester assise plus de 90 min ralentit ton métabolisme. 2 minutes debout suffisent.',
      type: 'activity'
    },
    {
      objective: 'Ajoute des légumes à chaque repas aujourd\'hui.',
      why: 'Les fibres des légumes stabilisent ta glycémie et t\'aident à tenir jusqu\'au prochain repas.',
      type: 'nutrition'
    },
    {
      objective: 'Pas d\'écran 30 minutes avant de dormir ce soir.',
      why: 'La lumière bleue bloque la mélatonine. Un bon sommeil = un métabolisme qui fonctionne mieux demain.',
      type: 'sleep'
    },
    {
      objective: 'Prends tous tes compléments aux bons moments aujourd\'hui.',
      why: 'Le timing change tout : D3 le matin avec du gras, magnésium le soir pour le sommeil.',
      type: 'supplements'
    }
  ];

  return objectives[dayOfWeek % objectives.length];
}

/**
 * Generate encouragement based on real data
 * Not generic — based on what actually happened
 */
export function getEncouragement() {
  const weekWeights = db.prepare(`
    SELECT weight_kg FROM weight_log
    WHERE date >= date('now', '-7 days')
    ORDER BY date ASC
  `).all();

  if (weekWeights.length >= 2) {
    const first = weekWeights[0].weight_kg;
    const last = weekWeights[weekWeights.length - 1].weight_kg;
    const diff = last - first;

    if (diff < -0.3) {
      return `Tu as perdu ${Math.abs(diff).toFixed(1)} kg cette semaine. C'est exactement le bon rythme — ton corps s'adapte sans stress.`;
    }
    if (diff > 0.5) {
      return `+${diff.toFixed(1)} kg cette semaine. Pas de panique — c'est souvent de la rétention d'eau (sel, chaleur, hormones). Regarde la tendance sur 2 semaines, pas 1 jour.`;
    }
    return `Poids stable cette semaine. C'est normal — le corps ne perd pas de façon linéaire. Continue le plan, les résultats viennent par vagues.`;
  }

  return `Chaque jour où tu notes tes repas et tu te pèses, c'est un jour où tu reprends le contrôle. Continue.`;
}
