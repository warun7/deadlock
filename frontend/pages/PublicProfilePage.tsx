import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import PublicProfilePageComponent from '../components/PublicProfilePage';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';

const PublicProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <>
      <Navbar
        isLoggedIn={isLoggedIn}
        onLogin={() => navigate('/auth')}
        onProfile={() => navigate('/profile')}
        onDashboard={() => navigate('/dashboard')}
        onLogout={handleLogout}
      />
      <PublicProfilePageComponent />
      <Footer />
    </>
  );
};

export default PublicProfilePage;
