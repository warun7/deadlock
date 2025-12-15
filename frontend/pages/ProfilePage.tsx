import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ProfilePageComponent from '../components/ProfilePage';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';

const ProfilePage: React.FC = () => {
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

  return (
    <>
      <Navbar 
        isLoggedIn={true} 
        onLogin={() => {}} 
        onProfile={handleProfileClick}
        onDashboard={handleDashboardClick}
        onLogout={handleLogout}
      />
      <ProfilePageComponent />
      <Footer />
    </>
  );
};

export default ProfilePage;

