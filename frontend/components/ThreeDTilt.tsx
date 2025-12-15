import React, { useRef, useState, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface ThreeDTiltProps {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
}

const ThreeDTilt: React.FC<ThreeDTiltProps> = ({ children, className = "", intensity = 20 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x);
  const mouseYSpring = useSpring(y);

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], [intensity, -intensity]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], [-intensity, intensity]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;

    x.set(xPct);
    y.set(yPct);
  }, [x, y]);

  const handleMouseLeave = useCallback(() => {
    setHover(false);
    x.set(0);
    y.set(0);
  }, [x, y]);

  const handleMouseEnter = useCallback(() => {
    setHover(true);
  }, []);

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
      }}
      className={`relative transition-all duration-200 ease-out ${className}`}
    >
      <div 
        style={{ transform: "translateZ(50px)" }} 
        className={`${hover ? 'scale-105' : 'scale-100'} transition-transform duration-300`}
      >
        {children}
      </div>
      
      {/* Glare effect */}
      <div
        className="absolute inset-0 w-full h-full pointer-events-none opacity-0 transition-opacity duration-300 rounded-xl"
        style={{
          opacity: hover ? 0.15 : 0,
          background: `linear-gradient(125deg, transparent 40%, rgba(255,255,255,0.8) 45%, rgba(255,255,255,0) 50%)`,
          mixBlendMode: 'overlay',
          transform: 'translateZ(60px)'
        }}
      />
    </motion.div>
  );
};

export default ThreeDTilt;