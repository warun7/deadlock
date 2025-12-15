import React, { useEffect, useState } from 'react';
import { motion, useSpring, useMotionValue } from 'framer-motion';

const Cursor: React.FC = () => {
  const [hovered, setHovered] = useState(false);
  
  const mouseX = useMotionValue(-100);
  const mouseY = useMotionValue(-100);

  const springConfig = { damping: 25, stiffness: 400 };
  const cursorX = useSpring(mouseX, springConfig);
  const cursorY = useSpring(mouseY, springConfig);

  useEffect(() => {
    const moveCursor = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.closest('button') || target.closest('a')) {
        setHovered(true);
      } else {
        setHovered(false);
      }
    };

    window.addEventListener('mousemove', moveCursor);
    window.addEventListener('mouseover', handleMouseOver);

    return () => {
      window.removeEventListener('mousemove', moveCursor);
      window.removeEventListener('mouseover', handleMouseOver);
    };
  }, [mouseX, mouseY]);

  return (
    <>
      {/* Trailing Circle */}
      <motion.div
        className="fixed top-0 left-0 w-8 h-8 rounded-full border border-red-500/50 pointer-events-none z-[9999] mix-blend-difference flex items-center justify-center"
        style={{
          translateX: cursorX,
          translateY: cursorY,
          x: -16,
          y: -16,
        }}
      >
        <motion.div 
          animate={{ scale: hovered ? 1.5 : 0 }}
          className="w-full h-full bg-red-500/10 rounded-full"
        />
      </motion.div>

      {/* Center Dot */}
      <motion.div
        className="fixed top-0 left-0 w-1.5 h-1.5 bg-red-500 rounded-full pointer-events-none z-[10000]"
        style={{
            translateX: mouseX,
            translateY: mouseY,
            x: -3,
            y: -3
        }}
      />
    </>
  );
};

export default Cursor;