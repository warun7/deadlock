import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Github, Crosshair, User, LayoutDashboard, LogOut, Menu, X, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
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
  const { theme, toggleTheme, isDark } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
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
  
  const username = profile?.username || 
                   user?.user_metadata?.username || 
                   user?.user_metadata?.display_name || 
                   user?.email?.split('@')[0] || 
                   'User';
  
  const customImage = profile?.avatar_url || user?.user_metadata?.profile_image;
  const avatarSeed = username.replace(/[^a-zA-Z0-9]/g, '');
  const avatarUrl = customImage || `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}&backgroundColor=b6e3f4`;

  const handleLogoClick = () => {
    setMobileMenuOpen(false);
    if (isLoggedIn) {
      navigate('/dashboard');
    } else {
      navigate('/');
    }
  };

  const handleMobileNavAction = (action?: () => void) => {
    setMobileMenuOpen(false);
    action?.();
  };

  return (
    <nav 
      className="fixed w-full z-50 top-0 left-0 backdrop-blur-md theme-transition"
      style={{ 
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={handleLogoClick}
          >
            <span className="text-2xl font-black tracking-tighter brand-font uppercase group-hover:text-red-500 transition-colors" style={{ color: 'var(--text-primary)' }}>
              DEAD<span className="text-red-500">LOCK</span>
            </span>
          </div>
          
          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
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
            ) : null}
          </div>

          <div className="flex items-center gap-3">

            {isLoggedIn ? (
               <div className="hidden md:flex items-center gap-2">
                  <div 
                    onClick={onProfile}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all cursor-pointer group theme-transition"
                    style={{
                      backgroundColor: 'var(--bg-card-solid)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                     <div className="w-6 h-6 rounded-sm overflow-hidden relative" style={{ backgroundColor: 'var(--bg-primary)' }}>
                         <img src={avatarUrl} alt="User" className="w-full h-full object-cover grayscale group-hover:grayscale-0" />
                     </div>
                     <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{username}</span>
                  </div>
                  <button 
                    onClick={onLogout}
                    className="p-2 hover:text-red-500 transition-colors"
                    style={{ color: 'var(--text-dim)' }}
                    title="Logout"
                  >
                     <LogOut className="w-5 h-5" />
                  </button>
               </div>
            ) : (
              <button 
                onClick={onLogin}
                className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all"
                style={{ boxShadow: '0 0 15px var(--shadow-glow)' }}
              >
                <Crosshair className="w-4 h-4" />
                Login
              </button>
            )}

            {/* Mobile Hamburger Button */}
            <button
              className="md:hidden p-2 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div 
          className="md:hidden backdrop-blur-lg theme-transition"
          style={{ 
            borderTop: '1px solid var(--border-primary)',
            backgroundColor: 'var(--bg-surface)',
          }}
        >
          <div className="px-4 py-4 space-y-2">
            {isLoggedIn ? (
              <>
                <div 
                  onClick={() => handleMobileNavAction(onProfile)}
                  className="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer theme-transition"
                  style={{ 
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  <div className="w-8 h-8 rounded-sm overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
                    <img src={avatarUrl} alt="User" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{username}</div>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>View Profile</div>
                  </div>
                </div>

                <button 
                  onClick={() => handleMobileNavAction(onDashboard)} 
                  className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <LayoutDashboard className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                  Dashboard
                </button>
                <button 
                  onClick={() => handleMobileNavAction(onProfile)} 
                  className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <User className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                  Profile
                </button>

                {/* Removed Mobile Theme Toggle */}

                <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--border-primary)' }}>
                  <button 
                    onClick={() => handleMobileNavAction(onLogout)} 
                    className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium text-red-500 hover:bg-red-950/30 rounded-lg transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Removed Mobile Links and Theme Toggle */}
                <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--border-primary)' }}>
                  <button 
                    onClick={() => handleMobileNavAction(onLogin)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all"
                  >
                    <Crosshair className="w-4 h-4" />
                    Login
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;