import { beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import { navigateToFoundationCheckout } from "./checkout-navigation";
const account = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const result = {
  account_id: account,
  paymentId: "00000000-0000-4000-8000-000000000003",
  checkoutUrl: "https://one.ozow.com/checkout/example",
};
const navigate = vi.fn();
beforeEach(() => {
  navigate.mockReset();
  useAuthStore.setState({
    user: { id: account, email: "test@example.invalid", displayName: "Member", role: "member" },
  });
});
it("opens only an authenticated account's verified HTTPS checkout", () => {
  navigateToFoundationCheckout(result, account, navigate);
  expect(navigate).toHaveBeenCalledExactlyOnceWith(result.checkoutUrl);
});
it("does not follow an earlier response after sign-out or an account switch", () => {
  for (const user of [
    null,
    { id: other, email: "test@example.invalid", displayName: "Other", role: "member" },
  ]) {
    useAuthStore.setState({ user });
    expect(() => navigateToFoundationCheckout(result, account, navigate)).toThrow(
      "account changed"
    );
  }
  expect(navigate).not.toHaveBeenCalled();
});
it("rejects a checkout created under different response cookies", () => {
  expect(() =>
    navigateToFoundationCheckout({ ...result, account_id: other }, account, navigate)
  ).toThrow();
  expect(navigate).not.toHaveBeenCalled();
});
it.each([
  "http://one.ozow.com/",
  "https://ozow.com.attacker.invalid/",
  "https://one.ozow.com@attacker.invalid/",
  "https://user:password@one.ozow.com/",
  "https://one.ozow.com:444/",
  "javascript:alert(1)",
])("refuses an unverified destination %s", (checkoutUrl) => {
  expect(() =>
    navigateToFoundationCheckout({ ...result, checkoutUrl }, account, navigate)
  ).toThrow();
  expect(navigate).not.toHaveBeenCalled();
});
