# Meal Log — Template

Rachida décrit ce qu'elle a mangé en français libre.
Tu dois analyser le repas et retourner les données nutritionnelles.

## Input

Description : "{MEAL_DESCRIPTION}"
Type de repas : {MEAL_TYPE}
Heure : {TIME}

## Contexte du jour

- Objectif calories : {CALORIES_TARGET} kcal
- Déjà consommé : {CALORIES_CONSUMED} kcal
- Protéines restantes : {PROTEIN_REMAINING}g
- Glucides restants : {CARBS_REMAINING}g
- Lipides restants : {FAT_REMAINING}g

## Ce que tu dois faire

1. Identifie chaque aliment dans la description
2. Estime la portion (taille normale pour une femme adulte, ~150-200g viande, ~200g féculents, ~100g légumes)
3. Si la portion est ambiguë, assume une portion standard
4. Calcule calories + macros + micronutriments pour chaque aliment
5. Vérifie que tout est halal. Si un aliment est possiblement non-halal, signale-le
6. Additionne les totaux
7. Montre le reste de la journée
8. Suggère le prochain repas pour rester dans les objectifs

## Format de réponse

Réponds UNIQUEMENT en JSON valide :

```json
{
  "items": [
    {
      "name": "Nom de l'aliment",
      "quantity_g": 150,
      "calories": 248,
      "protein_g": 46,
      "fat_g": 6,
      "carbs_g": 0,
      "fiber_g": 2,
      "is_halal": true,
      "halal_note": null,
      "micros": {
        "iron_mg": 1.2,
        "zinc_mg": 0.8,
        "calcium_mg": 15,
        "magnesium_mg": 12,
        "potassium_mg": 200,
        "vit_a_mcg": 0,
        "vit_c_mg": 0,
        "vit_d_ui": 0,
        "vit_e_mg": 0.5,
        "vit_b1_mg": 0.1,
        "vit_b6_mg": 0.2,
        "vit_b9_mcg": 10,
        "vit_b12_mcg": 0.5,
        "selenium_mcg": 15
      }
    }
  ],
  "totals": {
    "calories": 523,
    "protein_g": 52,
    "fat_g": 6,
    "carbs_g": 60,
    "fiber_g": 5,
    "iron_mg": 2.5,
    "zinc_mg": 1.5,
    "calcium_mg": 50,
    "magnesium_mg": 30,
    "potassium_mg": 400,
    "vit_a_mcg": 100,
    "vit_c_mg": 15,
    "vit_d_ui": 0,
    "vit_b12_mcg": 1.0,
    "vit_b9_mcg": 25,
    "selenium_mcg": 20
  },
  "next_meal_suggestion": "Description concrète du repas suggéré",
  "next_meal_why": "Explication courte (2 phrases max)"
}
```

## Valeurs de référence journalières (AJR femme adulte 45-55 ans)

| Nutriment | AJR |
|-----------|-----|
| Calories | 1800–2000 kcal |
| Protéines | 50 g |
| Fer | 16 mg |
| Zinc | 8 mg |
| Calcium | 1000 mg |
| Magnésium | 300 mg |
| Potassium | 3500 mg |
| Vit A | 700 mcg |
| Vit C | 75 mg |
| Vit D | 600 UI |
| Vit E | 15 mg |
| Vit B1 | 1.1 mg |
| Vit B6 | 1.3 mg |
| Vit B9 | 400 mcg |
| Vit B12 | 2.4 mcg |
| Sélénium | 55 mcg |

## Règles

- Portions réalistes pour le Moyen-Orient (pas de portions américaines)
- Riz = riz basmati ou long grain par défaut
- Pain = pain arabe/pita par défaut
- Poulet = halal par défaut
- Viande rouge = vérifie si elle dit "halal" ou pas
- Si elle dit "salade" sans détail = laitue, tomate, concombre, huile d'olive
- Arrondir les chiffres (pas de décimales pour les macros)
