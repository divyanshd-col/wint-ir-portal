'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// ── Icons ─────────────────────────────────────────────────────────────────────

const GridIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

const StickyNoteIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const QualityShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const CalendarRosterIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const StarOutlineIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const MoreHorizontalIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </svg>
);

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

interface NoteItem {
  id: string;
  text: string;
  category: 'Follow-up' | 'Customer Query' | 'General';
  timestamp: string;
}

const NOTE_CATEGORIES: {
  key: 'Follow-up' | 'Customer Query' | 'General';
  label: string;
  border: string;
  badge: string;
  bg: string;
}[] = [
  {
    key: 'Follow-up',
    label: 'Follow-up / Escalations',
    border: 'border-gray-200',
    badge: 'bg-gray-100 text-gray-700 border-gray-200',
    bg: 'bg-gray-50/40',
  },
  {
    key: 'Customer Query',
    label: 'Priority Issues',
    border: 'border-gray-200',
    badge: 'bg-gray-100 text-gray-700 border-gray-200',
    bg: 'bg-gray-50/40',
  },
  {
    key: 'General',
    label: 'General TL Notes',
    border: 'border-gray-200',
    badge: 'bg-gray-100 text-gray-700 border-gray-200',
    bg: 'bg-gray-50/40',
  },
];

const DEFAULT_NOTES: NoteItem[] = [
  {
    id: 'n_tl_1',
    text: 'Review weekly disputes arbitration pipeline with QA team by 3 PM.',
    category: 'Follow-up',
    timestamp: 'Today, 10:15 AM',
  },
  {
    id: 'n_tl_2',
    text: 'Audit week-on-week CSAT and IQS trends for Bhavika and Vikrant.',
    category: 'General',
    timestamp: 'Today, 11:30 AM',
  },
  {
    id: 'n_tl_3',
    text: 'Check shift roster allocations and holiday coverage for next week.',
    category: 'Follow-up',
    timestamp: 'Yesterday, 05:00 PM',
  },
];

interface HolidayItem {
  id: string;
  name: string;
  dateStr: string;
  day: string;
  displayDate: string;
  month: string;
  dateNum: string;
  type: 'company' | 'market' | 'both';
  isLongWeekend?: boolean;
  notes: string;
}

