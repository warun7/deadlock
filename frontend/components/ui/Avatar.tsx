import React, { useState } from "react";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}

/** Squircle avatar. Falls back to initials if there is no image or it fails to load. */
const Avatar: React.FC<AvatarProps> = ({ src, name, size = 32, className = "" }) => {
  const [broken, setBroken] = useState(false);
  const initials = name
    .replace(/[^a-zA-Z0-9 _]/g, "")
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  const radius = Math.round(size * 0.3);
  const showImage = src && !broken;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-surface-3 font-semibold text-fg-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] ${className}`}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.max(10, size * 0.38) }}
    >
      {showImage ? (
        <img
          src={src!}
          alt=""
          className="size-full object-cover"
          onError={() => setBroken(true)}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
};

export default Avatar;
