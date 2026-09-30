import React from "react";
import { ButtonLink } from "../components/ui/Button";
import Wordmark from "../components/ui/Wordmark";
import { useAuth } from "../contexts/AuthContext";

const NotFoundPage: React.FC = () => {
  const { isLoggedIn } = useAuth();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-5 text-center">
      <Wordmark className="text-[17px] text-fg" />
      <p className="tabular mt-12 font-mono text-sm text-fg-3">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-fg">This page does not exist</h1>
      <p className="mt-2 max-w-[36ch] text-[15px] text-fg-2">The link may be old, or the address has a typo.</p>
      <ButtonLink to={isLoggedIn ? "/dashboard" : "/"} className="mt-8">
        {isLoggedIn ? "Back to lobby" : "Go home"}
      </ButtonLink>
    </div>
  );
};

export default NotFoundPage;
