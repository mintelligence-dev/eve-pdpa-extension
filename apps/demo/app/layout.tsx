import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans_Thai, JetBrains_Mono, Manrope, Rubik } from 'next/font/google'
import './globals.css'

// Mintel UI fonts, self-hosted by next/font at build time: the page makes no
// requests to a third party.
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' })
const rubik = Rubik({ subsets: ['latin'], variable: '--font-rubik', display: 'swap' })
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
})
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'eve-pdpa-extension · Live Demo',
  description:
    'Try eve-pdpa-extension in the browser: detect and mask Thai personal data before it reaches an AI.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e1e' },
  ],
}

// Runs before the first paint: the visitor's saved choice (light, dark or
// system), else the OS. Mintel UI switches on the `dark` class.
const THEME_SCRIPT = `(function () {
  var KEY = 'pdpa-demo-theme', m = window.matchMedia('(prefers-color-scheme: dark)')
  function get() { try { return localStorage.getItem(KEY) || 'system' } catch (e) { return 'system' } }
  function apply() {
    var c = get(), dark = c === 'dark' || (c === 'system' && m.matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }
  window.pdpaTheme = { get: get, set: function (c) { try { localStorage.setItem(KEY, c) } catch (e) {} apply() } }
  apply()
  m.addEventListener('change', apply)
})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="th"
      suppressHydrationWarning
      className={`${manrope.variable} ${rubik.variable} ${plexThai.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-grouped font-sans text-foreground antialiased">{children}</body>
    </html>
  )
}
