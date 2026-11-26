import { DM_Mono, Lora, Space_Grotesk } from 'next/font/google';

// The prototype's design system uses these three (it loaded them from Google Fonts, which the portal's CSP blocks), so they are
// self-hosted here through next/font. Inter is the portal's own and is picked up from --font-inter.
const lora = Lora({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-lora', display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-space-grotesk', display: 'swap' });
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-dm-mono', display: 'swap' });

export const hrmsFontClass = `${lora.variable} ${spaceGrotesk.variable} ${dmMono.variable}`;
