import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DispatchConsole } from './pages/DispatchConsole';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<DispatchConsole />} />
      </Route>
    </Routes>
  );
}
