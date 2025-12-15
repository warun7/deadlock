import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, Code2 } from 'lucide-react';
import { MatchDetailed } from '../types/database';

interface MatchHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  matches: MatchDetailed[];
  loading: boolean;
}

const MatchHistoryModal: React.FC<MatchHistoryModalProps> = ({
  isOpen,
  onClose,
  matches,
  loading
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-[#0a0a0a] border-2 border-stone-800 w-full max-w-4xl max-h-[80vh] flex flex-col font-mono">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-stone-800">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-red-500" />
                  <h2 className="text-2xl font-black text-white uppercase tracking-tighter">
                    Match History
                  </h2>
                  <span className="text-xs text-stone-500 font-bold">
                    ({matches.length} total)
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-stone-900 border border-stone-800 hover:border-red-600 transition-colors group"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-stone-500 group-hover:text-red-500" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                  <div className="text-center text-stone-500 py-12">
                    <div className="animate-spin w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                    <p>Loading matches...</p>
                  </div>
                ) : matches.length === 0 ? (
                  <div className="text-center text-stone-500 py-12">
                    <Code2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-bold mb-2">No matches yet</p>
                    <p className="text-sm">Start playing to see your history!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {matches.map((match, index) => {
                      const isWin = match.result === 'won';
                      const isDraw = match.result === 'draw';
                      const resultLetter = isWin ? 'W' : isDraw ? 'D' : 'L';
                      const resultColor = isWin
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : isDraw
                        ? 'bg-yellow-500/10 text-yellow-500'
                        : 'bg-red-500/10 text-red-500';

                      // Format date
                      const date = new Date(match.completed_at);
                      const formattedDate = date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      });
                      const formattedTime = date.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                      });

                      return (
                        <motion.div
                          key={match.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.03 }}
                          className="grid grid-cols-12 gap-4 items-center p-4 bg-black/40 hover:bg-stone-900/50 transition-colors border-l-2 border-transparent hover:border-red-600 group"
                        >
                          {/* Result Badge */}
                          <div className="col-span-1 flex justify-center">
                            <span
                              className={`text-xs font-bold px-2 py-1 rounded-sm ${resultColor}`}
                            >
                              {resultLetter}
                            </span>
                          </div>

                          {/* Opponent */}
                          <div className="col-span-3">
                            <div className="text-sm font-bold text-stone-300 group-hover:text-white transition-colors">
                              {match.opponent_username}
                            </div>
                            <div className="text-[10px] text-stone-600 uppercase tracking-wider">
                              Opponent
                            </div>
                          </div>

                          {/* Problem */}
                          <div className="col-span-3">
                            <div className="text-sm text-stone-400 group-hover:text-stone-300 transition-colors">
                              {match.problem_title}
                            </div>
                            <div className="text-[10px] text-stone-600 uppercase">
                              {match.language}
                            </div>
                          </div>

                          {/* Date/Time */}
                          <div className="col-span-3">
                            <div className="text-xs text-stone-500">
                              {formattedDate}
                            </div>
                            <div className="text-[10px] text-stone-600">
                              {formattedTime}
                            </div>
                          </div>

                          {/* Rating Change */}
                          <div className="col-span-2 text-right">
                            <div
                              className={`text-sm font-mono font-bold ${
                                isWin ? 'text-emerald-500' : 'text-red-500'
                              }`}
                            >
                              {match.rating_change > 0 ? '+' : ''}
                              {match.rating_change}
                            </div>
                            <div className="text-[10px] text-stone-600">RP</div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-stone-800 bg-black/40">
                <div className="flex items-center justify-between text-xs text-stone-500">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                      <span>Win</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      <span>Loss</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                      <span>Draw</span>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-stone-900 hover:bg-stone-800 border border-stone-800 hover:border-red-600 text-white font-bold text-xs uppercase tracking-wider transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MatchHistoryModal;


