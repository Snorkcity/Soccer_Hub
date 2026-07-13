/**
 * A small fixed badge shown ONLY in the local/dev environment (the Replit
 * preview). Gated on Vite's `import.meta.env.DEV`, which is `true` when running
 * the dev server and `false` in the production build served on Railway — so
 * this never appears on the live site.
 */
export function DevBadge() {
  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 9999,
        background: '#f59e0b',
        color: '#1c1917',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
      title="Development preview — uses the DEV database, not your live Railway site"
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#1c1917',
          display: 'inline-block',
        }}
      />
      Dev preview
    </div>
  );
}
