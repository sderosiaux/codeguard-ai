import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProfileMenu from '../components/ProfileMenu';
import {
  Shield,
  Key,
  ArrowLeft,
  BookOpen,
  Users,
  Settings,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { GeneralTab } from '../components/settings/GeneralTab';
import { TokensTab } from '../components/settings/TokensTab';
import { MembersTab } from '../components/settings/MembersTab';

type TabType = 'general' | 'tokens' | 'members';

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'tokens' || tab === 'members' || tab === 'general') return tab;
    return 'general';
  });

  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'tokens' || tab === 'members' || tab === 'general') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-emerald-200/40 rounded-full blur-[120px] animate-pulse-subtle" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-emerald-200/30 rounded-full blur-[100px] animate-pulse-subtle" style={{ animationDelay: '1s' }} />
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage: `linear-gradient(rgb(16 185 129 / 0.03) 1px, transparent 1px), linear-gradient(90deg, rgb(16 185 129 / 0.03) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-50 bg-white/70 backdrop-blur-md border-b border-gray-200/50 sticky top-0">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link to="/app" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <div className="relative">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                </div>
                <span className="text-xl font-bold tracking-tight text-gray-900">
                  CodeGuard<span className="text-emerald-600">AI</span>
                </span>
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <Link
                to="/app"
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <a
                href="/docs"
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                Docs
              </a>
              <ProfileMenu />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">Manage your workspace, API tokens, and team members</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-6 w-fit">
          <button
            onClick={() => handleTabChange('general')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'general'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            General
          </button>
          <button
            onClick={() => handleTabChange('tokens')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'tokens'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Key className="w-4 h-4" />
            API Tokens
          </button>
          <button
            onClick={() => handleTabChange('members')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'members'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Users className="w-4 h-4" />
            Members
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'tokens' && <TokensTab />}
        {activeTab === 'members' && <MembersTab />}
      </main>
    </div>
  );
}
