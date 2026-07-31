/**
 * A persistent warning banner shown ONLY in the local/dev environment (the
 * Replit preview). Gated on Vite's `import.meta.env.DEV`, which is `true` when
 * running the dev server and `false` in the production build served on
 * Railway — so this never appears on the live site.
 *
 * Deliberately loud (full-width amber striped bar, fixed to the top) so the
 * test site can't be mistaken for the live one, even on a small laptop screen.
 */
export function DevBadge() {
  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '3px 10px',
        background:
          'repeating-linear-gradient(45deg, #f59e0b, #f59e0b 14px, #fbbf24 14px, #fbbf24 28px)',
        color: '#1c1917',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.06em',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        textAlign: 'center',
      }}
      title="Development preview — uses the DEV database, not your live Railway site"
    >
      <span style={{ textTransform: 'uppercase' }}>Test site</span>
      <span style={{ fontWeight: 500 }}>
        — changes here don&apos;t affect the live app
      </span>
    </div>
  );
}
