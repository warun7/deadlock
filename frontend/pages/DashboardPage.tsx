import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import DashboardHero from '../components/DashboardHero';
import FeatureGrid from '../components/FeatureGrid';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleProfileClick = () => {
    navigate('/profile');
  };

  const handleDashboardClick = () => {
    navigate('/dashboard');
  };

  const handleLogout = async () => {
    console.log('Logging out...');
    await logout();
    console.log('Logged out, redirecting to home...');
    navigate('/', { replace: true });
  };

  const handleStartMatchmaking = () => {
    navigate('/matchmaking');
  };

  return (
    <>
      <Navbar 
        isLoggedIn={true} 
        onLogin={() => {}} 
        onProfile={handleProfileClick}
        onDashboard={handleDashboardClick}
        onLogout={handleLogout}
      />
      <main>
        <DashboardHero onFindMatch={handleStartMatchmaking} />
        <FeatureGrid />
      </main>
      <Footer />
    </>
  );
};

export default DashboardPage;

