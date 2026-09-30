import React from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { ButtonLink } from "../components/ui/Button";
import { AppShell } from "../components/app/AppNav";
import { CrossRow } from "../components/ui/Chrome";
import PixelText from "../components/ui/pixel/PixelText";
import { useAuth } from "../contexts/AuthContext";

const NotFoundPage: React.FC = () => {
  const { isLoggedIn } = useAuth();
  return (
    <AppShell>
      <p className="label text-fg-3">Error</p>
      <h1 className="mt-6">
        <PixelText text="404" intro="mount" ripple label="404" className="h-[clamp(7rem,26vw,22rem)] text-fg" />
      </h1>
      <CrossRow className="mt-12" at={[0, 62, 100]} />
      <div className="mt-10 grid gap-8 md:grid-cols-12 md:gap-6">
        <p className="max-w-[22ch] text-[clamp(1.5rem,2.6vw,2.25rem)] font-medium leading-[1.06] tracking-[-0.04em] text-fg md:col-span-7">
          This page does not exist. The link may be old, or the address has a typo.
        </p>
        <div className="md:col-span-4 md:col-start-9 md:self-end">
          <ButtonLink to={isLoggedIn ? "/dashboard" : "/"} variant="primary" size="lg" className="group w-full justify-between">
            {isLoggedIn ? "Back to lobby" : "Go home"}
            <ArrowRight weight="bold" className="size-4 transition-transform group-hover:translate-x-1" />
          </ButtonLink>
        </div>
      </div>
    </AppShell>
  );
};

export default NotFoundPage;
