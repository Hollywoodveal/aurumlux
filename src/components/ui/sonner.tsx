import { Toaster as Sonner } from "sonner";

import { useAppTheme } from "@/hooks/useAppTheme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const appTheme = useAppTheme();

  return (
    <Sonner
      className="toaster group"
      // Sonner paints from its own --normal-* variables, which beat utility
      // classes on the toast, so the palette has to be handed to it directly —
      // otherwise every toast is stark white, whatever the theme.
      theme={appTheme === "dark" ? "dark" : "light"}
      // Installed to a home screen there is no browser chrome to push toasts
      // clear of the notch, so a top-centre toast lands under the status bar
      // and the Dynamic Island. Both offsets have to be set: Sonner switches to
      // mobileOffset under 600px and it does not inherit from offset.
      offset={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
      mobileOffset={{
        top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
        left: "0.75rem",
        right: "0.75rem",
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:border group-[.toaster]:border-gold/25 group-[.toaster]:shadow-lux",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
