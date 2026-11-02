// src/app/offline/page.tsx
// Shown by the service worker when a navigation fails and nothing is cached.

export const metadata = {
  title: 'Offline — Tindie Resources',
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '32px 24px',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: '#e6f7f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
          stroke="#22b8c4" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
        </svg>
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
        You&apos;re offline
      </h1>
      <p style={{ color: '#6b7280', maxWidth: 320, margin: 0, lineHeight: 1.5 }}>
        This page hasn&apos;t been saved for offline reading yet. Reconnect to
        load the latest hardware discoveries.
      </p>
    </main>
  );
}

