import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Zap, TrendingUp, Clock, Code2, Trophy, Crosshair, Grid, Award, Edit3, Camera, Upload } from 'lucide-react';
import ThreeDTilt from './ThreeDTilt';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { getCurrentUserProfile, getRecentMatches, getAllMatches, getAllAchievements, getUserAchievements } from '../lib/api';
import { Profile, MatchDetailed, Achievement, UserAchievement } from '../types/database';
import MatchHistoryModal from './MatchHistoryModal';

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State for real data
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchDetailed[]>([]);
  const [allMatchesData, setAllMatchesData] = useState<MatchDetailed[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [userAchievements, setUserAchievements] = useState<UserAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadingAllMatches, setLoadingAllMatches] = useState(false);
  
  // Get username from profile or user metadata or fallback to email
  const username = profile?.username || 
                   user?.user_metadata?.username || 
                   user?.user_metadata?.display_name || 
                   user?.email?.split('@')[0] || 
                   'CodeMaster';
  
  // Get custom profile image or generate avatar
  const customImage = profile?.avatar_url || user?.user_metadata?.profile_image || profileImage;
  const avatarSeed = username.replace(/[^a-zA-Z0-9]/g, '');
  const avatarUrl = customImage || `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}&backgroundColor=b6e3f4`;

  // Fetch data on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [profileData, matchesData, achievementsData, userAchievementsData] = await Promise.all([
          getCurrentUserProfile(),
          getRecentMatches(5),
          getAllAchievements(),
          getUserAchievements()
        ]);
        
        setProfile(profileData);
        setRecentMatches(matchesData);
        setAchievements(achievementsData);
        setUserAchievements(userAchievementsData);
      } catch (error) {
        console.error('Error fetching profile data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);

  // Check username availability with debounce
  useEffect(() => {
    if (!newUsername || newUsername.length < 3) {
      setUsernameError(null);
      return;
    }

    const trimmedUsername = newUsername.trim();

    // Basic validation
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      setUsernameError('Only letters, numbers, and underscores allowed');
      return;
    }

    if (trimmedUsername.length > 20) {
      setUsernameError('Username must be less than 20 characters');
      return;
    }

    // Check if it's the same as current username
    if (trimmedUsername === username) {
      setUsernameError(null);
      return;
    }

    // Debounce username availability check
    const timeoutId = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username')
          .eq('username', trimmedUsername)
          .single();

        if (data) {
          setUsernameError('Username already taken');
        } else {
          setUsernameError(null);
        }
      } catch (error: any) {
        // PGRST116 means no rows found (username available)
        if (error.code === 'PGRST116') {
          setUsernameError(null);
        }
      } finally {
        setCheckingUsername(false);
      }
    }, 500); // Wait 500ms after user stops typing

    return () => clearTimeout(timeoutId);
  }, [newUsername, username]);

  // Fetch all matches when "View All" is clicked
  const handleViewAllMatches = async () => {
    setIsModalOpen(true);
    
    if (allMatchesData.length === 0) {
      setLoadingAllMatches(true);
      const matches = await getAllMatches();
      setAllMatchesData(matches);
      setLoadingAllMatches(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB');
      return;
    }

    setUploadingImage(true);

    try {
      // Convert to base64 for simple storage
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        setProfileImage(base64String);

        // Update user metadata
        const { error } = await supabase.auth.updateUser({
          data: {
            profile_image: base64String
          }
        });

        if (error) throw error;
        setUploadingImage(false);
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image');
      setUploadingImage(false);
    }
  };

  const handleUsernameUpdate = async () => {
    const trimmedUsername = newUsername.trim();
    
    // Validation
    if (!trimmedUsername || trimmedUsername.length < 3) {
      alert('Username must be at least 3 characters');
      return;
    }

    if (trimmedUsername.length > 20) {
      alert('Username must be less than 20 characters');
      return;
    }

    // Only allow alphanumeric and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      alert('Username can only contain letters, numbers, and underscores');
      return;
    }

    // Check if username is already taken
    try {
      const { data: existingUser, error: checkError } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', trimmedUsername)
        .single();

      if (existingUser && existingUser.username !== username) {
        alert(`Username "${trimmedUsername}" is already taken. Please choose another one.`);
        return;
      }

      // Update in profiles table
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ username: trimmedUsername })
        .eq('id', user?.id);

      if (profileError) throw profileError;

      // Also update in auth metadata for consistency
      await supabase.auth.updateUser({
        data: {
          username: trimmedUsername,
          display_name: trimmedUsername
        }
      });
      
      setIsEditingProfile(false);
      setNewUsername('');
      alert('Username updated successfully!');
      // Refresh page to show new username
      window.location.reload();
    } catch (error: any) {
      console.error('Error updating username:', error);
      
      // Check if it's a unique constraint violation
      if (error.code === '23505') {
        alert(`Username "${trimmedUsername}" is already taken. Please choose another one.`);
      } else {
        alert('Failed to update username. Please try again.');
      }
    }
  };
  
  return (
    <div className="min-h-screen bg-[#050505] pt-24 pb-12 font-mono relative overflow-hidden">
      {/* Background Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
         <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:40px_40px]"></div>
         <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-red-900/10 to-transparent"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 relative z-10">
        
        {/* Profile Header */}
        <div className="flex flex-col md:flex-row gap-8 items-end mb-16 pb-8 border-b border-stone-800">
           <ThreeDTilt intensity={10} className="w-full md:w-auto">
              <div className="relative group w-40 h-40 bg-stone-900 rounded-sm border-2 border-stone-800 p-1">
                 <div className="w-full h-full overflow-hidden bg-black relative">
                    <img 
                      src={avatarUrl} 
                      alt="Avatar" 
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-300"
                    />
                    <div className="absolute inset-0 bg-red-600/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    {/* Scanline */}
                    <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]"></div>
                 </div>
                 
                 {/* Upload Button */}
                 <button
                   onClick={() => fileInputRef.current?.click()}
                   disabled={uploadingImage}
                   className="absolute inset-0 bg-black/80 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
                 >
                   {uploadingImage ? (
                     <div className="text-white text-xs font-bold">Uploading...</div>
                   ) : (
                     <div className="flex flex-col items-center gap-2">
                       <Camera className="w-8 h-8 text-white" />
                       <span className="text-xs text-white font-bold">Change Photo</span>
                     </div>
                   )}
                 </button>
                 
                 <input
                   ref={fileInputRef}
                   type="file"
                   accept="image/*"
                   onChange={handleImageUpload}
                   className="hidden"
                 />
                 
                 <div className="absolute -bottom-3 -right-3 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-widest border border-black shadow-[4px_4px_0_black]">
                    PRO
                 </div>
              </div>
           </ThreeDTilt>

           <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                 <span className="text-red-500 font-bold tracking-widest text-xs uppercase">[ User_ID: {user?.id?.slice(0, 8) || '--------'} ]</span>
                 <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              </div>
              
              {isEditingProfile ? (
                <div className="flex items-center gap-4 mb-2">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder={username}
                    className="text-2xl md:text-4xl font-black text-white uppercase tracking-tighter bg-black/50 border border-stone-800 rounded px-4 py-2 focus:border-red-600 focus:outline-none"
                  />
                  <button
                    onClick={handleUsernameUpdate}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-sm uppercase tracking-wider transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingProfile(false);
                      setNewUsername('');
                    }}
                    className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-white font-bold text-sm uppercase tracking-wider transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4 mb-2">
                  <h1 className="text-4xl md:text-6xl font-black text-white uppercase tracking-tighter">{username}</h1>
                  <button
                    onClick={() => setIsEditingProfile(true)}
                    className="p-2 hover:bg-stone-900 border border-stone-800 hover:border-red-600 transition-colors rounded group"
                    title="Edit Profile"
                  >
                    <Edit3 className="w-4 h-4 text-stone-500 group-hover:text-red-500" />
                  </button>
                </div>
              )}
              
              <p className="text-stone-500 text-sm font-bold uppercase tracking-wide">{user?.email || 'user@deadlock.dev'}</p>
           </div>

           <div className="flex gap-8">
              <div className="text-right relative">
                 <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-1">Rank Tier</div>
                 <div className="text-lg font-black text-stone-600 flex items-center justify-end gap-2">
                    COMING SOON
                    <Shield className="w-6 h-6 text-stone-700 fill-stone-800/20" />
                 </div>
                 <div className="absolute top-0 right-0 bg-stone-800 text-stone-500 text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest">
                   SOON
                 </div>
              </div>
              <div className="text-right relative">
                 <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-1">Current Rating</div>
                 <div className="text-lg font-black text-stone-600 flex items-center justify-end gap-2">
                    COMING SOON
                    <TrendingUp className="w-6 h-6 text-stone-700" />
                 </div>
                 <div className="absolute top-0 right-0 bg-stone-800 text-stone-500 text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest">
                   SOON
                 </div>
              </div>
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           
           {/* Left Col: Stats */}
           <div className="lg:col-span-2 space-y-8">
              
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 {[
                    { 
                      label: "Global Rank", 
                      value: profile?.global_rank ? `#${profile.global_rank.toLocaleString()}` : "COMING SOON", 
                      icon: <Grid className="w-4 h-4" />, 
                      color: profile?.global_rank ? "text-white" : "text-stone-600",
                      comingSoon: !profile?.global_rank
                    },
                    { 
                      label: "Win Rate", 
                      value: loading ? "..." : `${profile?.win_rate?.toFixed(1) || "0.0"}%`, 
                      icon: <Crosshair className="w-4 h-4" />, 
                      color: "text-emerald-400",
                      comingSoon: false
                    },
                    { 
                      label: "Best Streak", 
                      value: loading ? "..." : `${profile?.best_streak || 0} Win${(profile?.best_streak || 0) === 1 ? '' : 's'}`, 
                      icon: <Zap className="w-4 h-4" />, 
                      color: "text-yellow-400",
                      comingSoon: false
                    },
                    { 
                      label: "Total Matches", 
                      value: loading ? "..." : `${profile?.total_matches || 0}`, 
                      icon: <Code2 className="w-4 h-4" />, 
                      color: "text-blue-400",
                      comingSoon: false
                    },
                 ].map((stat, i) => (
                    <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="bg-[#0a0a0a] border border-stone-800 p-4 relative group overflow-hidden"
                    >
                        <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                            {stat.icon}
                        </div>
                        <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-1">{stat.label}</div>
                        <div className={`text-xl font-black ${stat.color} ${stat.comingSoon ? 'text-xs' : ''}`}>
                          {stat.value}
                        </div>
                        {stat.comingSoon && (
                          <div className="absolute top-2 right-2 bg-stone-800 text-stone-500 text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest">
                            SOON
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-stone-700 to-transparent group-hover:via-red-600 transition-colors"></div>
                    </motion.div>
                 ))}
              </div>

              {/* Match History */}
              <div className="bg-[#0a0a0a] border border-stone-800 p-6 relative">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-white uppercase flex items-center gap-2">
                       <Clock className="w-4 h-4 text-red-500" />
                       Recent Matches
                    </h3>
                    <button 
                      onClick={handleViewAllMatches}
                      className="text-[10px] text-stone-500 hover:text-white uppercase tracking-widest transition-colors"
                    >
                      View All
                    </button>
                 </div>

                 <div className="space-y-1">
                    {loading ? (
                      <div className="text-center text-stone-500 py-8">Loading matches...</div>
                    ) : recentMatches.length === 0 ? (
                      <div className="text-center text-stone-500 py-8">
                        <Code2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No matches yet. Start playing to see your history!</p>
                      </div>
                    ) : (
                      recentMatches.map((match, i) => {
                        const isWin = match.result === 'won';
                        const isDraw = match.result === 'draw';
                        const resultLetter = isWin ? 'W' : isDraw ? 'D' : 'L';
                        const resultColor = isWin ? 'bg-emerald-500/10 text-emerald-500' : isDraw ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-500';
                        
                        return (
                          <div key={match.id} className="grid grid-cols-12 gap-4 items-center p-3 hover:bg-stone-900/50 transition-colors border-l-2 border-transparent hover:border-red-600 group">
                            <div className="col-span-1">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${resultColor}`}>
                                {resultLetter}
                              </span>
                            </div>
                            <div className="col-span-4 text-sm font-bold text-stone-300 group-hover:text-white transition-colors">
                              {match.opponent_username}
                            </div>
                            <div className="col-span-4 text-xs text-stone-500">{match.problem_title}</div>
                            <div className="col-span-1 text-[10px] text-stone-600 uppercase">{match.language}</div>
                            <div className="col-span-2 text-right text-xs font-mono font-bold">
                              <span className={isWin ? 'text-emerald-500' : 'text-red-500'}>
                                {match.rating_change > 0 ? '+' : ''}{match.rating_change} RP
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                 </div>
              </div>

           </div>

           {/* Right Col: Achievements */}
           <div className="lg:col-span-1 space-y-8">
              
              {/* Achievements */}
              <div className="bg-[#0a0a0a] border border-stone-800 p-6 relative overflow-hidden">
                 <h3 className="text-lg font-bold text-white uppercase flex items-center gap-2 mb-6">
                       <Award className="w-4 h-4 text-red-500" />
                       Achievements
                 </h3>
                 
                 <div className="relative">
                   {/* Achievement Grid (Blurred) */}
                   <div className="grid grid-cols-4 gap-2 blur-sm">
                      {[
                        'First Victory',
                        'Winning Streak',
                        'Speed Demon',
                        'Polyglot',
                        'Code Master',
                        'Night Owl',
                        'Problem Solver',
                        'Champion'
                      ].map((name, i) => (
                        <div 
                          key={i} 
                          className="aspect-square border border-stone-800 rounded-sm flex flex-col items-center justify-center bg-black/50"
                        >
                          <Trophy className="w-5 h-5 text-stone-700" />
                        </div>
                      ))}
                   </div>
                   
                   {/* Coming Soon Overlay */}
                   <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                     <div className="text-center">
                       <Award className="w-12 h-12 mx-auto mb-3 text-stone-600" />
                       <div className="text-2xl font-black text-stone-400 uppercase tracking-tighter mb-2">
                         COMING SOON
                       </div>
                       <div className="text-xs text-stone-600 uppercase tracking-wider">
                         Achievements Under Development
                       </div>
                     </div>
                   </div>
                 </div>
              </div>

           </div>
        </div>
      </div>
      
      {/* Match History Modal */}
      <MatchHistoryModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        matches={allMatchesData}
        loading={loadingAllMatches}
      />
    </div>
  );
};

const GlobeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
);

export default ProfilePage;