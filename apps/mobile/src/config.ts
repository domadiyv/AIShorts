export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export const CATEGORIES = ['Models', 'Tools', 'Research', 'Business', 'Policy', 'How-to'] as const;
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
