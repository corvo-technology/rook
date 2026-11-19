import type { AdapterDescriptor } from "./types.js";

/**
 * Partner collection for white-label customers (docs/partner-commerce.md, sections 4.2, 7.2 and
 * 12). The partner is the merchant: every charge happens on the partner's connected account and
 * Rook takes `applicationFeeMinor`. Product code owns who pays what and when credit is granted;
 * adapters own the vendor API and translate its events into `NormalizedPaymentEvent`. It sits
 * beside `BillingProvider`, which sells Rook's own plans and knows nothing of connected accounts.
 */

/** Where a partner's connected account stands; `active` means it can charge and be paid out. */
export type ConnectState = "none" | "pending" | "restricted" | "active" | "disabled";

export interface ConnectedAccountStatus {
  account: string;
  state: ConnectState;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** What the vendor still needs from the partner; empty when nothing is due. */
  requirementsDue: string[];
}

export interface PaymentCheckoutBase {
  /** The partner's connected account. */
  account: string;
  currency: string;
  /** What the customer pays. */
  amountMinor: number;
  /** What Rook keeps; `amountMinor` minus this reaches the partner. */
  applicationFeeMinor: number;
  /** Shown on the checkout and the receipt, in the partner's brand. */
  productName: string;
  customerEmail?: string;
  /** An existing customer on the connected account, so a card is not asked for twice. */
  customerRef?: string;
  /** Echoed back on the events this payment produces; ids only, never customer content. */
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentRefundResult {
  refundRef: string;
  refundedMinor: number;
}

export interface ApplicationFeeRecord {
  ref: string;
  account: string;
  currency: string;
  amountMinor: number;
  refundedMinor: number;
  createdAt: Date;
}

export type PaymentRemoteStatus =
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "paused";

/** What a vendor event means to Rook, with no vendor field names left in it. */
export type NormalizedPaymentEvent = { eventRef: string; account: string | null } & (
  | { type: "account.updated"; status: ConnectedAccountStatus }
  | {
      /** A subscription charge was paid: the first one, a renewal or a plan change. */
      type: "subscription.paid";
      subscriptionRef: string;
      customerRef: string | null;
      invoiceRef: string;
      /** Names the charge: the payment ref a refund will carry, then the invoice's. */
      paymentRefs: string[];
      amountMinor: number;
      currency: string;
      periodStart: Date;
      periodEnd: Date;
      reason: "create" | "cycle" | "update" | "other";
      metadata: Record<string, string>;
    }
  | {
      type: "subscription.payment_failed";
      subscriptionRef: string;
      customerRef: string | null;
      invoiceRef: string;
      metadata: Record<string, string>;
    }
  | {
      type: "subscription.updated";
      subscriptionRef: string;
      customerRef: string | null;
      status: PaymentRemoteStatus;
      periodStart: Date | null;
      periodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      metadata: Record<string, string>;
    }
  | {
      /** A subscription invoice that is still a draft: the last moment to set its fee. */
      type: "invoice.draft";
      invoiceRef: string;
      subscriptionRef: string;
      amountDueMinor: number;
      currency: string;
      metadata: Record<string, string>;
    }
  | {
      type: "topup.paid";
      paymentRefs: string[];
      customerRef: string | null;
      amountMinor: number;
      currency: string;
      metadata: Record<string, string>;
    }
  | {
      type: "payment.refunded";
      paymentRefs: string[];
      /** Everything refunded on the payment so far, so a repeated event adds nothing. */
      refundedMinor: number;
      /** What the customer paid, so Rook's fee can be handed back in proportion. */
      chargeAmountMinor: number;
      applicationFeeRef: string | null;
      currency: string;
    }
  | {
      type: "payment.disputed";
      disputeRef: string;
      paymentRefs: string[];
      amountMinor: number;
      currency: string;
      reason: string;
      status: string;
    }
  | {
      type: "payout.paid" | "payout.failed";
      payoutRef: string;
      amountMinor: number;
      currency: string;
      arrivedAt: Date | null;
    }
);

export interface PaymentsProvider {
  describe(): AdapterDescriptor<{ connect: boolean; portal: boolean }>;
  /** Opens an account for the partner, or returns the one already opened for the same partner. */
  createConnectedAccount(input: {
    partnerId: string;
    country: string;
    email?: string;
    businessName: string;
  }): Promise<{ account: string }>;
  /** A short-lived address where the partner finishes onboarding. */
  createOnboardingLink(input: {
    account: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }>;
  getAccountStatus(account: string): Promise<ConnectedAccountStatus>;
  /** A short-lived address into the partner's own dashboard for the account. */
  createDashboardLink(account: string): Promise<{ url: string }>;
  createSubscriptionCheckout(input: PaymentCheckoutBase): Promise<{ url: string }>;
  createTopUpCheckout(input: PaymentCheckoutBase): Promise<{ url: string }>;
  /** Card change and cancellation for a customer of the connected account. */
  createCustomerPortal(input: {
    account: string;
    customerRef: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  /** Moves a live subscription to another price; the fee follows for the charges to come. */
  changeSubscriptionPlan(input: {
    account: string;
    subscriptionRef: string;
    currency: string;
    amountMinor: number;
    applicationFeeMinor: number;
    productName: string;
    metadata: Record<string, string>;
    /** "now" charges the difference for the rest of the period; "none" changes the next charge only. */
    proration: "now" | "none";
  }): Promise<void>;
  /** Sets Rook's exact fee on a subscription invoice that has not been finalized yet. */
  setInvoiceApplicationFee(input: {
    account: string;
    invoiceRef: string;
    applicationFeeMinor: number;
  }): Promise<void>;
  /**
   * Hands Rook's fee back in proportion to what was refunded, for a refund the partner made on its
   * own. A no-op when the vendor already did, and safe to repeat.
   */
  refundApplicationFee(input: {
    applicationFeeRef: string;
    chargeAmountMinor: number;
    refundedMinor: number;
  }): Promise<void>;
  /**
   * Brings Rook's net fee on a payment down to `targetFeeMinor` by handing back the excess. A first
   * invoice is charged with a percentage that never rounds below Rook's share; this makes it exact.
   * A no-op when the fee is already at or under the target, and safe to repeat.
   */
  trimApplicationFee(input: {
    account: string;
    paymentRef: string;
    targetFeeMinor: number;
  }): Promise<void>;
  /** Refunds a payment; Rook's application fee is handed back in proportion by the vendor. */
  refund(input: {
    account: string;
    paymentRef: string;
    amountMinor?: number;
    /** Repeating a refund under one key refunds once. */
    key: string;
  }): Promise<PaymentRefundResult>;
  /** What Rook took in fees between two moments, for reconciliation against the ledger. */
  listApplicationFees(input: { from: Date; to: Date }): Promise<ApplicationFeeRecord[]>;
  /** Verifies the signature. `null` means the request is not authentic. */
  parseWebhook(rawBody: string, headers: Headers): NormalizedPaymentEvent | "ignored" | null;
}
