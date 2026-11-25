import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/layout/Layout';
import { LoginPage } from '@/features/auth/LoginPage';
import { ToastProvider } from '@/components/ui/Toast';
import '@/index.css';

// Route-level code splitting keeps heavy chart pages (Recharts) out of the initial bundle.
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage'));
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const CandidateListPage = lazy(() =>
  import('@/features/candidates/CandidateListPage').then((m) => ({ default: m.CandidateListPage }))
);
const CandidateDetailPage = lazy(() =>
  import('@/features/candidates/CandidateDetailPage').then((m) => ({ default: m.CandidateDetailPage }))
);
const CriteriaPage = lazy(() =>
  import('@/features/criteria/CriteriaPage').then((m) => ({ default: m.CriteriaPage }))
);
const AssessmentOverviewPage = lazy(() =>
  import('@/features/assessments').then((m) => ({ default: m.AssessmentOverviewPage }))
);
const AssessmentInputPage = lazy(() =>
  import('@/features/assessments').then((m) => ({ default: m.AssessmentInputPage }))
);
const TopsisResultsPage = lazy(() =>
  import('@/features/results').then((m) => ({ default: m.TopsisResultsPage }))
);
const BordaResultsPage = lazy(() =>
  import('@/features/results').then((m) => ({ default: m.BordaResultsPage }))
);
const VotingPage = lazy(() =>
  import('@/features/voting/VotingPage').then((m) => ({ default: m.VotingPage }))
);
const VotingResultsPage = lazy(() =>
  import('@/features/voting/VotingResultsPage').then((m) => ({ default: m.VotingResultsPage }))
);
const RevotePage = lazy(() =>
  import('@/features/voting/RevotePage').then((m) => ({ default: m.RevotePage }))
);
const FinalDecisionPage = lazy(() =>
  import('@/features/voting/FinalDecisionPage').then((m) => ({ default: m.FinalDecisionPage }))
);
const DecisionHistoryPage = lazy(() =>
  import('@/features/voting/DecisionHistoryPage').then((m) => ({ default: m.DecisionHistoryPage }))
);
const ElectionHistoryPage = lazy(() =>
  import('@/features/elections/ElectionHistoryPage').then((m) => ({ default: m.ElectionHistoryPage }))
);
const NewElectionPage = lazy(() =>
  import('@/features/elections/NewElectionPage').then((m) => ({ default: m.NewElectionPage }))
);
const AuditLogPage = lazy(() =>
  import('@/features/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 2, // 2 minutes
    },
  },
});

const PageFallback: React.FC = () => (
  <div className="flex items-center justify-center min-h-[16rem]">
    <div className="text-center">
      <div className="w-12 h-12 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-4" />
      <p className="text-slate-600">Memuat halaman...</p>
    </div>
  </div>
);

const ProtectedLayout: React.FC<{ children: React.ReactNode; allowedRoles?: Array<'chair' | 'member' | 'voter'> }> = ({
  children,
  allowedRoles,
}) => (
  <ProtectedRoute allowedRoles={allowedRoles}>
    <Layout>{children}</Layout>
  </ProtectedRoute>
);

const AppRoutes: React.FC = () => {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-canvas">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-navy-800 border-t-gold-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Memuat...</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Root redirect */}
        <Route path="/" element={<ProtectedRoute><Navigate to="/dashboard" replace /></ProtectedRoute>} />

        {/* Protected: Dashboard (all roles) */}
        <Route path="/dashboard" element={<ProtectedLayout><DashboardPage /></ProtectedLayout>} />

        {/* Protected: Candidates (all roles) */}
        <Route path="/candidates" element={<ProtectedLayout><CandidateListPage /></ProtectedLayout>} />
        <Route path="/candidates/:id" element={<ProtectedLayout><CandidateDetailPage /></ProtectedLayout>} />

        {/* Protected: Criteria (panel only) */}
        <Route path="/criteria" element={<ProtectedLayout allowedRoles={['chair', 'member']}><CriteriaPage /></ProtectedLayout>} />

        {/* Protected: Assessments (panel only) */}
        <Route path="/assessments" element={<ProtectedLayout allowedRoles={['chair', 'member']}><AssessmentOverviewPage /></ProtectedLayout>} />
        <Route path="/assessments/input" element={<ProtectedLayout allowedRoles={['chair', 'member']}><AssessmentInputPage /></ProtectedLayout>} />

        {/* Protected: Results (panel only) — halaman aktif memakai TOPSIS */}
        <Route path="/results/saw" element={<Navigate to="/results/topsis" replace />} />
        <Route path="/results/topsis" element={<ProtectedLayout allowedRoles={['chair', 'member']}><TopsisResultsPage /></ProtectedLayout>} />
        <Route path="/results/borda" element={<ProtectedLayout allowedRoles={['chair', 'member']}><BordaResultsPage /></ProtectedLayout>} />

        {/* Protected: Voting & Decisions (all roles) */}
        <Route path="/voting" element={<ProtectedLayout><VotingPage /></ProtectedLayout>} />
        <Route path="/voting/results" element={<ProtectedLayout><VotingResultsPage /></ProtectedLayout>} />
        <Route path="/voting/revote" element={<ProtectedLayout allowedRoles={['chair', 'member']}><RevotePage /></ProtectedLayout>} />
        <Route path="/decisions/final" element={<ProtectedLayout><FinalDecisionPage /></ProtectedLayout>} />
        <Route path="/decisions/history" element={<ProtectedLayout><DecisionHistoryPage /></ProtectedLayout>} />

        {/* Protected: Election Cycle (Phase 4) */}
        <Route path="/elections" element={<ProtectedLayout><ElectionHistoryPage /></ProtectedLayout>} />
        <Route
          path="/elections/new"
          element={<ProtectedLayout allowedRoles={['chair']}><NewElectionPage /></ProtectedLayout>}
        />

        {/* Protected: Audit Trail (Phase 6, chair only) */}
        <Route
          path="/audit-logs"
          element={<ProtectedLayout allowedRoles={['chair']}><AuditLogPage /></ProtectedLayout>}
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  );
};
