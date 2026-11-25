export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="container-x flex justify-center py-12 sm:py-16"><div className="w-full max-w-[420px]">{children}</div></div>;
}
