// API functions for interacting with the Supabase database
import { supabase } from './supabase';
import { Profile, Match, MatchDetailed, Achievement, UserAchievement } from '../types/database';

// ==========================================
// PROFILE API
// ==========================================

/**
 * Get the current user's profile
 */
export async function getCurrentUserProfile(): Promise<Profile | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Exception fetching profile:', error);
    return null;
  }
}

/**
 * Update user profile
 */
export async function updateProfile(updates: Partial<Profile>): Promise<{ error: Error | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: new Error('Not authenticated') };

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id);

    if (error) {
      console.error('Error updating profile:', error);
      return { error };
    }

    return { error: null };
  } catch (error: any) {
    console.error('Exception updating profile:', error);
    return { error };
  }
}

/**
 * Upload profile image to Supabase Storage
 */
export async function uploadProfileImage(file: File): Promise<{ url: string | null; error: Error | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { url: null, error: new Error('Not authenticated') };

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    // Upload file to storage
    const { error: uploadError } = await supabase.storage
      .from('profiles')
      .upload(filePath, file, {
        upsert: true,
        contentType: file.type
      });

    if (uploadError) {
      console.error('Error uploading file:', uploadError);
      return { url: null, error: uploadError };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('profiles')
      .getPublicUrl(filePath);

    // Update profile with new avatar URL
    await updateProfile({ avatar_url: publicUrl });

    return { url: publicUrl, error: null };
  } catch (error: any) {
    console.error('Exception uploading image:', error);
    return { url: null, error };
  }
}

// ==========================================
// MATCHES API
// ==========================================

/**
 * Get recent matches for current user (last 5)
 */
export async function getRecentMatches(limit: number = 5): Promise<MatchDetailed[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('recent_matches_detailed')
      .select('*')
      .eq('player_id', user.id)
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching recent matches:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Exception fetching recent matches:', error);
    return [];
  }
}

/**
 * Get all matches for current user
 */
export async function getAllMatches(): Promise<MatchDetailed[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('recent_matches_detailed')
      .select('*')
      .eq('player_id', user.id)
      .order('completed_at', { ascending: false });

    if (error) {
      console.error('Error fetching all matches:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Exception fetching all matches:', error);
    return [];
  }
}

/**
 * Create a new match record
 */
export async function createMatch(matchData: {
  opponent_id: string;
  problem_id: string;
  problem_title: string;
  language: string;
  result: 'won' | 'lost' | 'draw';
  rating_change: number;
  duration_seconds?: number;
}): Promise<{ match: Match | null; error: Error | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { match: null, error: new Error('Not authenticated') };

    const { data, error } = await supabase
      .from('matches')
      .insert({
        player_id: user.id,
        ...matchData
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating match:', error);
      return { match: null, error };
    }

    return { match: data, error: null };
  } catch (error: any) {
    console.error('Exception creating match:', error);
    return { match: null, error };
  }
}

// ==========================================
// ACHIEVEMENTS API
// ==========================================

/**
 * Get all achievements
 */
export async function getAllAchievements(): Promise<Achievement[]> {
  try {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching achievements:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Exception fetching achievements:', error);
    return [];
  }
}

/**
 * Get user's earned achievements
 */
export async function getUserAchievements(): Promise<UserAchievement[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('user_achievements')
      .select(`
        *,
        achievement:achievements(*)
      `)
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false });

    if (error) {
      console.error('Error fetching user achievements:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Exception fetching user achievements:', error);
    return [];
  }
}

/**
 * Award an achievement to user
 */
export async function awardAchievement(achievementId: string): Promise<{ error: Error | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: new Error('Not authenticated') };

    const { error } = await supabase
      .from('user_achievements')
      .insert({
        user_id: user.id,
        achievement_id: achievementId
      });

    if (error) {
      // Ignore duplicate errors (user already has this achievement)
      if (error.code !== '23505') {
        console.error('Error awarding achievement:', error);
        return { error };
      }
    }

    return { error: null };
  } catch (error: any) {
    console.error('Exception awarding achievement:', error);
    return { error };
  }
}

// ==========================================
// LEADERBOARD API
// ==========================================

/**
 * Get top players for leaderboard
 */
export async function getLeaderboard(limit: number = 100) {
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .limit(limit);

    if (error) {
      console.error('Error fetching leaderboard:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Exception fetching leaderboard:', error);
    return [];
  }
}

// ==========================================
// STATS API
// ==========================================

/**
 * Get match statistics for a user
 */
export async function getUserStats(userId?: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const targetUserId = userId || user?.id;
    
    if (!targetUserId) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('win_rate, current_streak, best_streak, total_matches, matches_won, matches_lost')
      .eq('id', targetUserId)
      .single();

    if (error) {
      console.error('Error fetching user stats:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Exception fetching user stats:', error);
    return null;
  }
}


