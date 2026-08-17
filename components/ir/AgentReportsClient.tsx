'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const StarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

interface ReportComment {
  id: string;
  targetKey: string; // e.g. "general", "theme:0", "evidence:103929", "csat"
  text: string;
  highlighted: boolean;
  createdAt: string;
}

interface TLNote {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

interface Report {
  id: string;
  agent_id: number;
  week_start: string;
  week_end: string;
  status: string;
  generated: any; // The GeneratedScorecard JSON
  comments: ReportComment[];
  tl_notes?: TLNote[];
  viewed_at: string | null;
  generated_at: string;
  agent_name?: string;
}

interface Props {
  agentName: string;
  role?: string; // Passed from TL view if viewing an agent's report
  userId?: string;
}

export default function AgentReportsClient({ agentName, role = 'agent' }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [assignedAgents, setAssignedAgents] = useState<{ id: number; name: string }[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comment Modal/Form State (Agent)
  const [commentTarget, setCommentTarget] = useState<{ key: string; label: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);

  // TL 1-on-1 Note State
  const [showTLNoteModal, setShowTLNoteModal] = useState(false);
  const [tlNoteText, setTLNoteText] = useState('');
  const [editingTLNoteId, setEditingTLNoteId] = useState<string | null>(null);

  // Copy Feedback State
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState('all');
  const [selectedWeekFilter, setSelectedWeekFilter] = useState('all');
  const [latestSystemWeek, setLatestSystemWeek] = useState<string | null>(null);

  const fetchReports = async () => {
    try {
      const res = await fetch('/api/ir/reports');
      let data: any = {};
      try {
        data = await res.json();
      } catch (e) {
        throw new Error(`Server returned status ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        throw new Error(data.error || `Error ${res.status}: Failed to fetch reports.`);
      }
      setReports(data.reports || []);
      setAssignedAgents(data.assignedAgents || []);
      setLatestSystemWeek(data.latestSystemWeek || null);
      if (data.reports && data.reports.length > 0 && !activeReportId) {
        setActiveReportId(data.reports[0].id);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const activeReport = reports.find(r => r.id === activeReportId);

  // Mark as read when report is opened by agent
  useEffect(() => {
    if (activeReport && !activeReport.viewed_at && role === 'agent') {
      fetch('/api/ir/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: activeReport.id })
      })
      .then(res => {
        if (res.ok) {
          setReports(prev => prev.map(r => r.id === activeReport.id ? { ...r, viewed_at: new Date().toISOString() } : r));
        }
      })
      .catch(err => console.error('Failed to mark report as read:', err));
    }
  }, [activeReportId, role]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenComment = (targetKey: string, label: string, existing?: ReportComment) => {
    if (role !== 'agent') return;
    setCommentTarget({ key: targetKey, label });
    if (existing) {
      setCommentText(existing.text);
      setIsHighlighted(existing.highlighted);
      setEditingCommentId(existing.id);
    } else {
      setCommentText('');
      setIsHighlighted(false);
      setEditingCommentId(null);
    }
  };

  const handleSaveComment = async () => {
    if (!activeReport || !commentTarget) return;

    let updatedComments = [...(activeReport.comments || [])];

    if (editingCommentId) {
      updatedComments = updatedComments.map(c => c.id === editingCommentId ? {
        ...c,
        text: commentText,
        highlighted: isHighlighted,
      } : c);
    } else {
      const newComment: ReportComment = {
        id: Math.random().toString(36).substring(2, 9),
        targetKey: commentTarget.key,
        text: commentText,
        highlighted: isHighlighted,
        createdAt: new Date().toISOString()
      };
      updatedComments.push(newComment);
    }

    try {
      const res = await fetch('/api/ir/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: activeReport.id,
          comments: updatedComments
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save comment.');
      }

      setReports(prev => prev.map(r => r.id === activeReport.id ? { ...r, comments: updatedComments } : r));
      setCommentTarget(null);
      setCommentText('');
      setIsHighlighted(false);
      setEditingCommentId(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!activeReport || !window.confirm('Are you sure you want to delete this note?')) return;

    const updatedComments = (activeReport.comments || []).filter(c => c.id !== commentId);

    try {
      const res = await fetch('/api/ir/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: activeReport.id,
          comments: updatedComments
        })
      });

      if (!res.ok) {
        throw new Error('Failed to delete comment.');
      }

      setReports(prev => prev.map(r => r.id === activeReport.id ? { ...r, comments: updatedComments } : r));
    } catch (err: any) {
      alert(err.message);
    }
  };

  // TL 1-on-1 Meeting Note handlers
  const handleOpenTLNoteModal = (existingNote?: TLNote) => {
    if (role !== 'tl' && role !== 'admin') return;
    if (existingNote) {
      setTLNoteText(existingNote.text);
      setEditingTLNoteId(existingNote.id);
    } else {
      setTLNoteText('');
      setEditingTLNoteId(null);
    }
    setShowTLNoteModal(true);
  };

  const handleSaveTLNote = async () => {
    if (!activeReport || !tlNoteText.trim()) return;

    let updatedTLNotes = [...(activeReport.tl_notes || [])];

    if (editingTLNoteId) {
      updatedTLNotes = updatedTLNotes.map(n => n.id === editingTLNoteId ? {
        ...n,
        text: tlNoteText,
      } : n);
    } else {
      const newTLNote: TLNote = {
        id: Math.random().toString(36).substring(2, 9),
        author: agentName || 'Team Lead',
        text: tlNoteText,
        createdAt: new Date().toISOString()
      };
      updatedTLNotes.push(newTLNote);
    }

    try {
      const res = await fetch('/api/ir/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: activeReport.id,
          tl_notes: updatedTLNotes
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save 1-on-1 meeting note.');
      }

      setReports(prev => prev.map(r => r.id === activeReport.id ? { ...r, tl_notes: updatedTLNotes } : r));
      setShowTLNoteModal(false);
      setTLNoteText('');
      setEditingTLNoteId(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteTLNote = async (noteId: string) => {
    if (!activeReport || !window.confirm('Are you sure you want to delete this 1-on-1 meeting note?')) return;

    const updatedTLNotes = (activeReport.tl_notes || []).filter(n => n.id !== noteId);

    try {
      const res = await fetch('/api/ir/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: activeReport.id,
          tl_notes: updatedTLNotes
        })
      });

      if (!res.ok) {
        throw new Error('Failed to delete 1-on-1 meeting note.');
      }

      setReports(prev => prev.map(r => r.id === activeReport.id ? { ...r, tl_notes: updatedTLNotes } : r));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const formatDate = (dateStr: string) => {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return new Date(dateStr).toLocaleDateString('en-US', options);
  };

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          <p className="font-semibold">Error Loading Reports</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col h-[70vh] items-center justify-center p-6 text-center bg-gray-50">
        <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"/>
        </svg>
        <h3 className="text-lg font-bold text-gray-800">No Scorecards Available</h3>
        <p className="text-gray-500 mt-2 max-w-md font-medium text-sm leading-relaxed">
          {role === 'tl' 
            ? `No published scorecards available for your assigned agents.`
            : `No scorecard was generated for ${agentName} because there were no evaluated chats in recent periods.`}
        </p>
      </div>
    );
  }

  // Determine lists of available agents & available dates/weeks
  const uniqueAgentNames = Array.from(new Set([
    ...assignedAgents.map(a => a.name),
    ...reports.map(r => r.agent_name).filter(Boolean) as string[]
  ])).sort();

  const uniqueWeeks = Array.from(new Set(reports.map(r => r.week_start))).sort().reverse();

  const filteredReports = reports.filter(r => {
    const weekRange = `${formatDate(r.week_start)} - ${formatDate(r.week_end)}`.toLowerCase();
    const searchMatch = !searchTerm || 
      weekRange.includes(searchTerm.toLowerCase()) || 
      (r.agent_name && r.agent_name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const agentFilterMatch = selectedAgentFilter === 'all' || r.agent_name === selectedAgentFilter;
    const weekFilterMatch = selectedWeekFilter === 'all' || r.week_start === selectedWeekFilter;

    return searchMatch && agentFilterMatch && weekFilterMatch;
  });

  // Check if there is a missing report alert to display
  let missingWeekAlert = null;
  if (latestSystemWeek) {
    const targetAgentName = role === 'agent' ? agentName : (selectedAgentFilter !== 'all' ? selectedAgentFilter : null);
    
    if (targetAgentName) {
      const hasLatestReport = reports.some(r => {
        const isLatestWeek = r.week_start === latestSystemWeek;
        const matchesAgent = role === 'agent' || r.agent_name === targetAgentName;
        return isLatestWeek && matchesAgent;
      });

      if (!hasLatestReport) {
        const start = new Date(latestSystemWeek);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const weekRangeLabel = `${formatDate(start.toISOString())} - ${formatDate(end.toISOString())}`;
        
        missingWeekAlert = {
          weekRange: weekRangeLabel,
          agent: targetAgentName
        };
      }
    }
  }

  const scorecard = activeReport?.generated;
  const numbers = scorecard?.numbers;

  return (
    <div className="flex h-[calc(100dvh-64px)] overflow-hidden bg-[#F7F7F8]">
      {/* Sidebar List */}
      <aside className="w-80 border-r border-[#E4E4E7] bg-white flex flex-col overflow-y-auto shrink-0">
        <div className="p-4 border-b border-[#E4E4E7] bg-gray-50 flex items-center justify-between">
          <span className="font-bold text-gray-800 text-sm tracking-wide uppercase">
            {role === 'tl' ? 'Team Scorecards' : role === 'admin' ? 'All Scorecards' : 'My Scorecards'}
          </span>
          <span className="bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full text-xs">
            {filteredReports.length}
          </span>
        </div>

        {/* Filters Section (TL / Admin View) */}
        {role !== 'agent' && (
          <div className="p-3 border-b border-[#E4E4E7] bg-gray-50/50 space-y-2">
            {/* Agent-wise Filter */}
            <div>
              <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block mb-1">
                Filter by Agent
              </label>
              <select
                value={selectedAgentFilter}
                onChange={(e) => setSelectedAgentFilter(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold bg-white text-gray-800 cursor-pointer shadow-sm"
              >
                <option value="all">All Mapped Agents ({uniqueAgentNames.length})</option>
                {uniqueAgentNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {/* Date / Week-wise Filter */}
            <div>
              <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block mb-1">
                Filter by Week / Date
              </label>
              <select
                value={selectedWeekFilter}
                onChange={(e) => setSelectedWeekFilter(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold bg-white text-gray-800 cursor-pointer shadow-sm"
              >
                <option value="all">All Weeks ({uniqueWeeks.length})</option>
                {uniqueWeeks.map(wStart => {
                  const wEnd = new Date(wStart);
                  wEnd.setDate(wEnd.getDate() + 6);
                  return (
                    <option key={wStart} value={wStart}>
                      Week of {formatDate(wStart)}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        {/* Search Input */}
        <div className="p-2 border-b border-[#E4E4E7] bg-white">
          <input
            type="text"
            placeholder={role === 'agent' ? "Search by date..." : "Search by name or date..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium bg-gray-50 hover:bg-gray-100/50 transition-all text-gray-700 placeholder-gray-400"
          />
        </div>

        {/* List of Scorecards */}
        <nav className="flex-1 p-2 space-y-1">
          {filteredReports.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 font-medium">
              No matching scorecards found.
            </div>
          ) : (
            filteredReports.map((r) => {
              const isSelected = r.id === activeReportId;
              const isUnread = !r.viewed_at;
              const weekRange = `${formatDate(r.week_start)} - ${formatDate(r.week_end)}`;
              const score = r.generated?.numbers?.averageScore;

              return (
                <button
                  key={r.id}
                  onClick={() => setActiveReportId(r.id)}
                  className={`w-full text-left p-3 rounded-lg transition-all duration-200 flex items-center justify-between group ${
                    isSelected
                      ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 shadow-sm'
                      : 'hover:bg-gray-50 border border-transparent text-gray-700'
                  }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      {role !== 'agent' && r.agent_name && (
                        <span className="font-bold text-xs text-indigo-700 block truncate">
                          {r.agent_name}
                        </span>
                      )}
                      {isUnread && role === 'agent' && (
                        <span className="w-2 h-2 min-w-[8px] rounded-full bg-indigo-600 inline-block animate-pulse" title="New unread report" />
                      )}
                    </div>
                    <span className="text-xs text-gray-500 font-medium block mt-0.5 truncate">{weekRange}</span>
                  </div>
                  {score !== null && score !== undefined && (
                    <span className={`text-sm font-bold font-mono px-2 py-0.5 rounded-md ${
                      score >= 85 
                        ? 'bg-green-100 text-green-700 border border-green-200' 
                        : score >= 70 
                          ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                          : 'bg-red-100 text-red-700 border border-red-200'
                    }`}>
                      {score}%
                    </span>
                  )}
                </button>
              );
            })
          )}
        </nav>
      </aside>

      {/* Main Scorecard View */}
      <main className="flex-1 overflow-y-auto p-8 relative">
        {missingWeekAlert && (
          <div className="max-w-4xl mx-auto mb-6 bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3 shadow-sm animate-fade-in">
            <svg className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            <div className="text-sm">
              <span className="font-semibold block text-amber-900">
                Scorecard not generated for {missingWeekAlert.agent === agentName ? 'you' : missingWeekAlert.agent} for the week of {missingWeekAlert.weekRange}
              </span>
              <p className="text-amber-700/90 mt-1 font-medium leading-relaxed">
                Reason: {missingWeekAlert.agent === agentName ? 'You' : missingWeekAlert.agent} did not handle any evaluated chats closed during this period.
              </p>
            </div>
          </div>
        )}

        {activeReport && scorecard && (
          <div className="max-w-4xl mx-auto space-y-8">
            
            {/* Header info */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-[#E4E4E7]">
              <div>
                <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  IR Weekly Scorecard
                </h1>
                <p className="text-sm text-gray-500 font-medium mt-1">
                  Week of {formatDate(activeReport.week_start)} to {formatDate(activeReport.week_end)}
                </p>
                {role !== 'agent' && activeReport.agent_name && (
                  <p className="text-sm font-semibold text-indigo-700 mt-0.5 flex items-center gap-2">
                    <span>Agent: <strong>{activeReport.agent_name}</strong></span>
                  </p>
                )}
              </div>
              <div className="mt-4 md:mt-0 flex items-center gap-3">
                <span className="text-xs text-gray-400 font-medium font-mono">
                  Generated at {new Date(activeReport.generated_at).toLocaleString()}
                </span>
                {role === 'agent' ? (
                  <button
                    onClick={() => handleOpenComment('general', 'General Feedback')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 hover:border-indigo-500 hover:text-indigo-600 bg-white text-gray-600 text-xs font-semibold shadow-sm transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                    </svg>
                    Add General Note
                  </button>
                ) : (
                  <button
                    onClick={() => handleOpenTLNoteModal()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/>
                    </svg>
                    Add 1-on-1 Meeting Note
                  </button>
                )}
              </div>
            </div>

            {/* TL 1-on-1 Meeting Notes Section */}
            {(role !== 'agent' || (activeReport.tl_notes && activeReport.tl_notes.length > 0)) && (
              <div className="bg-indigo-50/40 border border-indigo-200/70 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-indigo-900 uppercase tracking-wider flex items-center gap-2">
                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                    1-on-1 Meeting Notes (TL Coaching Log)
                  </h3>
                  {role !== 'agent' && (
                    <button
                      onClick={() => handleOpenTLNoteModal()}
                      className="text-xs font-bold text-indigo-700 hover:text-indigo-900 hover:underline"
                    >
                      + Add Note
                    </button>
                  )}
                </div>

                {activeReport.tl_notes && activeReport.tl_notes.length > 0 ? (
                  <div className="space-y-3">
                    {activeReport.tl_notes.map((n) => (
                      <div key={n.id} className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-indigo-800">{n.author || 'Team Lead'}</span>
                            <span className="text-[10px] text-gray-400 font-mono">
                              {new Date(n.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-gray-800 font-medium leading-relaxed whitespace-pre-wrap">{n.text}</p>
                        </div>
                        {role !== 'agent' && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleOpenTLNoteModal(n)}
                              className="text-gray-400 hover:text-indigo-600 text-xs font-semibold"
                            >
                              Edit
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => handleDeleteTLNote(n.id)}
                              className="text-gray-400 hover:text-red-600 text-xs font-semibold"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-indigo-700/80 font-medium italic">
                    No 1-on-1 meeting notes recorded yet for this report.
                  </p>
                )}
              </div>
            )}

            {/* General Report Comments */}
            {renderCommentsForTarget('general', 'Agent Notes & Feedback')}

            {/* 1. Numbers Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">1</span>
                  The Numbers
                </h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                
                {/* Chats Handled */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Chats Handled</span>
                  <span className="text-2xl font-extrabold text-gray-900 font-mono mt-2">{numbers?.chatsHandled ?? 0}</span>
                </div>

                {/* Average score */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Avg IQS Score</span>
                  <span className={`text-2xl font-extrabold font-mono mt-2 ${
                    numbers?.averageScore !== null && numbers.averageScore >= 85 
                      ? 'text-green-600' 
                      : numbers?.averageScore !== null && numbers.averageScore >= 70 
                        ? 'text-amber-600' 
                        : 'text-red-600'
                  }`}>
                    {numbers?.averageScore != null ? `${numbers.averageScore}%` : '—'}
                  </span>
                </div>

                {/* Below 85 */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Below 85 Score</span>
                  <span className={`text-2xl font-extrabold font-mono mt-2 ${numbers?.below85Count > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                    {numbers?.below85Count ?? 0}
                  </span>
                </div>

                {/* CSAT Rating */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col col-span-2 justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">CSAT Metrics</span>
                  <span className="text-xs font-semibold text-gray-800 mt-3 bg-indigo-50 p-1.5 rounded-lg border border-indigo-100 text-center truncate" title={numbers?.csatText}>
                    {numbers?.csatText || 'no ratings'}
                  </span>
                </div>

                {/* Compliance Breaches */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Breaches</span>
                  <span className={`text-2xl font-extrabold font-mono mt-2 ${numbers?.complianceBreachesCount > 0 ? 'text-red-600 animate-pulse' : 'text-gray-900'}`}>
                    {numbers?.complianceBreachesCount ?? 0}
                  </span>
                </div>
              </div>
              
            </div>

            {/* 2. What Went Well */}
            <div className="bg-green-50/50 border border-green-200/80 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none transform translate-y-4 translate-x-2">
                <svg className="w-40 h-40 text-green-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26 6.91.97-5 4.89 1.18 6.88L12 17.77l-6.18 3.25L7 14.12 2 9.23l6.91-.97L12 2z"/>
                </svg>
              </div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-extrabold text-green-800 uppercase tracking-wider flex items-center gap-1.5">
                  <StarIcon /> What Went Well
                </h3>
              </div>
              <p className="text-green-950 font-bold text-base leading-relaxed">
                {scorecard?.whatWentWell}
              </p>
            </div>

            {/* 3. Discussion Points for 1-on-1 */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">2</span>
                  1-on-1 Discussion Points
                </h2>
              </div>

              {scorecard?.themes && scorecard.themes.length > 0 ? (
                <div className="space-y-4">
                  {scorecard.themes.map((theme: any, index: number) => {
                    return (
                      <div
                        key={index}
                        className={`bg-white rounded-2xl border shadow-sm p-6 space-y-4 transition-all hover:shadow-md ${
                          theme.isBreach ? 'border-red-200 bg-red-50/10' : 'border-[#E4E4E7]'
                        }`}
                      >
                        {/* Theme Header */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            {theme.isBreach && (
                              <span className="bg-red-100 text-red-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-red-200 tracking-wider">
                                Compliance Breach Root
                              </span>
                            )}
                            <h4 className="font-bold text-gray-900 text-base">
                              {theme.pattern}
                            </h4>
                          </div>
                        </div>

                        {/* Details */}
                        <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
                          <div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Why it Matters</span>
                            <p className="mt-1 text-gray-600 font-medium leading-relaxed">{theme.whyItMatters}</p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Actionable Behavior Change</span>
                            <p className="mt-1 text-gray-900 font-bold leading-relaxed">{theme.actionable}</p>
                          </div>
                        </div>

                        {/* Backing chats */}
                        <div className="pt-2 flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Evidence:</span>
                          {theme.backingChatIds?.map((cid: string) => (
                            <div key={cid} className="flex items-center bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold px-2 py-1 rounded-md border border-gray-200 font-mono transition-all">
                              <a href={`https://app.robylon.ai/unified-inbox/share/${cid}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                Chat #{cid}
                              </a>
                              <button
                                onClick={() => handleCopy(cid)}
                                className="ml-1.5 text-gray-400 hover:text-indigo-600"
                                title="Copy Chat ID"
                              >
                                {copiedId === cid ? (
                                  <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/>
                                  </svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3"/>
                                  </svg>
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                  🎉 Fantastic week! No low-scoring chat themes were identified. Keep up the excellent work!
                </div>
              )}
            </div>

            {/* 4. Compliance Breaches */}
            {scorecard?.breaches && scorecard.breaches.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">3</span>
                    Compliance Flags Surfaced
                  </h2>
                </div>
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-xs font-semibold leading-relaxed">
                  ⚠️ <strong>Note on compliance flags:</strong> These are flagged by the AI classifier for a human to review, not proven violations. The classifier over-fires on ordinary file sharing and Slack URLs.
                </div>

                <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                  <div className="divide-y divide-[#E4E4E7]">
                    {scorecard.breaches.map((breach: any, idx: number) => (
                      <div key={idx} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-gray-50 transition-all">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold px-2 py-0.5 rounded border border-gray-200 font-mono flex items-center gap-1 transition-all">
                              <a href={`https://app.robylon.ai/unified-inbox/share/${breach.chatId}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                Chat #{breach.chatId}
                              </a>
                              <button onClick={() => handleCopy(breach.chatId)} className="text-gray-400 hover:text-indigo-600">
                                {copiedId === breach.chatId ? '✓' : '📋'}
                              </button>
                            </span>
                            <span className="bg-red-50 text-red-700 text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-red-100">
                              Flagged
                            </span>
                            {breach.note && (
                              <span className="text-[10px] text-gray-400 font-medium">
                                {breach.note}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-mono text-gray-700 break-all bg-gray-50 p-2 rounded border border-gray-100 mt-2">
                            {breach.flaggedContent}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {breach.score !== null && (
                            <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">
                              IQS Score: {breach.score}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* 5. Full Evidence List */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    {scorecard?.breaches && scorecard.breaches.length > 0 ? 4 : 3}
                  </span>
                  Full Evidence List (Low-Scoring Chats)
                </h2>
              </div>

              {scorecard?.evidence && scorecard.evidence.length > 0 ? (
                <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-[#E4E4E7] text-xs text-gray-400 font-bold uppercase tracking-wider text-left">
                        <th className="p-4">Chat ID</th>
                        <th className="p-4 text-center">Score</th>
                        <th className="p-4">Topic / Disposition</th>
                        <th className="p-4">Primary Coaching Point / Issue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E4E7] text-sm text-gray-700">
                      {scorecard.evidence.map((ev: any, index: number) => (
                        <tr key={ev.chatId} className="hover:bg-gray-50 transition-all">
                          <td className="p-4 font-mono font-bold text-indigo-600 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <a href={`https://app.robylon.ai/unified-inbox/share/${ev.chatId}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                #{ev.chatId}
                              </a>
                              <button onClick={() => handleCopy(ev.chatId)} className="text-gray-400 hover:text-indigo-600">
                                {copiedId === ev.chatId ? '✓' : '📋'}
                              </button>
                            </div>
                          </td>
                          <td className="p-4 text-center whitespace-nowrap">
                            <span className={`text-xs font-extrabold font-mono px-2 py-0.5 rounded ${
                              ev.score >= 85 
                                ? 'bg-green-50 text-green-700 border border-green-200' 
                                : ev.score >= 70 
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                                  : 'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              {ev.score}%
                            </span>
                          </td>
                          <td className="p-4 font-semibold text-gray-800 whitespace-nowrap">
                            {ev.topic}
                          </td>
                          <td className="p-4 text-gray-600 font-medium">
                            {ev.summary}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                  No low-scoring chats to display this week. Excellent!
                </div>
              )}
            </div>

          </div>
        )}
      </main>

      {/* Floating Comment Modal Dialog (Agent Notes) */}
      {commentTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-gray-800 text-sm tracking-wide uppercase">
                {editingCommentId ? 'Edit Notes / Flag' : 'Add Note / Flag'}
              </h3>
              <button
                onClick={() => {
                  setCommentTarget(null);
                  setCommentText('');
                  setIsHighlighted(false);
                  setEditingCommentId(null);
                }}
                className="text-gray-400 hover:text-gray-700 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <div>
              <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider block">Target Section</span>
              <span className="text-xs font-semibold text-gray-800 mt-1 block">
                {commentTarget.label}
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">My Comment / Note</label>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Type your notes here. Describe what happened so you can discuss it with your TL..."
                rows={4}
                className="w-full p-3 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-gray-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="highlight-check"
                checked={isHighlighted}
                onChange={(e) => setIsHighlighted(e.target.checked)}
                className="w-4 h-4 rounded text-amber-600 border-gray-300 focus:ring-amber-500"
              />
              <label htmlFor="highlight-check" className="text-xs font-bold text-amber-800 cursor-pointer select-none">
                💡 Highlight / Flag this for 1-on-1 discussion
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setCommentTarget(null);
                  setCommentText('');
                  setIsHighlighted(false);
                  setEditingCommentId(null);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-bold rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveComment}
                disabled={!commentText.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-indigo-300 text-xs font-bold rounded-lg shadow-sm transition-all"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating TL 1-on-1 Meeting Note Modal */}
      {showTLNoteModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-indigo-900 text-sm tracking-wide uppercase">
                {editingTLNoteId ? 'Edit 1-on-1 Meeting Note' : 'Add 1-on-1 Meeting Note'}
              </h3>
              <button
                onClick={() => {
                  setShowTLNoteModal(false);
                  setTLNoteText('');
                  setEditingTLNoteId(null);
                }}
                className="text-gray-400 hover:text-gray-700 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <div>
              <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider block">Agent</span>
              <span className="text-xs font-semibold text-gray-800 mt-0.5 block">
                {activeReport?.agent_name} (Week of {activeReport ? formatDate(activeReport.week_start) : ''})
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">TL 1-on-1 Meeting Notes / Action Items</label>
              <textarea
                value={tlNoteText}
                onChange={(e) => setTLNoteText(e.target.value)}
                placeholder="Log discussion points, feedback given, goals set, or action items for next week's 1-on-1 meeting..."
                rows={5}
                className="w-full p-3 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm text-gray-700 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowTLNoteModal(false);
                  setTLNoteText('');
                  setEditingTLNoteId(null);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-bold rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTLNote}
                disabled={!tlNoteText.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-indigo-300 text-xs font-bold rounded-lg shadow-sm transition-all"
              >
                Save 1-on-1 Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Helper to render comments for a specific target key
  function renderCommentsForTarget(targetKey: string, headerText?: string) {
    if (!activeReport) return null;
    const targetComments = (activeReport.comments || []).filter(c => c.targetKey === targetKey);
    if (targetComments.length === 0) return null;

    return (
      <div className="mt-2 space-y-2">
        {headerText && (
          <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">
            {headerText}
          </span>
        )}
        {targetComments.map(c => (
          <div
            key={c.id}
            className={`p-4 rounded-xl border text-sm flex items-start justify-between gap-4 transition-all ${
              c.highlighted
                ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm'
                : 'bg-gray-50 border-gray-200 text-gray-700'
            }`}
          >
            <div className="space-y-1">
              {c.highlighted && (
                <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-amber-200 tracking-wider">
                  Highlighted for 1-on-1
                </span>
              )}
              <p className="font-semibold text-xs leading-relaxed whitespace-pre-wrap">{c.text}</p>
              <span className="text-[10px] text-gray-400 font-medium font-mono block">
                {new Date(c.createdAt).toLocaleString()}
              </span>
            </div>
            {role === 'agent' && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleOpenComment(c.targetKey, commentTarget?.label || 'Edit Note', c)}
                  className="text-gray-400 hover:text-indigo-600 text-xs font-semibold"
                >
                  Edit
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => handleDeleteComment(c.id)}
                  className="text-gray-400 hover:text-red-600 text-xs font-semibold"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
}
