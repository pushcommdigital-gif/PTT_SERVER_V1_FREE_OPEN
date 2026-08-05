import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DISPATCHER_LEVEL } from '@pushcomm/shared';
import { getJwtRoleLevel } from '../lib/authRole';

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (getJwtRoleLevel() < DISPATCHER_LEVEL) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 text-center">
        <div className="max-w-md rounded-xl border border-border bg-bg-card p-6">
          <h1 className="text-xl font-semibold text-white">Management access required</h1>
          <p className="mt-2 text-sm text-text-secondary">
            This dashboard is available to dispatchers and administrators only.
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Log out and sign in again
          </button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
