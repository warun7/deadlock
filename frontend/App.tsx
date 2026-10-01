import React, { Suspense, lazy } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import DotLoader from "./components/ui/pixel/DotLoader";

// Route-level code splitting: the landing page never downloads the editor or KaTeX.
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const RealMatchmakingPage = lazy(() => import("./pages/RealMatchmakingPage"));
const GamePage = lazy(() => import("./pages/GamePage"));
const RoomPage = lazy(() => import("./pages/RoomPage"));
const PublicProfilePage = lazy(() => import("./pages/PublicProfilePage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const RouteFallback: React.FC = () => (
  <div className="flex min-h-[100dvh] items-center justify-center" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading</span>
    <DotLoader pattern="spiral" size={5} cell={5} gap={2} className="text-fg" />
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoggedIn, loading } = useAuth();
  if (loading) return <RouteFallback />;
  return isLoggedIn ? <>{children}</> : <Navigate to="/auth" replace />;
};

const AppContent: React.FC = () => (
  <>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/matchmaking"
          element={
            <ProtectedRoute>
              <RealMatchmakingPage key="ranked" mode="ranked" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/practice"
          element={
            <ProtectedRoute>
              <RealMatchmakingPage key="practice" mode="practice" />
            </ProtectedRoute>
          }
        />
        {/* Duel rooms: /duel opens yours; invite links are public so a signed-out friend sees who invited them */}
        <Route
          path="/duel"
          element={
            <ProtectedRoute>
              <RoomPage key="new" />
            </ProtectedRoute>
          }
        />
        <Route path="/duel/:code" element={<RoomPage />} />
        <Route
          path="/game/:matchId"
          element={
            <ProtectedRoute>
              <GamePage />
            </ProtectedRoute>
          }
        />
        {/* Public profile pages - accessible without login */}
        <Route path="/u/:targetUsername" element={<PublicProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  </>
);

const App: React.FC = () => (
  <Router>
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  </Router>
);

export default App;
