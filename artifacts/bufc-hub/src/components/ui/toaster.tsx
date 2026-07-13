import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose, ToastAction } from "@radix-ui/react-toast"
import { useToast } from "./use-toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props} className="bg-popover border border-border text-foreground shadow-lg rounded-md p-4 flex justify-between gap-2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full">
            <div className="grid gap-1">
              {title && <ToastTitle className="text-sm font-semibold">{title}</ToastTitle>}
              {description && (
                <ToastDescription className="text-sm opacity-90">{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose className="rounded-md p-1 opacity-50 hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring" />
          </Toast>
        )
      })}
      <ToastViewport className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]" />
    </ToastProvider>
  )
}
