import type { ReactNode } from 'react';
import { LogoSq, RefChip } from '../ui/primitives';

/** Two-column record page: main content on the left, properties on the right. */
export function Record({ main, side }: { main: ReactNode; side: ReactNode }) {
  return <div className="record"><div className="record-main">{main}</div><aside className="record-side">{side}</aside></div>;
}

export function RecHead({ name, refId, meta }: { name: string; refId?: unknown; meta?: ReactNode }) {
  return (
    <div className="rec-head">
      <LogoSq name={name} />
      <div><h1>{name}<RefChip value={refId} /></h1><div className="meta">{meta}</div></div>
    </div>
  );
}

export function Hl({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return <div className={`hl ${tone ?? ''}`}><div className="l">{label}</div><div className="v">{value}</div>{sub != null && sub !== '' ? <div className="s">{sub}</div> : null}</div>;
}
export const Highlights = ({ children }: { children: ReactNode }) => <div className="highlights">{children}</div>;

export function Prop({ label, children }: { label: string; children?: ReactNode }) {
  return <dl className="prop"><dt>{label}</dt><dd>{children == null || children === '' || children === false ? <span className="faint">—</span> : children}</dd></dl>;
}
export function PropsSec({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <section className="props-sec"><div className="props-h"><span>{title}</span>{action}</div>{children}</section>;
}
export const Meta = ({ children }: { children: ReactNode }) => <span>{children}</span>;
