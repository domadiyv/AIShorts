// Card categories shown as feed tabs in the app/web.
export const CATEGORIES = [
  'Models',
  'Tools',
  'Research',
  'Business',
  'Policy',
  'How-to',
] as const;
export type Category = (typeof CATEGORIES)[number];

// Difficulty levels — lets one app serve both beginners and practitioners.
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type DifficultyLevel = (typeof DIFFICULTIES)[number];

// Target word count for a card summary (Inshorts-style brevity).
export const SUMMARY_WORD_TARGET = { min: 50, max: 65 } as const;
