'use client';

import { useState, useEffect } from 'react';
import { Agent, AgentStats } from '@/lib/supabase';

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);

  // Fetch stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setLastQuery(query);
    setAgents([]);
    setCsvData(null);
    setBatchId(null);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Query failed');
        return;
      }

      setAgents(data.agents || []);
      setCsvData(data.csv);
      setBatchId(data.batch_id);
      
      // Refresh stats
      fetchStats();
    } catch (err) {
      console.error('Query error:', err);
      setError('Failed to execute query');
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    if (!csvData) return;
    
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agents-${batchId || 'export'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Final Expense Agent Pipeline
          </h1>
          <p className="mt-2 text-gray-600">
            Query independent insurance agents with direct-dial phone numbers
          </p>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">Total Agents</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats?.total_agents?.toLocaleString() || '—'}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">Delivered</div>
              <div className="text-2xl font-bold text-green-600">
                {stats?.total_delivered?.toLocaleString() || '—'}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">Remaining</div>
              <div className="text-2xl font-bold text-blue-600">
                {stats?.remaining?.toLocaleString() || '—'}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">Cap Usage</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats?.global_cap?.usage_percent || 0}%
              </div>
              <div className="text-xs text-gray-500">
                of {stats?.global_cap?.limit?.toLocaleString() || 20000}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Query Form */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Ask for a list of agents
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="query" className="sr-only">
                Query
              </label>
              <input
                id="query"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g., give me 5,000 Texas agents I haven't gotten yet, another 20k across all three states, no dupes"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Try: "give me 5,000 Texas agents", "another 20k across TX, FL, GA", "just Houston"
              </p>
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-8">
            {error}
          </div>
        )}

        {/* Results */}
        {lastQuery && (
          <div className="bg-white rounded-xl shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Results for: "{lastQuery}"
                </h3>
                <p className="text-sm text-gray-500">
                  {agents.length} agents found
                  {batchId && <span className="ml-2">Batch ID: {batchId.slice(0, 8)}...</span>}
                </p>
              </div>
              {csvData && (
                <button
                  onClick={downloadCSV}
                  className="px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors"
                >
                  Export CSV
                </button>
              )}
            </div>

            {/* Table */}
            {agents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Phone
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Location
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Source
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {agents.slice(0, 100).map((agent) => (
                      <tr key={agent.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">
                            {agent.full_name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <a
                            href={`tel:${agent.phone_e164 || agent.phone}`}
                            className="text-blue-600 hover:text-blue-800 font-mono"
                          >
                            {agent.phone || agent.phone_e164 || 'N/A'}
                          </a>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                          {agent.email || '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                          {agent.city}, {agent.state} {agent.zip}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {agent.sources?.[0] || 'Unknown'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {agents.length > 100 && (
                  <div className="px-6 py-4 text-center text-gray-500 border-t border-gray-200">
                    Showing first 100 of {agents.length} results. Download CSV for full data.
                  </div>
                )}
              </div>
            ) : !loading && !error && (
              <div className="px-6 py-12 text-center text-gray-500">
                No agents found matching your criteria
              </div>
            )}
          </div>
        )}

        {/* State Breakdown */}
        {stats?.by_state && Object.keys(stats.by_state).length > 0 && (
          <div className="mt-8 bg-white rounded-xl shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Agents by State</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Object.entries(stats.by_state)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([state, data]) => (
                  <div key={state} className="bg-gray-50 rounded-lg p-4">
                    <div className="text-lg font-bold text-gray-900">{state}</div>
                    <div className="text-sm text-gray-500 mt-1">
                      <div>Total: {data.total}</div>
                      <div>Remaining: {data.remaining}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
