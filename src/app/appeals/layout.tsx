import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export const metadata = {
  title: "Decisions and appeals",
  description: "See moderation decisions on your account and ask for an independent review.",
  robots: { index: false, follow: false },
};

export default function AppealsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1 px-4 py-8 sm:py-12">
        <div className="mx-auto w-full max-w-2xl space-y-6">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
