'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface User { username: string; password: string; }

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [vercelEnv, setVercelEnv] = useState<Record<string, string> | null>(null);

  const [geminiKey, setGeminiKey] = useState('');
  const [urls, setUrls] = useState<string[]>(['']);
  const [users, setUsers] = useState<User[]>([{ username: '', password: '' }]);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => {
      if (data.geminiApiKey) setGeminiKey(data.geminiApiKey);
      if (data.knowledgeBaseUrls?.length) setUrls(data.knowledgeBaseUrls);
      if (data.users?.length) setUsers(data.users);
    }).catch(() => {});
  }, []);

  const addUrl = () => setUrls([...urls, '']);
  const removeUrl = (i: number) => setUrls(urls.filter((_, idx) => idx !== i));
  const updateUrl = (i: number, val: string) => setUrls(urls.map((u, idx) => idx === i ? val : u));
  const addUser = () => setUsers([...users, { username: '', password: '' }]);
  const removeUser = (i: number) => setUsers(users.filter((_, idx) => idx !== i));
  const updateUser = (i: number, field: keyof User, val: string) =>
    setUsers(users.map((u, idx) => idx === i ? { ...u, [field]: val } : u));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiApiKey: geminiKey,
          knowledgeBaseUrls: urls.filter(u => u.trim()),
          users: users.filter(u => u.username.trim() && u.password.trim()),
        }),
      });
      const data = await res.json();
      
      if (data.vercel) {
        // On Vercel - show CLI commands
        setVercelEnv(data.env);
      } else if (data.success) {
        setTimeout(() => router.push('/login'), 1000);
      } else {
        setError('Failed to save. Please try again.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    { num: 1, label: 'Gemini API' },
    { num: 2, label: 'Knowledge Base' },
    { num: 3, label: 'IR Users' },
  ];

  // Vercel instructions screen
  if (vercelEnv) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-3 mb-3">
              <svg width="36" height="28" viewBox="0 0 40 32" fill="none">
                <rect x="0" y="12" width="12" height="20" fill="#2d9e4f" rx="1"/>
                <rect x="14" y="6" width="12" height="26" fill="#2d9e4f" rx="1"/>
                <rect x="28" y="0" width="12" height="32" fill="#2d9e4f" rx="1"/>
              </svg>
              <span className="text-2xl font-bold text-[#1a1a1a]">wint</span>
            </div>
            <h1 className="text-xl font-semibold text-[#1a1a1a]">One Last Step!</h1>
            <p className="text-gray-500 text-sm mt-1">Run these 4 commands in your Terminal to save config to Vercel, then redeploy.</p>
          </div>
          <div className="bg-[#1a1a1a] rounded-2xl p-6 space-y-4">
            {Object.entries(vercelEnv).map(([key, value]) => (
              <div key={key}>
                <p className="text-gray-400 text-xs mb-1">Copy & paste in Terminal:</p>
                <div className="bg-black rounded-lg px-4 py-3 flex items-center justify-between gap-3">
                  <code className="text-green-400 text-xs break-all">
                    vercel env add {key} production
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(`vercel env add ${key} production`)}
                    className="text-gray-500 hover:text-white shrink-0 text-xs border border-gray-700 rounded px-2 py-1"
                  >
                    Copy
                  </button>
                </div>
                <div className="bg-black/50 rounded-lg px-4 py-2 mt-1 flex items-center justify-between gap-3">
                  <code className="text-yellow-400 text-xs break-all">Value → {value.length > 60 ? value.slice(0, 60) + '...' : value}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(value)}
                    className="text-gray-500 hover:text-white shrink-0 text-xs border border-gray-700 rounded px-2 py-1"
                  >
                    Copy value
                  </button>
                </div>
              </div>
            ))}
            <div className="border-t border-white/10 pt-4">
              <p className="text-gray-400 text-xs mb-2">Finally, redeploy:</p>
              <div className="bg-black rounded-lg px-4 py-3 flex items-center justify-between">
                <code className="text-green-400 text-xs">vercel --prod</code>
                <button
                  onClick={() => navigator.clipboard.writeText('vercel --prod')}
                  className="text-gray-500 hover:text-white text-xs border border-gray-700 rounded px-2 py-1"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-gray-400 mt-4">
            After redeploying, your portal will be fully live at your Vercel URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <svg width="36" height="28" viewBox="0 0 40 32" fill="none">
              <rect x="0" y="12" width="12" height="20" fill="#2d9e4f" rx="1"/>
              <rect x="14" y="6" width="12" height="26" fill="#2d9e4f" rx="1"/>
              <rect x="28" y="0" width="12" height="32" fill="#2d9e4f" rx="1"/>
            </svg>
            <span className="text-2xl font-bold text-[#1a1a1a]">wint</span>
          </div>
          <h1 className="text-xl font-semibold text-[#1a1a1a]">IR Portal Setup</h1>
          <p className="text-gray-500 text-sm mt-1">Configure your portal in 3 steps</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <button
                onClick={() => setStep(s.num)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  step === s.num ? 'bg-[#2d9e4f] text-white' : step > s.num ? 'bg-[#2d9e4f]/20 text-[#2d9e4f]' : 'bg-gray-100 text-gray-400'
                }`}
              >
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs">
                  {step > s.num ? '✓' : s.num}
                </span>
                {s.label}
              </button>
              {i < steps.length - 1 && <div className={`w-8 h-0.5 ${step > s.num ? 'bg-[#2d9e4f]' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold text-[#1a1a1a] mb-1">Gemini API Key</h2>
              <p className="text-gray-500 text-sm mb-6">
                Get your free API key from{' '}
                <a href="https://aistudio.google.com" target="_blank" className="text-[#2d9e4f] hover:underline">aistudio.google.com</a>
                {' '}→ Get API Key → Create API key
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
              <input
                type="password"
                value={geminiKey}
                onChange={e => setGeminiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent"
              />
              <button onClick={() => setStep(2)} disabled={!geminiKey.trim()}
                className="mt-6 w-full bg-[#2d9e4f] hover:bg-[#27883f] disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                Next →
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold text-[#1a1a1a] mb-1">Knowledge Base Documents</h2>
              <p className="text-gray-500 text-sm mb-2">Paste links to your Google Docs. Make sure each is set to <strong>"Anyone with the link can view"</strong>.</p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-5 text-xs text-amber-700">
                💡 In Google Drive: Right-click doc → Share → "Anyone with the link" → Viewer → Copy link
              </div>
              <div className="space-y-2">
                {urls.map((url, i) => (
                  <div key={i} className="flex gap-2">
                    <input type="url" value={url} onChange={e => updateUrl(i, e.target.value)}
                      placeholder="https://docs.google.com/document/d/..."
                      className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent" />
                    {urls.length > 1 && <button onClick={() => removeUrl(i)} className="text-red-400 hover:text-red-600 px-2 text-lg">×</button>}
                  </div>
                ))}
              </div>
              <button onClick={addUrl} className="mt-3 text-[#2d9e4f] text-sm hover:underline">+ Add another document</button>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(1)} className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">← Back</button>
                <button onClick={() => setStep(3)} disabled={!urls.some(u => u.trim())}
                  className="flex-1 bg-[#2d9e4f] hover:bg-[#27883f] disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">Next →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold text-[#1a1a1a] mb-1">IR Portal Users</h2>
              <p className="text-gray-500 text-sm mb-5">Add login credentials for investors and analysts.</p>
              <div className="space-y-3">
                {users.map((user, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input type="text" value={user.username} onChange={e => updateUser(i, 'username', e.target.value)}
                      placeholder="Username"
                      className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent" />
                    <input type="password" value={user.password} onChange={e => updateUser(i, 'password', e.target.value)}
                      placeholder="Password"
                      className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent" />
                    {users.length > 1 && <button onClick={() => removeUser(i)} className="text-red-400 hover:text-red-600 text-lg px-1">×</button>}
                  </div>
                ))}
              </div>
              <button onClick={addUser} className="mt-3 text-[#2d9e4f] text-sm hover:underline">+ Add another user</button>
              {error && <div className="mt-4 bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2.5 rounded-xl">{error}</div>}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(2)} className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">← Back</button>
                <button onClick={handleSave} disabled={saving || !users.some(u => u.username.trim() && u.password.trim())}
                  className="flex-1 bg-[#2d9e4f] hover:bg-[#27883f] disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                  {saving ? 'Saving...' : '✓ Save & Launch Portal'}
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">You can update these settings anytime from the portal sidebar.</p>
      </div>
    </div>
  );
}
