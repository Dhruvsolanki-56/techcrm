import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { dmy, parseDate } from '@crm/shared';
import { Icon } from './Icon';

const toShown = (iso: string): string => dmy(iso);
const toIso = (shown: string, strict = false): string | null => parseDate(shown, strict);

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: string | null | undefined; onChange(e: ChangeEvent<HTMLInputElement>): void };

/**
 * A date typed or picked as 21 Jan 2026 (21-01-2026 and 21/1/26 also work) — the same way everywhere, whatever the browser's language.
 * The value passed in and out is always the plain ISO date (2026-08-30) that the server stores.
 */
export function DateInput({ value, onChange, className, ...rest }: Props) {
  const [text, setText] = useState(toShown(value ?? ''));
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(toShown(value ?? '')); }, [value]);
  const emit = (v: string): void => onChange({ target: { value: v } } as ChangeEvent<HTMLInputElement>);
  const type = (raw: string): void => {
    setText(raw);
    if (!raw.trim()) { emit(''); return; }
    const iso = toIso(raw, true);
    if (iso) emit(iso);
  };
  return (
    <span className={`dateinput ${className ?? ''}`}>
      <input {...rest} type="text" autoComplete="off" placeholder="21 Jan 2026" maxLength={14} value={text} onChange={(e) => type(e.target.value)}
        onBlur={(e) => { const iso = toIso(text); if (iso) { setText(toShown(iso)); if (iso !== value) emit(iso); } else if (text) setText(toShown(value ?? '')); rest.onBlur?.(e); }} />
      <button type="button" className="dateinput-btn" aria-label="Open calendar" tabIndex={-1} onClick={() => { try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}><Icon name="calendar" /></button>
      <input ref={picker} type="date" className="dateinput-native" tabIndex={-1} aria-hidden="true" value={/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? (value as string) : ''} onChange={(e) => { setText(toShown(e.target.value)); emit(e.target.value); }} />
    </span>
  );
}