const HOLIDAY_LIST: HolidayItem[] = [
  {
    id: 'h_1',
    name: 'Republic Day',
    dateStr: '2026-01-26',
    day: 'Monday',
    displayDate: '26 Jan 2026',
    month: 'JAN',
    dateNum: '26',
    type: 'both',
    isLongWeekend: true,
    notes: 'National holiday & BSE/NSE settlement off',
  },
  {
    id: 'h_2',
    name: 'Mahashivratri',
    dateStr: '2026-02-15',
    day: 'Sunday',
    displayDate: '15 Feb 2026',
    month: 'FEB',
    dateNum: '15',
    type: 'company',
    notes: 'Festival holiday',
  },
  {
    id: 'h_3',
    name: 'Holi',
    dateStr: '2026-03-03',
    day: 'Tuesday',
    displayDate: '03 Mar 2026',
    month: 'MAR',
    dateNum: '03',
    type: 'both',
    notes: 'Company off & BSE/NSE settlement closed',
  },
  {
    id: 'h_4',
    name: 'Id-ul-Fitr (Ramzan Eid)',
    dateStr: '2026-03-20',
    day: 'Friday',
    displayDate: '20 Mar 2026',
    month: 'MAR',
    dateNum: '20',
    type: 'both',
    isLongWeekend: true,
    notes: 'Company off & BSE/NSE settlement closed',
  },
  {
    id: 'h_5',
    name: 'Good Friday',
    dateStr: '2026-04-03',
    day: 'Friday',
    displayDate: '03 Apr 2026',
    month: 'APR',
    dateNum: '03',
    type: 'both',
    isLongWeekend: true,
    notes: 'Company off & BSE/NSE settlement closed',
  },
  {
    id: 'h_6',
    name: 'Dr. B.R. Ambedkar Jayanti',
    dateStr: '2026-04-14',
    day: 'Tuesday',
    displayDate: '14 Apr 2026',
    month: 'APR',
    dateNum: '14',
    type: 'both',
    notes: 'National holiday & clearing settlement closed',
  },
  {
    id: 'h_7',
    name: 'Maharashtra Day / May Day',
    dateStr: '2026-05-01',
    day: 'Friday',
    displayDate: '01 May 2026',
    month: 'MAY',
    dateNum: '01',
    type: 'both',
    isLongWeekend: true,
    notes: 'Company off & BSE/NSE settlement closed',
  },
  {
    id: 'h_8',
    name: 'Bakri Id (Eid-ul-Adha)',
    dateStr: '2026-05-27',
    day: 'Wednesday',
    displayDate: '27 May 2026',
    month: 'MAY',
    dateNum: '27',
    type: 'both',
    notes: 'Company off & bank clearing off',
  },
  {
    id: 'h_9',
    name: 'Muharram',
    dateStr: '2026-06-25',
    day: 'Thursday',
    displayDate: '25 Jun 2026',
    month: 'JUN',
    dateNum: '25',
    type: 'market',
    notes: 'Exchange settlement closed (BSE/NSE)',
  },
  {
    id: 'h_10',
    name: 'Independence Day',
    dateStr: '2026-08-15',
    day: 'Saturday',
    displayDate: '15 Aug 2026',
    month: 'AUG',
    dateNum: '15',
    type: 'both',
    notes: 'National holiday',
  },
  {
    id: 'h_11',
    name: 'Mahatma Gandhi Jayanti',
    dateStr: '2026-10-02',
    day: 'Friday',
    displayDate: '02 Oct 2026',
    month: 'OCT',
    dateNum: '02',
    type: 'both',
    isLongWeekend: true,
    notes: 'National holiday & BSE/NSE settlement closed',
  },
  {
    id: 'h_12',
    name: 'Dussehra (Vijayadashami)',
    dateStr: '2026-10-20',
    day: 'Tuesday',
    displayDate: '20 Oct 2026',
    month: 'OCT',
    dateNum: '20',
    type: 'both',
    notes: 'Company off & BSE/NSE settlement closed',
  },
  {
    id: 'h_13',
    name: 'Diwali (Laxmi Pujan)',
    dateStr: '2026-11-08',
    day: 'Sunday',
    displayDate: '08 Nov 2026',
    month: 'NOV',
    dateNum: '08',
    type: 'market',
    notes: 'Evening Muhurat trading only (Settlement closed)',
  },
  {
    id: 'h_14',
    name: 'Diwali Balipratipada',
    dateStr: '2026-11-10',
    day: 'Tuesday',
    displayDate: '10 Nov 2026',
    month: 'NOV',
    dateNum: '10',
    type: 'both',
    notes: 'Company off & BSE/NSE settlement closed',
  },
  {
    id: 'h_15',
    name: 'Guru Nanak Jayanti',
    dateStr: '2026-11-24',
    day: 'Tuesday',
    displayDate: '24 Nov 2026',
    month: 'NOV',
    dateNum: '24',
    type: 'both',
    notes: 'Company off & BSE/NSE settlement closed',
  },
  {
    id: 'h_16',
    name: 'Christmas',
    dateStr: '2026-12-25',
    day: 'Friday',
    displayDate: '25 Dec 2026',
    month: 'DEC',
    dateNum: '25',
    type: 'both',
    isLongWeekend: true,
    notes: 'Company off & BSE/NSE settlement closed',
  },
];

interface Props {
  tlName?: string;
}

