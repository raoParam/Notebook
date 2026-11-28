'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { db, DEFAULT_MODULE_ID } from '@/lib/db';
import { getModule, getNotebookSlug } from '@/lib/workspace';

function RootRedirector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'resolving' | 'redirecting'>('resolving');

  useEffect(() => {
    let active = true;

    async function resolveRoute() {
      try {
        const { seedIfEmpty } = await import('@/lib/db');
        await seedIfEmpty();

        const noteParam = searchParams.get('note');
        const lastActiveId = typeof window !== 'undefined' ? localStorage.getItem('nb-active-id') : null;

        // 1. Try ?note=<id> param first
        if (noteParam) {
          const noteById = await db.notes.get(noteParam);
          if (noteById && active) {
            const modId = noteById.moduleId || DEFAULT_MODULE_ID;
            const mod = await getModule(modId);
            const modSlug = mod?.slug || mod?.id || 'general';
            const nbSlug = getNotebookSlug(noteById);
            setStatus('redirecting');
            router.replace(`/${modSlug}/${nbSlug}`);
            return;
          }
        }

        // 2. Try last active notebook from localStorage
        if (lastActiveId) {
          const lastNote = await db.notes.get(lastActiveId);
          if (lastNote && active) {
            const modId = lastNote.moduleId || DEFAULT_MODULE_ID;
            const mod = await getModule(modId);
            const modSlug = mod?.slug || mod?.id || 'general';
            const nbSlug = getNotebookSlug(lastNote);
            setStatus('redirecting');
            router.replace(`/${modSlug}/${nbSlug}`);
            return;
          }
        }

        // 3. Fallback to the most recently updated note in DB
        const allNotes = await db.notes.toArray();
        if (allNotes.length > 0 && active) {
          allNotes.sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          const topNote = allNotes[0];
          const modId = topNote.moduleId || DEFAULT_MODULE_ID;
          const mod = await getModule(modId);
          const modSlug = mod?.slug || mod?.id || 'general';
          const nbSlug = getNotebookSlug(topNote);
          setStatus('redirecting');
          router.replace(`/${modSlug}/${nbSlug}`);
          return;
        }

        // 4. If no notes exist, redirect to /modules overview
        if (active) {
          setStatus('redirecting');
          router.replace('/modules');
        }
      } catch (err) {
        console.error('Failed to resolve route:', err);
        if (active) {
          router.replace('/modules');
        }
      }
    }

    void resolveRoute();

    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-app)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <svg
          className="animate-spin-slow"
          style={{
            margin: '0 auto 12px',
            display: 'block',
            color: 'var(--accent)',
          }}
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>
          {status === 'redirecting' ? 'Opening notebook…' : 'Loading workspace…'}
        </p>
      </div>
    </div>
  );
}

export default function RootPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: 'flex',
            height: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-app)',
          }}
        >
          <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>Loading…</p>
        </div>
      }
    >
      <RootRedirector />
    </Suspense>
  );
}
