import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { readFoundationBillingCatalogue } from "@/lib/foundation/billing-catalogue";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { FoundationBillingClient } from "./billing-client";
export async function FoundationBillingPage() {
  const catalogue = await readFoundationBillingCatalogue(foundationServerPublicApi());
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="container-page flex-1 py-8">
        <FoundationBillingClient catalogue={catalogue} />
      </main>
      <Footer />
    </div>
  );
}
