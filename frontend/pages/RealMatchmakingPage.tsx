import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Server, Globe } from 'lucide-react';
import GlitchText from '../components/GlitchText';
import { gameSocket } from '../lib/socket';
import { supabase } from '../lib/supabase';

const RealMatchmakingPage: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'connecting' | 'searching' | 'found' | 'error'>('connecting');
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>(null);

  useEffect(() => {
    let timerInterval: NodeJS.Timeout;
    let hasJoinedQueue = false; // Flag to prevent double join

    const initSocket = async () => {
      try {
        // Get auth token
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setError('Not authenticated');
          setStatus('error');
          return;
        }

        // Connect socket (or get existing connection)
        const socket = gameSocket.connect(session.access_token);

        // IMPORTANT: Remove old listeners to prevent duplicates
        socket.off('connect');
        socket.off('connect_error');
        socket.off('queue_joined');
        socket.off('match_found');
        socket.off('error');

        // Helper to join queue (only once)
        const joinQueueOnce = () => {
          if (hasJoinedQueue) {
            console.log('Already joined queue, skipping...');
            return;
          }
          hasJoinedQueue = true;
          console.log('Joining queue...');
          setStatus('searching');
          gameSocket.joinQueue();
          
          // Start timer
          timerInterval = setInterval(() => {
            setTimer(t => t + 1);
          }, 1000);
        };

        // If already connected, join queue immediately
        if (socket.connected) {
          console.log('Socket already connected');
          joinQueueOnce();
        }

        // Wait for connection (for new connections)
        socket.on('connect', () => {
          console.log('Socket connected');
          joinQueueOnce();
        });

        socket.on('connect_error', (err) => {
          console.error('Connection error:', err);
          setError('Failed to connect to server');
          setStatus('error');
        });

        socket.on('queue_joined', (data) => {
          console.log('Joined queue at position:', data.position);
        });

        socket.on('match_found', (data) => {
          console.log('Match found!', data);
          setMatchData(data);
          setStatus('found');
          clearInterval(timerInterval);

          // Navigate to game after animation
          setTimeout(() => {
            navigate('/game', { state: { matchData: data } });
          }, 3000);
        });

        socket.on('error', (data) => {
          console.error('Socket error:', data);
          setError(data.message);
          setStatus('error');
        });

      } catch (err: any) {
        console.error('Init error:', err);
        setError(err.message);
        setStatus('error');
      }
    };

    initSocket();

    return () => {
      clearInterval(timerInterval);
      // Only leave queue if still searching (not if match found)
      if (status === 'searching') {
        gameSocket.leaveQueue();
      }
    };
  }, []); // Empty deps - only run once on mount

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCancel = () => {
    gameSocket.leaveQueue();
    gameSocket.disconnect();
    navigate('/');
  };

  if (status === 'error') {
    return (
      <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center font-mono">
        <div className="text-center">
          <h1 className="text-4xl font-black text-red-600 mb-4">CONNECTION ERROR</h1>
          <p className="text-stone-400 mb-8">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-red-600 text-white font-bold hover:bg-red-700"
          >
            GO BACK
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center font-mono">
      <AnimatePresence>
        {status === 'connecting' && (
          <motion.div className="text-center">
            <div className="text-2xl text-stone-400 animate-pulse">Connecting...</div>
          </motion.div>
        )}

        {status === 'searching' && (
          <motion.div 
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex flex-col items-center relative"
          >
            {/* Radar Ring */}
            <div className="relative w-64 h-64 md:w-96 md:h-96 border border-stone-800 rounded-full flex items-center justify-center mb-12">
              <div className="absolute inset-0 border-2 border-red-900/30 rounded-full animate-[ping_2s_linear_infinite]"></div>
              <div className="absolute inset-0 border-t-2 border-red-600 rounded-full animate-[radar-spin_3s_linear_infinite]"></div>
              <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(220,38,38,0.1)_0%,transparent_70%)]"></div>
              
              <div className="text-center z-10">
                <div className="text-4xl font-black text-white mb-2 font-mono tracking-widest">{formatTime(timer)}</div>
                <div className="text-xs text-red-500 uppercase tracking-widest animate-pulse">Searching</div>
              </div>
            </div>

            <div className="mt-8 flex gap-8 text-stone-600 text-xs uppercase tracking-widest">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4" />
                LIVE SERVER
              </div>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                GLOBAL
              </div>
            </div>

            <button
              onClick={handleCancel}
              className="mt-12 px-6 py-2 border border-red-900 text-red-500 hover:bg-red-900/20 transition"
            >
              CANCEL
            </button>
          </motion.div>
        )}

        {status === 'found' && (
          <motion.div 
            initial={{ opacity: 0, scale: 1.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative flex flex-col items-center justify-center w-full h-full"
          >
            {/* Impact Flash */}
            <motion.div 
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 bg-red-600 z-0"
            />

            <div className="relative z-10 text-center">
              <h1 className="text-6xl md:text-9xl font-black text-white italic tracking-tighter mb-4 mix-blend-difference">
                <GlitchText text="MATCH" /> <br/>
                <span className="text-red-600">FOUND</span>
              </h1>
              
              <div className="flex items-center justify-center gap-12 mt-12">
                <div className="text-center">
                  <div className="w-24 h-24 bg-stone-900 rounded-full border-2 border-white flex items-center justify-center mb-4">
                    <span className="text-2xl font-bold">YOU</span>
                  </div>
                  <div className="text-sm font-bold text-white">{matchData?.opponent?.elo || '???'} ELO</div>
                </div>

                <div className="text-4xl font-black text-red-600 italic">VS</div>

                <div className="text-center">
                  <div className="w-24 h-24 bg-stone-900 rounded-full border-2 border-red-600 flex items-center justify-center mb-4 relative overflow-hidden">
                    <div className="absolute inset-0 bg-red-900/20 animate-pulse"></div>
                    <span className="text-2xl font-bold text-red-500">{matchData?.opponent?.username?.[0] || '?'}</span>
                  </div>
                  <div className="text-sm font-bold text-stone-400">{matchData?.opponent?.username || 'OPPONENT'}</div>
                </div>
              </div>

              <p className="mt-12 text-stone-500 font-mono text-sm uppercase tracking-[0.3em] animate-pulse">
                Loading Game...
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RealMatchmakingPage;
