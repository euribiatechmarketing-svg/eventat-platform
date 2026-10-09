'use client';
// A link that also confirms with a toast (‹Свали PDF› → ‹Файлът се изтегля›).
import type { ReactNode } from 'react';
import { toast } from '@/components/ui/client';

export function ToastLink({ href, className, message, children, newTab }: { href: string; className: string; message: string; children: ReactNode; newTab?: boolean }) {
  return (
    <a className={className} href={href} onClick={() => toast(message)} {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>
      {children}
    </a>
  );
}
