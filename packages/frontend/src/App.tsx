import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import RepoBrowserPage from './pages/RepoBrowserPage';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<LandingPage />} />

        {/* App routes under /app */}
        <Route path="/app" element={<DashboardPage />} />
        <Route path="/app/repos/:owner/:name" element={<RepoBrowserPage />} />
        <Route path="/app/repos/:owner/:name/code" element={<RepoBrowserPage />} />
        <Route path="/app/repos/:owner/:name/code/*" element={<RepoBrowserPage />} />
      </Routes>
    </div>
  );
}

export default App;
