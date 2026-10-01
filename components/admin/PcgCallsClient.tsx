'use client';

import React, { useEffect, useState, useRef } from 'react';

interface PCGCall {
  id: string;
  callId: string;
  agentName: string;
  phoneNumber: string;
  callType: string;
  tag: string | null;
  durationSeconds: number;
  startTime: string | null;
  hasRecording: boolean;
}

interface AgentOption {
  name: string;
  count: number;
}

interface SummaryMetrics {
  totalCalls: number;
  totalDurationSeconds: number;
  activeAgentsCount: number;
}

export default function PcgCallsClient() {
  const [calls, setCalls] = useState<PCGCall[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedAgent, setSelectedAgent] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Audio Playback state
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  useEffect(() => {
    fetchCalls();
  }, [selectedAgent, page]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchCalls();
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchCalls = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '15',
      });
      if (selectedAgent && selectedAgent !== 'all') {
        params.set('agent_name', selectedAgent);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/admin/pcg-calls?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to load PCG calls data');
      }
      const data = await res.json();
      setCalls(data.calls || []);
      setAgents(data.agents || []);
      setSummary(data.summary || null);
      setTotalPages(data.totalPages || 1);
      setTotalCount(data.total || 0);
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching PCG calls');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAudio = (callId: string) => {
    // Pause any other currently playing audio
    if (currentlyPlayingId && currentlyPlayingId !== callId) {
      const prevAudio = audioRefs.current[currentlyPlayingId];
      if (prevAudio) {
        prevAudio.pause();
      }
    }
    setCurrentlyPlayingId(callId);
  };

  const formatDuration = (secs: number) => {
    if (!secs || secs <= 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatHoursMinutes = (secs: number) => {
    if (!secs || secs <= 0) return '0m';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return 'N/A';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold text-lg">
              📞
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">PCG Call Recordings</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Admin view to review complete calls handled by PCG Team agents
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-amber-500/10 text-amber-600 text-xs font-semibold rounded-full border border-amber-500/20">
            🔒 Admin View Only
          </span>
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 text-xs font-semibold rounded-full border border-emerald-500/20">
            Audio Stream Verified
          </span>
        </div>
      </div>

      {/* Summary Stat Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Complete Calls</div>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
              {summary.totalCalls}
            </div>
            <p className="text-xs text-slate-500 mt-1">Calls with verified recording & duration</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Audio Duration</div>
            <div className="text-3xl font-extrabold text-blue-600 dark:text-blue-400 mt-1">
              {formatHoursMinutes(summary.totalDurationSeconds)}
            </div>
            <p className="text-xs text-slate-500 mt-1">Combined call recording time</p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active PCG Agents</div>
            <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
              {summary.activeAgentsCount}
            </div>
            <p className="text-xs text-slate-500 mt-1">Agents with completed calls</p>
          </div>
        </div>
      )}

      {/* Controls & Filters Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          {/* Agent Filter */}
          <div className="w-full sm:w-64">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Filter by Agent</label>
            <select
              value={selectedAgent}
              onChange={(e) => {
                setSelectedAgent(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Agents ({agents.reduce((acc, a) => acc + a.count, 0)})</option>
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.count} calls)
                </option>
              ))}
            </select>
          </div>

          {/* Search Filter */}
          <div className="w-full sm:w-72">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Search Phone / Call ID</label>
            <input
              type="text"
              placeholder="Search phone (+91...) or call ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing <span className="font-semibold text-slate-800 dark:text-white">{calls.length}</span> of{' '}
          <span className="font-semibold text-slate-800 dark:text-white">{totalCount}</span> calls
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Call Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <div className="inline-block animate-spin text-2xl">⏳</div>
            <p className="text-sm font-medium">Loading PCG Call Recordings...</p>
          </div>
        ) : calls.length === 0 ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            <p className="text-base font-semibold">No complete call recordings found</p>
            <p className="text-xs mt-1 text-slate-400">Try changing your agent filter or search query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4">Agent Name</th>
                  <th className="py-3.5 px-4">Customer Phone</th>
                  <th className="py-3.5 px-4">Call Type</th>
                  <th className="py-3.5 px-4">Date & Time</th>
                  <th className="py-3.5 px-4">Duration</th>
                  <th className="py-3.5 px-4 text-center">Audio Recording Player</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 dark:divide-slate-700/60 text-slate-700 dark:text-slate-200">
                {calls.map((call) => (
                  <tr
                    key={call.id}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors ${
                      currentlyPlayingId === call.id ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                    }`}
                  >
                    {/* Agent Name */}
                    <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs">
                          {call.agentName ? call.agentName.charAt(0).toUpperCase() : '?'}
                        </span>
                        <span>{call.agentName}</span>
                      </div>
                    </td>

                    {/* Customer Phone */}
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-300">
                      {call.phoneNumber}
                    </td>

                    {/* Call Type */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          call.callType === 'incoming'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        {call.callType === 'incoming' ? '📥 Incoming' : '📤 Outgoing'}
                      </span>
                    </td>

                    {/* Start Time */}
                    <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(call.startTime)}
                    </td>

                    {/* Duration */}
                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                      ⏱️ {formatDuration(call.durationSeconds)}
                    </td>

                    {/* Audio Player */}
                    <td className="py-3.5 px-4 min-w-[280px]">
                      <div className="flex items-center justify-center">
                        <audio
                          ref={(el) => { audioRefs.current[call.id] = el; }}
                          controls
                          controlsList="nodownload"
                          preload="none"
                          onPlay={() => handlePlayAudio(call.id)}
                          src={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(call.id)}`}
                          className="h-9 w-full max-w-[260px] rounded-lg accent-blue-600 shadow-sm"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page <span className="font-semibold text-slate-800 dark:text-white">{page}</span> of{' '}
              <span className="font-semibold text-slate-800 dark:text-white">{totalPages}</span>
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
