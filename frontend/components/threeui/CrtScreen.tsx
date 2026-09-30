import React from "react";
import { CrtBackground, type CrtBackgroundProps } from "./crt/CrtBackground";
import { useReducedMotion } from "../../lib/motion";
import "./threeui.css";

/**
 * Wraps ThreeUI's <CrtBackground /> (vendored unmodified in ./crt) with two app
 * concerns the component leaves to its host:
 *  - WebGL failure: createCrtRenderer throws without WebGL, so an error boundary
 *    swaps in the variant's flat colour instead of taking the page down.
 *  - Reduced motion: time is frozen (speed 0, motion 0) so transport noise and
 *    flicker hold still.
 */
class CrtErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("CrtBackground unavailable, showing static fallback", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const FALLBACK_BACKGROUND = "linear-gradient(180deg, #212ec0 0%, #1a22a4 62%, #141a86 100%)";

const CrtScreen: React.FC<CrtBackgroundProps> = (props) => {
  const reduced = useReducedMotion();
  const motionProps = reduced ? { speed: 0, motion: 0 } : {};
  return (
    <CrtErrorBoundary fallback={<div className="absolute inset-0" style={{ background: FALLBACK_BACKGROUND }} aria-hidden="true" />}>
      <CrtBackground {...props} {...motionProps} />
    </CrtErrorBoundary>
  );
};

export default CrtScreen;
