"use client";

import React, { useEffect, useMemo, useState } from 'react';

export default function MacSetupPage() {
  const [origin, setOrigin] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const cmd = useMemo(() => {
    const base = origin || '';
    return `curl -fsSL ${base}/api/ai/setup/script | bash -s -- --auto`;
  }, [origin]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      alert('Copy failed. Please select and copy the command manually.');
    }
  };

  // Try to auto-copy on load (may be blocked by browser; harmless if it fails)
  useEffect(() => {
    const tryCopy = async () => {
      try {
        if (cmd) {
          await navigator.clipboard.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 3000);
        }
      } catch {}
    };
    tryCopy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd]);

  return (
    <main style={{
      maxWidth: 720,
      margin: '40px auto',
      padding: 24,
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji',
      lineHeight: 1.5,
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Dial AI macOS Setup</h1>
      <p style={{ color: '#444', marginBottom: 16 }}>
        This page copies a single command. Paste it into Terminal and press Enter to install everything automatically.
      </p>

      <div style={{
        background: '#0b1020', color: '#e6e6e6', padding: 16, borderRadius: 8,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        overflowX: 'auto', marginBottom: 12,
      }}>
        <code>{cmd || 'Loading...'}</code>
      </div>

      <button onClick={onCopy} style={{
        background: copied ? '#16a34a' : '#2563eb',
        color: 'white', border: 0, borderRadius: 8, padding: '12px 16px',
        fontSize: 16, fontWeight: 600, cursor: 'pointer',
      }}>
        {copied ? 'Copied!' : 'Copy Setup Command'}
      </button>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Steps (takes ~3–8 minutes)</h2>
        <ol style={{ paddingLeft: 18 }}>
          <li>Press Command + Space → type “Terminal” → press Enter.</li>
          <li>Press Command + V to paste (already copied), then press Enter.</li>
          <li>Wait until setup completes. Close the window when done.</li>
        </ol>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Troubleshooting</h3>
        <ul style={{ paddingLeft: 18 }}>
          <li>If copy fails, select the command above and copy manually (Command + C).</li>
          <li>If you prefer a downloaded installer, use the Telegram “macOS Installer” button (may require right-click → Open the first time).</li>
        </ul>
      </section>
    </main>
  );
}
