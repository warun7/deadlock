import React, { useEffect, useRef, useState } from "react";
import {
  LiquidMetalLayout,
  LiquidMetalRenderer,
} from "./liquidMetalRenderer";
import { useReducedMotion } from "../../lib/motion";

interface LiquidMetalProps {
  className?: string;
  layout: (width: number, height: number) => LiquidMetalLayout;
  /** Read every frame. 0 = drops locked together, 1 = pulled apart. */
  splitRef?: React.MutableRefObject<number>;
  /** Lower-cost preset for secondary placements (auth panel, queue screen). */
  quality?: "high" | "low";
  /** Called once the first frame is on screen, or when WebGL is unavailable. */
  onReady?: (webgl: boolean) => void;
}

/**
 * Static stand-in for devices without WebGL: two layered radial gradients
 * approximating the chrome drops.
 */
const Fallback: React.FC<{ className?: string }> = ({ className }) => (
  <div className={className} aria-hidden="true">
    <div className="absolute inset-0 [background:radial-gradient(38%_42%_at_64%_48%,#d9d9de_0%,#6b6b72_38%,#1a1a1f_70%,transparent_72%),radial-gradient(26%_30%_at_78%_60%,#f0a3a6_0%,#8f2a30_40%,#1a1013_72%,transparent_74%)] opacity-80 max-md:[background:radial-gradient(46%_26%_at_45%_28%,#d9d9de_0%,#6b6b72_38%,#1a1a1f_70%,transparent_72%),radial-gradient(30%_18%_at_62%_36%,#f0a3a6_0%,#8f2a30_40%,#1a1013_72%,transparent_74%)]" />
  </div>
);

const LiquidMetal: React.FC<LiquidMetalProps> = ({
  className,
  layout,
  splitRef,
  quality = "high",
  onReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!LiquidMetalRenderer.isSupported()) {
      setFailed(true);
      onReadyRef.current?.(false);
      return;
    }

    let renderer: LiquidMetalRenderer | null = null;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    try {
      renderer = new LiquidMetalRenderer(canvas, {
        reducedMotion: reduced,
        maxDpr: quality === "high" ? 1.5 : 1.25,
        renderScale: quality === "high" ? (coarse ? 0.7 : 1) : 0.6,
        minRenderScale: quality === "high" ? 0.45 : 0.35,
        layout: (w, h) => layoutRef.current(w, h),
        getSplit: splitRef ? () => splitRef.current : undefined,
      });
      requestAnimationFrame(() => onReadyRef.current?.(true));
    } catch (err) {
      console.warn("LiquidMetal: falling back to static render", err);
      setFailed(true);
      onReadyRef.current?.(false);
    }

    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      renderer?.destroy();
    };
  }, [reduced, quality, splitRef]);

  if (failed) return <Fallback className={className} />;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
};

export default LiquidMetal;
