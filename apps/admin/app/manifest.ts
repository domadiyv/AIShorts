import type { MetadataRoute } from 'next';

// Makes the admin installable on your phone home screen ("Add to Home Screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AIShorts Admin',
    short_name: 'AIShorts',
    description: 'Review, edit, and publish AIShorts cards.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f1115',
    theme_color: '#0f1115',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
