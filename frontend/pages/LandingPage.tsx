import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import FeatureGrid from '../components/FeatureGrid';
import Footer from '../components/Footer';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();

  // Redirect logged-in users to dashboard
  React.useEffect(() => {
    if (isLoggedIn) {
      navigate('/dashboard', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  const handleLoginClick = () => {
    if (isLoggedIn) {
      navigate('/dashboard');
    } else {
      navigate('/auth');
    }
  };

  return (
    <>
      <Navbar 
        isLoggedIn={isLoggedIn}
        onLogin={handleLoginClick} 
      />
      <main>
        <Hero onStart={handleLoginClick} />
        <div id="features">
          <FeatureGrid />
        </div>
        {/* CTA Section */}
        <section className="py-40 relative overflow-hidden border-t border-stone-900">
          <div className="absolute inset-0 bg-[#050505]">
             {/* Noise texture */}
             <div 
               className="absolute inset-0 opacity-[0.02]"
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")` }}
             />
             <div className="absolute bottom-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.12),transparent_60%)]"></div>
             <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:40px_40px]"></div>
             {/* Animated glow orbs */}
             <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-red-600/10 rounded-full blur-[100px] animate-pulse"></div>
             <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-red-500/5 rounded-full blur-[80px] animate-pulse" style={{ animationDelay: '1s' }}></div>
          </div>
          
          <div className="max-w-4xl mx-auto px-4 relative z-10 text-center">
            {/* Glitch-style heading */}
            <div className="relative mb-12">
              <h2 className="text-5xl md:text-8xl font-black font-mono tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-stone-600">
                Ready?
              </h2>
              {/* Glitch layers */}
              <h2 className="absolute inset-0 text-5xl md:text-8xl font-black font-mono tracking-tighter uppercase text-red-500/20 animate-pulse" style={{ transform: 'translate(2px, 2px)' }}>
                Ready?
              </h2>
            </div>
            
            <div className="flex flex-col items-center gap-4">
              {/* Premium button with animated border */}
              <div className="relative group">
                {/* Animated border glow */}
                <div className="absolute -inset-[2px] bg-gradient-to-r from-red-600 via-red-500 to-orange-500 rounded-lg opacity-0 group-hover:opacity-100 blur-sm transition-all duration-500"></div>
                <div className="absolute -inset-[1px] bg-gradient-to-r from-red-600 via-red-500 to-orange-500 rounded-lg opacity-50 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <button 
                  onClick={handleLoginClick}
                  className="relative px-12 py-6 bg-[#0a0a0a] rounded-lg font-black text-xl text-white transition-all duration-300 overflow-hidden border border-transparent"
                >
                  {/* Button noise texture */}
                  <div 
                    className="absolute inset-0 opacity-[0.03]"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")` }}
                  />
                  
                  {/* Hover fill effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-red-500 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
                  
                  {/* Button content */}
                  <span className="relative flex items-center gap-4 z-10 font-mono uppercase tracking-wider">
                     <span className="text-red-500 group-hover:text-white transition-colors">▸</span>
                     Enter Arena
                     <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                  </span>
                  
                  {/* Corner accents */}
                  <div className="absolute top-2 left-2 w-2 h-2 border-l border-t border-stone-700 group-hover:border-red-400 transition-colors"></div>
                  <div className="absolute top-2 right-2 w-2 h-2 border-r border-t border-stone-700 group-hover:border-red-400 transition-colors"></div>
                  <div className="absolute bottom-2 left-2 w-2 h-2 border-l border-b border-stone-700 group-hover:border-red-400 transition-colors"></div>
                  <div className="absolute bottom-2 right-2 w-2 h-2 border-r border-b border-stone-700 group-hover:border-red-400 transition-colors"></div>
                </button>
              </div>
              
              {/* Status indicators */}
              <div className="mt-12 flex flex-col items-center gap-3">
                <div className="flex items-center gap-6 text-xs font-mono text-stone-600">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                    <span>SERVERS ONLINE</span>
                  </div>
                  <div className="w-px h-3 bg-stone-800"></div>
                  <span>LATENCY: &lt;50MS</span>
                </div>
                <p className="animate-pulse text-red-500 text-sm font-mono flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
                  LIVE MATCHMAKING ACTIVE
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
};

export default LandingPage;

