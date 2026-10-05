import React, { useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import LoginPage from './components/auth/LoginPage';
import ResetPasswordPage from './components/auth/ResetPasswordPage';
import HelpWidget from './components/help/HelpWidget';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useScrollActivity } from './hooks/useScrollActivity';
import { usePlatform } from './hooks/usePlatform';
import { UserRole, Language } from './types';
import { readAppLanguage, saveLanguagePreference } from './utils/languagePreference';

function lazyWithRetry(factory: () => Promise<{ default: React.ComponentType<any> }>) {
  return lazy(() =>
    factory().catch((err: Error) => {
      const key = 'chunk_reload';
      const last = sessionStorage.getItem(key);
      if (!last || Date.now() - Number(last) > 10_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
      throw err;
    })
  );
}

// The marketing site is dead weight for signed-in users, who land on /dashboard.
// All five pieces come from one module, so they share a single chunk.
const loadPublicHome = () => import('./components/PublicHomePage');
const PublicHomePage = lazyWithRetry(loadPublicHome);
const PublicHomeContent = lazyWithRetry(() => loadPublicHome().then(m => ({ default: m.PublicHomeContent })));
const PublicFeatures = lazyWithRetry(() => loadPublicHome().then(m => ({ default: m.PublicFeatures })));
const PublicPrinciples = lazyWithRetry(() => loadPublicHome().then(m => ({ default: m.PublicPrinciples })));
const PublicAbout = lazyWithRetry(() => loadPublicHome().then(m => ({ default: m.PublicAbout })));

const Workspace = lazyWithRetry(() => import('./components/Workspace'));
const MobileWorkspace = lazyWithRetry(() => import('./components/mobile/MobileWorkspace'));
const Dashboard = lazyWithRetry(() => import('./components/Dashboard'));
const PersonalAgentPage = lazyWithRetry(() => import('./components/PersonalAgentPage'));
const TuringTestActivity = lazyWithRetry(() => import('./components/TuringTestActivity'));
const TuringTestManage = lazyWithRetry(() => import('./components/TuringTestManage'));
const CTToolPage = lazyWithRetry(() => import('./components/CTToolPage'));
const CourseSettingsPage = lazyWithRetry(() => import('./components/courseSettings/CourseSettingsPage'));
const LazyFallback = () => (
  <div className="min-h-screen bg-gray-950 flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode; requiredRole?: string }> = ({ children, requiredRole }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && user.role !== requiredRole && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

// Public Route (redirect to dashboard if already logged in)
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

// Renders MobileWorkspace on phones, desktop Workspace on larger screens
const AdaptiveWorkspace: React.FC<{ userRole: UserRole; lang: Language; setLang: (l: Language) => void }> = (props) => {
  const { isMobileLayout } = usePlatform();
  if (isMobileLayout) return <MobileWorkspace {...props} />;
  return <Workspace {...props} />;
};

// App Router Component
const AppRouter: React.FC = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [lang, setLangState] = useState<Language>(() => readAppLanguage('en'));

  // Derive role from authenticated user
  const userRole: UserRole = (user?.role as UserRole) ?? 'student';

  const handleCourseSelect = (courseId: string, courseTitle: string) => {
    navigate(`/workspace/${courseId}`, { state: { courseTitle } });
  };

  const setLang = (nextLang: Language) => {
    saveLanguagePreference(nextLang);
    setLangState(nextLang);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const routes = (
    <Routes>
      {/* Public Routes */}
      {/* One boundary covers the layout and everything rendered into its Outlet. */}
      <Route path="/" element={<Suspense fallback={<LazyFallback />}><PublicHomePage /></Suspense>}>
        <Route index element={<PublicHomeContent />} />
        <Route path="features" element={<PublicFeatures />} />
        <Route path="principles" element={<PublicPrinciples />} />
        <Route path="about" element={<PublicAbout />} />
      </Route>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protected Routes — lazy loaded */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LazyFallback />}>
              <Dashboard
                currentRole={userRole}
                onRoleChange={() => {}}
                onCourseSelect={handleCourseSelect}
                lang={lang}
                setLang={setLang}
              />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* 笔记是独立页面 /workspace/:courseId/note/:noteId，用 splat 兜住，
          这样在画布和笔记之间来回时 Workspace 不会卸载重挂。 */}
      <Route
        path="/workspace/:courseId/*"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LazyFallback />}>
              <AdaptiveWorkspace userRole={userRole} lang={lang} setLang={setLang} />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/workspace/:courseId/turing-test"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LazyFallback />}>
              <TuringTestManage lang={lang} />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/workspace/:courseId/turing-test/:activityId"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LazyFallback />}>
              <TuringTestActivity lang={lang} />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/workspace/:courseId/ct-tool"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LazyFallback />}>
              <CTToolPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* 课程设置是独立页面：教师排课、传资料、布置任务要停留很久，不该塞在浮层里 */}
      <Route
        path="/course/:courseId/settings"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LazyFallback />}>
              <CourseSettingsPage lang={lang} />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/ai-assistant"
        element={
          <ProtectedRoute>
            <Suspense fallback={<LazyFallback />}>
              <PersonalAgentPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  return (
    <>
      {routes}
      {/* 使用帮助的小球只挂这一处，跟着学生走过首页、画布、笔记页和阅读页。
          它自己出错也不能连累页面，所以单独包一层。 */}
      <ErrorBoundary fallback={null}>
        <HelpWidget lang={lang} />
      </ErrorBoundary>
    </>
  );
};

// Main App Component
const App: React.FC = () => {
  useScrollActivity();
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;
