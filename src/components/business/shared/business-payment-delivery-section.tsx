"use client";

import { CreditCard, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BusinessPaymentDeliverySectionProps {
  paymentMethods: string[] | null;
  deliveryAvailable: boolean;
}

export function BusinessPaymentDeliverySection({
  paymentMethods,
  deliveryAvailable,
}: BusinessPaymentDeliverySectionProps) {
  const hasPayment = paymentMethods && paymentMethods.length > 0;
  if (!hasPayment && !deliveryAvailable) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {hasPayment && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {paymentMethods.map((method) => (
                <Badge key={method} variant="outline" className="capitalize">
                  {method.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {deliveryAvailable && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4 text-muted-foreground" />
              Delivery
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">Available</Badge>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
