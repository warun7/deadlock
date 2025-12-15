import React from 'react';
import { useNavigate } from 'react-router-dom';
import MatchmakingScreen from '../components/MatchmakingScreen';

const MatchmakingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleMatchFound = () => {
    navigate('/game');
  };

  return <MatchmakingScreen onMatchFound={handleMatchFound} />;
};

export default MatchmakingPage;

