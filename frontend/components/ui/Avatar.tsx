import React, { useState } from "react";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}

/** Square avatar. Falls back to mono initials if there is no image or it fails to load. */
const Avatar: React.FC<AvatarProps> = ({ src, name, size = 32, className = "" }) => {
  const [broken, setBroken] = useState(false);
  const initials =
    name
      .replace(/[^a-zA-Z0-9 _]/g, "")
      .split(/[\s_]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  const showImage = src && !broken;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-bg-2 font-mono font-medium text-fg ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.34) }}
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
