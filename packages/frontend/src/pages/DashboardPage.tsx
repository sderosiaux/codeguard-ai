import { useState, useEffect } from 'react';
import { useRepos } from '../hooks/useApi';
import RepoCard from '../components/RepoCard';
import AddRepoDialog from '../components/AddRepoDialog';
import StatsOverview from '../components/StatsOverview';
import { Button } from '../components/ui/Button';
import {
  Shield,
  Plus,
  Github,
  Scan,
  Lock,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  BookOpen,
} from 'lucide-react';

export default function DashboardPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const { data: repos, isLoading, error, refetch } = useRepos();
  const [scanProgress, setScanProgress] = useState(0);

  // Animated scan progress for hero
  useEffect(() => {
    const interval = setInterval(() => {
      setScanProgress((prev) => (prev >= 100 ? 0 : prev + 1));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Poll for status updates
  useEffect(() => {
    const hasAnalyzingRepos = repos?.some(
      (repo) =>
        repo.status === 'pending' ||
        repo.status === 'cloning' ||
        repo.status === 'analyzing'
    );

    if (hasAnalyzingRepos) {
      const interval = setInterval(() => refetch(), 2000);
      return () => clearInterval(interval);
    }
  }, [repos, refetch]);

  // Calculate stats
  const stats = repos?.reduce(
    (acc, repo) => {
      const counts = repo.issueCounts || { critical: 0, high: 0, medium: 0, low: 0 };
      return {
        total: acc.total + counts.critical + counts.high + counts.medium + counts.low,
        critical: acc.critical + counts.critical,
        high: acc.high + counts.high,
        medium: acc.medium + counts.medium,
        low: acc.low + counts.low,
        repos: acc.repos + 1,
      };
    },
    { total: 0, critical: 0, high: 0, medium: 0, low: 0, repos: 0 }
  ) || { total: 0, critical: 0, high: 0, medium: 0, low: 0, repos: 0 };

  const hasRepos = repos && repos.length > 0;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Gradient orbs - light version */}
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-emerald-200/40 rounded-full blur-[120px] animate-pulse-subtle" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-emerald-200/30 rounded-full blur-[100px] animate-pulse-subtle" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] bg-teal-100/40 rounded-full blur-[80px] animate-pulse-subtle" style={{ animationDelay: '2s' }} />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage: `linear-gradient(rgb(16 185 129 / 0.03) 1px, transparent 1px), linear-gradient(90deg, rgb(16 185 129 / 0.03) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />

        {/* Floating particles */}
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 bg-emerald-400/20 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${5 + Math.random() * 10}s`,
            }}
          />
        ))}
      </div>

      {/* Header */}
      <header className="relative z-10 bg-white/70 backdrop-blur-md border-b border-gray-200/50 sticky top-0">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="/app" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-ping" />
              </div>
              <span className="text-xl font-bold tracking-tight text-gray-900">
                CodeGuard<span className="text-emerald-600">AI</span>
              </span>
            </a>

            <div className="flex items-center gap-3">
              <a
                href="/docs"
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                Docs
              </a>
              {hasRepos && (
                <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add Repository
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div className="relative">
              <div className="w-16 h-16 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
              <Shield className="absolute inset-0 m-auto w-6 h-6 text-brand-500" />
            </div>
            <p className="mt-6 text-gray-500">Initializing security scanner...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div className="w-20 h-20 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mb-6">
              <AlertTriangle className="w-10 h-10 text-red-500" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Error</h2>
            <p className="text-gray-500 mb-6">{(error as Error).message}</p>
            <Button onClick={() => refetch()} variant="outline">
              Retry Connection
            </Button>
          </div>
        )}

        {/* Empty State - Onboarding Hero */}
        {!isLoading && !error && repos && repos.length === 0 && (
          <div className="max-w-6xl mx-auto px-6 lg:px-8 py-16">
            {/* Hero Section */}
            <div className="text-center mb-16">
              {/* Animated Shield */}
              <div className="relative inline-flex mb-8">
                <div className="relative">
                  {/* Outer ring */}
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-300/50 animate-ping" style={{ animationDuration: '3s' }} />
                  {/* Shield container */}
                  <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 border-2 border-emerald-200 flex items-center justify-center shadow-xl shadow-emerald-500/10">
                    <Shield className="w-16 h-16 text-emerald-500" />
                    {/* Scan line */}
                    <div
                      className="absolute inset-0 rounded-full overflow-hidden"
                      style={{
                        background: `linear-gradient(180deg, transparent ${scanProgress}%, rgba(16, 185, 129, 0.15) ${scanProgress}%, rgba(16, 185, 129, 0.15) ${scanProgress + 2}%, transparent ${scanProgress + 2}%)`,
                      }}
                    />
                  </div>
                  {/* Floating icons */}
                  <div className="absolute -top-2 -right-2 w-10 h-10 rounded-xl bg-white border border-gray-200 shadow-lg flex items-center justify-center animate-bounce" style={{ animationDuration: '2s' }}>
                    <Lock className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div className="absolute -bottom-2 -left-2 w-10 h-10 rounded-xl bg-white border border-gray-200 shadow-lg flex items-center justify-center animate-bounce" style={{ animationDuration: '2.5s' }}>
                    <Scan className="w-5 h-5 text-emerald-500" />
                  </div>
                </div>
              </div>

              {/* Headline */}
              <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
                <span className="bg-gradient-to-r from-gray-900 via-gray-700 to-gray-500 bg-clip-text text-transparent">
                  AI-Powered
                </span>
                <br />
                <span className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 bg-clip-text text-transparent">
                  Code Security
                </span>
              </h1>

              <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
                Deep vulnerability scanning powered by Claude AI. Find security flaws,
                reliability issues, and get actionable fixes in minutes.
              </p>

              {/* CTA */}
              <Button
                onClick={() => setIsAddDialogOpen(true)}
                size="lg"
                className="gap-3 text-lg px-8 py-4 shadow-xl shadow-brand-500/25 hover:shadow-brand-500/40 transition-all duration-300 hover:scale-105"
              >
                <Github className="w-6 h-6" />
                Connect Repository
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>

            {/* Onboarding Steps */}
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-8">
                <span className="text-sm font-medium text-brand-600 uppercase tracking-wider">How it works</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  {
                    step: '01',
                    icon: Github,
                    title: 'Connect',
                    description: 'Paste your GitHub repository URL',
                    gradient: 'from-blue-500 to-cyan-500',
                    bg: 'bg-blue-50',
                    iconColor: 'text-blue-500',
                  },
                  {
                    step: '02',
                    icon: Scan,
                    title: 'Analyze',
                    description: 'AI scans every file for vulnerabilities',
                    gradient: 'from-emerald-500 to-teal-500',
                    bg: 'bg-emerald-50',
                    iconColor: 'text-emerald-500',
                  },
                  {
                    step: '03',
                    icon: CheckCircle2,
                    title: 'Fix',
                    description: 'Get prioritized issues with remediation',
                    gradient: 'from-emerald-500 to-teal-500',
                    bg: 'bg-emerald-50',
                    iconColor: 'text-emerald-500',
                  },
                ].map((item, index) => (
                  <div key={item.step} className="group relative">
                    {/* Connection line */}
                    {index < 2 && (
                      <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-gradient-to-r from-gray-200 to-transparent" />
                    )}

                    <div className="relative p-6 rounded-2xl bg-white border border-gray-200 shadow-sm hover:shadow-xl hover:border-gray-300 transition-all duration-300 hover:transform hover:scale-105 hover:-translate-y-1">
                      {/* Step number */}
                      <div className="absolute -top-3 -left-3 w-8 h-8 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center">
                        <span className="text-xs font-bold text-gray-400">{item.step}</span>
                      </div>

                      {/* Icon */}
                      <div className={`w-14 h-14 rounded-xl ${item.bg} flex items-center justify-center mb-4`}>
                        <item.icon className={`w-7 h-7 ${item.iconColor}`} />
                      </div>

                      <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.title}</h3>
                      <p className="text-sm text-gray-500">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Terminal Preview */}
            <div className="mt-16 max-w-3xl mx-auto">
              <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-2xl shadow-gray-200/50 bg-white">
                {/* Terminal header */}
                <div className="bg-gray-100 px-4 py-3 flex items-center gap-2 border-b border-gray-200">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 text-center">
                    <span className="text-xs text-gray-500 font-mono">codeguard-ai — security-scan</span>
                  </div>
                </div>

                {/* Terminal content */}
                <div className="bg-gray-900 p-5 font-mono text-sm">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-brand-400">$</span>
                      <span className="text-gray-300">codeguard scan github.com/your-repo</span>
                      <span className="text-brand-400 animate-pulse">▋</span>
                    </div>
                    <div className="text-gray-500">
                      <span className="text-brand-400">→</span> Cloning repository...
                    </div>
                    <div className="text-gray-500">
                      <span className="text-brand-400">→</span> Running AI security analysis...
                    </div>
                    <div className="text-gray-400">
                      <span className="text-emerald-400">✓</span> Found <span className="text-red-400">3 critical</span>, <span className="text-orange-400">5 high</span>, <span className="text-yellow-400">12 medium</span> issues
                    </div>
                    <div className="pt-2 border-t border-gray-700 mt-2">
                      <span className="text-gray-500"># View detailed report at</span>
                      <span className="text-brand-400"> localhost:5173/repos/1</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Dashboard with Repos */}
        {!isLoading && !error && hasRepos && (
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8">
            {/* Stats Overview Card */}
            <div className="mb-8">
              <StatsOverview
                title="Security Overview"
                subtitle={
                  stats.total > 0
                    ? `${stats.total} issues found across ${stats.repos} ${stats.repos === 1 ? 'repository' : 'repositories'}`
                    : 'All repositories are secure'
                }
                stats={stats}
                reposCount={stats.repos}
              />
            </div>

            {/* Section Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Your Repositories</h2>
            </div>

            {/* Repository Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {repos.map((repo, index) => (
                <div
                  key={repo.id}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
                >
                  <RepoCard repo={repo} />
                </div>
              ))}

              {/* Add New Card */}
              <button
                onClick={() => setIsAddDialogOpen(true)}
                className="group min-h-[200px] rounded-xl border-2 border-dashed border-gray-200 hover:border-emerald-300 bg-white/50 hover:bg-emerald-50/50 flex flex-col items-center justify-center gap-3 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gray-100 group-hover:bg-emerald-100 border border-gray-200 group-hover:border-emerald-200 flex items-center justify-center transition-all duration-300">
                  <Plus className="w-6 h-6 text-gray-400 group-hover:text-emerald-500" />
                </div>
                <span className="text-sm text-gray-500 group-hover:text-emerald-600 font-medium">Add Repository</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Add Dialog */}
      <AddRepoDialog open={isAddDialogOpen} onClose={() => setIsAddDialogOpen(false)} />
    </div>
  );
}
