'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BalanceCard, Button, DataTable, EmptyState, ErrorState, Field, LoadingState, LopTag, PageHeader, QDays, q, type Col } from '../ui';
import { HRMS_CHANGED } from '../HrmsShell';
import { api, whenIst } from './api';
import { fr, payrollOf, payrollSpan } from './format';
import { useMe } from './useMe';

interface Entry { id: number; at: string; type: string; description: string; leaveId: string | null; amount: number; balance: number }
interface Stmt { name: string; balance: number; held: number; heldRequests: { leave_id: string; start_date: string; end_date: string; status: string; charge: number }[]; entries: Entry[] }
const ENTRY_TYPES = ['Opening balance', 'Monthly credit', 'Part-month credit', 'Holiday credit', 'Extra day worked', 'Leave approved', 'Leave given back', 'LOP', 'LOP converted to leave', 'Pattern change recalculation', 'Holiday deleted, credit reversed', 'Adjustment', 'Cash-out', 'Paid in FnF', 'Reversal'];
const EMPTY = { from: '', to: '', pm: '', type: '' };
/** The IST calendar day of an entry ('2026-11-19T15:06' is already IST wall clock). */
const dayOf = (e: Entry) => e.at.slice(0, 10);
function Ledger({ rows, total }: { rows: (Entry & Record<string, unknown>)[]; total: number }) {
  const cols: Col<Entry & Record<string, unknown>>[] = [
    { key: 'at', label: 'Date and time', w: 150, render: r => { const w = whenIst(r.at + ':00+05:30').split(' · '); return <span className="sm12" style={{ whiteSpace: 'nowrap' }}><div>{w[0]}</div><div className="mut">{w[1]} IST</div></span>; } },
    { key: 'type', label: 'Entry type', w: 180, render: r => <span className="row" style={{ gap: 6 }}><span style={{ fontWeight: 600 }}>{r.type}</span>{r.type === 'LOP' && <LopTag />}</span> },
    { key: 'description', label: 'Description', render: r => <span className="sm12" style={{ color: '#e5e5e5' }}>{r.description}</span> },
    { key: 'leaveId', label: 'Leave ID', w: 110, render: r => r.leaveId ? <Link className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap' }} href={`/leave/requests?req=${r.leaveId}`}>{r.leaveId}</Link> : <span className="mut">–</span> },
    { key: 'cr', label: 'Credit (+)', r: true, w: 90, render: r => r.amount > 0 ? <span className="qd" style={{ color: 'var(--green-400)' }}>+{q(r.amount)}</span> : <span className="mut">–</span> },
    { key: 'dr', label: 'Debit (−)', r: true, w: 90, render: r => r.amount < 0 ? <span className="qd">{q(r.amount)}</span> : <span className="mut">–</span> },
    { key: 'bal', label: 'Balance', r: true, w: 90, render: r => <QDays v={r.balance} /> },
    { key: 'pm', label: 'Payroll month', w: 140, render: r => <span className="tag pm-open">{payrollOf(dayOf(r)).label.split(' ')[0]} payroll</span> },
  ];
  return <DataTable columns={cols} rows={rows} foot={<><span>{rows.length} of {total} entries · newest first · nothing is ever edited or deleted</span><span>Payroll month runs 25th to 24th. Times in IST.</span></>} />;
}

/** Statement (prototype page-statement.jsx): balance, held for pending requests, available, filters and the ledger. */
export default function StatementScreen() {
  const { me } = useMe();
  const [s, setS] = useState<Stmt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(EMPTY);
  const load = useCallback(async () => { const r = await api<Stmt>('/api/leave/statement'); if (r.ok) { setS(r.data); setError(null); } else setError(r.error); }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); const h = () => { void load(); }; window.addEventListener(HRMS_CHANGED, h); return () => window.removeEventListener(HRMS_CHANGED, h); }, [load]);
  const pmOpts = useMemo(() => { const m = new Map<string, string>(); for (const e of s?.entries ?? []) { const p = payrollOf(dayOf(e)); m.set(p.key, p.label); } return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1)); }, [s]);
  const rows = useMemo(() => (s?.entries ?? []).filter(e => (!f.pm || payrollOf(dayOf(e)).key === f.pm) && (!f.type || e.type === f.type) && (!f.from || dayOf(e) >= f.from) && (!f.to || dayOf(e) <= f.to)), [s, f]);
  const head = <PageHeader title="Statement" sub="Works like a bank statement. Every change to your balance is one line. Mistakes are fixed with a new line." />;
  if (error) return <div className="page">{head}<div className="card"><ErrorState title="Couldn’t load the statement" body={error} onRetry={load} /></div></div>;
  if (!s) return <div className="page">{head}<div className="card flush"><LoadingState rows={7} /></div></div>;
  const avail = Math.round((s.balance - s.held) * 4) / 4;
  const floor = me ? me.negativeLimit : -2;
  return (
    <div className="page">
      {head}
      {s.entries.length > 0 || s.held > 0 ? (
        <>
          <div className="grid3" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', marginBottom: 20 }}>
            <BalanceCard label="Balance on statement" note="The last line of the table below"><QDays v={s.balance} size={36} /></BalanceCard>
            <div className="card col" style={{ gap: 8 }}><div className="ov">Held for pending requests</div><QDays v={s.held} size={36} />
              {s.heldRequests.length ? s.heldRequests.map(x => <div key={x.leave_id} className="row sm12" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'nowrap' }}><span><Link className="mono" href={`/leave/requests?req=${x.leave_id}`}>{x.leave_id}</Link> <span className="mut">{fr(x.start_date, x.end_date)} · {x.status}</span></span><QDays v={x.charge} size={13} /></div>) : <div className="sm12 mut">Nothing held right now.</div>}
              <div className="sm12 mut">Not in the running balance. Used if approved, back if rejected or cancelled.</div></div>
            <BalanceCard label="Available" neg={avail < 0} note={avail < 0 ? `Can go to ${q(floor)}` : 'Balance on statement minus held'}><QDays v={avail} size={36} /></BalanceCard>
          </div>
          <div className="row" style={{ gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
            <Field label="From"><input type="date" className="input" style={{ width: 170 }} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="To"><input type="date" className="input" style={{ width: 170 }} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
            <Field label="Payroll month"><select className="input" style={{ width: 250 }} value={f.pm} onChange={e => setF({ ...f, pm: e.target.value })}><option value="">All payroll months</option>{pmOpts.map(([k, l]) => <option key={k} value={k}>{l} ({payrollSpan(k)})</option>)}</select></Field>
            <Field label="Entry type"><select className="input" style={{ width: 250 }} value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="">All entry types</option>{ENTRY_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
            {(f.from || f.to || f.pm || f.type) && <Button kind="tertiary" size="sm" onClick={() => setF(EMPTY)}>Clear filters</Button>}
          </div>
        </>
      ) : null}
      {!s.entries.length
        ? <div className="card"><EmptyState title="No entries yet" body="Your first entry appears on your joining date, when your part-month credit is added." /></div>
        : !rows.length
          ? <div className="card"><EmptyState title="No entries match these filters" body="Try a different date range, payroll month or entry type." action="Clear filters" onAction={() => setF(EMPTY)} /></div>
          : <Ledger rows={rows as (Entry & Record<string, unknown>)[]} total={s.entries.length} />}
    </div>
  );
}