export default function HarshHomePage({ tlName = 'Harsh' }: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [activeTool, setActiveTool] = useState<'notes' | 'calendar' | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Notes State (Saved in LocalStorage)
  const [notes, setNotes] = useState<NoteItem[]>(DEFAULT_NOTES);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState<'Follow-up' | 'Customer Query' | 'General'>('Follow-up');
  const [completingIds, setCompletingIds] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    'Follow-up': false,
    'Customer Query': false,
    'General': false,
  });

  const toggleCategory = (catKey: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [catKey]: !prev[catKey],
    }));
  };

  // Holiday Calendar Filter State
  const [holidayTab, setHolidayTab] = useState<'all' | 'company' | 'market' | 'long_weekend'>('all');
  const [holidayQuery, setHolidayQuery] = useState('');

  // Load saved notes from LocalStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wint_sidebar');
      if (saved) setCollapsed(saved === 'collapsed');

      const savedNotes = localStorage.getItem('wint_harsh_notes');
      if (savedNotes) {
        const parsed = JSON.parse(savedNotes);
        if (Array.isArray(parsed) && parsed.length > 0) setNotes(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('wint_sidebar', next ? 'collapsed' : 'expanded');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    const now = new Date();
    const timeStr = `Today, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const newNote: NoteItem = {
      id: `n_tl_${Date.now()}`,
      text: newNoteText.trim(),
      category: newNoteCategory,
      timestamp: timeStr,
    };
    const updated = [newNote, ...notes];
    setNotes(updated);
    setNewNoteText('');
    setExpandedCategories((prev) => ({ ...prev, [newNoteCategory]: true }));
    try {
      localStorage.setItem('wint_harsh_notes', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleCompleteNote = (id: string) => {
    if (completingIds.includes(id)) return;
    setCompletingIds((prev) => [...prev, id]);
    setTimeout(() => {
      setNotes((prev) => {
        const updated = prev.filter((n) => n.id !== id);
        try {
          localStorage.setItem('wint_harsh_notes', JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
      setCompletingIds((prev) => prev.filter((x) => x !== id));
    }, 220);
  };

  const handleDeleteNote = (id: string) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    try {
      localStorage.setItem('wint_harsh_notes', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Filtered Holidays for the Holiday & Settlement Calendar
  const filteredHolidays = HOLIDAY_LIST.filter((h) => {
    if (holidayTab === 'company' && h.type !== 'company' && h.type !== 'both') return false;
    if (holidayTab === 'market' && h.type !== 'market' && h.type !== 'both') return false;
    if (holidayTab === 'long_weekend' && !h.isLongWeekend) return false;
    if (holidayQuery.trim()) {
      const q = holidayQuery.toLowerCase();
      return (
        h.name.toLowerCase().includes(q) ||
        h.displayDate.toLowerCase().includes(q) ||
        h.day.toLowerCase().includes(q) ||
        h.notes.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const copyableHolidayList = `Wint Wealth & Exchange Settlement Holidays (2026):
${HOLIDAY_LIST.map((h) => `• ${h.displayDate} (${h.day}): ${h.name} - ${h.notes}${h.isLongWeekend ? ' [Long Weekend]' : ''}`).join('\n')}`;

  const applications = [
    {
      id: 'chats',
      title: 'Chats',
      subtitle: 'IR Chat Support Queue',
      status: 'Active queue',
      href: '/chat',
      bgClass: 'bg-gray-200 hover:bg-gray-300/80 border-gray-300',
      iconBgClass: 'bg-white text-gray-800',
      icon: <ChatBubbleIcon />,
    },
    {
      id: 'quality',
      title: 'Quality',
      subtitle: 'Evaluations, Performance & Disputes',
      status: '3 channels',
      href: '/quality',
      bgClass: 'bg-gray-200 hover:bg-gray-300/80 border-gray-300',
      iconBgClass: 'bg-white text-gray-800',
      icon: <QualityShieldIcon />,
    },
    {
      id: 'roster',
      title: 'Roster',
      subtitle: 'Team Schedule & Shifts',
      status: 'Team rotation',
      href: '/roster',
      bgClass: 'bg-gray-200 hover:bg-gray-300/80 border-gray-300',
      iconBgClass: 'bg-white text-gray-800',
      icon: <CalendarRosterIcon />,
    },
    {
      id: 'leave',
      title: 'Leave',
      subtitle: 'Leave Requests & Balances',
      status: 'On shift',
      href: '/leave',
      bgClass: 'bg-gray-200 hover:bg-gray-300/80 border-gray-300',
      iconBgClass: 'bg-white text-gray-800',
      icon: <CalendarIcon />,
    },
  ].filter(app => app.id !== 'roster' && app.id !== 'leave');

  return (
    <div className="quality-shell-container">
      <div className="quality-shell-body">
        {/* Left Side Panel: CX TL Tools */}
        <aside className={`quality-shell-sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="quality-shell-sidebar-head">
            {!collapsed && (
              <div className="quality-shell-sidebar-title font-semibold text-xs tracking-wider uppercase text-gray-500">
                CX Team Lead Tools
              </div>
            )}
            <button
              type="button"
              className="quality-shell-sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          </div>

          <div className="space-y-1">
            {/* 1. Active Workspaces View */}
            <button
              type="button"
              onClick={() => setActiveTool(null)}
              className={`quality-shell-sidebar-link w-[calc(100%-24px)] text-left cursor-pointer ${
                activeTool === null ? 'active' : ''
              }`}
            >
              <span>
                <GridIcon />
              </span>
              <span className="quality-shell-sidebar-label">Workspaces</span>
            </button>

            {!collapsed && (
              <div className="pt-4 pb-1 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                Quick Tools
              </div>
            )}

            {/* 2. Notes */}
            <button
              type="button"
              onClick={() => setActiveTool('notes')}
              className={`quality-shell-sidebar-link w-[calc(100%-24px)] text-left cursor-pointer ${
                activeTool === 'notes' ? 'active' : ''
              }`}
            >
              <span>
                <StickyNoteIcon />
              </span>
              <span className="quality-shell-sidebar-label">Quick Notes</span>
            </button>

            {/* 3. Company Holidays & Market Settlement Calendar */}
            <button
              type="button"
              onClick={() => setActiveTool('calendar')}
              className={`quality-shell-sidebar-link w-[calc(100%-24px)] text-left cursor-pointer ${
                activeTool === 'calendar' ? 'active' : ''
              }`}
            >
              <span>
                <CalendarIcon />
              </span>
              <span className="quality-shell-sidebar-label">Holiday Calendar</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area: Centered and Clean */}
        <main className="quality-shell-main" style={{ padding: '36px 48px' }}>
          <div className="max-w-5xl mx-auto space-y-8">
            {/* Header: Choose your workspace */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-200/80">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Choose your workspace</h1>
              </div>

              <div className="text-sm sm:text-[15px] text-gray-600 font-medium">
                Welcome back, <span className="font-bold text-gray-900">{tlName}</span>
              </div>
            </div>

            {/* Application Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {applications.map((app) => (
                <div key={app.id} className="group flex flex-col">
                  {/* The Card */}
                  <div
                    onClick={() => router.push(app.href)}
                    className={`relative h-28 rounded-2xl border p-5 flex items-center justify-between shadow-2xs transition-all duration-200 cursor-pointer group-hover:shadow-md group-hover:-translate-y-0.5 ${app.bgClass}`}
                  >
                    {/* Star at top-left */}
                    <div className="absolute top-3.5 left-3.5 text-gray-500/70 group-hover:text-gray-900 transition">
                      <StarOutlineIcon />
                    </div>

                    {/* Card Title */}
                    <div className="mt-2 pl-0.5">
                      <span className="text-xl font-bold text-gray-900 tracking-tight block">
                        {app.title}
                      </span>
                    </div>

                    {/* Round Icon Badge on the right */}
                    <div className={`w-12 h-12 rounded-full shadow-xs flex items-center justify-center transition-transform group-hover:scale-105 ${app.iconBgClass}`}>
                      {app.icon}
                    </div>
                  </div>

                  {/* Caption row below the card */}
                  <div className="flex items-center justify-between px-1 mt-2 text-xs text-gray-500">
                    <span className="truncate">{app.subtitle}</span>
                    <button
                      type="button"
                      className="p-1 text-gray-400 hover:text-gray-700 rounded transition cursor-pointer"
                      title="More options"
                    >
                      <MoreHorizontalIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* ── CX TL UTILITY TOOLS (MODALS / DRAWERS) ───────────────────────────── */}

      {/* Tool 1: TL Quick Notes */}
      {activeTool === 'notes' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4" onClick={() => setActiveTool(null)}>
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4 flex-shrink-0">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span className="text-gray-500"><StickyNoteIcon /></span>
                <span>Quick Notes</span>
              </h3>
              <button onClick={() => setActiveTool(null)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg cursor-pointer">✕</button>
            </div>

            {/* Scrollable Modal Content */}
            <div className="overflow-y-auto flex-1 pr-1 space-y-5">
              {/* Add New Note Form */}
              <form onSubmit={handleSaveNote} className="p-4 rounded-xl border border-gray-200 bg-gray-50/70 space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    New Note / Reminder
                  </label>
                  <textarea
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    placeholder="e.g. Follow up on dispute review with QA team for Chat #208940..."
                    rows={2}
                    className="w-full border border-gray-200 rounded-xl p-3 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-semibold text-gray-500 uppercase">Save Under Section:</label>
                    <select
                      value={newNoteCategory}
                      onChange={(e) => setNewNoteCategory(e.target.value as any)}
                      className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs bg-white text-gray-800 font-medium"
                    >
                      <option value="Follow-up">Follow-up</option>
                      <option value="Customer Query">Priority Issues</option>
                      <option value="General">General</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={!newNoteText.trim()}
                    className="px-4 py-1.5 bg-black text-white rounded-lg text-xs font-semibold hover:bg-zinc-800 disabled:opacity-40 transition cursor-pointer shadow-xs"
                  >
                    Save Note
                  </button>
                </div>
              </form>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    Categorized Notes ({notes.length} total)
                  </div>
                  <div className="text-[11px] text-gray-400 italic">
                    Tick the checkbox to complete &amp; remove a note
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 items-start">
                  {NOTE_CATEGORIES.map((cat) => {
                    const categoryNotes = notes.filter((n) => n.category === cat.key);
                    const isExpanded = !!expandedCategories[cat.key];
                    return (
                      <div
                        key={cat.key}
                        className={`rounded-xl border ${cat.border} ${cat.bg} flex flex-col overflow-hidden shadow-2xs transition-all duration-200`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleCategory(cat.key)}
                          className={`p-3 bg-gray-50/80 ${isExpanded ? 'border-b border-gray-200' : ''} flex items-center justify-between cursor-pointer hover:bg-gray-100/70 transition`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900">{cat.label}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full border ${cat.badge}`}>
                              {categoryNotes.length}
                            </span>
                          </div>
                          <span className={`text-xs text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                            ▾
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="p-2.5 space-y-2 transition-all">
                            {categoryNotes.length === 0 ? (
                              <div className="py-6 text-center text-[11px] text-gray-400 italic">
                                No notes in this section
                              </div>
                            ) : (
                              categoryNotes.map((note) => {
                                const isFinishing = completingIds.includes(note.id);
                                return (
                                  <div
                                    key={note.id}
                                    className={`group/note p-2.5 rounded-lg border border-gray-200/80 bg-white shadow-2xs hover:border-gray-300 transition-all duration-300 ${
                                      isFinishing ? 'opacity-30 scale-95' : 'opacity-100 scale-100'
                                    }`}
                                  >
                                    <div className="flex items-start gap-2.5">
                                      <input
                                        type="checkbox"
                                        checked={isFinishing}
                                        onChange={() => handleCompleteNote(note.id)}
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-black focus:ring-black/20 cursor-pointer"
                                        title="Mark complete"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-xs text-gray-800 leading-snug break-words whitespace-pre-wrap ${isFinishing ? 'line-through text-gray-400' : ''}`}>
                                          {note.text}
                                        </p>
                                        <div className="flex items-center justify-between mt-2 pt-1 border-t border-gray-50 text-[10px] text-gray-400">
                                          <span>{note.timestamp}</span>
                                          <button
                                            type="button"
                                            onClick={() => handleCompleteNote(note.id)}
                                            className="text-gray-300 hover:text-red-500 opacity-0 group-hover/note:opacity-100 transition cursor-pointer"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tool 2: Company Holidays & Market Settlement Calendar */}
      {activeTool === 'calendar' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4" onClick={() => setActiveTool(null)}>
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-gray-500"><CalendarIcon /></span>
                <h3 className="text-base font-bold text-gray-900">2026 Holiday Calendar</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                  Wint Wealth &amp; Settlement
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setActiveTool(null)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg cursor-pointer">✕</button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 flex-shrink-0">
              <div className="inline-flex p-1 bg-gray-100 rounded-xl text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setHolidayTab('all')}
                  className={`px-3 py-1 rounded-lg transition cursor-pointer ${holidayTab === 'all' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  All ({HOLIDAY_LIST.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHolidayTab('company')}
                  className={`px-3 py-1 rounded-lg transition cursor-pointer ${holidayTab === 'company' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  Company
                </button>
                <button
                  type="button"
                  onClick={() => setHolidayTab('market')}
                  className={`px-3 py-1 rounded-lg transition cursor-pointer ${holidayTab === 'market' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  Market
                </button>
                <button
                  type="button"
                  onClick={() => setHolidayTab('long_weekend')}
                  className={`px-3 py-1 rounded-lg transition cursor-pointer ${holidayTab === 'long_weekend' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  Long Weekends ({HOLIDAY_LIST.filter(h => h.isLongWeekend).length})
                </button>
              </div>

              <input
                type="text"
                placeholder="Search holidays…"
                value={holidayQuery}
                onChange={(e) => setHolidayQuery(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-black/10 w-full sm:w-48"
              />
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-gray-100 pr-1">
              {filteredHolidays.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-400">
                  No holidays match your filter
                </div>
              ) : (
                filteredHolidays.map((h) => (
                  <div key={h.id} className="py-3 flex items-center justify-between gap-4 hover:bg-gray-50/70 px-2 rounded-xl transition">
                    <div className="flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-gray-100 flex flex-col items-center justify-center text-gray-900 flex-shrink-0 border border-gray-200/60">
                        <span className="text-[9px] font-bold tracking-wider uppercase text-gray-500">{h.month}</span>
                        <span className="text-sm font-extrabold leading-none">{h.dateNum}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900">{h.name}</span>
                          {h.isLongWeekend && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Long Weekend
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                          <span>{h.day}</span>
                          <span>•</span>
                          <span>{h.notes}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
