import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './routes/Dashboard';
import NewProject from './routes/NewProject';
import Processing from './routes/Processing';
import Report from './routes/Report';
import Library from './routes/Library';
import Admin from './routes/Admin';

const guard = (el: React.ReactNode) => <ErrorBoundary>{el}</ErrorBoundary>;

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={guard(<Dashboard />)} />
        <Route path="/new-project"      element={guard(<NewProject />)} />
        <Route path="/processing/:id"   element={guard(<Processing />)} />
        <Route path="/report/:id"       element={guard(<Report />)} />
        <Route path="/project/:id"      element={guard(<Report />)} />
        <Route path="/library"          element={guard(<Library />)} />
        <Route path="/admin"            element={guard(<Admin />)} />
        <Route path="*"                 element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
