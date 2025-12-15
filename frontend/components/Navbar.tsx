import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Github, Crosshair, User, LayoutDashboard, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getCurrentUserProfile } from '../lib/api';
import { Profile } from '../types/database';

interface NavbarProps {
  isLoggedIn?: boolean;
  onLogin: () => void;
  onProfile?: () => void;
  onDashboard?: () => void;
  onLogout?: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ isLoggedIn, onLogin, onProfile, onDashboard, onLogout }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  
  // Fetch profile data when logged in
  useEffect(() => {
    if (isLoggedIn && user) {
      const fetchProfile = async () => {
        try {
          const profileData = await getCurrentUserProfile();
          setProfile(profileData);
        } catch (error) {
          console.error('Error fetching profile in Navbar:', error);
        }
      };
      fetchProfile();
    }
  }, [isLoggedIn, user]);
  
  // Get username from profile or user metadata or fallback to email
  // Same priority order as DashboardHero
  const username = profile?.username || 
                   user?.user_metadata?.username || 
                   user?.user_metadata?.display_name || 
                   user?.email?.split('@')[0] || 
                   'User';
  
  // Get custom profile image or generate avatar
  // Check profile first, then user_metadata, then generate
  const customImage = profile?.avatar_url || user?.user_metadata?.profile_image;
  const avatarSeed = username.replace(/[^a-zA-Z0-9]/g, '');
  const avatarUrl = customImage || `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}&backgroundColor=b6e3f4`;

  const handleLogoClick = () => {
    if (isLoggedIn) {
      navigate('/dashboard');
    } else {
      navigate('/');
    }
  };

  return (
    <nav className="fixed w-full z-50 top-0 left-0 border-b border-white/5 bg-stone-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={handleLogoClick}
          >
            <span className="text-2xl font-black tracking-tighter text-white brand-font uppercase group-hover:text-red-500 transition-colors">
              DEAD<span className="text-red-500">LOCK</span>
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-stone-400">
            {isLoggedIn ? (
              <>
                 <button onClick={onDashboard} className="hover:text-red-500 transition-colors flex items-center gap-2">
                    <LayoutDashboard className="w-4 h-4" />
                    Dashboard
                 </button>
                 <button onClick={onProfile} className="hover:text-red-500 transition-colors flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Profile
                 </button>
              </>
            ) : (
              <>
                <a href="#features" className="hover:text-red-500 transition-colors">Battle Arena</a>
                <a href="#ranking" className="hover:text-red-500 transition-colors">Global Ranking</a>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button className="text-stone-500 hover:text-white transition-colors">
              <Github className="w-5 h-5" />
            </button>
            
            {isLoggedIn ? (
               <div className="flex items-center gap-2">
                  <div 
                    onClick={onProfile}
                    className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-900 border border-stone-800 hover:border-red-600 hover:bg-stone-800 transition-all cursor-pointer group"
                  >
                     <div className="w-6 h-6 rounded-sm bg-black overflow-hidden relative">
                         <img src={avatarUrl} alt="User" className="w-full h-full object-cover grayscale group-hover:grayscale-0" />
                     </div>
                     <span className="text-xs font-bold text-stone-300 group-hover:text-white">{username}</span>
                  </div>
                  <button 
                    onClick={onLogout}
                    className="p-2 text-stone-500 hover:text-red-500 transition-colors"
                    title="Logout"
                  >
                     <LogOut className="w-5 h-5" />
                  </button>
               </div>
            ) : (
              <button 
                onClick={onLogin}
                className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all shadow-[0_0_15px_rgba(220,38,38,0.4)] hover:shadow-[0_0_25px_rgba(220,38,38,0.6)]"
              >
                <Crosshair className="w-4 h-4" />
                Login
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;